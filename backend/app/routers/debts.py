from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..calculations import compute_debt
from ..converters import to_debt_input, to_goal_input
from ..database import get_db
from ..models import Debt, GoalSettings
from ..schemas import DebtCreate, DebtResponse, DebtStatusUpdate, DebtUpdate

router = APIRouter(prefix="/api/debts", tags=["debts"])


async def _duration(db: AsyncSession) -> int:
    goal = (await db.execute(select(GoalSettings))).scalars().first()
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal settings not found")
    return goal.goal_duration_months


def _serialize(debt: Debt, duration: int) -> dict:
    return compute_debt(to_debt_input(debt), duration)


@router.get("", response_model=list[DebtResponse])
async def list_debts(db: AsyncSession = Depends(get_db)):
    duration = await _duration(db)
    debts = (await db.execute(select(Debt).order_by(Debt.id))).scalars().all()
    return [_serialize(d, duration) for d in debts]


@router.post("", response_model=DebtResponse, status_code=201)
async def create_debt(payload: DebtCreate, db: AsyncSession = Depends(get_db)):
    duration = await _duration(db)
    debt = Debt(**payload.model_dump())
    db.add(debt)
    await db.commit()
    await db.refresh(debt)
    return _serialize(debt, duration)


@router.put("/{debt_id}", response_model=DebtResponse)
async def update_debt(debt_id: int, payload: DebtUpdate, db: AsyncSession = Depends(get_db)):
    duration = await _duration(db)
    debt = await db.get(Debt, debt_id)
    if debt is None:
        raise HTTPException(status_code=404, detail="Debt not found")
    for key, value in payload.model_dump().items():
        setattr(debt, key, value)
    await db.commit()
    await db.refresh(debt)
    return _serialize(debt, duration)


@router.patch("/{debt_id}/status", response_model=DebtResponse)
async def update_status(debt_id: int, payload: DebtStatusUpdate, db: AsyncSession = Depends(get_db)):
    duration = await _duration(db)
    debt = await db.get(Debt, debt_id)
    if debt is None:
        raise HTTPException(status_code=404, detail="Debt not found")
    debt.status = payload.status
    await db.commit()
    await db.refresh(debt)
    return _serialize(debt, duration)


@router.delete("/{debt_id}", status_code=204)
async def delete_debt(debt_id: int, db: AsyncSession = Depends(get_db)):
    debt = await db.get(Debt, debt_id)
    if debt is None:
        raise HTTPException(status_code=404, detail="Debt not found")
    await db.delete(debt)
    await db.commit()
