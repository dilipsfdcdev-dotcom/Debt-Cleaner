// Indian-style number formatting helpers (₹, lakh/crore, digit grouping).

const inr = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const inr2 = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isNaN(n) ? null : n;
}

// ₹38,80,9651 style full grouping, no decimals.
export function rupee(v) {
  const n = toNum(v);
  if (n === null) return "—";
  return "₹" + inr.format(Math.round(n));
}

// With two decimals.
export function rupee2(v) {
  const n = toNum(v);
  if (n === null) return "—";
  return "₹" + inr2.format(n);
}

// Short crore / lakh form for dashboard hero numbers.
export function rupeeShort(v) {
  const n = toNum(v);
  if (n === null) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1.0e7) return `${sign}₹${(abs / 1.0e7).toFixed(2)} Cr`;
  if (abs >= 1.0e5) return `${sign}₹${(abs / 1.0e5).toFixed(2)} L`;
  if (abs >= 1.0e3) return `${sign}₹${(abs / 1.0e3).toFixed(1)} K`;
  return `${sign}₹${abs.toFixed(0)}`;
}

export function pct(v) {
  const n = toNum(v);
  if (n === null) return "—";
  return `${n.toFixed(2)}%`;
}

export function signedRupee(v) {
  const n = toNum(v);
  if (n === null) return "—";
  const s = rupee2(Math.abs(n));
  return n < 0 ? `-${s}` : `+${s}`;
}

const fmtDate = new Intl.DateTimeFormat("en-IN", {
  weekday: "short",
  day: "2-digit",
  month: "short",
});

export function prettyDate(iso) {
  if (!iso) return "—";
  return fmtDate.format(new Date(iso + "T00:00:00"));
}

export function isToday(iso) {
  if (!iso) return false;
  const today = new Date();
  const t = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
    today.getDate()
  ).padStart(2, "0")}`;
  return iso === t;
}
