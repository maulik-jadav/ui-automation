import { CheckCircle2, Info, AlertTriangle, X, XCircle } from "lucide-react";
import { useApp, type ToastKind } from "../context/AppContext";

const ICONS: Record<ToastKind, typeof Info> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: XCircle,
};

const STYLES: Record<ToastKind, string> = {
  info: "border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-900",
  success: "border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/50",
  warning: "border-orange-200 bg-orange-50 dark:border-orange-800 dark:bg-orange-950/50",
  error: "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950/50",
};

export function ToastStack() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-4 right-4 z-[100] flex max-w-sm flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={`animate-toast pointer-events-auto flex gap-3 rounded-xl border p-4 shadow-lg ${STYLES[t.kind]}`}
          >
            <Icon className="mt-0.5 h-5 w-5 shrink-0 text-navy-800 dark:text-navy-700" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900 dark:text-slate-100">{t.title}</p>
              {t.message ? (
                <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{t.message}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(t.id)}
              className="shrink-0 rounded p-1 text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-700"
              aria-label="Dismiss notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
