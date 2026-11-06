/* My Debt Tracker - dashboard logic (no external libraries, works offline) */
"use strict";

const DEBT_TYPES = ["Hand Loan", "Bank Loan", "Personal Loan", "Home Loan", "Vehicle Loan", "Gold Loan",
  "Credit Card", "Chit", "Business Loan", "Education Loan", "Friends & Family", "Other"];
const BILL_TYPES = ["Rent", "Electricity", "Water", "Gas", "Internet", "Mobile", "DTH / TV", "Insurance",
  "School Fees", "Maintenance", "Maid / Help", "Subscription", "Credit Card Bill", "Tax", "Groceries", "Other"];
const FREQS = [["monthly", "Monthly"], ["quarterly", "Every 3 months"], ["half-yearly", "Every 6 months"],
  ["yearly", "Yearly"], ["one-time", "One time"]];
const FREQ_MONTHS = { monthly: 1, quarterly: 3, "half-yearly": 6, yearly: 12 };
const KIND_LABEL = { debt: "I Owe", card: "Credit Cards", receivable: "Owed to Me", bill: "Bills & Expenses" };
const KIND_SINGULAR = { debt: "debt / loan", card: "credit card", receivable: "receivable", bill: "bill / expense" };

let S = { items: [], payments: [], today: "", excel_ok: false };
let view = (location.hash || "#dashboard").slice(1);
const filters = { debt: { q: "", cat: "", closed: false }, card: { q: "", cat: "", closed: false }, receivable: { q: "", cat: "", closed: false },
  bill: { q: "", cat: "", closed: false }, payments: { q: "", month: "" } };

/* ---------------------------------------------------------------- helpers */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (v) => { const n = parseFloat(String(v == null ? "" : v).replace(/,/g, "")); return isNaN(n) ? 0 : n; };
const nf = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const inr = (n) => (n < 0 ? "−₹" : "₹") + nf.format(Math.abs(Math.round(num(n))));
function short(n) {
  const a = Math.abs(n), sign = n < 0 ? "−" : "";
  if (a >= 1e7) return sign + "₹" + (a / 1e7).toFixed(2).replace(/\.?0+$/, "") + " Cr";
  if (a >= 1e5) return sign + "₹" + (a / 1e5).toFixed(2).replace(/\.?0+$/, "") + " L";
  return inr(n);
}
const parseD = (s) => { if (!s) return null; const [y, m, d] = s.slice(0, 10).split("-").map(Number); return y ? new Date(y, m - 1, d) : null; };
const todayD = () => parseD(S.today) || new Date(new Date().toDateString());
const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const daysUntil = (s) => { const d = parseD(s); return d ? Math.round((d - todayD()) / 864e5) : null; };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtD = (s) => { const d = parseD(s); return d ? d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear() : ""; };
const monthKey = (s) => (s || "").slice(0, 7);
const thisMonth = () => S.today.slice(0, 7);
function monthName(key) { const [y, m] = key.split("-").map(Number); return MONTHS[m - 1] + " " + y; }

const isActive = (i) => (i.status || "Active") !== "Closed";
const ofKind = (k) => S.items.filter((i) => i.kind === k);
const activeOf = (k) => ofKind(k).filter(isActive);
/* ---------------------------------------------------------------- automatic calculations */
const isLoan = (i) => i.kind === "debt" || i.kind === "receivable";
const monthlyRate = (i) => num(i.rate) / 100 / (i.rate_unit === "month" ? 1 : 12);
function addMonths(d, n, anchorDay) {
  const day = anchorDay || d.getDate();
  const y = d.getFullYear(), m = d.getMonth() + n, last = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(day, last));
}
function emiFor(P, r, n) {
  if (!P || !n) return 0;
  return r ? P * r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1) : P / n;
}
function monthlyInterest(i) {
  if (i.category === "Chit" || i.kind === "card" || i.kind === "bill") return 0;
  return num(i.outstanding) * monthlyRate(i);
}
/** The auto-calculated instalment: EMI when a tenure is known, otherwise interest-only. */
function autoPayment(i) {
  if (!isLoan(i)) return 0;
  const n = num(i.tenure_months), r = monthlyRate(i);
  if (n && i.category !== "Chit") return Math.round(emiFor(num(i.principal) || num(i.outstanding), r, n));
  return Math.round(monthlyInterest(i));
}
/** What is actually due each cycle (user's figure, or the automatic one when left blank). */
function payAmt(i) {
  if (i.kind === "card") return num(i.payment) || num(i.min_due);
  if (i.kind === "bill") return num(i.payment);
  return i.payment_auto || !num(i.payment) ? autoPayment(i) : num(i.payment);
}
const cardDue = (i) => payAmt(i);
function monthlyEq(i) {
  if (i.kind === "card") return payAmt(i);
  const m = FREQ_MONTHS[i.frequency];
  return m ? payAmt(i) / m : 0;
}
/** Number of due dates already missed (next_due in the past) and the total arrears. */
function arrears(i) {
  const d0 = parseD(i.next_due), t = todayD();
  if (!isActive(i) || !d0 || d0 >= t) return { missed: 0, amount: 0 };
  const step = FREQ_MONTHS[i.frequency] || 0;
  let k = 0, d = d0;
  while (d < t && k < 600) { k++; if (!step) break; d = addMonths(d0, step * k); }
  return { missed: k, amount: k * payAmt(i) };
}
/** Months left, payoff date and interest still to pay, for loans that amortise. */
function payoff(i) {
  const B = num(i.outstanding), p = payAmt(i), r = i.category === "Chit" ? 0 : monthlyRate(i);
  if (!isLoan(i) || B <= 0) return null;
  if (!p || p <= B * r + 0.5) return { never: true };
  const n = r ? Math.ceil(-Math.log(1 - r * B / p) / Math.log(1 + r)) : Math.ceil(B / p);
  const start = parseD(i.next_due) || todayD();
  return { months: n, date: addMonths(start, n - 1), interest: Math.max(0, p * n - B) };
}
/** Balance an EMI loan should have today according to its schedule (start date + tenure). */
function scheduleBalance(i) {
  const P = num(i.principal), n = num(i.tenure_months), s = parseD(i.start_date), r = monthlyRate(i);
  if (!P || !n || !s || i.category === "Chit") return null;
  const t = todayD();
  let k = (t.getFullYear() - s.getFullYear()) * 12 + (t.getMonth() - s.getMonth());
  if (t.getDate() < s.getDate()) k--;
  k = Math.max(0, Math.min(n, k));
  const E = emiFor(P, r, n);
  const bal = r ? P * Math.pow(1 + r, k) - E * (Math.pow(1 + r, k) - 1) / r : P - E * k;
  return { paid: k, balance: Math.max(0, Math.round(bal)), emi: Math.round(E) };
}
function clearsIn(i) {
  if (!isActive(i)) return "";
  const p = payoff(i);
  if (!p) return '<span class="small-muted">—</span>';
  if (p.never) return '<span class="chip amber" title="Payment only covers interest - the balance never goes down">Interest only</span>';
  return `<span title="≈ ${inr(p.interest)} interest still to pay">${fmtMonths(p.months)}<div class="small-muted">${MONTHS[p.date.getMonth()]} ${p.date.getFullYear()}</div></span>`;
}
const fmtMonths = (n) => n >= 12 ? `${Math.floor(n / 12)}y ${n % 12 ? (n % 12) + "m" : ""}`.trim() : `${n}m`;
const annualRate = (i) => num(i.rate) * (i.rate_unit === "month" ? 12 : 1);
const rateText = (i) => num(i.rate) ? num(i.rate) + "% " + (i.rate_unit === "month" ? "/ month" : "p.a.") : "—";

function dueChip(i) {
  if (!isActive(i)) return '<span class="chip">Closed</span>';
  if (!i.next_due) return '<span class="chip">No date</span>';
  const d = daysUntil(i.next_due);
  const a = arrears(i);
  if (a.missed > 1) return `<span class="chip red" title="${a.missed} instalments missed = ${inr(a.amount)}">${a.missed} dues missed</span>`;
  if (d < 0) return `<span class="chip red">Overdue ${-d}d</span>`;
  if (d === 0) return '<span class="chip red">Due today</span>';
  if (d <= 7) return `<span class="chip amber">In ${d} day${d > 1 ? "s" : ""}</span>`;
  return `<span class="chip">${fmtD(i.next_due)}</span>`;
}
function paidThisMonth(item) {
  return S.payments.filter((p) => p.item_id === item.id && monthKey(p.date) === thisMonth());
}

