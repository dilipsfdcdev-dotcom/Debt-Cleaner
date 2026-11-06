# My Debt Tracker

A simple, private dashboard to track **everything you owe, everything owed to you, credit cards, and monthly bills** — running on your own computer. No accounts, no internet, no database to install.

## Start it

You need **Python 3.8+** (already on Mac/Linux; on Windows get it from python.org and tick *“Add to PATH”*).

| Windows | Mac / Linux |
|---|---|
| Double-click **`start-windows.bat`** | Run `./start-mac-linux.sh` in Terminal |

Or from any terminal:

```bash
pip install openpyxl
```

```bash
python tracker.py
```

Your browser opens **http://127.0.0.1:8765**. Keep the black window open while you use it; close it (or press Ctrl+C) to stop.

## First time: bring in your Excel

Go to **Excel & Backup → Import from Excel**, pick your `Expense_Debt_Tracker.xlsx`, review the list, click **Import selected**. It reads the *Debts Register* sheet, any *Credit Cards / Receivables / Bills* sheets, and turns the chit schedule into a single chit entry with the remaining balance. After that, make all changes from the dashboard.

## What you can track

- **I Owe** — bank loans, home / vehicle / personal loans, gold loans, **hand loans** (interest % per month), chits, business loans, anything else.
- **Credit Cards** — limit, balance used, usage %, statement amount, minimum due, statement day, due date. Pay *statement*, *minimum* or *full balance* in one click.
- **Owed to Me** — money you lent; record what you receive.
- **Bills & Expenses** — rent, electricity, water, internet, mobile, insurance, school fees, subscriptions… monthly / quarterly / yearly / one-time, with autopay flag.
- **Payments** — full history of every payment and receipt, filter by month, **Undo** any entry.

## Automatic calculations

Leave a field blank and it is worked out for you:

| Blank field | Calculated as |
|---|---|
| Monthly payment | **EMI** from principal, rate and tenure — or **interest-only** (outstanding × rate) when there is no tenure. Interest-only amounts shrink automatically as the balance goes down. |
| Outstanding | Balance today according to the EMI schedule (start date + tenure), else = principal |
| Next due date | Next instalment date after today, from the start date |
| End date | Start date + tenure |
| Card minimum due | 5% of the statement amount |

And always shown automatically:

- **Interest per month** for every loan, and the **costliest debts** ranked by yearly rate.
- **Missed instalments / arrears** — e.g. *6 dues missed = 6 × ₹4,00,000 = ₹24,00,000* — and an **Overdue now** total.
- **Clears in / payoff date** and **interest still to pay** for each loan; overall **Debt-free by** date; interest-only loans flagged because they never reduce.
- **Paying**: interest/principal split is pre-filled; the principal part reduces the outstanding; the due date moves forward by the number of instalments the amount covers. A loan that reaches ₹0 is marked *Closed*.

Rates: choose **% per year** (bank loans) or **% per month** (hand loans — 1.5 means ₹1.50 per ₹100 per month).

## Your data

- Saved in `data/tracker.json` next to the app. Every change also keeps a copy in `data/backups/` (last 30).
- **Excel & Backup** lets you download everything as a formatted Excel file, download/restore a full backup, or start over.
- `data/` is git-ignored, so your figures are never committed.

## Options

- Different port: `TRACKER_PORT=8766 python tracker.py`
- Use from your phone on the same Wi-Fi: `TRACKER_HOST=0.0.0.0 python tracker.py`, then open `http://<your-computer-ip>:8765` (anyone on that Wi-Fi could then open it too).
- Don't auto-open the browser: `python tracker.py --no-browser`

## Files

```
tracker.py           the app (Python standard library + openpyxl for Excel)
static/              the dashboard page (HTML / CSS / JS, works offline)
start-windows.bat    double-click launcher for Windows
start-mac-linux.sh   launcher for Mac / Linux
data/                your data (created on first run, not in git)
```
