from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models import DailyPnl, Debt, GoalSettings
from ..schemas import BackupPayload

router = APIRouter(prefix="/api", tags=["backup"])


def _jsonable(value):
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _row_dict(obj, columns) -> dict:
    return {c: _jsonable(getattr(obj, c)) for c in columns}


GOAL_COLS = ["start_date", "goal_duration_months", "trading_days_per_week", "savings_goal"]
DEBT_COLS = [
    "lender", "type", "original_amount", "interest_rate", "rate_basis",
    "emi_monthly_pay", "start_date", "tenure_months", "outstanding", "status",
]
PNL_COLS = ["day_number", "trade_date", "actual_pnl", "notes"]


@router.get("/export", response_model=BackupPayload)
async def export_data(db: AsyncSession = Depends(get_db)):
    goal = (await db.execute(select(GoalSettings))).scalars().first()
    debts = (await db.execute(select(Debt).order_by(Debt.id))).scalars().all()
    pnl = (await db.execute(select(DailyPnl).order_by(DailyPnl.day_number))).scalars().all()
    return BackupPayload(
        goal_settings=_row_dict(goal, GOAL_COLS) if goal else {},
        debts=[_row_dict(d, DEBT_COLS) for d in debts],
        daily_pnl=[_row_dict(p, PNL_COLS) for p in pnl],
    )


def _to_decimal(v):
    return Decimal(str(v)) if v is not None else None


def _to_date(v):
    return date.fromisoformat(v) if v else None


@router.post("/import")
async def import_data(payload: BackupPayload, db: AsyncSession = Depends(get_db)):
    if not payload.goal_settings:
        raise HTTPException(status_code=400, detail="Backup missing goal_settings")

    # Wipe and replace everything.
    for model in (DailyPnl, Debt, GoalSettings):
        for row in (await db.execute(select(model))).scalars().all():
            await db.delete(row)
    await db.flush()

    g = payload.goal_settings
    db.add(
        GoalSettings(
            start_date=_to_date(g["start_date"]),
            goal_duration_months=int(g["goal_duration_months"]),
            trading_days_per_week=int(g["trading_days_per_week"]),
            savings_goal=_to_decimal(g["savings_goal"]),
        )
    )
    for d in payload.debts:
        db.add(
            Debt(
                lender=d["lender"],
                type=d["type"],
                original_amount=_to_decimal(d["original_amount"]),
                interest_rate=_to_decimal(d["interest_rate"]),
                rate_basis=d["rate_basis"],
                emi_monthly_pay=_to_decimal(d.get("emi_monthly_pay")),
                start_date=_to_date(d.get("start_date")),
                tenure_months=d.get("tenure_months"),
                outstanding=_to_decimal(d["outstanding"]),
                status=d.get("status", "Active"),
            )
        )
    for p in payload.daily_pnl:
        db.add(
            DailyPnl(
                day_number=int(p["day_number"]),
                trade_date=_to_date(p["trade_date"]),
                actual_pnl=_to_decimal(p.get("actual_pnl")),
                notes=p.get("notes"),
            )
        )
    await db.commit()
    return {"status": "ok", "debts": len(payload.debts), "daily_pnl": len(payload.daily_pnl)}
