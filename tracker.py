#!/usr/bin/env python3
"""
My Debt Tracker - a simple, private, local dashboard.

Run:   python tracker.py
Then the dashboard opens at http://127.0.0.1:8765

Everything is saved in data/tracker.json (a backup copy is kept in
data/backups every time you change something). Nothing leaves your computer.
Only optional dependency: openpyxl (for Excel import / export).
"""

import calendar
import io
import json
import os
import shutil
import sys
import threading
import uuid
import webbrowser
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(APP_DIR, "data")
DATA_FILE = os.path.join(DATA_DIR, "tracker.json")
BACKUP_DIR = os.path.join(DATA_DIR, "backups")
STATIC_DIR = os.path.join(APP_DIR, "static")
HOST = os.environ.get("TRACKER_HOST", "127.0.0.1")
PORT = int(os.environ.get("TRACKER_PORT", "8765"))
MAX_BACKUPS = 30

LOCK = threading.Lock()

KINDS = ("debt", "receivable", "bill", "card")
FREQ_MONTHS = {"monthly": 1, "quarterly": 3, "half-yearly": 6, "yearly": 12}

ITEM_FIELDS = {
    # name: (type, default)
    "kind": (str, "debt"),
    "name": (str, ""),
    "party": (str, ""),
    "category": (str, "Other"),
    "principal": (float, 0.0),
    "outstanding": (float, 0.0),
    "rate": (float, 0.0),
    "rate_unit": (str, "year"),        # "year" (% p.a.) or "month" (% per month)
    "payment": (float, 0.0),           # EMI / monthly interest / bill amount
    "payment_auto": (bool, False),     # True = payment is calculated automatically (EMI or interest)
    "frequency": (str, "monthly"),     # monthly, quarterly, half-yearly, yearly, one-time
    "next_due": (str, ""),             # YYYY-MM-DD
    "start_date": (str, ""),
    "end_date": (str, ""),
    "tenure_months": (float, 0.0),
    "status": (str, "Active"),         # Active / Closed
    "autopay": (bool, False),
    "phone": (str, ""),
    "notes": (str, ""),
    # credit cards
    "credit_limit": (float, 0.0),
    "min_due": (float, 0.0),           # minimum amount due on the current statement
    "statement_day": (float, 0.0),     # day of month the statement is generated
    "card_last4": (str, ""),
}

PAYMENT_FIELDS = {
    "item_id": (str, ""),
    "date": (str, ""),
    "amount": (float, 0.0),
    "principal": (float, 0.0),
    "interest": (float, 0.0),
    "note": (str, ""),
}


# --------------------------------------------------------------------------- storage

def empty_db():
    return {"version": 1, "items": [], "payments": [], "settings": {"currency": "₹"}}


def load_db():
    if not os.path.exists(DATA_FILE):
        return empty_db()
    with open(DATA_FILE, "r", encoding="utf-8") as fh:
        db = json.load(fh)
    base = empty_db()
    base.update(db)
    return base


def save_db(db):
    os.makedirs(BACKUP_DIR, exist_ok=True)
    if os.path.exists(DATA_FILE):
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
        shutil.copy2(DATA_FILE, os.path.join(BACKUP_DIR, "tracker-%s.json" % stamp))
        backups = sorted(os.listdir(BACKUP_DIR))
        for old in backups[:-MAX_BACKUPS]:
            try:
                os.remove(os.path.join(BACKUP_DIR, old))
            except OSError:
                pass
    tmp = DATA_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(db, fh, indent=2, ensure_ascii=False)
    os.replace(tmp, DATA_FILE)


def now_iso():
    return datetime.now().isoformat(timespec="seconds")


def new_id():
    return uuid.uuid4().hex[:12]


