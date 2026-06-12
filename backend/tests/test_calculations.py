"""Acceptance tests: the seed data must reproduce the spreadsheet exactly."""
from datetime import date
from decimal import Decimal

import pytest

from app.calculations import (
    DebtInput,
    GoalInput,
    PnlInput,
    compute_dashboard,
    compute_goal_numbers,
    compute_pnl_rows,
    generate_trading_dates,
    goal_end_date,
    total_trading_days,
)
from app.seed_data import SEED_DEBTS, SEED_GOAL


def _seed_goal() -> GoalInput:
    return GoalInput(**SEED_GOAL)


def _seed_debts() -> list[DebtInput]:
    debts = []
    for i, (lender, dtype, orig, rate, basis, emi, sdate, tenure, out) in enumerate(SEED_DEBTS, start=1):
        debts.append(
            DebtInput(
                id=i,
                lender=lender,
                type=dtype,
                original_amount=Decimal(orig),
                interest_rate=Decimal(rate),
                rate_basis=basis,
                outstanding=Decimal(out),
                status="Active",
                emi_monthly_pay=Decimal(emi) if emi is not None else None,
                start_date=sdate,
                tenure_months=tenure,
            )
        )
    return debts


def _round2(v) -> Decimal:
    return Decimal(str(v)).quantize(Decimal("0.01"))


# --------------------------------------------------------------------------- #
# Calendar
# --------------------------------------------------------------------------- #
def test_goal_end_date():
    assert goal_end_date(_seed_goal()) == date(2026, 9, 15)


def test_total_trading_days_is_65():
    assert total_trading_days(_seed_goal()) == 65


def test_calendar_has_65_weekday_rows_from_start():
    dates = generate_trading_dates(_seed_goal())
    assert len(dates) == 65
    assert dates[0] == date(2026, 6, 15)
    assert all(d.weekday() < 5 for d in dates)


# --------------------------------------------------------------------------- #
# Aggregate goal numbers
# --------------------------------------------------------------------------- #
def test_seed_aggregate_values():
    gn = compute_goal_numbers(_seed_goal(), _seed_debts())
    assert _round2(gn.total_outstanding) == Decimal("38809651.00")
    assert _round2(gn.monthly_interest_burn) == Decimal("910669.93")
    assert _round2(gn.interest_provision) == Decimal("2732009.79")
    assert _round2(gn.total_debt_payoff) == Decimal("41541660.79")
    assert _round2(gn.grand_target) == Decimal("51541660.79")
    assert _round2(gn.required_profit_per_day) == Decimal("792948.63")
    assert _round2(gn.required_profit_per_week) == Decimal("3964743.14")
    assert _round2(gn.required_profit_per_month) == Decimal("17180553.60")


def test_per_debt_examples():
    debts = {d.lender + "|" + d.type: d for d in _seed_debts()}
    from app.calculations import monthly_interest_cost

    bajaj = debts["Bajaj Finserv|Vehicle Loan"]
    assert _round2(monthly_interest_cost(bajaj)) == Decimal("32399.96")

    mamaya = debts["Hand Loan - Mamaya|Hand Loan (Interest)"]
    assert monthly_interest_cost(mamaya) == Decimal("585000")


# --------------------------------------------------------------------------- #
# Mark Cleared
# --------------------------------------------------------------------------- #
def test_marking_mamaya_cleared_drops_totals():
    debts = _seed_debts()
    for d in debts:
        if d.lender == "Hand Loan - Mamaya":
            d.status = "Cleared"

    gn = compute_goal_numbers(_seed_goal(), debts)
    assert _round2(gn.total_outstanding) == Decimal("19309651.00")
    # burn drops by exactly 585,000
    assert _round2(gn.monthly_interest_burn) == Decimal("325669.93")


# --------------------------------------------------------------------------- #
# P&L + pace
# --------------------------------------------------------------------------- #
def test_entering_day1_pnl_sets_on_track_and_revised_target():
    goal = _seed_goal()
    debts = _seed_debts()
    day1 = generate_trading_dates(goal)[0]
    pnl = [PnlInput(trade_date=day1, actual_pnl=Decimal("800000"))]

    dash = compute_dashboard(goal, debts, pnl)
    assert dash["pace"]["on_track_status"] == "ON TRACK ✅"
    assert dash["pace"]["trading_days_remaining"] == 64

    expected = (Decimal("51541660.79") - Decimal("800000")) / Decimal(64)
    assert dash["pace"]["revised_daily_target"] == expected.quantize(Decimal("0.01"))
    assert dash["progress"]["days_traded"] == 1
    assert dash["stats"]["green_days"] == 1


def test_pnl_rows_cumulative_and_status():
    goal = _seed_goal()
    debts = _seed_debts()
    dates = generate_trading_dates(goal)
    pnl = [
        PnlInput(trade_date=dates[0], actual_pnl=Decimal("800000")),
        PnlInput(trade_date=dates[1], actual_pnl=Decimal("-50000")),
    ]
    rows = compute_pnl_rows(goal, debts, pnl)
    assert rows[0]["target_status"] == "HIT ✅"
    assert rows[0]["cumulative_pnl"] == Decimal("800000.00")
    assert rows[1]["target_status"] == "MISS"
    assert rows[1]["cumulative_pnl"] == Decimal("750000.00")
    assert rows[2]["actual_pnl"] is None
    assert rows[2]["target_status"] == ""


def test_not_started_status():
    dash = compute_dashboard(_seed_goal(), _seed_debts(), [])
    assert dash["pace"]["on_track_status"] == "NOT STARTED"
    assert dash["progress"]["days_traded"] == 0
