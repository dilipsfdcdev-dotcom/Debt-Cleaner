import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";
import {
  rupee2,
  signedRupee,
  pct,
  prettyDate,
  isToday,
} from "../format.js";

export default function DailyPnL() {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null); // trade_date being edited
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [err, setErr] = useState(null);
  const [saving, setSaving] = useState(false);
  const todayRef = useRef(null);

  const load = () =>
    api
      .listPnl()
      .then(setRows)
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (rows.length && todayRef.current) {
      todayRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [rows.length]);

  const startEdit = (r) => {
    setEditing(r.trade_date);
    setDraft(r.actual_pnl === null ? "" : String(r.actual_pnl));
    setNoteDraft(r.notes || "");
  };

  const save = async (r) => {
    setSaving(true);
    try {
      const val = draft.trim() === "" ? null : parseFloat(draft);
      const updated = await api.upsertPnl(r.trade_date, {
        actual_pnl: val,
        notes: noteDraft.trim() === "" ? null : noteDraft,
      });
      setRows(updated);
      setEditing(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const clear = async (r) => {
    setSaving(true);
    try {
      const updated = await api.clearPnl(r.trade_date);
      setRows(updated);
      setEditing(null);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const onKey = (e, r) => {
    if (e.key === "Enter") save(r);
    if (e.key === "Escape") setEditing(null);
  };

  const rowTint = (r) => {
    if (r.actual_pnl === null || r.actual_pnl === undefined) return "";
    const v = parseFloat(r.actual_pnl);
    if (v > 0) return "bg-accent/5";
    if (v < 0) return "bg-red-500/10";
    return "";
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-extrabold">Daily P&L Tracker</h2>
        <span className="text-sm text-slate-400">
          {rows.filter((r) => r.actual_pnl !== null).length} / {rows.length}{" "}
          days entered
        </span>
      </div>
      {err && <div className="card text-red-400">{err}</div>}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-ink-600">
              <th className="px-3 py-3">#</th>
              <th className="px-3 py-3">Date</th>
              <th className="px-3 py-3 text-right">Target</th>
              <th className="px-3 py-3 text-right">Actual P&L</th>
              <th className="px-3 py-3 text-right">Variance</th>
              <th className="px-3 py-3 text-right">Cumulative</th>
              <th className="px-3 py-3 text-right">% Goal</th>
              <th className="px-3 py-3 text-center">Status</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const today = isToday(r.trade_date);
              const isEditing = editing === r.trade_date;
              const v =
                r.actual_pnl === null ? null : parseFloat(r.actual_pnl);
              return (
                <tr
                  key={r.trade_date}
                  ref={today ? todayRef : null}
                  className={`border-b border-ink-700/60 ${rowTint(r)} ${
                    today ? "ring-1 ring-accent/50" : ""
                  }`}
                >
                  <td className="px-3 py-2 num text-slate-500">
                    {r.day_number}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {prettyDate(r.trade_date)}
                    {today && (
                      <span className="ml-2 text-[10px] font-bold text-accent">
                        TODAY
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 num text-right text-slate-400">
                    {rupee2(r.daily_target)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isEditing ? (
                      <input
                        autoFocus
                        type="number"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => onKey(e, r)}
                        className="input num text-right w-32 py-1"
                        placeholder="0"
                      />
                    ) : (
                      <button
                        onClick={() => startEdit(r)}
                        className={`num font-semibold ${
                          v === null
                            ? "text-slate-600"
                            : v < 0
                            ? "text-red-400"
                            : "text-accent"
                        }`}
                      >
                        {v === null ? "+ add" : signedRupee(v)}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 num text-right text-slate-400">
                    {r.variance_vs_target === null
                      ? "—"
                      : signedRupee(r.variance_vs_target)}
                  </td>
                  <td className="px-3 py-2 num text-right">
                    {rupee2(r.cumulative_pnl)}
                  </td>
                  <td className="px-3 py-2 num text-right text-slate-400">
                    {pct(r.pct_of_goal_done)}
                  </td>
                  <td className="px-3 py-2 text-center whitespace-nowrap">
                    {r.target_status === "HIT ✅" && (
                      <span className="text-xs font-bold px-2 py-1 rounded-full bg-accent/15 text-accent">
                        HIT ✅
                      </span>
                    )}
                    {r.target_status === "MISS" && (
                      <span className="text-xs font-bold px-2 py-1 rounded-full bg-red-500/15 text-red-400">
                        MISS
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {isEditing ? (
                      <div className="flex flex-col gap-1 items-end">
                        <input
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          onKeyDown={(e) => onKey(e, r)}
                          className="input py-1 text-xs w-40"
                          placeholder="notes…"
                        />
                        <div className="flex gap-1">
                          <button
                            disabled={saving}
                            onClick={() => save(r)}
                            className="btn btn-primary py-1 px-2 text-xs"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => clear(r)}
                            className="btn btn-ghost py-1 px-2 text-xs"
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                    ) : (
                      r.notes && (
                        <span className="text-xs text-slate-500 italic">
                          {r.notes}
                        </span>
                      )
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500">
        Tip: click an Actual P&L cell, type the value, press Enter to save.
        Negative numbers allowed.
      </p>
    </div>
  );
}