def coerce(fields, data, existing=None):
    out = dict(existing or {})
    for key, (typ, default) in fields.items():
        if key in data:
            val = data[key]
            if typ is float:
                try:
                    val = float(str(val).replace(",", "").strip() or 0)
                except ValueError:
                    val = 0.0
            elif typ is bool:
                val = bool(val) and str(val).lower() not in ("false", "0", "no", "")
            else:
                val = "" if val is None else str(val).strip()
            out[key] = val
        elif key not in out:
            out[key] = default
    return out


# --------------------------------------------------------------------------- dates

def parse_date(s):
    if not s:
        return None
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def add_months(d, months, anchor_day=None):
    day = anchor_day or d.day
    m = d.month - 1 + months
    y = d.year + m // 12
    m = m % 12 + 1
    return date(y, m, min(day, calendar.monthrange(y, m)[1]))


def next_occurrence(day, today=None):
    """Next date (today or later) falling on the given day of month."""
    today = today or date.today()
    cand = date(today.year, today.month, min(day, calendar.monthrange(today.year, today.month)[1]))
    if cand < today:
        cand = add_months(cand, 1, day)
    return cand


def advance_due(item):
    months = FREQ_MONTHS.get(item.get("frequency"))
    d = parse_date(item.get("next_due"))
    if not months or not d:
        return item.get("next_due", "")
    anchor = d.day
    start = parse_date(item.get("start_date"))
    if start and start.day > anchor:
        anchor = start.day  # keep e.g. the 31st after a short month
    return add_months(d, months, anchor).isoformat()


# --------------------------------------------------------------------------- calculations

def monthly_rate(item):
    r = float(item.get("rate") or 0) / 100.0
    return r if item.get("rate_unit") == "month" else r / 12.0


def auto_payment(item):
    """EMI when a tenure is known, otherwise the monthly interest on what is outstanding."""
    if item.get("kind") not in ("debt", "receivable"):
        return float(item.get("payment") or 0)
    r = monthly_rate(item)
    n = int(float(item.get("tenure_months") or 0))
    if n and item.get("category") != "Chit":
        p = float(item.get("principal") or 0) or float(item.get("outstanding") or 0)
        if not p:
            return 0.0
        return round(p * r * (1 + r) ** n / ((1 + r) ** n - 1) if r else p / n)
    if item.get("category") == "Chit":
        return float(item.get("payment") or 0)
    return round(float(item.get("outstanding") or 0) * r)


def refresh_auto(item):
    if item.get("payment_auto"):
        item["payment"] = auto_payment(item)
    return item


# --------------------------------------------------------------------------- actions

def upsert_item(db, data):
    item_id = data.get("id")
    if item_id:
        for i, it in enumerate(db["items"]):
            if it["id"] == item_id:
                updated = refresh_auto(coerce(ITEM_FIELDS, data, it))
                updated["updated"] = now_iso()
                db["items"][i] = updated
                return updated
        raise KeyError("Item not found")
    item = refresh_auto(coerce(ITEM_FIELDS, data))
    if item["kind"] not in KINDS:
        item["kind"] = "debt"
    if not item["name"]:
        raise ValueError("Name is required")
    item["id"] = new_id()
    item["created"] = item["updated"] = now_iso()
    db["items"].append(item)
    return item


def delete_item(db, item_id, delete_payments=True):
    db["items"] = [i for i in db["items"] if i["id"] != item_id]
    if delete_payments:
        db["payments"] = [p for p in db["payments"] if p.get("item_id") != item_id]


def find_item(db, item_id):
    for it in db["items"]:
        if it["id"] == item_id:
            return it
    return None


