from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..calculations import GoalInput, generate_trading_dates, goal_end_date, total_trading_days
from ..converters import to_goal_input
from ..database import get_db
from ..models import DailyPnl, GoalSettings
from ..schemas import SettingsResponse, SettingsUpdate, SettingsUpdateResponse

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _response(goal: GoalSettings) -> SettingsResponse:
    gi = to_goal_input(goal)
    return SettingsResponse(
        id=goal.id,
        start_date=goal.start_date,
        goal_duration_months=goal.goal_duration_months,
        trading_days_per_week=goal.trading_days_per_week,
        savings_goal=goal.savings_goal,
        goal_end_date=goal_end_date(gi),
        total_trading_days=total_trading_days(gi),
    )


@router.get("", response_model=SettingsResponse)
async def get_settings(db: AsyncSession = Depends(get_db)):
    goal = (await db.execute(select(GoalSettings))).scalars().first()
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal settings not found")
    return _response(goal)


@router.put("", response_model=SettingsUpdateResponse)
async def update_settings(payload: SettingsUpdate, db: AsyncSession = Depends(get_db)):
    goal = (await db.execute(select(GoalSettings))).scalars().first()
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal settings not found")

    calendar_changed = (
        payload.start_date != goal.start_date
        or payload.goal_duration_months != goal.goal_duration_months
        or payload.trading_days_per_week != goal.trading_days_per_week
    )

    goal.start_date = payload.start_date
    goal.goal_duration_months = payload.goal_duration_months
    goal.trading_days_per_week = payload.trading_days_per_week
    goal.savings_goal = payload.savings_goal

    orphaned: list = []
    warning = None

    if calendar_changed:
        # Preserve entered P&L whose dates still fall in the new calendar.
        existing = (await db.execute(select(DailyPnl))).scalars().all()
        entered = {r.trade_date: r for r in existing if r.actual_pnl is not None}

        new_dates = generate_trading_dates(to_goal_input(goal))
        new_date_set = set(new_dates)

        orphaned = sorted(d for d in entered if d not in new_date_set)
        if orphaned:
            warning = (
                f"{len(orphaned)} P&L entr"
                + ("y" if len(orphaned) == 1 else "ies")
                + " fall outside the new calendar and will be dropped."
            )

        # Rebuild the calendar, carrying forward any still-valid entries.
        for r in existing:
            await db.delete(r)
        await db.flush()

        for i, d in enumerate(new_dates, start=1):
            prev = entered.get(d)
            db.add(
                DailyPnl(
                    day_number=i,
                    trade_date=d,
                    actual_pnl=prev.actual_pnl if prev else None,
                    notes=prev.notes if prev else None,
                )
            )

    await db.commit()
    await db.refresh(goal)
    return SettingsUpdateResponse(settings=_response(goal), orphaned_dates=orphaned, warning=warning)
