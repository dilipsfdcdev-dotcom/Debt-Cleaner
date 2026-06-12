import { useEffect, useState } from "react";
import { api } from "../api.js";
import { rupee, rupee2, pct } from "../format.js";

const EMPTY = {
  lender: "",
  type: "Personal Loan",
  original_amount: "",
  interest_rate: "",
  rate_basis: "Annual",
  emi_monthly_pay: "",
  start_date: "",
  tenure_months: "",
  outstanding: "",
  status: "Active",
};

function DebtModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    if (!initial) return EMPTY;
    return {
      ...initial,
      // rate is stored as decimal (0.155) but shown as percent (15.5)
      interest_rate: (parseFloat(initial.interest_rate) * 100).toString(),
      original_amount: String(initial.original_amount ?? ""),
      emi_monthly_pay: initial.emi_monthly_pay ?? "",
      start_date: initial.start_date ?? "",
      tenure_months: initial.tenure_months ?? "",
      outstanding: String(initial.outstanding ?? ""),
    };
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = {
      lender: form.lender,
      type: form.type,
      original_amount: parseFloat(form.original_amount),
      interest_rate: parseFloat(form.interest_rate) / 100,
      rate_basis: form.rate_basis,
      emi_monthly_pay:
        form.emi_monthly_pay === "" ? null : parseFloat(form.emi_monthly_pay),
      start_date: form.start_date === "" ? null : form.start_date,
      tenure_months:
        form.tenure_months === "" ? null : parseInt(form.tenure_months, 10),
      outstanding: parseFloat(form.outstanding),
      status: form.status,
    };
    try {
      if (initial) await api.updateDebt(initial.id, body);
      else await api.createDebt(body);
      onSaved();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="card w-full max-w-lg max-h-[90vh] overflow-y-auto"
      >
        <h3 className="text-xl font-bold mb-4">
          {initial ? "Edit Debt" : "Add Debt"}
        </h3>
        {err && <div className="text-red-400 text-sm mb-3">{err}</div>}
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 text-sm">
            Lender
            <input className="input mt-1" value={form.lender} onChange={set("lender")} required />
          </label>
          <label className="text-sm">
            Type
            <input className="input mt-1" value={form.type} onChange={set("type")} required />
          </label>
          <label className="text-sm">
            Status
            <select className="input mt-1" value={form.status} onChange={set("status")}>
              <option>Active</option>
              <option>Cleared</option>
            </select>
          </label>
          <label className="text-sm">
            Original Amount (₹)
            <input className="input mt-1 num" type="number" step="0.01" value={form.original_amount} onChange={set("original_amount")} required />
          </label>
          <label className="text-sm">
            Outstanding (₹)
            <input className="input mt-1 num" type="number" step="0.01" value={form.outstanding} onChange={set("outstanding")} required />
          </label>
          <label className="text-sm">
            Interest Rate (%)
            <input className="input mt-1 num" type="number" step="0.001" value={form.interest_rate} onChange={set("interest_rate")} required />
          </label>
          <label className="text-sm">
            Rate Basis
            <select className="input mt-1" value={form.rate_basis} onChange={set("rate_basis")}>
              <option>Annual</option>
              <option>Monthly</option>
            </select>
          </label>
          <label className="text-sm">
            EMI / Monthly Pay (₹)
            <input className="input mt-1 num" type="number" step="0.01" value={form.emi_monthly_pay} onChange={set("emi_monthly_pay")} />
          </label>
          <label className="text-sm">
            Tenure (months)
            <input className="input mt-1 num" type="number" value={form.tenure_months} onChange={set("tenure_months")} />
          </label>
          <label className="col-span-2 text-sm">
            Start Date
            <input className="input mt-1" type="date" value={form.start_date} onChange={set("start_date")} />
          </label>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn btn-primary">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function DebtRegister() {
  const [debts, setDebts] = useState([]);
  const [err, setErr] = useState(null);
  const [modal, setModal] = useState(null); // null | {} (new) | debt (edit)
  const [showCleared, setShowCleared] = useState(false);

  const load = () =>
    api
      .listDebts()
      .then(setDebts)
      .catch((e) => setErr(e.message));

  useEffect(() => {
    load();
  }, []);

  const active = debts.filter((d) => d.status === "Active");
  const cleared = debts.filter((d) => d.status === "Cleared");

  const sum = (key) =>
    active.reduce((acc, d) => acc + parseFloat(d[key] || 0), 0);

  const toggleStatus = async (d) => {
    try {
      await api.setDebtStatus(d.id, d.status === "Active" ? "Cleared" : "Active");
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const remove = async (d) => {
    if (!confirm(`Delete ${d.lender} – ${d.type}? This cannot be undone.`))
      return;
    try {
      await api.deleteDebt(d.id);
      load();
    } catch (e) {
      setErr(e.message);
    }
  };

  const Row = ({ d, clearedStyle }) => (
    <tr
      className={`border-b border-ink-700/60 ${
        clearedStyle ? "line-through text-slate-500" : ""
      }`}
    >
      <td className="px-3 py-2">
        <div className="font-semibold">{d.lender}</div>
        <div className="text-xs text-slate-400">{d.type}</div>
      </td>
      <td className="px-3 py-2 num text-right">{rupee(d.original_amount)}</td>
      <td className="px-3 py-2 num text-right">
        {pct(parseFloat(d.interest_rate) * 100)}
        <span className="text-xs text-slate-500 ml-1">{d.rate_basis[0]}</span>
      </td>
      <td className="px-3 py-2 num text-right">{rupee(d.outstanding)}</td>
      <td className="px-3 py-2 num text-right text-amber-400">
        {rupee2(d.monthly_interest_cost)}
      </td>
      <td className="px-3 py-2 num text-right">
        {rupee(d.interest_till_goal_end)}
      </td>
      <td className="px-3 py-2 num text-right font-semibold">
        {rupee(d.total_payoff)}
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button
          onClick={() => toggleStatus(d)}
          className="btn btn-ghost py-1 px-2 text-xs"
        >
          {d.status === "Active" ? "Mark Cleared" : "Reactivate"}
        </button>
        <button
          onClick={() => setModal(d)}
          className="btn btn-ghost py-1 px-2 text-xs ml-1"
        >
          Edit
        </button>
        <button
          onClick={() => remove(d)}
          className="btn py-1 px-2 text-xs ml-1 text-red-400 hover:bg-red-500/10"
        >
          ✕
        </button>
      </td>
    </tr>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-2xl font-extrabold">Debt Register</h2>
        <button className="btn btn-primary" onClick={() => setModal({})}>
          + Add Debt
        </button>
      </div>
      {err && <div className="card text-red-400">{err}</div>}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-slate-400 border-b border-ink-600">
              <th className="px-3 py-3">Lender / Type</th>
              <th className="px-3 py-3 text-right">Original</th>
              <th className="px-3 py-3 text-right">Rate</th>
              <th className="px-3 py-3 text-right">Outstanding</th>
              <th className="px-3 py-3 text-right">Monthly Int.</th>
              <th className="px-3 py-3 text-right">Int. till Goal</th>
              <th className="px-3 py-3 text-right">Total Payoff</th>
              <th className="px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {active.map((d) => (
              <Row key={d.id} d={d} />
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-ink-500 font-bold bg-ink-700/40">
              <td className="px-3 py-3">TOTAL ({active.length} active)</td>
              <td className="px-3 py-3 num text-right">
                {rupee(sum("original_amount"))}
              </td>
              <td className="px-3 py-3"></td>
              <td className="px-3 py-3 num text-right">
                {rupee(sum("outstanding"))}
              </td>
              <td className="px-3 py-3 num text-right text-amber-400">
                {rupee2(sum("monthly_interest_cost"))}
              </td>
              <td className="px-3 py-3 num text-right">
                {rupee(sum("interest_till_goal_end"))}
              </td>
              <td className="px-3 py-3 num text-right text-accent">
                {rupee(sum("total_payoff"))}
              </td>
              <td className="px-3 py-3"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      {cleared.length > 0 && (
        <div className="card">
          <button
            className="flex items-center gap-2 text-sm font-semibold text-slate-300"
            onClick={() => setShowCleared((s) => !s)}
          >
            <span>{showCleared ? "▾" : "▸"}</span>
            Cleared debts ({cleared.length})
          </button>
          {showCleared && (
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <tbody>
                  {cleared.map((d) => (
                    <Row key={d.id} d={d} clearedStyle />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {modal && (
        <DebtModal
          initial={modal.id ? modal : null}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            load();
          }}
        />
      )}
    </div>
  );
}