def record_payment(db, data):
    pay = coerce(PAYMENT_FIELDS, data)
    item = find_item(db, pay["item_id"])
    if not item:
        raise KeyError("Item not found")
    if not pay["date"]:
        pay["date"] = date.today().isoformat()
    pay["id"] = new_id()
    pay["kind"] = item["kind"]
    pay["item_name"] = item["name"]
    pay["category"] = item.get("category", "")
    pay["created"] = now_iso()
    pay["prev_next_due"] = item.get("next_due", "")
    pay["prev_outstanding"] = item.get("outstanding", 0)
    pay["prev_status"] = item.get("status", "Active")
    pay["prev_payment"] = item.get("payment", 0)
    pay["prev_min_due"] = item.get("min_due", 0)

    if item["kind"] in ("debt", "receivable", "card") and pay["principal"]:
        item["outstanding"] = round(max(0.0, float(item.get("outstanding") or 0) - pay["principal"]), 2)
        if item["kind"] == "card":
            # this statement is (partly) settled - shrink what is still due on it
            item["payment"] = round(max(0.0, float(item.get("payment") or 0) - pay["amount"]), 2)
            item["min_due"] = round(max(0.0, float(item.get("min_due") or 0) - pay["amount"]), 2)
        elif item["outstanding"] <= 0 and float(item.get("principal") or 0) > 0:
            item["status"] = "Closed"
    if data.get("advance", True):
        if item.get("frequency") == "one-time" and item["kind"] == "bill":
            item["status"] = "Closed"
        else:
            try:
                cycles = max(1, min(600, int(float(data.get("cycles") or 1))))
            except (TypeError, ValueError):
                cycles = 1
            for _ in range(cycles):
                item["next_due"] = advance_due(item)
    refresh_auto(item)  # interest-only instalment shrinks as the balance goes down
    pay["new_next_due"] = item.get("next_due", "")
    item["updated"] = now_iso()
    db["payments"].append(pay)
    return pay, item


def delete_payment(db, pay_id, revert=True):
    pay = next((p for p in db["payments"] if p["id"] == pay_id), None)
    if not pay:
        raise KeyError("Payment not found")
    db["payments"] = [p for p in db["payments"] if p["id"] != pay_id]
    item = find_item(db, pay.get("item_id"))
    if revert and item:
        if item["kind"] in ("debt", "receivable", "card") and pay.get("principal"):
            item["outstanding"] = round(float(item.get("outstanding") or 0) + float(pay["principal"]), 2)
        if item["kind"] == "card" and "prev_payment" in pay:
            item["payment"] = pay["prev_payment"]
            item["min_due"] = pay.get("prev_min_due", item.get("min_due", 0))
        if pay.get("new_next_due") and item.get("next_due") == pay.get("new_next_due"):
            item["next_due"] = pay.get("prev_next_due", item.get("next_due"))
        if pay.get("prev_status"):
            item["status"] = pay["prev_status"]
        refresh_auto(item)
        item["updated"] = now_iso()


# --------------------------------------------------------------------------- Excel

def _require_openpyxl():
    try:
        import openpyxl  # noqa: F401
        return openpyxl
    except ImportError:
        raise RuntimeError("Excel support needs openpyxl. Install it with:  pip install openpyxl")


def _num(v):
    if v is None or v == "":
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v).replace(",", "").replace("₹", "").replace("%", "").strip())
    except ValueError:
        return 0.0


def _date_str(v):
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    if isinstance(v, str):
        for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y", "%d-%b-%Y", "%d %b %Y"):
            try:
                return datetime.strptime(v.strip(), fmt).date().isoformat()
            except ValueError:
                pass
    return ""


CATEGORY_MAP = {
    "hand loan": "Hand Loan",
    "bank loan": "Bank Loan",
    "vehicle": "Vehicle Loan",
    "home": "Home Loan",
    "personal": "Personal Loan",
    "gold": "Gold Loan",
    "credit card": "Credit Card",
    "chit": "Chit",
}


def _category(raw):
    low = (raw or "").lower()
    for key, cat in CATEGORY_MAP.items():
        if key in low:
            return cat
    return raw.strip() if raw else "Other"


