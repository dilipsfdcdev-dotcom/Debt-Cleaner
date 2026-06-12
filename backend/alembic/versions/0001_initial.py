"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-06-12

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MONEY = sa.Numeric(18, 2)
RATE = sa.Numeric(10, 6)


def upgrade() -> None:
    op.create_table(
        "goal_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("start_date", sa.Date(), nullable=False),
        sa.Column("goal_duration_months", sa.Integer(), nullable=False),
        sa.Column("trading_days_per_week", sa.Integer(), nullable=False),
        sa.Column("savings_goal", MONEY, nullable=False),
    )

    op.create_table(
        "debts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("lender", sa.String(120), nullable=False),
        sa.Column("type", sa.String(60), nullable=False),
        sa.Column("original_amount", MONEY, nullable=False),
        sa.Column("interest_rate", RATE, nullable=False),
        sa.Column("rate_basis", sa.String(10), nullable=False),
        sa.Column("emi_monthly_pay", MONEY, nullable=True),
        sa.Column("start_date", sa.Date(), nullable=True),
        sa.Column("tenure_months", sa.Integer(), nullable=True),
        sa.Column("outstanding", MONEY, nullable=False),
        sa.Column("status", sa.String(10), nullable=False, server_default="Active"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "daily_pnl",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("day_number", sa.Integer(), nullable=False),
        sa.Column("trade_date", sa.Date(), nullable=False),
        sa.Column("actual_pnl", MONEY, nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.UniqueConstraint("trade_date", name="uq_daily_pnl_trade_date"),
    )
    op.create_index("ix_daily_pnl_trade_date", "daily_pnl", ["trade_date"])


def downgrade() -> None:
    op.drop_index("ix_daily_pnl_trade_date", table_name="daily_pnl")
    op.drop_table("daily_pnl")
    op.drop_table("debts")
    op.drop_table("goal_settings")
