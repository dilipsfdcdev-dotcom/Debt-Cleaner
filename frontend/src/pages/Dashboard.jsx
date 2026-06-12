import { useEffect, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import { api } from "../api.js";
import {
  rupee,
  rupee2,
  rupeeShort,
  pct,
  prettyDate,
} from "../format.js";

function Stat({ label, value, sub, accent }) {
  return (
    <div className="card">
      <div className="card-label">{label}</div>
      <div
        className={`num text-2xl font-bold mt-2 ${
          accent ? "text-accent" : "text-slate-100"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-xs text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}

export default function Dashboard() {
  const [dash, setDash] = useState(null);
  const [pnl, setPnl] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    Promise.all([api.dashboard(), api.listPnl()])
      .then(([d, p]) => {
        setDash(d);
        setPnl(p);
      })
      .catch((e) => setErr(e.message));
  }, []);

  if (err)
    return (
      <div className="card text-red-400">Failed to load dashboard: {err}</div>
    );
  if (!dash) return <div className="text-slate-400">Loading…</div>;

  const { goal, progress, pace, stats } = dash;

  // Build cumulative actual vs. ideal-pace series for the chart.
  const dailyTarget = parseFloat(goal.required_profit_per_day);
  const chartData = pnl.map((r) => ({
    day: r.day_number,
    date: r.trade_date,
    ideal: Math.round(dailyTarget * r.day_number),
    actual:
      r.actual_pnl === null || r.actual_pnl === undefined
        ? null
        : parseFloat(r.cumulative_pnl),
  }));

  const onTrack = pace.on_track_status;
  const onTrackColor = onTrack.includes("ON TRACK")
    ? "text-accent"
    : onTrack.includes("BEHIND")
    ? "text-amber-400"
    : "text-slate-300";

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-extrabold">Dashboard</h2>

      {/* Hero */}
      <div className="card bg-gradient-to-br from-ink-700 to-ink-800 border-accent/30">
        <div className="card-label text-accent">Grand Target</div>
        <div className="num text-4xl md:text-5xl font-extrabold mt-1">
          {rupeeShort(goal.grand_target)}
        </div>
        <div className="num text-sm text-slate-400">
          {rupee(goal.grand_target)} · debt payoff + ₹1 Cr savings
        </div>

        <div className="mt-5">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-slate-300">
              Earned {rupeeShort(progress.total_earned)}
            </span>
            <span className="text-slate-400">{pct(progress.progress_pct)}</span>
          </div>
          <div className="h-3 rounded-full bg-ink-900 overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all"
              style={{
                width: `${Math.min(
                  100,
                  Math.max(0, parseFloat(progress.progress_pct))
                )}%`,
              }}
            />
          </div>
          <div className="num text-sm text-slate-400 mt-2">
            Remaining {rupee(progress.remaining_to_goal)}
          </div>
        </div>
      </div>

      {/* Pace check — the number I look at daily */}
      <div className="card border-accent/40">
        <div className="card-label text-accent">
          Pace Check · Revised Daily Target
        </div>
        <div className="num text-4xl font-extrabold mt-1 text-accent">
          {pace.revised_daily_target_label ||
            rupee2(pace.revised_daily_target)}
        </div>
        <div className="flex flex-wrap gap-x-8 gap-y-2 mt-3 text-sm">
          <span className="text-slate-400">
            Status:{" "}
            <span className={`font-bold ${onTrackColor}`}>{onTrack}</span>
          </span>
          <span className="num text-slate-400">
            Avg/day: {rupee2(pace.average_daily_pnl)}
          </span>
          <span className="num text-slate-400">
            Days left: {pace.trading_days_remaining}
          </span>
          <span className="num text-slate-400">
            Original target/day: {rupee2(pace.required_profit_per_day)}
          </span>
        </div>
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="The Goal · Per Day"
          value={rupee(goal.required_profit_per_day)}
          sub={`${goal.total_trading_days} trading days`}
          accent
        />
        <Stat
          label="Per Week"
          value={rupee(goal.required_profit_per_week)}
          sub={`${goal.trading_days_per_week} days/week`}
        />
        <Stat
          label="Per Month"
          value={rupee(goal.required_profit_per_month)}
          sub={`${goal.goal_duration_months} months to ${prettyDate(
            goal.goal_end_date
          )}`}
        />
        <Stat
          label="Days Traded"
          value={progress.days_traded}
          sub={`of ${goal.total_trading_days}`}
        />
      </div>

      {/* Debt + interest burn */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Debt Outstanding"
          value={rupeeShort(goal.total_outstanding)}
          sub={rupee(goal.total_outstanding)}
        />
        <Stat
          label="Total Payoff (P+I)"
          value={rupeeShort(goal.total_debt_payoff)}
          sub={`incl. ${rupee(goal.interest_provision)} interest`}
        />
        <div className="card border-amber-500/30">
          <div className="card-label text-amber-400">Monthly Interest Burn</div>
          <div className="num text-2xl font-bold mt-2 text-amber-400">
            {rupee2(goal.monthly_interest_burn)}
          </div>
          <div className="text-xs text-slate-400 mt-1">
            You're burning{" "}
            <span className="num text-amber-300">
              {rupee(goal.daily_interest_bleed)}/day
            </span>{" "}
            in interest
          </div>
        </div>
        <Stat
          label="Savings Goal"
          value={rupeeShort(goal.savings_goal)}
          sub="on top of debt freedom"
        />
      </div>

      {/* Trading stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        <Stat label="Green Days" value={stats.green_days} accent />
        <Stat label="Red Days" value={stats.red_days} />
        <Stat label="Win Rate" value={pct(stats.win_rate)} />
        <Stat label="Target Hits" value={stats.target_hit_days} />
        <Stat label="Best Day" value={rupeeShort(stats.best_day)} accent />
        <Stat label="Worst Day" value={rupeeShort(stats.worst_day)} />
      </div>

      {/* Chart */}
      <div className="card">
        <div className="card-label mb-4">
          Cumulative P&L vs. Ideal Pace
        </div>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }}>
              <CartesianGrid stroke="#1f2942" strokeDasharray="3 3" />
              <XAxis dataKey="day" stroke="#64748b" tick={{ fontSize: 12 }} />
              <YAxis
                stroke="#64748b"
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => rupeeShort(v)}
                width={70}
              />
              <Tooltip
                contentStyle={{
                  background: "#0f1525",
                  border: "1px solid #2a3654",
                  borderRadius: 12,
                }}
                formatter={(v) => (v === null ? "—" : rupee(v))}
                labelFormatter={(d) => `Day ${d}`}
              />
              <Legend />
              <Line
                type="monotone"
                dataKey="ideal"
                name="Ideal pace"
                stroke="#64748b"
                strokeDasharray="6 4"
                dot={false}
                strokeWidth={2}
              />
              <Line
                type="monotone"
                dataKey="actual"
                name="Actual cumulative"
                stroke="#22d3a6"
                dot={false}
                strokeWidth={2.5}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
