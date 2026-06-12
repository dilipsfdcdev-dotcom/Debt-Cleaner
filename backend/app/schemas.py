from __future__ import annotations

from datetime import date
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

RateBasis = Literal["Annual", "Monthly"]
DebtStatus = Literal["Active", "Cleared"]


# --------------------------------------------------------------------------- #
# Settings
# --------------------------------------------------------------------------- #
class SettingsBase(BaseModel):
    start_date: date
    goal_duration_months: int = Field(gt=0)
    trading_days_per_week: int = Field(gt=0, le=7)
    savings_goal: Decimal


class SettingsUpdate(SettingsBase):
    pass


class SettingsResponse(SettingsBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    goal_end_date: date
    total_trading_days: int


class SettingsUpdateResponse(BaseModel):
    settings: SettingsResponse
    orphaned_dates: list[date] = []
    warning: Optional[str] = None


# --------------------------------------------------------------------------- #
# Debts
# --------------------------------------------------------------------------- #
class DebtBase(BaseModel):
    lender: str
    type: str
    original_amount: Decimal
    interest_rate: Decimal
    rate_basis: RateBasis
    emi_monthly_pay: Optional[Decimal] = None
    start_date: Optional[date] = None
    tenure_months: Optional[int] = None
    outstanding: Decimal
    status: DebtStatus = "Active"


class DebtCreate(DebtBase):
    pass


class DebtUpdate(DebtBase):
    pass


class DebtStatusUpdate(BaseModel):
    status: DebtStatus


class DebtResponse(DebtBase):
    id: int
    monthly_interest_cost: Decimal
    interest_till_goal_end: Decimal
    total_payoff: Decimal


# --------------------------------------------------------------------------- #
# Daily P&L
# --------------------------------------------------------------------------- #
class PnlUpsert(BaseModel):
    actual_pnl: Optional[Decimal] = None
    notes: Optional[str] = None


class PnlRow(BaseModel):
    day_number: int
    trade_date: date
    daily_target: Decimal
    actual_pnl: Optional[Decimal]
    variance_vs_target: Optional[Decimal]
    cumulative_pnl: Decimal
    remaining_to_goal: Decimal
    pct_of_goal_done: Decimal
    target_status: str
    notes: Optional[str]


# --------------------------------------------------------------------------- #
# Backup
# --------------------------------------------------------------------------- #
class BackupPayload(BaseModel):
    goal_settings: dict
    debts: list[dict]
    daily_pnl: list[dict]
