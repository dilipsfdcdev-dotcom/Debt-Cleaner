"""Idempotent database seed. Safe to run on every startup — it only inserts
when the relevant table is empty.
"""
from __future__ import annotations

import asyncio
from decimal import Decimal

from sqlalchemy import func, select

from .calculations import GoalInput, generate_trading_dates
from .database import AsyncSessionLocal
from .models import DailyPnl, Debt, GoalSettings
from .seed_data import SEED_DEBTS, SEED_GOAL


async def seed() -> None:
    async with AsyncSessionLocal() as session:
        # ---- goal_settings ------------------------------------------------ #
        goal = (await session.execute(select(GoalSettings))).scalars().first()
        if goal is None:
            goal = GoalSettings(**SEED_GOAL)
            session.add(goal)
            await session.flush()

        # ---- debts -------------------------------------------------------- #
        debt_count = (await session.execute(select(func.count()).select_from(Debt))).scalar_one()
        if debt_count == 0:
            for (lender, dtype, orig, rate, basis, emi, sdate, tenure, out) in SEED_DEBTS:
                session.add(
                    Debt(
                        lender=lender,
                        type=dtype,
                        original_amount=Decimal(orig),
                        interest_rate=Decimal(rate),
                        rate_basis=basis,
                        emi_monthly_pay=Decimal(emi) if emi is not None else None,
                        start_date=sdate,
                        tenure_months=tenure,
                        outstanding=Decimal(out),
                        status="Active",
                    )
                )

        # ---- daily_pnl ---------------------------------------------------- #
        pnl_count = (await session.execute(select(func.count()).select_from(DailyPnl))).scalar_one()
        if pnl_count == 0:
            gi = GoalInput(
                start_date=goal.start_date,
                goal_duration_months=goal.goal_duration_months,
                trading_days_per_week=goal.trading_days_per_week,
                savings_goal=goal.savings_goal,
            )
            for i, d in enumerate(generate_trading_dates(gi), start=1):
                session.add(DailyPnl(day_number=i, trade_date=d, actual_pnl=None, notes=None))

        await session.commit()


if __name__ == "__main__":
    asyncio.run(seed())
