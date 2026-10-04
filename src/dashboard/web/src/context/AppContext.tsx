import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  pendingHandoffCount,
  subscribeInterventionEvents,
} from "../api";
import {
  DEMO_CHECKLIST_DEFAULT as DEFAULT_ITEMS,
  type DemoChecklistItem,
  type HealthResponse,
  type InterventionRequest,
} from "../types";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastItem {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
}

const TENANTS = ["ACME CU", "Contoso CU"] as const;
export type TenantName = (typeof TENANTS)[number];

const STORAGE_DARK = "acd-dark-mode";
const STORAGE_TENANT = "acd-tenant";
const STORAGE_CHECKLIST = "acd-demo-checklist";
const STORAGE_NOTIFIED = "acd-handoff-notified";

interface AppContextValue {
  health: HealthResponse | null;
  healthLoading: boolean;
  refreshHealth: (deep?: boolean) => Promise<void>;
  tenant: TenantName;
  setTenant: (t: TenantName) => void;
  tenants: readonly TenantName[];
  darkMode: boolean;
  toggleDarkMode: () => void;
  handoffs: InterventionRequest[];
  handoffCount: number;
  toasts: ToastItem[];
  pushToast: (t: Omit<ToastItem, "id">) => void;
  dismissToast: (id: string) => void;
  notificationPermission: NotificationPermission | "unsupported";
  requestNotificationPermission: () => Promise<void>;
  demoChecklist: DemoChecklistItem[];
  toggleChecklistItem: (id: string) => void;
  resetChecklist: () => void;
  playHandoffBeep: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

function loadChecklist(): DemoChecklistItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_CHECKLIST);
    if (raw) {
      const parsed = JSON.parse(raw) as DemoChecklistItem[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_ITEMS.map((i) => ({ ...i, done: false }));
}

function softBeep(): void {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.value = 0.04;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc.stop(ctx.currentTime + 0.25);
    setTimeout(() => void ctx.close(), 400);
  } catch {
    /* ignore */
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [tenant, setTenantState] = useState<TenantName>(() => {
    const s = localStorage.getItem(STORAGE_TENANT);
    return s === "Contoso CU" ? "Contoso CU" : "ACME CU";
  });
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem(STORAGE_DARK) === "1");
  const [handoffs, setHandoffs] = useState<InterventionRequest[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [demoChecklist, setDemoChecklist] = useState<DemoChecklistItem[]>(loadChecklist);
  const notifiedRef = useRef<Set<string>>(new Set());

  const notificationPermission: NotificationPermission | "unsupported" =
    typeof Notification === "undefined" ? "unsupported" : Notification.permission;

  const pushToast = useCallback((t: Omit<ToastItem, "id">) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev.slice(-4), { ...t, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id));
    }, 6000);
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const refreshHealth = useCallback(async (deep = false) => {
    setHealthLoading(true);
    try {
      const h = await api.health(deep);
      setHealth(h);
    } catch (err) {
      pushToast({
        kind: "error",
        title: "Could not reach dashboard API",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setHealthLoading(false);
    }
  }, [pushToast]);

  const setTenant = useCallback((t: TenantName) => {
    setTenantState(t);
    localStorage.setItem(STORAGE_TENANT, t);
    pushToast({ kind: "info", title: "Tenant switched", message: `Now working as ${t}` });
  }, [pushToast]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((d) => {
      const next = !d;
      localStorage.setItem(STORAGE_DARK, next ? "1" : "0");
      return next;
    });
  }, []);

  const toggleChecklistItem = useCallback((id: string) => {
    setDemoChecklist((items) => {
      const next = items.map((i) => (i.id === id ? { ...i, done: !i.done } : i));
      localStorage.setItem(STORAGE_CHECKLIST, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetChecklist = useCallback(() => {
    const next = DEFAULT_ITEMS.map((i) => ({ ...i, done: false }));
    setDemoChecklist(next);
    localStorage.setItem(STORAGE_CHECKLIST, JSON.stringify(next));
  }, []);

  const requestNotificationPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    await Notification.requestPermission();
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    document.body.classList.toggle("dark", darkMode);
    if (darkMode) {
      document.body.classList.remove("bg-slate-50", "text-slate-900");
      document.body.classList.add("bg-navy-950", "text-slate-100");
    } else {
      document.body.classList.remove("bg-navy-950", "text-slate-100");
      document.body.classList.add("bg-slate-50", "text-slate-900");
    }
  }, [darkMode]);

  useEffect(() => {
    void refreshHealth(true);
    const t = window.setInterval(() => void refreshHealth(false), 30000);
    return () => clearInterval(t);
  }, [refreshHealth]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_NOTIFIED);
      if (raw) notifiedRef.current = new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }

    const unsub = subscribeInterventionEvents((payload) => {
      const items = payload.items ?? [];
      setHandoffs(items);
      const pending = items.filter((i) => i.status === "pending");
      for (const p of pending) {
        if (notifiedRef.current.has(p.id)) continue;
        notifiedRef.current.add(p.id);
        softBeep();
        pushToast({
          kind: "warning",
          title: "Automation needs your help",
          message: p.goalOrCapability,
        });
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("Needs your help", {
            body: p.reason || p.goalOrCapability,
            tag: p.id,
          });
        }
      }
      localStorage.setItem(STORAGE_NOTIFIED, JSON.stringify([...notifiedRef.current]));
    });

    void api.interventions().then(setHandoffs).catch(() => undefined);

    return unsub;
  }, [pushToast]);

  const handoffCount = pendingHandoffCount(handoffs);

  const value = useMemo<AppContextValue>(
    () => ({
      health,
      healthLoading,
      refreshHealth,
      tenant,
      setTenant,
      tenants: TENANTS,
      darkMode,
      toggleDarkMode,
      handoffs,
      handoffCount,
      toasts,
      pushToast,
      dismissToast,
      notificationPermission,
      requestNotificationPermission,
      demoChecklist,
      toggleChecklistItem,
      resetChecklist,
      playHandoffBeep: softBeep,
    }),
    [
      health,
      healthLoading,
      refreshHealth,
      tenant,
      setTenant,
      darkMode,
      toggleDarkMode,
      handoffs,
      handoffCount,
      toasts,
      pushToast,
      dismissToast,
      notificationPermission,
      requestNotificationPermission,
      demoChecklist,
      toggleChecklistItem,
      resetChecklist,
    ]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}

// re-export for type-only import fix
export type { DemoChecklistItem };