/* ---------------------------------------------------------------- api */
async function api(method, url, body, raw) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    if (raw) { opts.body = body; } else { opts.body = JSON.stringify(body); opts.headers["Content-Type"] = "application/json"; }
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed (" + res.status + ")");
  return data;
}
async function reload() {
  S = await api("GET", "/api/state");
  render();
}
function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (isErr ? " error" : "");
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), isErr ? 5000 : 2500);
}
async function act(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); await reload(); return r; }
  catch (e) { toast(e.message, true); throw e; }
}

/* ---------------------------------------------------------------- routing */
function setView(v) {
  view = v; location.hash = v;
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  render(); window.scrollTo(0, 0);
}
function render() {
  $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  const app = $("#app");
  if (view === "dashboard") app.innerHTML = renderDashboard();
  else if (KIND_LABEL[view]) app.innerHTML = renderList(view);
  else if (view === "payments") app.innerHTML = renderPayments();
  else if (view === "data") app.innerHTML = renderData();
  else { view = "dashboard"; return render(); }
  bindPage();
}

/* ---------------------------------------------------------------- dashboard */
function renderDashboard() {
  if (!S.items.length) {
    return `<div class="card welcome">
      <h2>Welcome to your debt tracker</h2>
      <p>Bring in your existing Excel sheet in one click, or start adding loans, hand loans, money people owe you and monthly bills.</p>
      <div class="btns">
        <button class="btn primary" data-go="data">Import my Excel</button>
        <button class="btn" data-add="debt">+ Add a debt</button>
        <button class="btn" data-add="card">+ Add a credit card</button>
        <button class="btn" data-add="receivable">+ Add money owed to me</button>
        <button class="btn" data-add="bill">+ Add a monthly bill</button>
      </div></div>`;
  }
  const debts = activeOf("debt"), recs = activeOf("receivable"), bills = activeOf("bill"), cards = activeOf("card");
  const cardBal = cards.reduce((s, i) => s + num(i.outstanding), 0);
  const cardLimit = cards.reduce((s, i) => s + num(i.credit_limit), 0);
  const cardMonthly = cards.reduce((s, i) => s + cardDue(i), 0);
  const owe = debts.reduce((s, i) => s + num(i.outstanding), 0) + cardBal;
  const owed = recs.reduce((s, i) => s + num(i.outstanding), 0);
  const debtMonthly = debts.reduce((s, i) => s + monthlyEq(i), 0);
  const billMonthly = bills.reduce((s, i) => s + monthlyEq(i), 0);
  const interest = debts.reduce((s, i) => s + monthlyInterest(i), 0);
  const recMonthly = recs.reduce((s, i) => s + monthlyEq(i), 0);
  const tm = thisMonth();
  const paidOut = S.payments.filter((p) => monthKey(p.date) === tm && p.kind !== "receivable").reduce((s, p) => s + num(p.amount), 0);
  const received = S.payments.filter((p) => monthKey(p.date) === tm && p.kind === "receivable").reduce((s, p) => s + num(p.amount), 0);

  // upcoming & overdue
  const horizon = 30;
  const dueItems = S.items.filter((i) => isActive(i) && i.next_due && daysUntil(i.next_due) <= horizon)
    .sort((a, b) => a.next_due.localeCompare(b.next_due));
  const overdue = dueItems.filter((i) => daysUntil(i.next_due) < 0 && i.kind !== "receivable");
  const amtDue = payAmt;
  const overdueAmt = overdue.reduce((s, i) => s + arrears(i).amount, 0);
  const lateRec = recs.filter((i) => arrears(i).missed).reduce((s, i) => s + arrears(i).amount, 0);
  const noDate = S.items.filter((i) => isActive(i) && !i.next_due && i.kind !== "receivable" && (payAmt(i) > 0 || i.kind === "card"));
  // debt-free date (loans that actually reduce) + interest-only loans that never reduce
  const pays = debts.map((i) => [i, payoff(i)]).filter((x) => x[1]);
  const amort = pays.filter((x) => !x[1].never);
  const never = pays.filter((x) => x[1].never);
  const lastPay = amort.reduce((m, x) => (!m || x[1].date > m ? x[1].date : m), null);
  const interestLeft = amort.reduce((s, x) => s + x[1].interest, 0);
  const neverAmt = never.reduce((s, x) => s + num(x[0].outstanding), 0);

  const dueHtml = dueItems.length ? `<ul class="due-list">${dueItems.map((i) => {
    const d = daysUntil(i.next_due), dt = parseD(i.next_due);
    const cls = d < 0 ? "red" : d <= 3 ? "amber" : "";
    const a = arrears(i);
    const when = a.missed > 1 ? `<b style="color:var(--red)">${a.missed} instalments missed</b>` : d < 0 ? `Overdue by ${-d} day${d < -1 ? "s" : ""}` : d === 0 ? "Due today" : `In ${d} day${d > 1 ? "s" : ""}`;
    const btn = i.kind === "receivable" ? "Received" : "Paid";
    return `<li>
      <div class="due-date ${cls}"><b>${dt.getDate()}</b><span>${MONTHS[dt.getMonth()]}</span></div>
      <div class="due-main"><div class="name">${esc(i.name)}</div>
        <div class="small-muted">${esc(i.category)} · ${KIND_LABEL[i.kind]} · ${when}${i.autopay ? " · autopay" : ""}${i.kind === "card" && num(i.min_due) ? " · min " + inr(i.min_due) : ""}</div></div>
      <div class="due-amt" ${a.missed > 1 ? `title="${a.missed} × ${inr(amtDue(i))}"` : ""}>${inr(a.missed > 1 ? a.amount : amtDue(i))}${i.payment_auto && i.kind !== "card" ? '<div class="small-muted" style="font-weight:400;text-align:right">auto</div>' : ""}</div>
      <button class="btn small pay" data-pay="${i.id}">${btn}</button></li>`;
  }).join("")}</ul>` : `<div class="empty">Nothing due in the next ${horizon} days 🎉</div>`;

  // paid this month
  const paidList = S.payments.filter((p) => monthKey(p.date) === tm).sort((a, b) => b.date.localeCompare(a.date));
  const paidHtml = paidList.length ? `<ul class="due-list">${paidList.slice(0, 8).map((p) => {
    const dt = parseD(p.date);
    return `<li><div class="due-date green"><b>${dt.getDate()}</b><span>${MONTHS[dt.getMonth()]}</span></div>
      <div class="due-main"><div class="name">${esc(p.item_name)}</div>
      <div class="small-muted">${p.kind === "receivable" ? "Received" : "Paid"}${num(p.interest) ? " · interest " + inr(p.interest) : ""}${num(p.principal) ? " · principal " + inr(p.principal) : ""}</div></div>
      <div class="due-amt">${inr(p.amount)}</div></li>`;
  }).join("")}</ul>${paidList.length > 8 ? `<div class="small-muted" style="margin-top:8px"><a href="#payments" data-go="payments">See all ${paidList.length}</a></div>` : ""}`
    : `<div class="empty">No payments recorded this month yet.<br><span class="small-muted">Click “Paid” on a due item to record it.</span></div>`;

  // by type
  const byCat = {};
  debts.concat(cards).forEach((i) => { const c = i.kind === "card" ? "Credit Card" : (i.category || "Other"); byCat[c] = byCat[c] || { out: 0, mon: 0, n: 0 }; byCat[c].out += num(i.outstanding); byCat[c].mon += monthlyEq(i); byCat[c].n++; });
  const cats = Object.entries(byCat).sort((a, b) => b[1].out - a[1].out);
  const maxOut = Math.max(1, ...cats.map((c) => c[1].out));
  const barsHtml = cats.length ? `<div class="bars">${cats.map(([c, v]) => `
    <div class="bar-row" title="${esc(c)}: ${inr(v.out)} outstanding, ${inr(v.mon)}/month, ${v.n} item(s)">
      <div>${esc(c)} <span class="small-muted">(${v.n})</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${(v.out / maxOut * 100).toFixed(1)}%"></div></div>
      <div class="amt">${short(v.out)}</div></div>`).join("")}</div>` : '<div class="empty">No active debts</div>';

  // costliest
  const costly = debts.filter((i) => num(i.rate) > 0).sort((a, b) => annualRate(b) - annualRate(a)).slice(0, 6);
  const costlyHtml = costly.length ? `<div class="table-wrap"><table><thead><tr><th>Debt</th><th class="num">Rate / yr</th><th class="num">Interest / mo</th><th class="num">Outstanding</th></tr></thead>
    <tbody>${costly.map((i) => `<tr class="row" data-edit="${i.id}"><td><div class="name">${esc(i.name)}</div><div class="small-muted">${esc(i.category)}</div></td>
    <td class="num">${annualRate(i).toFixed(1)}%</td><td class="num">${inr(monthlyInterest(i))}</td><td class="num">${short(num(i.outstanding))}</td></tr>`).join("")}</tbody></table></div>
    <div class="small-muted" style="margin-top:8px">Paying off the top ones first saves the most interest.</div>` : '<div class="empty">Add interest rates to see this</div>';

  // bills summary
  const billByCat = {};
  bills.forEach((i) => { const c = i.category || "Other"; billByCat[c] = (billByCat[c] || 0) + monthlyEq(i); });
  const billCats = Object.entries(billByCat).sort((a, b) => b[1] - a[1]);
  const maxBill = Math.max(1, ...billCats.map((c) => c[1]));
  const billHtml = billCats.length ? `<div class="bars">${billCats.map(([c, v]) => `
    <div class="bar-row"><div>${esc(c)}</div><div class="bar-track"><div class="bar-fill" style="width:${(v / maxBill * 100).toFixed(1)}%"></div></div><div class="amt">${inr(v)}</div></div>`).join("")}</div>`
    : `<div class="empty">No bills yet. <a href="#" data-add="bill">Add rent, electricity, etc.</a></div>`;

  return `
  <div class="page-head"><div><h1>Dashboard</h1><div class="sub">${fmtD(S.today)} · all amounts in ₹</div></div></div>
  <div class="grid kpis">
    <div class="card kpi red clickable" data-go="debt"><div class="label">Total I owe</div><div class="value">${short(owe)}</div><div class="hint">${inr(owe)} · ${debts.length} loans${cards.length ? " + " + cards.length + " cards" : ""}</div></div>
    <div class="card kpi green clickable" data-go="receivable"><div class="label">Owed to me</div><div class="value">${short(owed)}</div><div class="hint">${inr(owed)} · ${recs.length} active</div></div>
    <div class="card kpi ${owed - owe < 0 ? "red" : "green"}"><div class="label">Net position</div><div class="value">${short(owed - owe)}</div><div class="hint">owed to me − I owe</div></div>
    <div class="card kpi"><div class="label">Monthly outgo</div><div class="value">${short(debtMonthly + billMonthly + cardMonthly)}</div><div class="hint">EMI/interest ${short(debtMonthly)} + bills ${short(billMonthly)}${cardMonthly ? " + cards " + short(cardMonthly) : ""}</div></div>
    <div class="card kpi"><div class="label">Interest cost / month</div><div class="value">${short(interest)}</div><div class="hint">≈ ${short(interest * 12)} a year (estimate)</div></div>
    <div class="card kpi ${overdue.length ? "red" : ""}"><div class="label">${monthName(tm)}</div><div class="value">${short(paidOut)}</div><div class="hint">paid this month${received ? " · received " + short(received) : ""}${recMonthly ? " · expected in " + short(recMonthly) + "/mo" : ""}</div></div>
    <div class="card kpi ${overdueAmt ? "red" : "green"}"><div class="label">Overdue now</div><div class="value">${overdueAmt ? short(overdueAmt) : "₹0"}</div><div class="hint">${overdue.length ? `${overdue.length} item(s), all missed instalments added up` : "nothing overdue 👍"}${lateRec ? ` · others owe you ${short(lateRec)} late` : ""}</div></div>
    <div class="card kpi"><div class="label">Debt-free by</div><div class="value">${lastPay ? MONTHS[lastPay.getMonth()] + " " + lastPay.getFullYear() : "—"}</div><div class="hint">${amort.length ? `${amort.length} loans at current EMIs · ≈ ${short(interestLeft)} interest still to pay` : "add EMIs / tenure to see this"}${never.length ? ` · <b>${never.length} interest-only (${short(neverAmt)}) never reduce</b>` : ""}</div></div>
  </div>
  <div class="grid two">
    <div class="card"><h3>Upcoming &amp; overdue <span class="small-muted">next ${horizon} days</span></h3>${dueHtml}
      ${noDate.length ? `<div class="small-muted" style="margin-top:10px">${noDate.length} item(s) have no due date set (${noDate.slice(0, 4).map((i) => `<a href="#" data-edit="${i.id}">${esc(i.name)}</a>`).join(", ")}${noDate.length > 4 ? "…" : ""}). Add one to get reminders here.</div>` : ""}
    </div>
    <div class="grid" style="align-content:start">
      <div class="card"><h3>Paid this month</h3>${paidHtml}</div>
    </div>
  </div>
  <div class="grid two" style="margin-top:16px">
    <div class="card"><h3>Debt by type <span class="small-muted">outstanding</span></h3>${barsHtml}</div>
    <div class="card"><h3>Costliest debts</h3>${costlyHtml}</div>
  </div>
  <div class="grid" style="margin-top:16px">
    <div class="card"><h3>Credit cards <span class="small-muted">${cards.length ? `${short(cardBal)} used of ${short(cardLimit)} limit${cardLimit ? " · " + Math.round(cardBal / cardLimit * 100) + "%" : ""}` : ""}</span></h3>${cards.length ? cardTable(cards) : `<div class="empty">No credit cards yet. <a href="#" data-add="card">Add a card</a> to track balance, limit and due dates.</div>`}</div>
  </div>
  <div class="grid two" style="margin-top:16px">
    <div class="card"><h3>Monthly bills &amp; expenses <span class="small-muted">${inr(billMonthly)} / month</span></h3>${billHtml}</div>
    <div class="card"><h3>Owed to me</h3>${recs.length ? `<ul class="due-list">${recs.sort((a, b) => num(b.outstanding) - num(a.outstanding)).slice(0, 6).map((i) => `
      <li><div class="due-main"><div class="name"><a href="#" data-edit="${i.id}">${esc(i.name)}</a></div><div class="small-muted">${esc(i.party || i.category)}${i.next_due ? " · next " + fmtD(i.next_due) : ""}</div></div>
      <div class="due-amt">${inr(i.outstanding)}</div><button class="btn small pay" data-pay="${i.id}">Received</button></li>`).join("")}</ul>`
      : `<div class="empty">Lent money to someone? <a href="#" data-add="receivable">Track it here</a>.</div>`}</div>
  </div>`;
}

