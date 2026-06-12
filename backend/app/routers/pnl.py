from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..calculations import compute_pnl_rows
from ..converters import to_debt_input, to_goal_input, to_pnl_input
from ..database import get_db
from ..models import DailyPnl, Debt, GoalSettings
from ..schemas import PnlRow, PnlUpsert

router = APIRouter(prefix="/api/pnl", tags=["pnl"])


async def _load(db: AsyncSession):
    goal = (await db.execute(select(GoalSettings))).scalars().first()
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal settings not found")
    debts = (await db.execute(select(Debt))).scalars().all()
    pnl = (await db.execute(select(DailyPnl).order_by(DailyPnl.day_number))).scalars().all()
    return goal, debts, pnl


@router.get("", response_model=list[PnlRow])
async def list_pnl(db: AsyncSession = Depends(get_db)):
    goal, debts, pnl = await _load(db)
    return compute_pnl_rows(
        to_goal_input(goal),
        [to_debt_input(d) for d in debts],
        [to_pnl_input(p) for p in pnl],
    )


@router.put("/{trade_date}", response_model=list[PnlRow])
async def upsert_pnl(trade_date: date, payload: PnlUpsert, db: AsyncSession = Depends(get_db)):
    row = (
        await db.execute(select(DailyPnl).where(DailyPnl.trade_date == trade_date))
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="No trading day for that date")
    row.actual_pnl = payload.actual_pnl
    if payload.notes is not None:
        row.notes = payload.notes
    await db.commit()

    goal, debts, pnl = await _load(db)
    return compute_pnl_rows(
        to_goal_input(goal),
        [to_debt_input(d) for d in debts],
        [to_pnl_input(p) for p in pnl],
    )


@router.delete("/{trade_date}", response_model=list[PnlRow])
async def clear_pnl(trade_date: date, db: AsyncSession = Depends(get_db)):
    row = (
        await db.execute(select(DailyPnl).where(DailyPnl.trade_date == trade_date))
    ).scalars().first()
    if row is None:
        raise HTTPException(status_code=404, detail="No trading day for that date")
    row.actual_pnl = None
    row.notes = None
    await db.commit()

    goal, debts, pnl = await _load(db)
    return compute_pnl_rows(
        to_goal_input(goal),
        [to_debt_input(d) for d in debts],
        [to_pnl_input(p) for p in pnl],
    )
