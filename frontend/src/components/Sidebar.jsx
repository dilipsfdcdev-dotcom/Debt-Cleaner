import { NavLink } from "react-router-dom";

const links = [
  { to: "/", label: "Dashboard", icon: "📊", end: true },
  { to: "/pnl", label: "Daily P&L", icon: "📈" },
  { to: "/debts", label: "Debt Register", icon: "💳" },
  { to: "/settings", label: "Goal Settings", icon: "⚙️" },
];

export default function Sidebar({ open, onClose }) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/50 z-30 md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed md:static z-40 inset-y-0 left-0 w-64 bg-ink-800 border-r border-ink-600
          transform transition-transform md:translate-x-0 ${
            open ? "translate-x-0" : "-translate-x-full"
          }`}
      >
        <div className="p-6">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏁</span>
            <div>
              <h1 className="font-extrabold text-lg leading-tight">
                Debt Freedom
              </h1>
              <p className="text-xs text-slate-400">Tracker</p>
            </div>
          </div>
        </div>
        <nav className="px-3 space-y-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
                  isActive
                    ? "bg-accent/15 text-accent"
                    : "text-slate-300 hover:bg-ink-700"
                }`
              }
            >
              <span>{l.icon}</span>
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 p-4 text-[11px] text-slate-500">
          Local-only · data in Postgres
        </div>
      </aside>
    </>
  );
}