/* ---------------------------------------------------------------- credit cards */
function utilBar(i) {
  const lim = num(i.credit_limit), bal = num(i.outstanding);
  if (!lim) return '<span class="small-muted">—</span>';
  const pct = Math.min(100, bal / lim * 100);
  const color = pct >= 75 ? "var(--red)" : pct >= 30 ? "var(--amber)" : "var(--green)";
  return `<div style="min-width:90px"><span class="small-muted">${pct.toFixed(0)}%</span><div class="progress"><div style="width:${pct}%;background:${color}"></div></div></div>`;
}
function cardTable(rows, full) {
  const sum = (fn) => rows.filter(isActive).reduce((s, i) => s + fn(i), 0);
  return `<div class="table-wrap"><table><thead><tr><th>Card</th><th class="num">Balance used</th><th class="num ${full ? "" : "hide-sm"}">Limit</th><th class="hide-sm">Usage</th>
    <th class="num">Statement due</th><th class="num hide-sm">Minimum</th><th>Due date</th>${full ? '<th class="hide-sm">This month</th>' : ""}<th></th></tr></thead>
    <tbody>${rows.map((i) => {
      const paid = paidThisMonth(i);
      return `<tr class="row ${isActive(i) ? "" : "closed"}" data-edit="${i.id}">
      <td><div class="name">${esc(i.name)}${i.card_last4 ? ` <span class="small-muted">•••• ${esc(i.card_last4)}</span>` : ""}</div><div class="small-muted">${esc([i.party, num(i.statement_day) ? "statement on " + num(i.statement_day) + ordinal(num(i.statement_day)) : ""].filter(Boolean).join(" · "))}</div></td>
      <td class="num"><b>${inr(i.outstanding)}</b></td><td class="num ${full ? "" : "hide-sm"}">${num(i.credit_limit) ? inr(i.credit_limit) : "—"}</td>
      <td class="hide-sm">${utilBar(i)}</td>
      <td class="num">${num(i.payment) ? inr(i.payment) : '<span class="small-muted">₹0</span>'}</td><td class="num hide-sm">${num(i.min_due) ? inr(i.min_due) : "—"}</td>
      <td>${cardDue(i) || !isActive(i) ? dueChip(i) : '<span class="chip green">Nothing due</span>'}</td>
      ${full ? `<td class="hide-sm">${paid.length ? `<span class="chip green">Paid ${inr(paid.reduce((s, p) => s + num(p.amount), 0))}</span>` : '<span class="small-muted">—</span>'}</td>` : ""}
      <td class="actions">${isActive(i) ? `<button class="btn small pay" data-pay="${i.id}">Pay</button>` : ""}</td></tr>`;
    }).join("")}</tbody>
    <tfoot><tr><td>Total</td><td class="num">${inr(sum((i) => num(i.outstanding)))}</td><td class="num ${full ? "" : "hide-sm"}">${inr(sum((i) => num(i.credit_limit)))}</td><td class="hide-sm"></td>
    <td class="num">${inr(sum((i) => num(i.payment)))}</td><td class="num hide-sm">${inr(sum((i) => num(i.min_due)))}</td><td colspan="${full ? 3 : 2}"></td></tr></tfoot></table></div>`;
}
const ordinal = (d) => ["th", "st", "nd", "rd"][(d % 10 < 4 && Math.floor(d / 10) !== 1) ? d % 10 : 0];

