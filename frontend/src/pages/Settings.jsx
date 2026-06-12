import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { rupee, rupee2, rupeeShort } from "../format.js";

// --- client-side mirror of the backend calendar math (for live preview) --- //
function addMonths(iso, months) {
  const d = new Date(iso + "T00:00:00");
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return target;
}

function countTradingDays(startIso, endDate) {
  // weekdays strictly between start and end (matches backend count_trading_days)
  const start = new Date(startIso + "T00:00:00");
  let days = 0;
  const cur = new Date(start);
  cur.setDate(cur.getDate() + 1);
  while (cur < endDate) {
    const wd = cur.getDay();
    if (wd >= 1 && wd <= 5) days += 1;
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

export default function Settings() {
  const [form, setForm] = useState(null);
  const [base, setBase] = useState(null); // {monthly_interest_burn, total_outstanding}
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    Promise.all([api.getSettings(), api.dashboard()])
      .then(([s, d]) => {
        setForm({
          start_date: s.start_date,
          goal_duration_months: s.goal_duration_months,
          trading_days_per_week: s.trading_days_per_week,
          savings_goal: String(s.savings_goal),
        });
        setBase({
          burn: parseFloat(d.goal.monthly_interest_burn),
          outstanding: parseFloat(d.goal.total_outstanding),
        });
      })
      .catch((e) => setErr(e.message));
  }, []);

  const preview = useMemo(() => {
    if (!form || !base) return null;
    const duration = parseInt(form.goal_duration_months, 10) || 0;
    const dpw = parseInt(form.trading_days_per_week, 10) || 0;
    const savings = parseFloat(form.savings_goal) || 0;
    const end = addMonths(form.start_date, duration);
    const tradingDays = countTradingDays(form.start_date, end);
    const provision = base.burn * duration;
    const payoff = base.outstanding + provision;
    const grand = payoff + savings;
    const perDay = tradingDays ? grand / tradingDays : 0;
    return {
      endDate: end.toISOString().slice(0, 10),
      tradingDays,
      grand,
      perDay,
      perWeek: perDay * dpw,
      perMonth: duration ? grand / duration : 0,
    };
  }, [form, base]);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.updateSettings({
        start_date: form.start_date,
        goal_duration_months: parseInt(form.goal_duration_months, 10),
        trading_days_per_week: parseInt(form.trading_days_per_week, 10),
        savings_goal: parseFloat(form.savings_goal),
      });
      setMsg(res.warning || "Settings saved. Calendar recomputed.");
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  if (err && !form) return <div className="card text-red-400">{err}</div>;
  if (!form) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <h2 className="text-2xl font-extrabold">Goal Settings</h2>

      <form onSubmit={save} className="card space-y-4">
        {err && <div className="text-red-400 text-sm">{err}</div>}
        {msg && <div className="text-accent text-sm">{msg}</div>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-sm">
            Start Date (first trading day)
            <input
              type="date"
              className="input mt-1"
              value={form.start_date}
              onChange={set("start_date")}
            />
          </label>
          <label className="text-sm">
            Goal Duration (months)
            <input
              type="number"
              min="1"
              className="input mt-1 num"
              value={form.goal_duration_months}
              onChange={set("goal_duration_months")}
            />
          </label>
          <label className="text-sm">
            Trading Days / Week
            <input
              type="number"
              min="1"
              max="7"
              className="input mt-1 num"
              value={form.trading_days_per_week}
              onChange={set("trading_days_per_week")}
            />
          </label>
          <label className="text-sm">
            Savings Goal (₹)
            <input
              type="number"
              step="0.01"
              className="input mt-1 num"
              value={form.savings_goal}
              onChange={set("savings_goal")}
            />
          </label>
        </div>

        <p className="text-xs text-slate-500">
          Changing start date, duration, or days/week regenerates the daily P&L
          calendar. Entries whose dates still fall in the new calendar are
          preserved; any that fall outside are dropped (you'll be warned).
        </p>

        <div className="flex justify-end">
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </form>

      {preview && (
        <div className="card border-accent/30">
          <div className="card-label text-accent mb-3">
            Live Preview (before save)
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <div>
              <div className="card-label">Goal End</div>
              <div className="num text-lg font-bold mt-1">
                {preview.endDate}
              </div>
            </div>
            <div>
              <div className="card-label">Trading Days</div>
              <div className="num text-lg font-bold mt-1">
                {preview.tradingDays}
              </div>
            </div>
            <div>
              <div className="card-label">Grand Target</div>
              <div className="num text-lg font-bold mt-1 text-accent">
                {rupeeShort(preview.grand)}
              </div>
              <div className="num text-xs text-slate-500">
                {rupee(preview.grand)}
              </div>
            </div>
            <div>
              <div className="card-label">Required / Day</div>
              <div className="num text-lg font-bold mt-1 text-accent">
                {rupee2(preview.perDay)}
              </div>
            </div>
            <div>
              <div className="card-label">Required / Week</div>
              <div className="num text-lg font-bold mt-1">
                {rupee(preview.perWeek)}
              </div>
            </div>
            <div>
              <div className="card-label">Required / Month</div>
              <div className="num text-lg font-bold mt-1">
                {rupee(preview.perMonth)}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