def _header_index(header):
    """Map our field names to column positions using fuzzy header matching."""
    rules = [
        ("credit_limit", ("credit limit", "limit")),
        ("min_due", ("minimum", "min due", "min. due")),
        ("statement_day", ("statement day", "statement date", "billing date", "bill date")),
        ("rate_unit", ("rate unit",)),
        ("card_last4", ("last 4", "card no", "card number")),
        ("name", ("lender", "source", "card name", "bill / expense", "name", "person", "party", "who owes")),
        ("frequency", ("frequency", "how often")),
        ("autopay", ("autopay",)),
        ("party", ("contact", "bank")),
        ("category", ("debt type", "type", "category")),
        ("principal", ("principal", "loan amount", "amount borrowed", "sanction")),
        ("rate", ("rate", "interest %", "roi")),
        ("payment", ("monthly", "emi", "statement amount", "total due", "amount due", "bill amount", "payment", "amount (")),
        ("start_date", ("start", "taken on", "disburs")),
        ("tenure_months", ("tenure", "months")),
        ("outstanding", ("outstanding", "balance", "pending", "used")),
        ("status", ("status",)),
        ("notes", ("note", "remark")),
        ("next_due", ("due date", "next due")),
        ("end_date", ("end", "maturity", "closure")),
        ("direction", ("direction", "owe / owed", "i owe")),
    ]
    idx = {}
    low = [(str(h).strip().lower() if h is not None else "") for h in header]
    for field, keys in rules:
        for col, h in enumerate(low):
            if not h or col in idx.values():
                continue
            if any(k in h for k in keys):
                idx[field] = col
                break
    return idx


def parse_excel(blob):
    """Read debts from any sheet that looks like a debt register.

    Works with the original 'Expense_Debt_Tracker.xlsx' (sheet 'Debts Register')
    as well as files exported from this app.
    """
    openpyxl = _require_openpyxl()
    wb = openpyxl.load_workbook(io.BytesIO(blob), data_only=True)
    found = []
    chit = None

    for ws in wb.worksheets:
        title = ws.title.lower()
        rows = list(ws.iter_rows(values_only=True))
        if "chit" in title and "debt" not in title:
            chit = _parse_chit(ws.title, rows) or chit
            continue
        kind = None
        if "credit card" in title or title.strip() in ("cards", "card"):
            kind = "card"
        elif "receiv" in title or "owed to me" in title:
            kind = "receivable"
        elif ("bill" in title or "expense" in title) and "debt" not in title:
            kind = "bill"
        elif "debt" in title or "loan" in title or "register" in title:
            kind = "debt"
        if kind is None:
            continue
        header_row = None
        for r, row in enumerate(rows[:15]):
            cells = [str(c).lower() for c in row if c is not None]
            joined = " | ".join(cells)
            if ("principal" in joined or "outstanding" in joined or "amount" in joined) and len(cells) >= 3:
                header_row = r
                break
        if header_row is None:
            continue
        idx = _header_index(rows[header_row])
        if "name" not in idx:
            continue
        for row in rows[header_row + 1:]:
            def g(field):
                c = idx.get(field)
                return row[c] if c is not None and c < len(row) else None
            name = g("name")
            if name is None or str(name).strip() == "":
                continue
            if str(name).strip().upper().startswith("TOTAL"):
                continue
            category = _category(str(g("category") or ""))
            principal = _num(g("principal"))
            outstanding = _num(g("outstanding")) if idx.get("outstanding") is not None else principal
            payment = _num(g("payment"))
            rate = _num(g("rate"))
            start = _date_str(g("start_date"))
            item = {
                "kind": kind,
                "name": str(name).strip(),
                "category": category if kind != "bill" else (str(g("category") or "Other").strip() or "Other"),
                "principal": principal,
                "outstanding": outstanding,
                "rate": rate,
                # hand loans in India are quoted as % per month (e.g. 1.5 rupees per 100)
                "rate_unit": "month" if (category == "Hand Loan" or (0 < rate <= 3 and kind != "bill")) else "year",
                "payment": payment if kind != "bill" else (payment or principal),
                "frequency": "monthly",
                "start_date": start,
                "tenure_months": _num(g("tenure_months")),
                "status": str(g("status") or "Active").strip() or "Active",
                "notes": str(g("notes") or "").strip(),
                "end_date": _date_str(g("end_date")),
                "party": str(g("party") or "").strip(),
                "autopay": str(g("autopay") or "").strip().lower() in ("yes", "y", "true", "1"),
            }
            freq = str(g("frequency") or "").strip().lower()
            if freq in ("monthly", "quarterly", "half-yearly", "yearly", "one-time"):
                item["frequency"] = freq
            if kind in ("debt", "receivable") and not payment and category != "Chit":
                item["payment_auto"] = True
                item["payment"] = auto_payment(item)
            nd = _date_str(g("next_due"))
            if nd:
                item["next_due"] = nd
            elif start:
                item["next_due"] = next_occurrence(parse_date(start).day).isoformat()
            if not item["end_date"] and start and item["tenure_months"]:
                item["end_date"] = add_months(parse_date(start), int(item["tenure_months"])).isoformat()
            direction = str(g("direction") or "").lower()
            if "receiv" in direction or "owed to me" in direction:
                item["kind"] = "receivable"
            unit = str(g("rate_unit") or "").lower()
            if unit:
                item["rate_unit"] = "month" if "month" in unit else "year"
            if item["kind"] == "card" or category == "Credit Card":
                sd = g("statement_day")
                item.update({
                    "kind": "card", "category": "Credit Card",
                    "credit_limit": _num(g("credit_limit")),
                    "min_due": _num(g("min_due")),
                    "statement_day": float(sd.day) if isinstance(sd, (datetime, date)) else _num(sd),
                    "card_last4": str(g("card_last4") or "").strip()[-4:],
                })
                if not unit:
                    item["rate_unit"] = "month" if 0 < rate <= 5 else "year"
                if not item["outstanding"]:
                    item["outstanding"] = principal
            found.append(item)

    if chit:
        found.append(chit)
    return found


