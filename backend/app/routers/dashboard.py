from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..calculations import compute_dashboard
from ..converters import to_debt_input, to_goal_input, to_pnl_input
from ..database import get_db
from ..models import DailyPnl, Debt, GoalSettings

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard")
async def get_dashboard(db: AsyncSession = Depends(get_db)):
    goal = (await db.execute(select(GoalSettings))).scalars().first()
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal settings not found")
    debts = (await db.execute(select(Debt))).scalars().all()
    pnl = (await db.execute(select(DailyPnl))).scalars().all()

    return compute_dashboard(
        to_goal_input(goal),
        [to_debt_input(d) for d in debts],
        [to_pnl_input(p) for p in pnl],
    )