/* ---------------------------------------------------------------- list views */
function renderList(kind) {
  const f = filters[kind];
  const all = ofKind(kind);
  const cats = Array.from(new Set(all.map((i) => i.category || "Other"))).sort();
  const q = f.q.toLowerCase();
  const rows = all.filter((i) => (f.closed || isActive(i)) && (!f.cat || (i.category || "Other") === f.cat) &&
    (!q || [i.name, i.party, i.category, i.notes, i.phone].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => (isActive(b) - isActive(a)) || ((a.next_due || "9999").localeCompare(b.next_due || "9999")) || a.name.localeCompare(b.name));
  const closedCount = all.filter((i) => !isActive(i)).length;
  const sum = (fn) => rows.filter(isActive).reduce((s, i) => s + fn(i), 0);

  let head, body, foot, table;
  if (kind === "card") {
    table = cardTable(rows, true);
  } else if (kind === "bill") {
    head = `<th>Bill / expense</th><th>Category</th><th class="num">Amount</th><th class="hide-sm">How often</th><th>Next due</th><th class="hide-sm">This month</th><th></th>`;
    body = rows.map((i) => {
      const paid = paidThisMonth(i);
      return `<tr class="row ${isActive(i) ? "" : "closed"}" data-edit="${i.id}">
      <td><div class="name">${esc(i.name)}</div>${i.notes ? `<div class="small-muted">${esc(i.notes.slice(0, 60))}</div>` : ""}</td>
      <td>${esc(i.category)}</td><td class="num">${inr(i.payment)}</td>
      <td class="hide-sm">${esc((FREQS.find((x) => x[0] === i.frequency) || ["", i.frequency])[1])}${i.autopay ? ' <span class="chip blue">autopay</span>' : ""}</td>
      <td>${dueChip(i)}</td>
      <td class="hide-sm">${paid.length ? `<span class="chip green">Paid ${inr(paid.reduce((s, p) => s + num(p.amount), 0))}</span>` : '<span class="small-muted">—</span>'}</td>
      <td class="actions">${isActive(i) ? `<button class="btn small pay" data-pay="${i.id}">Paid</button>` : ""}</td></tr>`;
    }).join("");
    foot = `<td>Total (active)</td><td></td><td class="num">${inr(sum((i) => num(i.payment)))}</td><td class="hide-sm small-muted">≈ ${inr(sum(monthlyEq))}/mo</td><td colspan="3"></td>`;
  } else {
    const payWord = kind === "receivable" ? "Received" : "Paid";
    head = `<th>${kind === "receivable" ? "Who owes me" : "Lender / source"}</th><th>Type</th><th class="num">Outstanding</th><th class="num hide-sm">Principal</th><th class="num">Rate</th><th class="num hide-sm">Interest / mo</th><th class="num">Monthly</th><th class="hide-sm">Clears in</th><th>Next due</th><th></th>`;
    body = rows.map((i) => {
      const pr = num(i.principal), out = num(i.outstanding);
      const pct = pr > 0 ? Math.max(0, Math.min(100, (1 - out / pr) * 100)) : 0;
      return `<tr class="row ${isActive(i) ? "" : "closed"}" data-edit="${i.id}">
      <td><div class="name">${esc(i.name)}</div><div class="small-muted">${esc([i.party, i.phone].filter(Boolean).join(" · ") || (i.notes || "").slice(0, 50))}</div></td>
      <td>${esc(i.category)}</td>
      <td class="num"><b>${inr(out)}</b>${pr > 0 && out < pr ? `<div class="progress" title="${pct.toFixed(0)}% repaid"><div style="width:${pct}%"></div></div>` : ""}</td>
      <td class="num hide-sm">${inr(pr)}</td>
      <td class="num">${rateText(i)}</td>
      <td class="num hide-sm">${monthlyInterest(i) ? inr(monthlyInterest(i)) : "—"}</td>
      <td class="num">${payAmt(i) ? inr(payAmt(i)) : "—"}${i.payment_auto || !num(i.payment) ? (payAmt(i) ? '<div class="small-muted">auto</div>' : "") : ""}</td>
      <td class="hide-sm">${clearsIn(i)}</td>
      <td>${dueChip(i)}</td>
      <td class="actions">${isActive(i) ? `<button class="btn small pay" data-pay="${i.id}">${payWord}</button>` : ""}</td></tr>`;
    }).join("");
    foot = `<td>Total (active)</td><td></td><td class="num">${inr(sum((i) => num(i.outstanding)))}</td><td class="num hide-sm">${inr(sum((i) => num(i.principal)))}</td><td></td><td class="num hide-sm">${inr(sum(monthlyInterest))}</td><td class="num">${inr(sum(monthlyEq))}</td><td colspan="3"></td>`;
  }
  const intro = { debt: "Bank loans, hand loans, gold loans, chits, credit cards — everything you owe.",
    receivable: "Money you lent to others that you expect back.",
    bill: "Rent, utility bills, insurance, fees and other recurring expenses.",
    card: "Balance, limit, statement amount and due date for each card. Update the statement amount when a new bill comes." }[kind];

  return `<div class="page-head"><div><h1>${KIND_LABEL[kind]}</h1><div class="sub">${intro}</div></div>
    <button class="btn primary" data-add="${kind}">+ Add ${KIND_SINGULAR[kind]}</button></div>
  <div class="card">
    <div class="filters">
      <input type="search" id="fq" placeholder="Search name, person, notes…" value="${esc(f.q)}">
      ${cats.length < 2 ? "" : `<select id="fcat"><option value="">All types</option>${cats.map((c) => `<option ${c === f.cat ? "selected" : ""}>${esc(c)}</option>`).join("")}</select>`}
      ${closedCount ? `<label><input type="checkbox" id="fclosed" ${f.closed ? "checked" : ""}> Show closed (${closedCount})</label>` : ""}
    </div>
    ${rows.length ? `${table || `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody><tfoot><tr>${foot}</tr></tfoot></table></div>`}
      <div class="small-muted" style="margin-top:8px">Click any row to edit or delete it.</div>`
      : `<div class="empty">${all.length ? "Nothing matches your filters." : `Nothing here yet. <a href="#" data-add="${kind}">Add the first one</a>.`}</div>`}
  </div>`;
}

/* ---------------------------------------------------------------- payments view */
function renderPayments() {
  const f = filters.payments;
  const months = Array.from(new Set(S.payments.map((p) => monthKey(p.date)))).sort().reverse();
  const q = f.q.toLowerCase();
  const rows = S.payments.filter((p) => (!f.month || monthKey(p.date) === f.month) &&
    (!q || [p.item_name, p.note, p.category].join(" ").toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.created || "").localeCompare(a.created || ""));
  const out = rows.filter((p) => p.kind !== "receivable").reduce((s, p) => s + num(p.amount), 0);
  const inn = rows.filter((p) => p.kind === "receivable").reduce((s, p) => s + num(p.amount), 0);
  const intr = rows.filter((p) => p.kind === "debt").reduce((s, p) => s + num(p.interest), 0);
  return `<div class="page-head"><div><h1>Payments</h1><div class="sub">Every payment you made or money you received.</div></div></div>
  <div class="grid kpis">
    <div class="card kpi red"><div class="label">Paid out</div><div class="value">${short(out)}</div><div class="hint">${inr(out)}</div></div>
    <div class="card kpi"><div class="label">Of which interest</div><div class="value">${short(intr)}</div><div class="hint">${inr(intr)}</div></div>
    <div class="card kpi green"><div class="label">Received</div><div class="value">${short(inn)}</div><div class="hint">${inr(inn)}</div></div>
  </div>
  <div class="card">
    <div class="filters">
      <input type="search" id="pq" placeholder="Search…" value="${esc(f.q)}">
      <select id="pmonth"><option value="">All months</option>${months.map((m) => `<option value="${m}" ${m === f.month ? "selected" : ""}>${monthName(m)}</option>`).join("")}</select>
    </div>
    ${rows.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>For</th><th class="hide-sm">Type</th><th class="num">Amount</th><th class="num hide-sm">Principal</th><th class="num hide-sm">Interest</th><th class="hide-sm">Note</th><th></th></tr></thead>
    <tbody>${rows.map((p) => `<tr>
      <td>${fmtD(p.date)}</td><td><div class="name">${esc(p.item_name)}</div><div class="small-muted">${esc(p.category)}</div></td>
      <td class="hide-sm">${p.kind === "receivable" ? '<span class="chip green">Received</span>' : p.kind === "bill" ? '<span class="chip">Bill</span>' : p.kind === "card" ? '<span class="chip amber">Card</span>' : '<span class="chip blue">Debt</span>'}</td>
      <td class="num"><b>${inr(p.amount)}</b></td><td class="num hide-sm">${num(p.principal) ? inr(p.principal) : "—"}</td><td class="num hide-sm">${num(p.interest) ? inr(p.interest) : "—"}</td>
      <td class="hide-sm">${esc(p.note)}</td>
      <td class="actions"><button class="btn small danger" data-delpay="${p.id}" title="Delete and undo this payment">Undo</button></td></tr>`).join("")}</tbody></table></div>`
      : '<div class="empty">No payments recorded yet. Use the “Paid” buttons on the dashboard or lists.</div>'}
  </div>`;
}

/* ---------------------------------------------------------------- data view */
function renderData() {
  const xl = S.excel_ok;
  const warn = xl ? "" : '<p style="color:var(--red)">Excel support is off. Run <code>pip install openpyxl</code> and restart the tracker.</p>';
  return `<div class="page-head"><div><h1>Excel &amp; Backup</h1><div class="sub">Your data lives in <code>data/tracker.json</code> next to the app. A backup copy is saved automatically on every change.</div></div></div>
  <div class="grid data-grid">
    <div class="card"><h3>Import from Excel</h3>
      <p>Load your existing debts from an Excel file (e.g. <b>Expense_Debt_Tracker.xlsx</b>). Sheets named like “Debts Register”, “Credit Cards”, “Receivables”, “Bills” and any chit schedule are read (credit-card rows in the debts sheet go to Credit Cards). You can review before anything is saved.</p>${warn}
      <input type="file" id="xlFile" accept=".xlsx,.xlsm" ${xl ? "" : "disabled"}></div>
    <div class="card"><h3>Export to Excel</h3>
      <p>Download everything (debts, receivables, bills, payment log) as a formatted Excel file to view, print or share.</p>${warn}
      <a class="btn primary" href="/api/export.xlsx" ${xl ? "" : 'style="pointer-events:none;opacity:.5"'}>Download Excel</a></div>
    <div class="card"><h3>Backup &amp; restore</h3>
      <p>Save a full backup file somewhere safe (Google Drive, pen drive). Restore replaces all current data with the backup.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="/api/backup.json">Download backup</a>
      <label class="btn">Restore backup…<input type="file" id="restoreFile" accept=".json" hidden></label></div></div>
    <div class="card"><h3>Start over</h3>
      <p>Delete every entry and payment. An automatic backup of the current data is kept in <code>data/backups</code>.</p>
      <button class="btn danger" id="resetAll">Delete all data…</button></div>
  </div>`;
}

/* ---------------------------------------------------------------- events */
function bindPage() {
  const app = $("#app");
  $$("[data-go]", app).forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); setView(el.dataset.go); }));
  $$("[data-add]", app).forEach((el) => el.addEventListener("click", (e) => { e.preventDefault(); openItem(null, el.dataset.add); }));
  $$("[data-edit]", app).forEach((el) => el.addEventListener("click", (e) => {
    if (e.target.closest("[data-pay]")) return;
    e.preventDefault(); openItem(S.items.find((i) => i.id === el.dataset.edit));
  }));
  $$("[data-pay]", app).forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); openPayment(S.items.find((i) => i.id === el.dataset.pay)); }));
  $$("[data-delpay]", app).forEach((el) => el.addEventListener("click", () => {
    const p = S.payments.find((x) => x.id === el.dataset.delpay);
    if (confirm(`Undo the ${inr(p.amount)} payment for “${p.item_name}” on ${fmtD(p.date)}?\n\nThe outstanding amount and due date will be put back.`))
      act(() => api("DELETE", "/api/payments/" + p.id), "Payment removed");
  }));
  if (KIND_LABEL[view]) {
    const f = filters[view];
    const fq = $("#fq");
    if (fq) fq.addEventListener("input", () => { f.q = fq.value; const pos = fq.selectionStart; render(); const n = $("#fq"); n.focus(); n.setSelectionRange(pos, pos); });
    const fc = $("#fcat"); if (fc) fc.addEventListener("change", () => { f.cat = fc.value; render(); });
    const fx = $("#fclosed"); if (fx) fx.addEventListener("change", () => { f.closed = fx.checked; render(); });
  }
  if (view === "payments") {
    const pq = $("#pq"); pq.addEventListener("input", () => { filters.payments.q = pq.value; const pos = pq.selectionStart; render(); const n = $("#pq"); n.focus(); n.setSelectionRange(pos, pos); });
    $("#pmonth").addEventListener("change", (e) => { filters.payments.month = e.target.value; render(); });
  }
  if (view === "data") {
    const xf = $("#xlFile"); if (xf) xf.addEventListener("change", () => xf.files[0] && previewImport(xf.files[0]));
    $("#restoreFile").addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!confirm(`Restore this backup? It has ${(data.items || []).length} entries and ${(data.payments || []).length} payments and will REPLACE what you have now.`)) return;
        await act(() => api("POST", "/api/restore", data), "Backup restored");
      } catch (err) { toast(err.message || "Not a valid backup file", true); }
      e.target.value = "";
    });
    $("#resetAll").addEventListener("click", () => {
      const t = prompt('This deletes ALL entries and payments.\nType DELETE to confirm.');
      if (t === "DELETE") act(() => api("POST", "/api/reset?confirm=yes"), "All data deleted");
    });
  }
}

/* ---------------------------------------------------------------- modal */
function openModal(title, html, wide) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  $(".modal-card").classList.toggle("wide", !!wide);
  $("#modal").classList.remove("hidden");
  const first = $("#modalBody input:not([type=hidden]):not([type=checkbox]), #modalBody select");
  if (first) first.focus();
}
function closeModal() { $("#modal").classList.add("hidden"); $("#modalBody").innerHTML = ""; }
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#modal").classList.contains("hidden")) closeModal(); });

const opt = (list, val) => list.map((x) => { const [v, l] = Array.isArray(x) ? x : [x, x]; return `<option value="${esc(v)}" ${v === val ? "selected" : ""}>${esc(l)}</option>`; }).join("");
const field = (label, input, cls = "", help = "") => `<label class="${cls}">${label}${input}${help ? `<span class="helper">${help}</span>` : ""}</label>`;

/* ---- add / edit item */
function openItem(item, kind) {
  const isNew = !item;
  item = item || { kind, status: "Active", frequency: "monthly", ...(kind === "card" ? { category: "Credit Card", rate: 3.5, rate_unit: "month" } : {}), rate_unit: kind === "debt" ? "year" : "month", category: kind === "bill" ? "Rent" : kind === "debt" ? "Personal Loan" : "Friends & Family" };
  kind = item.kind;
  const v = (k) => esc(item[k] == null ? "" : item[k]);
  const n = (k) => (item[k] ? num(item[k]) : "");
  const types = kind === "bill" ? BILL_TYPES : DEBT_TYPES;
  let html = `<form class="form" id="itemForm" autocomplete="off">`;
  if (kind === "card") {
    html += field("Card name *", `<input name="name" required value="${v("name")}" placeholder="e.g. HDFC Regalia, SBI SimplyClick">`, "full")
      + field("Bank", `<input name="party" value="${v("party")}" placeholder="optional">`)
      + field("Last 4 digits", `<input name="card_last4" maxlength="4" inputmode="numeric" value="${v("card_last4")}" placeholder="optional">`)
      + field("Credit limit (₹)", `<input name="credit_limit" inputmode="decimal" value="${n("credit_limit")}" placeholder="0">`)
      + field("Balance used now (₹)", `<input name="outstanding" inputmode="decimal" value="${n("outstanding")}" placeholder="total outstanding on the card">`)
      + field("Statement amount due (₹)", `<input name="payment" inputmode="decimal" value="${n("payment")}" placeholder="total amount due on last bill">`, "", "From your latest statement")
      + field("Minimum due (₹)", `<input name="min_due" inputmode="decimal" value="${n("min_due")}" placeholder="blank = auto 5%">`, "", "Blank = 5% of statement amount")
      + field("Payment due date", `<input type="date" name="next_due" value="${v("next_due")}">`, "", dueDayHelper())
      + field("Statement day (1–31)", `<input name="statement_day" inputmode="numeric" value="${n("statement_day")}" placeholder="e.g. 18">`)
      + field("Interest if not paid in full", `<div class="inline"><input name="rate" inputmode="decimal" value="${n("rate")}" placeholder="3.5"><select name="rate_unit">${opt([["month", "% per month"], ["year", "% per year"]], item.rate_unit)}</select></div>`)
      + field("Status", `<select name="status">${opt(["Active", "Closed"], item.status)}</select>`)
      + `<input type="hidden" name="category" value="Credit Card"><input type="hidden" name="frequency" value="monthly">`
      + `<label class="check full"><input type="checkbox" name="autopay" ${item.autopay ? "checked" : ""}> Autopay set up</label>`
      + field("Notes", `<textarea name="notes" placeholder="Annual fee, rewards, EMI conversions…">${v("notes")}</textarea>`, "full");
  } else if (kind === "bill") {
    html += field("Name *", `<input name="name" required value="${v("name")}" placeholder="e.g. House rent, BESCOM electricity">`, "full")
      + field("Category", `<input name="category" list="catList" value="${v("category")}"><datalist id="catList">${opt(types)}</datalist>`)
      + field("Amount (₹)", `<input name="payment" inputmode="decimal" value="${n("payment")}" placeholder="0">`)
      + field("How often", `<select name="frequency">${opt(FREQS, item.frequency)}</select>`)
      + field("Next due date", `<input type="date" name="next_due" value="${v("next_due")}">`, "", dueDayHelper())
      + field("Paid to / account", `<input name="party" value="${v("party")}" placeholder="optional">`)
      + field("Status", `<select name="status">${opt(["Active", "Closed"], item.status)}</select>`)
      + `<label class="check full"><input type="checkbox" name="autopay" ${item.autopay ? "checked" : ""}> Paid automatically (autopay / standing instruction)</label>`
      + field("Notes", `<textarea name="notes">${v("notes")}</textarea>`, "full");
  } else {
    const rec = kind === "receivable";
    html += field(rec ? "Who owes you *" : "Lender / source *", `<input name="name" required value="${v("name")}" placeholder="${rec ? "e.g. Ravi (hand loan)" : "e.g. SBI home loan, Nag hand loan"}">`, "full")
      + field("Type", `<input name="category" list="catList" value="${v("category")}"><datalist id="catList">${opt(types)}</datalist>`, "", "Pick from the list or type your own")
      + field(rec ? "Person / contact" : "Person / branch / account no.", `<input name="party" value="${v("party")}" placeholder="optional">`)
      + field(rec ? "Amount lent (₹)" : "Principal / amount taken (₹)", `<input name="principal" inputmode="decimal" value="${n("principal")}" placeholder="0">`)
      + field("Outstanding now (₹)", `<input name="outstanding" inputmode="decimal" value="${n("outstanding")}" placeholder="blank = auto">`, "", "Leave blank: calculated from the EMI schedule, or = principal")
      + field("Interest rate", `<div class="inline"><input name="rate" inputmode="decimal" value="${n("rate")}" placeholder="0"><select name="rate_unit">${opt([["year", "% per year"], ["month", "% per month"]], item.rate_unit)}</select></div>`, "",
        "Hand loans are usually “% per month” (e.g. 1.5 = ₹1.50 per ₹100)")
      + field(rec ? "Monthly amount you receive (₹)" : "Monthly payment — EMI or interest (₹)", `<input name="payment" inputmode="decimal" value="${item.payment_auto ? "" : n("payment")}" placeholder="blank = auto">`, "",
        "Leave blank to calculate automatically: EMI if tenure is given, else monthly interest")
      + field("How often", `<select name="frequency">${opt(FREQS, item.frequency)}</select>`)
      + field("Next due date", `<input type="date" name="next_due" value="${v("next_due")}">`, "", dueDayHelper() + " · blank = auto from start date")
      + field("Start / taken on", `<input type="date" name="start_date" value="${v("start_date")}">`)
      + field("Tenure (months)", `<input name="tenure_months" inputmode="numeric" value="${n("tenure_months")}" placeholder="blank if open-ended">`)
      + field("End / maturity date", `<input type="date" name="end_date" value="${v("end_date")}">`, "", "Blank = auto from start + tenure")
      + field("Phone", `<input name="phone" value="${v("phone")}" placeholder="optional">`)
      + field("Status", `<select name="status">${opt(["Active", "Closed"], item.status)}</select>`)
      + field("Notes", `<textarea name="notes" placeholder="Collateral, terms, promises…">${v("notes")}</textarea>`, "full")
      + `<div class="full calcbox" id="calcBox"></div>`;
  }
  const itemPays = isNew ? [] : S.payments.filter((p) => p.item_id === item.id).sort((a, b) => b.date.localeCompare(a.date));
  html += `</form>`;
  if (itemPays.length) {
    html += `<div style="margin-top:16px"><div class="small-muted" style="margin-bottom:4px">Payment history (${itemPays.length}) · total ${inr(itemPays.reduce((s, p) => s + num(p.amount), 0))}</div>
      <div class="table-wrap" style="max-height:180px;overflow:auto"><table><tbody>${itemPays.map((p) => `<tr><td>${fmtD(p.date)}</td><td class="num">${inr(p.amount)}</td><td class="small-muted">${num(p.interest) ? "int " + inr(p.interest) : ""} ${num(p.principal) ? "prin " + inr(p.principal) : ""}</td><td class="small-muted">${esc(p.note)}</td></tr>`).join("")}</tbody></table></div></div>`;
  }
  html += `<div class="form-actions">
      ${isNew ? "" : `<button type="button" class="btn danger" id="delItem">Delete</button>`}
      <div class="right">${isNew ? "" : `<button type="button" class="btn pay" id="payItem">${kind === "receivable" ? "Record received" : "Record payment"}</button>`}
      <button type="button" class="btn" data-close>Cancel</button>
      <button type="submit" form="itemForm" class="btn primary">${isNew ? "Add" : "Save changes"}</button></div></div>`;
  openModal((isNew ? "Add " : "Edit ") + KIND_SINGULAR[kind], html);

  const form = $("#itemForm");
  const get = (k) => form.elements[k] ? form.elements[k].value : "";
  const set = (k, val) => { if (form.elements[k]) form.elements[k].value = val; };
  $$("[data-due]", form).forEach((a) => a.addEventListener("click", () => set("next_due", a.dataset.due)));
  const formItem = () => {
    const d = { kind, id: item.id };
    Array.from(form.elements).forEach((el) => { if (el.name) d[el.name] = el.type === "checkbox" ? el.checked : el.value; });
    return d;
  };
  /** Fill every blank field that can be worked out from the others. */
  const autoFill = (d) => {
    const out = { ...d };
    if (kind === "card") {
      if (out.min_due === "" && num(out.payment)) out.min_due = Math.round(num(out.payment) * 0.05);
      return out;
    }
    if (kind === "bill") return out;
    const s0 = parseD(out.start_date), N = num(out.tenure_months);
    if (out.outstanding === "") {
      const sb = scheduleBalance(out);
      out.outstanding = sb ? sb.balance : out.principal;
    }
    if (!out.end_date && s0 && N) out.end_date = iso(addMonths(s0, N));
    if (!out.next_due && s0) {
      const t = todayD();
      let k = 1, nd = addMonths(s0, 1);
      while (nd < t && k < 1000) { k++; nd = addMonths(s0, k); }
      out.next_due = iso(nd);
    }
    out.payment_auto = out.payment === "";
    if (out.payment_auto) out.payment = autoPayment(out);
    return out;
  };
  const updCalc = () => {
    const box = $("#calcBox");
    if (!box) return;
    const d = autoFill(formItem());
    const auto = autoPayment(d), r = monthlyRate(d), mi = monthlyInterest(d);
    form.elements.payment.placeholder = auto ? "auto: " + inr(auto) : "blank = auto";
    form.elements.outstanding.placeholder = num(d.outstanding) ? "auto: " + inr(d.outstanding) : "blank = auto";
    const lines = [];
    if (r && mi) lines.push(`Interest this month: <b>${inr(mi)}</b> (${(r * 100).toFixed(2)}% a month = ${(r * 1200).toFixed(2)}% a year)`);
    if (auto) lines.push(`${num(d.tenure_months) && d.category !== "Chit" ? `EMI for ${num(d.tenure_months)} months` : "Interest-only payment"}: <b>${inr(auto)}</b>${!d.payment_auto && Math.abs(num(d.payment) - auto) > 1 ? ` · you entered ${inr(d.payment)}` : d.payment_auto ? " · used automatically" : ""}`);
    const sb = scheduleBalance(d);
    if (sb) lines.push(`Per schedule: ${sb.paid} of ${num(d.tenure_months)} EMIs done, balance today should be about <b>${inr(sb.balance)}</b>${form.elements.outstanding.value !== "" && Math.abs(num(form.elements.outstanding.value) - sb.balance) > 1 ? ` · <a data-use="${sb.balance}">use this</a>` : ""}`);
    const po = payoff(d);
    if (po && po.never) lines.push(`<span style="color:var(--amber)">This payment only covers interest — the balance never goes down.</span>`);
    else if (po) lines.push(`Clears in <b>${fmtMonths(po.months)}</b> (by ${MONTHS[po.date.getMonth()]} ${po.date.getFullYear()}) · ≈ <b>${inr(po.interest)}</b> interest still to pay`);
    const a = arrears(d);
    if (a.missed) lines.push(`<span style="color:var(--red)">${a.missed} instalment(s) overdue = ${inr(a.amount)}</span>`);
    if (!form.elements.next_due.value && d.next_due) lines.push(`Next due date will be set to <b>${fmtD(d.next_due)}</b>`);
    if (!form.elements.end_date.value && d.end_date) lines.push(`End date will be set to <b>${fmtD(d.end_date)}</b>`);
    box.innerHTML = lines.length ? `<div class="calc-title">Automatic calculations</div>${lines.map((l) => `<div>${l}</div>`).join("")}`
      : `<div class="small-muted">Enter amount, rate and dates — interest, EMI, balance and payoff date are worked out automatically.</div>`;
    $$("[data-use]", box).forEach((x) => x.addEventListener("click", () => { form.elements.outstanding.value = x.dataset.use; updCalc(); }));
  };
  form.addEventListener("input", updCalc);
  form.addEventListener("change", updCalc);
  updCalc();
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = autoFill(formItem());
    if (isNew) delete data.id;
    try { await act(() => api("POST", "/api/items", data), isNew ? "Added" : "Saved"); closeModal(); } catch (_) { /* toast shown */ }
  });
  const del = $("#delItem");
  if (del) del.addEventListener("click", () => {
    const np = S.payments.filter((p) => p.item_id === item.id).length;
    if (confirm(`Delete “${item.name}”${np ? ` and its ${np} payment record(s)` : ""}?\n\nTip: to keep history, set Status to “Closed” instead.`))
      act(() => api("DELETE", "/api/items/" + item.id), "Deleted").then(closeModal).catch(() => {});
  });
  const pay = $("#payItem");
  if (pay) pay.addEventListener("click", () => openPayment(item));
}
function dueDayHelper() {
  const t = todayD(), opts = [];
  [1, 5, 10, 15, 20, 25].forEach((d) => {
    let dt = new Date(t.getFullYear(), t.getMonth(), d);
    if (dt < t) dt = new Date(t.getFullYear(), t.getMonth() + 1, d);
    opts.push(`<a data-due="${iso(dt)}">${d}${["th", "st", "nd", "rd"][(d % 10 < 4 && Math.floor(d / 10) !== 1) ? d % 10 : 0]}</a>`);
  });
  return "Quick pick: " + opts.join(" · ");
}

/* ---- record payment */
function openPayment(item) {
  const rec = item.kind === "receivable", bill = item.kind === "bill", card = item.kind === "card";
  const per = payAmt(item);                       // one instalment (auto-calculated when left blank)
  const arr = arrears(item);                      // missed instalments so far
  const amt = per;
  const step = FREQ_MONTHS[item.frequency] || 0;
  // how many instalments an amount covers (used to move the due date forward)
  // extra money beyond the overdue instalments counts as prepayment, not as skipping future dues
  const cyclesFor = (a) => (card || !per) ? 1 : Math.max(1, Math.min(Math.max(arr.missed, 1), Math.floor((a + 1) / per)));
  const split = (a) => {
    if (bill) return [0, 0];
    if (item.category === "Chit" || card) return [a, 0];
    const intr = Math.min(a, Math.round(monthlyInterest(item) * cyclesFor(a)));
    return [Math.max(0, a - intr), intr];
  };
  const [p0, i0] = split(amt);
  const anchor = (() => { const s0 = parseD(item.start_date), d = parseD(item.next_due); return Math.max(d ? d.getDate() : 0, s0 ? s0.getDate() : 0) || undefined; })();
  const nextAfter = (cycles) => {
    const d = parseD(item.next_due);
    if (!step || !d) return "";
    return iso(addMonths(d, step * cycles, anchor));
  };
  const html = `<form class="form" id="payForm">
    <div class="full small-muted">${esc(item.category)} · ${bill ? "amount" : "outstanding"} ${inr(bill ? per : item.outstanding)}${item.next_due ? " · due " + fmtD(item.next_due) : ""}${!card && !bill ? " · instalment " + inr(per) + (item.payment_auto || !num(item.payment) ? " (auto)" : "") : ""}</div>
    ${arr.missed > 1 ? `<div class="full" style="color:var(--red)"><b>${arr.missed} instalments missed</b> — ${arr.missed} × ${inr(per)} = <b>${inr(arr.amount)}</b> overdue</div>` : ""}
    <div class="full" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">Quick fill:
      ${card ? `${num(item.payment) ? `<button type="button" class="btn small" data-fill="${num(item.payment)}">Statement ${inr(item.payment)}</button>` : ""}
        ${num(item.min_due) ? `<button type="button" class="btn small" data-fill="${num(item.min_due)}">Minimum ${inr(item.min_due)}</button>` : ""}
        <button type="button" class="btn small" data-fill="${num(item.outstanding)}">Full balance ${inr(item.outstanding)}</button>`
      : `${per ? `<button type="button" class="btn small" data-fill="${per}">One instalment ${inr(per)}</button>` : ""}
        ${arr.missed > 1 ? `<button type="button" class="btn small" data-fill="${arr.amount}">All overdue ${inr(arr.amount)}</button>` : ""}
        ${!bill && monthlyInterest(item) && Math.round(monthlyInterest(item)) !== per ? `<button type="button" class="btn small" data-fill="${Math.round(monthlyInterest(item))}">Interest only ${inr(monthlyInterest(item))}</button>` : ""}
        ${!bill && num(item.outstanding) ? `<button type="button" class="btn small" data-fill="${Math.round(num(item.outstanding) + monthlyInterest(item))}">Close fully ${inr(num(item.outstanding) + monthlyInterest(item))}</button>` : ""}`}
    </div>
    ${field("Date", `<input type="date" name="date" value="${S.today}" required>`)}
    ${field(rec ? "Amount received (₹)" : "Amount paid (₹)", `<input name="amount" inputmode="decimal" value="${amt || ""}" required>`)}
    ${bill || card ? "" : field("Of which interest (₹)", `<input name="interest" inputmode="decimal" value="${i0}">`, "", "Calculated automatically · interest does not reduce the balance")
      + field("Of which principal (₹)", `<input name="principal" inputmode="decimal" value="${p0}">`, "", `Reduces outstanding: ${inr(item.outstanding)} → <b id="newOut">${inr(num(item.outstanding) - p0)}</b>`)}
    ${item.next_due && step ? `<label class="check full"><input type="checkbox" name="advance" checked> <span id="advLabel"></span></label>`
      : bill && item.frequency === "one-time" ? `<label class="check full"><input type="checkbox" name="advance" checked> Mark this one-time bill as done</label>` : ""}
    ${field("Note", `<input name="note" placeholder="optional — e.g. UPI ref, cash, part payment">`, "full")}
  </form>
  <div class="form-actions"><div class="right"><button class="btn" data-close>Cancel</button>
    <button type="submit" form="payForm" class="btn primary">Save ${rec ? "receipt" : "payment"}</button></div></div>`;
  openModal((rec ? "Money received — " : "Record payment — ") + item.name, html);
  const form = $("#payForm");
  const el = (k) => form.elements[k];
  const refresh = () => {
    const o = $("#newOut"); if (o) o.textContent = inr(num(item.outstanding) - num(el("principal").value));
    const lab = $("#advLabel");
    if (lab) { const c = cyclesFor(num(el("amount").value)); lab.innerHTML = `Move next due date to <b>${fmtD(nextAfter(c))}</b>${c > 1 ? ` (covers ${c} instalments)` : ""}`; }
  };
  el("amount").addEventListener("input", () => {
    if (!bill && !card) { const [p, i] = split(num(el("amount").value)); el("principal").value = p; el("interest").value = i; }
    refresh();
  });
  if (!bill && !card) {
    el("interest").addEventListener("input", () => { el("principal").value = Math.max(0, num(el("amount").value) - num(el("interest").value)); refresh(); });
    el("principal").addEventListener("input", refresh);
  }
  refresh();
  $$("[data-fill]", form).forEach((b) => b.addEventListener("click", () => { el("amount").value = b.dataset.fill; el("amount").dispatchEvent(new Event("input")); }));
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const data = { item_id: item.id, date: el("date").value, amount: el("amount").value, note: el("note").value,
      principal: bill ? 0 : card ? el("amount").value : el("principal").value, interest: bill || card ? 0 : el("interest").value,
      advance: el("advance") ? el("advance").checked : false, cycles: cyclesFor(num(el("amount").value)) };
    if (!num(data.amount)) return toast("Enter the amount", true);
    try {
      const r = await act(() => api("POST", "/api/payments", data));
      closeModal();
      toast(r.item.status === "Closed" && item.status !== "Closed" ? `Saved — “${item.name}” is fully cleared 🎉` : "Payment saved");
    } catch (_) { /* toast shown */ }
  });
}

/* ---- Excel import preview */
async function previewImport(file) {
  let items;
  try {
    const res = await api("POST", "/api/import/preview", await file.arrayBuffer(), true);
    items = res.items;
  } catch (e) { $("#xlFile").value = ""; return toast(e.message, true); }
  $("#xlFile").value = "";
  if (!items.length) return toast("No debts found in that file. Is there a sheet named like “Debts Register”?", true);
  const total = (k) => items.filter((i) => i.kind === k).reduce((s, i) => s + num(i.outstanding), 0);
  const html = `<p class="sub">Found <b>${items.length}</b> entries in <b>${esc(file.name)}</b> — ${short(total("debt"))} owed${total("receivable") ? ", " + short(total("receivable")) + " receivable" : ""}. Untick anything you don't want. You can edit everything afterwards from the dashboard.</p>
    <div class="table-wrap" style="max-height:52vh;overflow:auto"><table><thead><tr><th><input type="checkbox" id="impAll" checked></th><th>Name</th><th>Type</th><th class="num">Outstanding</th><th class="num">Rate</th><th class="num">Monthly</th><th>Next due</th></tr></thead>
    <tbody>${items.map((i, n) => `<tr><td><input type="checkbox" class="impRow" data-n="${n}" checked></td><td><div class="name">${esc(i.name)}</div><div class="small-muted">${KIND_LABEL[i.kind]}</div></td><td>${esc(i.category)}</td>
      <td class="num">${inr(i.outstanding)}</td><td class="num">${rateText(i)}</td><td class="num">${num(i.payment) ? inr(i.payment) : "—"}</td><td>${i.next_due ? fmtD(i.next_due) : '<span class="small-muted">—</span>'}</td></tr>`).join("")}</tbody></table></div>
    <div class="form-actions">
      <div class="seg" id="impMode"><button class="on" data-m="merge" title="Add new entries, skip ones that already exist">Add to existing</button><button data-m="replace" title="Remove current entries of these kinds first">Replace existing</button></div>
      <div class="right"><button class="btn" data-close>Cancel</button><button class="btn primary" id="doImport">Import selected</button></div></div>`;
  openModal("Review Excel import", html, true);
  let mode = "merge";
  $("#impAll").addEventListener("change", (e) => $$(".impRow").forEach((c) => (c.checked = e.target.checked)));
  $$("#impMode button").forEach((b) => b.addEventListener("click", () => { mode = b.dataset.m; $$("#impMode button").forEach((x) => x.classList.toggle("on", x === b)); }));
  $("#doImport").addEventListener("click", async () => {
    const chosen = $$(".impRow").filter((c) => c.checked).map((c) => items[+c.dataset.n]);
    if (!chosen.length) return toast("Nothing selected", true);
    if (mode === "replace" && S.items.length && !confirm("Replace mode removes your current entries of the same kind (a backup is kept). Continue?")) return;
    try {
      const r = await act(() => api("POST", "/api/import", { items: chosen, mode }));
      closeModal(); toast(`Imported ${r.added}${r.skipped ? `, skipped ${r.skipped} already there` : ""}`);
      setView("dashboard");
    } catch (_) { /* toast shown */ }
  });
}

/* ---------------------------------------------------------------- boot */
$$("#tabs button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
$("#quickAdd").addEventListener("click", () => {
  const k = KIND_LABEL[view] ? view : null;
  if (k) return openItem(null, k);
  openModal("What do you want to add?", `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
    <button class="btn" style="padding:16px;text-align:left" data-k="debt"><b>Debt / loan I owe</b><div class="small-muted">Bank, hand loan, gold, chit…</div></button>
    <button class="btn" style="padding:16px;text-align:left" data-k="card"><b>Credit card</b><div class="small-muted">Balance, limit, due date</div></button>
    <button class="btn" style="padding:16px;text-align:left" data-k="receivable"><b>Money owed to me</b><div class="small-muted">Money I lent to someone</div></button>
    <button class="btn" style="padding:16px;text-align:left" data-k="bill"><b>Bill / expense</b><div class="small-muted">Rent, electricity, fees…</div></button></div>`);
  $$("#modalBody [data-k]").forEach((b) => b.addEventListener("click", () => openItem(null, b.dataset.k)));
});
window.addEventListener("hashchange", () => { const v = location.hash.slice(1); if (v && v !== view) { view = v; render(); } });
reload().catch((e) => { $("#app").innerHTML = `<div class="card empty">Could not reach the tracker server. Is <code>python tracker.py</code> running?<br><span class="small-muted">${esc(e.message)}</span></div>`; });