def _parse_chit(title, rows):
    """Turn a chit schedule sheet into one 'Chit' debt with the remaining balance."""
    header_row = None
    for r, row in enumerate(rows[:20]):
        cells = [str(c).strip().lower() for c in row if c is not None]
        if any(c.startswith("net payment") for c in cells) and "status" in cells:
            header_row = r
            break
    if header_row is None:
        return None
    hdr = [str(c).lower() if c is not None else "" for c in rows[header_row]]
    c_due = next((i for i, h in enumerate(hdr) if "due" in h), None)
    c_net = next((i for i, h in enumerate(hdr) if "net payment" in h), None)
    c_status = next((i for i, h in enumerate(hdr) if "status" in h), None)
    value = 0.0
    for row in rows[:header_row]:
        if row and row[0] and "chit value" in str(row[0]).lower():
            value = _num(row[1])
    total = paid = 0.0
    months = paid_months = 0
    schedule = []
    next_due = ""
    next_amt = 0.0
    last_due = ""
    for row in rows[header_row + 1:]:
        if c_net is None or c_net >= len(row) or not isinstance(row[c_net], (int, float)):
            continue
        amt = float(row[c_net])
        status = str(row[c_status] or "") if c_status is not None else ""
        due = _date_str(row[c_due]) if c_due is not None else ""
        if not due or str(row[0] or "").strip().upper().startswith("TOTAL"):
            continue  # skip totals / blank rows
        total += amt
        months += 1
        last_due = due or last_due
        if status.lower() == "paid":
            paid += amt
            paid_months += 1
        else:
            if not next_due:
                next_due, next_amt = due, amt
            schedule.append("%s: %s" % (due, "{:,.0f}".format(amt)))
    if not months:
        return None
    clean = title.strip()
    notes = ("Imported from '%s'. Chit value %s, %d months, %d paid (%s paid so far). "
             "Monthly amount changes - update 'Monthly payment' each month. Remaining schedule: %s"
             % (clean, "{:,.0f}".format(value), months, paid_months, "{:,.0f}".format(paid), "; ".join(schedule)))
    return {
        "kind": "debt", "name": clean, "party": "", "category": "Chit",
        "principal": round(total, 2), "outstanding": round(total - paid, 2),
        "rate": 0, "rate_unit": "year", "payment": next_amt, "frequency": "monthly",
        "next_due": next_due, "start_date": "", "end_date": last_due,
        "tenure_months": months, "status": "Active", "notes": notes,
    }


