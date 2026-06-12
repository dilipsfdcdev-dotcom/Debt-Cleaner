"""Adapters from SQLAlchemy ORM rows to the pure calculation inputs."""
from __future__ import annotations

from .calculations import DebtInput, GoalInput, PnlInput
from .models import DailyPnl, Debt, GoalSettings


def to_goal_input(g: GoalSettings) -> GoalInput:
    return GoalInput(
        start_date=g.start_date,
        goal_duration_months=g.goal_duration_months,
        trading_days_per_week=g.trading_days_per_week,
        savings_goal=g.savings_goal,
    )


def to_debt_input(d: Debt) -> DebtInput:
    return DebtInput(
        id=d.id,
        lender=d.lender,
        type=d.type,
        original_amount=d.original_amount,
        interest_rate=d.interest_rate,
        rate_basis=d.rate_basis,
        outstanding=d.outstanding,
        status=d.status,
        emi_monthly_pay=d.emi_monthly_pay,
        start_date=d.start_date,
        tenure_months=d.tenure_months,
    )


def to_pnl_input(p: DailyPnl) -> PnlInput:
    return PnlInput(trade_date=p.trade_date, actual_pnl=p.actual_pnl)
