from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Date,
    DateTime,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from .database import Base

# Precision wide enough for crore-scale INR with paise.
MONEY = Numeric(18, 2)
RATE = Numeric(10, 6)


class GoalSettings(Base):
    __tablename__ = "goal_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    goal_duration_months: Mapped[int] = mapped_column(Integer, nullable=False)
    trading_days_per_week: Mapped[int] = mapped_column(Integer, nullable=False)
    savings_goal: Mapped[Decimal] = mapped_column(MONEY, nullable=False)


class Debt(Base):
    __tablename__ = "debts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lender: Mapped[str] = mapped_column(String(120), nullable=False)
    type: Mapped[str] = mapped_column(String(60), nullable=False)
    original_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    interest_rate: Mapped[Decimal] = mapped_column(RATE, nullable=False)
    rate_basis: Mapped[str] = mapped_column(String(10), nullable=False)  # Annual | Monthly
    emi_monthly_pay: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    tenure_months: Mapped[int | None] = mapped_column(Integer, nullable=True)
    outstanding: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="Active")  # Active | Cleared
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DailyPnl(Base):
    __tablename__ = "daily_pnl"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    day_number: Mapped[int] = mapped_column(Integer, nullable=False)
    trade_date: Mapped[date] = mapped_column(Date, nullable=False, unique=True, index=True)
    actual_pnl: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