def import_items(db, items, mode="merge"):
    if mode == "replace":
        kinds = {x["kind"] for x in items}
        db["items"] = [i for i in db["items"] if i["kind"] not in kinds]
        db["payments"] = [p for p in db["payments"] if find_item(db, p.get("item_id"))]
    existing = {(i["kind"], i["name"].lower(), i.get("category", "").lower(), round(float(i.get("principal") or 0)))
                for i in db["items"]}
    added = skipped = 0
    for raw in items:
        key = (raw["kind"], raw["name"].lower(), raw.get("category", "").lower(), round(float(raw.get("principal") or 0)))
        if key in existing:
            skipped += 1
            continue
        upsert_item(db, raw)
        existing.add(key)
        added += 1
    return added, skipped


def export_excel(db):
    openpyxl = _require_openpyxl()
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = openpyxl.Workbook()
    head_fill = PatternFill("solid", fgColor="1F3A5F")
    head_font = Font(bold=True, color="FFFFFF")

    def sheet(ws, title, headers, rows, money_cols=()):
        ws.title = title
        ws.append(headers)
        for c in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=c)
            cell.fill, cell.font = head_fill, head_font
            cell.alignment = Alignment(vertical="center", wrap_text=True)
        for r in rows:
            ws.append(r)
        for c, h in enumerate(headers, start=1):
            letter = get_column_letter(c)
            width = max([len(str(h))] + [len(str(r[c - 1])) for r in rows if r[c - 1] is not None] + [8])
            ws.column_dimensions[letter].width = min(width + 2, 60)
            if c in money_cols:
                for row in ws.iter_rows(min_row=2, min_col=c, max_col=c):
                    for cell in row:
                        cell.number_format = "#,##,##0"
        ws.freeze_panes = "A2"
        if rows:
            n = len(rows) + 1
            total_row = ["TOTAL"] + [None] * (len(headers) - 1)
            ws.append(total_row)
            for c in money_cols:
                L = get_column_letter(c)
                cell = ws.cell(row=n + 1, column=c, value="=SUM(%s2:%s%d)" % (L, L, n))
                cell.number_format = "#,##,##0"
                cell.font = Font(bold=True)
            ws.cell(row=n + 1, column=1).font = Font(bold=True)

    def loan_rows(kind):
        out = []
        for i in db["items"]:
            if i["kind"] != kind:
                continue
            out.append([i["name"], i.get("party", ""), i.get("category", ""), i.get("principal", 0),
                        i.get("rate", 0), "% per month" if i.get("rate_unit") == "month" else "% per year",
                        i.get("payment", 0), i.get("frequency", ""), i.get("next_due", ""),
                        i.get("start_date", ""), i.get("end_date", ""), i.get("tenure_months") or None,
                        i.get("outstanding", 0), i.get("status", ""), i.get("phone", ""), i.get("notes", "")])
        return out

    loan_headers = ["Lender / Source", "Person / Contact", "Debt Type", "Principal (₹)", "Rate", "Rate Unit",
                    "Monthly Payment (₹)", "Frequency", "Next Due Date", "Start Date", "End Date",
                    "Tenure (Mo)", "Outstanding (₹)", "Status", "Phone", "Notes"]
    sheet(wb.active, "Debts Register", loan_headers, loan_rows("debt"), money_cols=(4, 7, 13))
    cards = [[i["name"], i.get("party", ""), i.get("card_last4", ""), i.get("credit_limit", 0),
              i.get("outstanding", 0), i.get("payment", 0), i.get("min_due", 0), i.get("next_due", ""),
              int(i.get("statement_day") or 0) or None, i.get("rate", 0),
              "% per month" if i.get("rate_unit") == "month" else "% per year",
              "Yes" if i.get("autopay") else "No", i.get("status", ""), i.get("notes", "")]
             for i in db["items"] if i["kind"] == "card"]
    sheet(wb.create_sheet(), "Credit Cards",
          ["Card Name", "Bank", "Last 4", "Credit Limit (₹)", "Balance Used (₹)", "Statement Amount (₹)",
           "Minimum Due (₹)", "Payment Due Date", "Statement Day", "Rate", "Rate Unit", "Autopay", "Status",
           "Notes"], cards, money_cols=(4, 5, 6, 7))
    rec_headers = list(loan_headers)
    rec_headers[0], rec_headers[2] = "Name (who owes me)", "Type"
    sheet(wb.create_sheet(), "Receivables", rec_headers, loan_rows("receivable"), money_cols=(4, 7, 13))
    bills = [[i["name"], i.get("category", ""), i.get("payment", 0), i.get("frequency", ""),
              i.get("next_due", ""), "Yes" if i.get("autopay") else "No", i.get("status", ""),
              i.get("notes", "")] for i in db["items"] if i["kind"] == "bill"]
    sheet(wb.create_sheet(), "Bills & Expenses",
          ["Bill / Expense", "Category", "Amount (₹)", "Frequency", "Next Due Date", "Autopay", "Status", "Notes"],
          bills, money_cols=(3,))
    pays = [[p.get("date"), p.get("item_name"), {"debt": "Paid (debt)", "receivable": "Received",
                                                 "bill": "Paid (bill)", "card": "Paid (card)"}.get(p.get("kind"), ""),
             p.get("amount", 0), p.get("principal", 0), p.get("interest", 0), p.get("note", "")]
            for p in sorted(db["payments"], key=lambda p: p.get("date", ""), reverse=True)]
    sheet(wb.create_sheet(), "Payments Log",
          ["Date", "For", "Type", "Amount (₹)", "Principal (₹)", "Interest (₹)", "Note"],
          pays, money_cols=(4, 5, 6))
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# --------------------------------------------------------------------------- HTTP

