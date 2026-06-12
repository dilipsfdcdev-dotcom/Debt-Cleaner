# Debt Freedom Tracker

A fully local, Dockerised replacement for an Excel-based debt-payoff and daily
trading P&L tracker. It computes — server-side and to the paise — how much
profit per day / week / month you need to clear every active debt (principal +
interest accrued over the goal window) **and** hit a savings goal, then lets you
log daily trading P&L and tracks your pace against that target.

- **Backend:** Python FastAPI (async) · SQLAlchemy 2.0 · Pydantic v2 · Alembic
- **Database:** PostgreSQL 16 with a named volume `debt_tracker_data` (data
  survives container restarts)
- **Frontend:** React 18 + Vite + Tailwind + Recharts
- All money math uses `Decimal` end-to-end — no float drift.
- Currency rendered in Indian digit grouping (₹3,88,09,651) with lakh/crore
  short forms on the dashboard (₹3.88 Cr).

## Quick start

```bash
cp .env.example .env          # optional — sensible defaults are baked in
docker compose up -d --build
```

Then open **http://localhost:3000**.

- Frontend (nginx, proxies `/api` → api): http://localhost:3000
- Backend API + docs: http://localhost:8000/api/health · http://localhost:8000/docs

On first start the API runs Alembic migrations and an **idempotent seed**
(12 debts, goal settings, and 65 trading-day rows). Re-running never duplicates
data — the seed only fills empty tables.

## Mobile / same-network P&L entry

The web container binds `0.0.0.0:3000`, so from a phone on the same Wi-Fi open
`http://<your-computer-ip>:3000` and enter the day's P&L from the Daily P&L
page (tap a cell → type → Enter).

## The four pages

1. **Dashboard** — grand target, progress bar, **Pace Check** (the revised
   daily target is the number to watch), trading stats, cumulative-vs-ideal
   P&L chart, and a monthly interest-burn card ("you're burning ₹X/day").
2. **Daily P&L Tracker** — all 65 days, today highlighted + auto-scrolled,
   inline edit, green/red row tinting, HIT badges, running cumulative & %.
3. **Debt Register** — spreadsheet-style table with computed columns and a
   TOTAL footer (active only), add/edit modal, one-click *Mark Cleared* (drops
   it from totals), collapsed strike-through section for cleared debts.
4. **Goal Settings** — edit the 4 inputs with a live preview of the recomputed
   grand target / daily target before saving.

## Calculations (replicated exactly from the spreadsheet)

Only **Active** debts count anywhere; cleared debts drop out everywhere.

- `monthly_interest_cost` = `outstanding × rate / 12` (Annual) or
  `outstanding × rate` (Monthly)
- `interest_till_goal_end` = `monthly_interest_cost × duration_months`
- `total_payoff` = `outstanding + interest_till_goal_end`
- `grand_target` = `Σ total_payoff + savings_goal`
- `required_profit_per_day` = `grand_target / total_trading_days`

With the seed data this reproduces: outstanding **₹3,88,09,651**, monthly burn
**₹9,10,669.93**, interest provision **₹27,32,009.79**, grand target
**₹5,15,41,660.79**, daily target **₹7,92,948.63**, over **65** trading days
(2026-06-15 → 2026-09-15).

> Trading days = weekdays strictly between start and goal-end date, which yields
> the spreadsheet's 65 (a trading quarter) for the seed window.

## Backup & restore

**JSON backup via the API** (full dataset):

```bash
curl http://localhost:8000/api/export > backup.json
curl -X POST http://localhost:8000/api/import \
     -H "Content-Type: application/json" --data @backup.json
```

**Postgres dump / restore** (binary-faithful):

```bash
# Backup
docker compose exec db pg_dump -U debt debt_tracker > debt_tracker.sql

# Restore (into a running, empty db)
cat debt_tracker.sql | docker compose exec -T db psql -U debt -d debt_tracker
```

## Reset everything

```bash
docker compose down -v        # -v also removes the debt_tracker_data volume
docker compose up -d --build  # fresh DB, re-seeded
```

## Running the tests

The calculation acceptance tests are pure-Python (no DB required):

```bash
cd backend
pip install -r requirements.txt
pytest
```

They assert the seed reproduces the headline numbers above, that marking the
Mamaya hand loan cleared drops outstanding to ₹1,93,09,651 (and burn by
₹5,85,000), and that entering ₹8,00,000 on day 1 flips status to **ON TRACK**
with a revised daily target of `(grand − 8,00,000) / 64`.

## Project layout

```
.
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── app/
│   │   ├── calculations.py   # pure Decimal calc engine (unit-tested)
│   │   ├── models.py · schemas.py · seed.py · converters.py
│   │   └── routers/          # dashboard, settings, debts, pnl, backup
│   ├── alembic/              # migrations
│   └── tests/test_calculations.py
└── frontend/
    └── src/
        ├── pages/            # Dashboard, DailyPnL, DebtRegister, Settings
        └── components/Sidebar.jsx
```
