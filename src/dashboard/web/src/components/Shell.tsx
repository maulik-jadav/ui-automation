import {
  Beaker,
  Bell,
  BookOpen,
  ChevronDown,
  History,
  Home,
  Moon,
  Play,
  Shield,
  Sparkles,
  Sun,
  UserRound,
} from "lucide-react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useApp } from "../context/AppContext";
import { ToastStack } from "./Toast";

const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/teach", label: "Teach a new task", icon: Sparkles },
  { to: "/library", label: "Task library", icon: BookOpen },
  { to: "/run", label: "Run a task", icon: Play },
  { to: "/handoff", label: "Needs your help", icon: UserRound },
  { to: "/safety", label: "Safety center", icon: Shield },
  { to: "/history", label: "Run history & reports", icon: History },
  { to: "/lab", label: "Test lab", icon: Beaker },
] as const;

export function Shell() {
  const {
    tenant,
    setTenant,
    tenants,
    darkMode,
    toggleDarkMode,
    handoffCount,
    notificationPermission,
    requestNotificationPermission,
  } = useApp();
  const navigate = useNavigate();

  return (
    <div className="flex min-h-full bg-slate-50 dark:bg-navy-950">
      <aside
        className="fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-slate-200/80 bg-white dark:border-slate-800 dark:bg-slate-950"
        aria-label="Main navigation"
      >
        <div className="border-b border-slate-200 px-5 py-5 dark:border-slate-800">
          <p className="text-xs font-semibold uppercase tracking-wider text-navy-800 dark:text-navy-700">
            Automation Control
          </p>
          <p className="mt-1 text-lg font-bold text-navy-900 dark:text-slate-100">Dashboard</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="space-y-1">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={"end" in item ? item.end : false}
                  className={({ isActive }) =>
                    `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                      isActive
                        ? "bg-navy-900 text-white dark:bg-navy-800"
                        : "text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900"
                    }`
                  }
                >
                  <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">{item.label}</span>
                  {item.label === "Needs your help" && handoffCount > 0 ? (
                    <span className="ml-auto rounded-full bg-orange-500 px-2 py-0.5 text-xs font-bold text-white">
                      {handoffCount}
                    </span>
                  ) : null}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <div className="flex min-h-full flex-1 flex-col pl-64">
        <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
          <div className="flex flex-wrap items-center gap-3 px-6 py-3">
            <div className="relative">
              <label className="sr-only" htmlFor="tenant-select">
                Tenant
              </label>
              <select
                id="tenant-select"
                value={tenant}
                onChange={(e) => setTenant(e.target.value as typeof tenant)}
                className="appearance-none rounded-lg border border-slate-300 bg-white py-2 pl-3 pr-9 text-sm font-medium dark:border-slate-600 dark:bg-slate-900"
              >
                {tenants.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
                aria-hidden
              />
            </div>

            <span className="rounded-full bg-navy-900/10 px-3 py-1 text-xs font-semibold text-navy-900 dark:bg-navy-800/50 dark:text-slate-200">
              Demo mode
            </span>

            <div className="ml-auto flex items-center gap-2">
              {notificationPermission === "default" ? (
                <button
                  type="button"
                  onClick={() => void requestNotificationPermission()}
                  className="hidden text-xs text-navy-800 underline sm:inline dark:text-navy-700"
                >
                  Enable alerts
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => navigate("/handoff")}
                className="relative rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label={`Notifications, ${handoffCount} need help`}
              >
                <Bell className="h-5 w-5" aria-hidden />
                {handoffCount > 0 ? (
                  <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-orange-500 px-1 text-[10px] font-bold text-white">
                    {handoffCount}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={toggleDarkMode}
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              >
                {darkMode ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>
              <div
                className="flex items-center gap-2 rounded-full border border-slate-200 py-1 pl-1 pr-3 dark:border-slate-700"
                aria-label="Signed in as Operator"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-white">
                  OP
                </span>
                <span className="text-sm font-medium">Operator</span>
              </div>
            </div>
          </div>

          {handoffCount > 0 ? (
            <div
              className="flex items-center justify-between gap-4 border-t border-orange-200 bg-gradient-to-r from-orange-100 to-red-50 px-6 py-2.5 dark:border-orange-900/50 dark:from-orange-950/60 dark:to-red-950/40"
              role="alert"
            >
              <p className="text-sm font-medium text-orange-950 dark:text-orange-100">
                {handoffCount} automation run{handoffCount === 1 ? "" : "s"} need your help right now.
              </p>
              <button
                type="button"
                onClick={() => navigate("/handoff")}
                className="shrink-0 rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-700"
              >
                Open inbox
              </button>
            </div>
          ) : null}
        </header>

        <main className="flex-1 px-6 py-8">
          <Outlet />
        </main>
      </div>
      <ToastStack />
    </div>
  );
}