class Handler(BaseHTTPRequestHandler):
    server_version = "DebtTracker/1.0"

    def log_message(self, fmt, *args):  # keep the console quiet
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _json(self):
        raw = self._body()
        return json.loads(raw.decode("utf-8")) if raw else {}

    def _error(self, exc):
        code = 404 if isinstance(exc, KeyError) else 400
        msg = exc.args[0] if exc.args else str(exc)
        self._send(code, {"error": str(msg)})

    # ---- GET
    def do_GET(self):
        url = urlparse(self.path)
        path = url.path
        if path == "/api/state":
            with LOCK:
                db = load_db()
            db["today"] = date.today().isoformat()
            db["excel_ok"] = _has_openpyxl()
            return self._send(200, db)
        if path == "/api/export.xlsx":
            try:
                with LOCK:
                    blob = export_excel(load_db())
            except RuntimeError as exc:
                return self._error(exc)
            name = "Debt_Tracker_%s.xlsx" % date.today().isoformat()
            return self._send(200, blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                              {"Content-Disposition": 'attachment; filename="%s"' % name})
        if path == "/api/backup.json":
            with LOCK:
                db = load_db()
            name = "Debt_Tracker_backup_%s.json" % date.today().isoformat()
            return self._send(200, json.dumps(db, indent=2, ensure_ascii=False), "application/json",
                              {"Content-Disposition": 'attachment; filename="%s"' % name})
        # static files
        if path in ("/", ""):
            path = "/index.html"
        safe = os.path.normpath(path.lstrip("/"))
        if safe.startswith(".."):
            return self._send(403, {"error": "forbidden"})
        full = os.path.join(STATIC_DIR, safe)
        if not os.path.isfile(full):
            return self._send(404, {"error": "not found"})
        ctype = {
            ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
            ".ico": "image/x-icon",
        }.get(os.path.splitext(full)[1], "application/octet-stream")
        with open(full, "rb") as fh:
            return self._send(200, fh.read(), ctype)

    # ---- POST
    def do_POST(self):
        url = urlparse(self.path)
        q = parse_qs(url.query)
        path = url.path
        try:
            if path == "/api/items":
                data = self._json()
                with LOCK:
                    db = load_db()
                    item = upsert_item(db, data)
                    save_db(db)
                return self._send(200, item)
            if path == "/api/payments":
                data = self._json()
                with LOCK:
                    db = load_db()
                    pay, item = record_payment(db, data)
                    save_db(db)
                return self._send(200, {"payment": pay, "item": item})
            if path == "/api/import/preview":
                items = parse_excel(self._body())
                return self._send(200, {"items": items})
            if path == "/api/import":
                data = self._json()
                with LOCK:
                    db = load_db()
                    added, skipped = import_items(db, data.get("items", []), data.get("mode", "merge"))
                    save_db(db)
                return self._send(200, {"added": added, "skipped": skipped})
            if path == "/api/restore":
                data = self._json()
                if not isinstance(data.get("items"), list) or not isinstance(data.get("payments"), list):
                    raise ValueError("That file is not a Debt Tracker backup")
                db = empty_db()
                db.update({k: data[k] for k in ("items", "payments", "settings") if k in data})
                with LOCK:
                    save_db(db)
                return self._send(200, {"ok": True})
            if path == "/api/reset":
                if q.get("confirm", [""])[0] != "yes":
                    raise ValueError("Missing confirmation")
                with LOCK:
                    save_db(empty_db())
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "not found"})
        except (KeyError, ValueError, RuntimeError) as exc:
            return self._error(exc)
        except Exception as exc:  # pragma: no cover - surface unexpected errors to the UI
            return self._send(500, {"error": "Unexpected error: %s" % exc})

    # ---- DELETE
    def do_DELETE(self):
        url = urlparse(self.path)
        parts = url.path.strip("/").split("/")
        q = parse_qs(url.query)
        try:
            if len(parts) == 3 and parts[:2] == ["api", "items"]:
                with LOCK:
                    db = load_db()
                    delete_item(db, parts[2], q.get("payments", ["yes"])[0] == "yes")
                    save_db(db)
                return self._send(200, {"ok": True})
            if len(parts) == 3 and parts[:2] == ["api", "payments"]:
                with LOCK:
                    db = load_db()
                    delete_payment(db, parts[2], q.get("revert", ["yes"])[0] == "yes")
                    save_db(db)
                return self._send(200, {"ok": True})
            return self._send(404, {"error": "not found"})
        except (KeyError, ValueError) as exc:
            return self._error(exc)


def _has_openpyxl():
    try:
        import openpyxl  # noqa: F401
        return True
    except ImportError:
        return False


def main():
    os.makedirs(DATA_DIR, exist_ok=True)
    try:
        server = ThreadingHTTPServer((HOST, PORT), Handler)
    except OSError:
        print("Port %d is busy. Is the tracker already running? Try: TRACKER_PORT=8766 python tracker.py" % PORT)
        sys.exit(1)
    url = "http://%s:%d" % ("127.0.0.1" if HOST in ("0.0.0.0", "") else HOST, PORT)
    print("=" * 60)
    print("  My Debt Tracker is running:  %s" % url)
    print("  Data file: %s" % DATA_FILE)
    if not _has_openpyxl():
        print("  (Excel import/export disabled - run: pip install openpyxl)")
    print("  Press Ctrl+C to stop.")
    print("=" * 60)
    if "--no-browser" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped. Your data is saved.")


if __name__ == "__main__":
    main()
