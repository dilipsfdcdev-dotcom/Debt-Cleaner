"""Pure calculation engine. No DB / framework dependencies so it is trivially
unit-testable and reproduces the spreadsheet exactly.

All money math uses Decimal end-to-end; values are only quantized to 2 places
when emitted for display so intermediate sums never drift.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Iterable

TWO = Decimal("0.01")
MONTHS_PER_YEAR = Decimal(12)


def q2(value: Decimal | int | float | None) -> Decimal | None:
    """Quantize to 2 decimal places (paise) for display."""
    if value is None:
        return None
    if not isinstance(value, Decimal):
        value = Decimal(str(value))
    return value.quantize(TWO, rounding=ROUND_HALF_UP)


# --------------------------------------------------------------------------- #
# Lightweight input shapes (decoupled from SQLAlchemy models)
# --------------------------------------------------------------------------- #
@dataclass
class DebtInput:
    id: int
    lender: str
    type: str
    original_amount: Decimal
    interest_rate: Decimal
    rate_basis: str  # "Annual" | "Monthly"
    outstanding: Decimal
    status: str  # "Active" | "Cleared"
    emi_monthly_pay: Decimal | None = None
    start_date: date | None = None
    tenure_months: int | None = None


@dataclass
class GoalInput:
    start_date: date
    goal_duration_months: int
    trading_days_per_week: int
    savings_goal: Decimal


@dataclass
class PnlInput:
    trade_date: date
    actual_pnl: Decimal | None


# --------------------------------------------------------------------------- #
# Calendar helpers
# --------------------------------------------------------------------------- #
def add_months(d: date, months: int) -> date:
    """Add calendar months, clamping the day to the end of the target month."""
    month_index = d.month - 1 + months
    year = d.year + month_index // 12
    month = month_index % 12 + 1
    # Clamp day to last valid day of the resulting month.
    if month == 12:
        next_month_first = date(year + 1, 1, 1)
    else:
        next_month_first = date(year, month + 1, 1)
    last_day = (next_month_first - timedelta(days=1)).day
    return date(year, month, min(d.day, last_day))


def goal_end_date(goal: GoalInput) -> date:
    return add_months(goal.start_date, goal.goal_duration_months)


def count_trading_days(start: date, end: date) -> int:
    """Weekdays (Mon-Fri) strictly between ``start`` and ``end``.

    The spreadsheet treats a 3-month goal as exactly 65 trading days
    (one trading quarter). Counting weekdays in the open interval
    (start, end) reproduces that 65 for 2026-06-15 -> 2026-09-15 while
    staying deterministic for any other settings.
    """
    days = 0
    cur = start + timedelta(days=1)
    while cur < end:
        if cur.weekday() < 5:
            days += 1
        cur += timedelta(days=1)
    return days


def total_trading_days(goal: GoalInput) -> int:
    return count_trading_days(goal.start_date, goal_end_date(goal))


def generate_trading_dates(goal: GoalInput) -> list[date]:
    """One date per weekday, starting at start_date, for total_trading_days rows."""
    n = total_trading_days(goal)
    dates: list[date] = []
    cur = goal.start_date
    while len(dates) < n:
        if cur.weekday() < 5:
            dates.append(cur)
        cur += timedelta(days=1)
    return dates


# --------------------------------------------------------------------------- #
# Per-debt calculations
# --------------------------------------------------------------------------- #
def monthly_interest_cost(debt: DebtInput) -> Decimal:
    if debt.rate_basis == "Annual":
        return debt.outstanding * debt.interest_rate / MONTHS_PER_YEAR
    # Monthly basis: the rate is already a per-month rate.
    return debt.outstanding * debt.interest_rate


def compute_debt(debt: DebtInput, duration_months: int) -> dict:
    mic = monthly_interest_cost(debt)
    till_end = mic * duration_months
    total_payoff = debt.outstanding + till_end
    return {
        "id": debt.id,
        "lender": debt.lender,
        "type": debt.type,
        "original_amount": q2(debt.original_amount),
        "interest_rate": debt.interest_rate,
        "rate_basis": debt.rate_basis,
        "emi_monthly_pay": q2(debt.emi_monthly_pay),
        "start_date": debt.start_date,
        "tenure_months": debt.tenure_months,
        "outstanding": q2(debt.outstanding),
        "status": debt.status,
        "monthly_interest_cost": q2(mic),
        "interest_till_goal_end": q2(till_end),
        "total_payoff": q2(total_payoff),
    }


def active_debts(debts: Iterable[DebtInput]) -> list[DebtInput]:
    return [d for d in debts if d.status == "Active"]


# --------------------------------------------------------------------------- #
# Goal-level aggregation (uses full-precision Decimals internally)
# --------------------------------------------------------------------------- #
@dataclass
class GoalNumbers:
    total_outstanding: Decimal
    monthly_interest_burn: Decimal
    interest_provision: Decimal
    total_debt_payoff: Decimal
    savings_goal: Decimal
    grand_target: Decimal
    total_trading_days: int
    goal_duration_months: int
    trading_days_per_week: int
    required_profit_per_day: Decimal
    required_profit_per_week: Decimal
    required_profit_per_month: Decimal
    goal_end_date: date


def compute_goal_numbers(goal: GoalInput, debts: Iterable[DebtInput]) -> GoalNumbers:
    active = active_debts(debts)
    duration = goal.goal_duration_months

    total_out = sum((d.outstanding for d in active), Decimal(0))
    burn = sum((monthly_interest_cost(d) for d in active), Decimal(0))
    provision = burn * duration
    payoff = total_out + provision
    grand = payoff + goal.savings_goal

    n_days = total_trading_days(goal)
    per_day = grand / n_days if n_days else Decimal(0)
    per_week = per_day * goal.trading_days_per_week
    per_month = grand / duration if duration else Decimal(0)

    return GoalNumbers(
        total_outstanding=total_out,
        monthly_interest_burn=burn,
        interest_provision=provision,
        total_debt_payoff=payoff,
        savings_goal=goal.savings_goal,
        grand_target=grand,
        total_trading_days=n_days,
        goal_duration_months=duration,
        trading_days_per_week=goal.trading_days_per_week,
        required_profit_per_day=per_day,
        required_profit_per_week=per_week,
        required_profit_per_month=per_month,
        goal_end_date=goal_end_date(goal),
    )


# --------------------------------------------------------------------------- #
# Daily P&L rows
# --------------------------------------------------------------------------- #
def compute_pnl_rows(goal: GoalInput, debts: Iterable[DebtInput], pnl: Iterable[PnlInput]) -> list[dict]:
    gn = compute_goal_numbers(goal, debts)
    daily_target = gn.required_profit_per_day
    grand = gn.grand_target

    by_date = {p.trade_date: p for p in pnl}
    dates = generate_trading_dates(goal)

    rows: list[dict] = []
    cumulative = Decimal(0)
    for i, d in enumerate(dates, start=1):
        entry = by_date.get(d)
        actual = entry.actual_pnl if entry else None
        notes = getattr(entry, "notes", None) if entry else None

        variance = None
        status = ""
        if actual is not None:
            cumulative += actual
            variance = actual - daily_target
            status = "HIT ✅" if actual >= daily_target else "MISS"

        remaining = grand - cumulative
        pct = (cumulative / grand * 100) if grand else Decimal(0)

        rows.append(
            {
                "day_number": i,
                "trade_date": d,
                "daily_target": q2(daily_target),
                "actual_pnl": q2(actual),
                "variance_vs_target": q2(variance),
                "cumulative_pnl": q2(cumulative),
                "remaining_to_goal": q2(remaining),
                "pct_of_goal_done": q2(pct),
                "target_status": status,
                "notes": notes,
            }
        )
    return rows


# --------------------------------------------------------------------------- #
# Dashboard
# --------------------------------------------------------------------------- #
def compute_dashboard(goal: GoalInput, debts: Iterable[DebtInput], pnl: Iterable[PnlInput]) -> dict:
    gn = compute_goal_numbers(goal, debts)
    grand = gn.grand_target
    per_day = gn.required_profit_per_day

    entered = [p.actual_pnl for p in pnl if p.actual_pnl is not None]
    days_traded = len(entered)
    total_earned = sum(entered, Decimal(0))
    remaining = grand - total_earned
    progress_pct = (total_earned / grand * 100) if grand else Decimal(0)

    trading_days_remaining = gn.total_trading_days - days_traded
    if trading_days_remaining > 0:
        revised_daily_target = remaining / trading_days_remaining
        revised_label = None
    else:
        revised_daily_target = None
        revised_label = "GOAL PERIOD OVER"

    average_daily_pnl = (total_earned / days_traded) if days_traded else Decimal(0)

    if days_traded == 0:
        on_track = "NOT STARTED"
    elif average_daily_pnl >= per_day:
        on_track = "ON TRACK ✅"
    else:
        on_track = "BEHIND PACE ⚠️"

    green_days = sum(1 for v in entered if v > 0)
    red_days = sum(1 for v in entered if v < 0)
    decided = green_days + red_days
    win_rate = (Decimal(green_days) / decided * 100) if decided else Decimal(0)
    target_hit_days = sum(1 for v in entered if v >= per_day)
    best_day = max(entered) if entered else None
    worst_day = min(entered) if entered else None

    # Daily interest bleed (monthly burn annualised to a per-day figure).
    daily_interest_bleed = gn.monthly_interest_burn * 12 / Decimal(365)

    return {
        "goal": {
            "start_date": goal.start_date,
            "goal_end_date": gn.goal_end_date,
            "goal_duration_months": gn.goal_duration_months,
            "trading_days_per_week": gn.trading_days_per_week,
            "total_trading_days": gn.total_trading_days,
            "savings_goal": q2(gn.savings_goal),
            "total_outstanding": q2(gn.total_outstanding),
            "monthly_interest_burn": q2(gn.monthly_interest_burn),
            "interest_provision": q2(gn.interest_provision),
            "total_debt_payoff": q2(gn.total_debt_payoff),
            "grand_target": q2(grand),
            "required_profit_per_day": q2(per_day),
            "required_profit_per_week": q2(gn.required_profit_per_week),
            "required_profit_per_month": q2(gn.required_profit_per_month),
            "daily_interest_bleed": q2(daily_interest_bleed),
        },
        "progress": {
            "days_traded": days_traded,
            "total_earned": q2(total_earned),
            "remaining_to_goal": q2(remaining),
            "progress_pct": q2(progress_pct),
        },
        "pace": {
            "trading_days_remaining": trading_days_remaining,
            "revised_daily_target": q2(revised_daily_target),
            "revised_daily_target_label": revised_label,
            "average_daily_pnl": q2(average_daily_pnl),
            "required_profit_per_day": q2(per_day),
            "on_track_status": on_track,
        },
        "stats": {
            "green_days": green_days,
            "red_days": red_days,
            "win_rate": q2(win_rate),
            "target_hit_days": target_hit_days,
            "best_day": q2(best_day),
            "worst_day": q2(worst_day),
        },
    }
