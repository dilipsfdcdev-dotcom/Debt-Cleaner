import { useState } from "react";
import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import DailyPnL from "./pages/DailyPnL.jsx";
import DebtRegister from "./pages/DebtRegister.jsx";
import Settings from "./pages/Settings.jsx";

export default function App() {
  const [navOpen, setNavOpen] = useState(false);

  return (
    <div className="flex min-h-screen">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="md:hidden flex items-center gap-3 p-4 border-b border-ink-600 bg-ink-800">
          <button
            className="text-2xl"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
          >
            ☰
          </button>
          <span className="font-bold">Debt Freedom Tracker</span>
        </header>
        <main className="flex-1 p-4 md:p-8 max-w-6xl w-full mx-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/pnl" element={<DailyPnL />} />
            <Route path="/debts" element={<DebtRegister />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
