// Thin fetch wrapper. All calls go through /api which nginx (prod) or the
// Vite dev proxy forwards to the FastAPI backend.

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch (_) {
      /* ignore */
    }
    throw new Error(detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  dashboard: () => request("/dashboard"),

  getSettings: () => request("/settings"),
  updateSettings: (body) =>
    request("/settings", { method: "PUT", body: JSON.stringify(body) }),

  listDebts: () => request("/debts"),
  createDebt: (body) =>
    request("/debts", { method: "POST", body: JSON.stringify(body) }),
  updateDebt: (id, body) =>
    request(`/debts/${id}`, { method: "PUT", body: JSON.stringify(body) }),
  setDebtStatus: (id, status) =>
    request(`/debts/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  deleteDebt: (id) => request(`/debts/${id}`, { method: "DELETE" }),

  listPnl: () => request("/pnl"),
  upsertPnl: (date, body) =>
    request(`/pnl/${date}`, { method: "PUT", body: JSON.stringify(body) }),
  clearPnl: (date) => request(`/pnl/${date}`, { method: "DELETE" }),

  exportData: () => request("/export"),
  importData: (body) =>
    request("/import", { method: "POST", body: JSON.stringify(body) }),
};
