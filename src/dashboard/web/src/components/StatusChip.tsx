import {
  AlertCircle,
  CheckCircle2,
  HelpCircle,
  Loader2,
  RotateCcw,
  UserRound,
  XCircle,
} from "lucide-react";
import type { RunStatusChip } from "../types";

const CONFIG: Record<
  RunStatusChip,
  { label: string; className: string; Icon: typeof CheckCircle2 }
> = {
  success: {
    label: "Success",
    className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
    Icon: CheckCircle2,
  },
  business_outcome: {
    label: "Business outcome",
    className: "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200",
    Icon: AlertCircle,
  },
  recovered: {
    label: "Recovered",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
    Icon: RotateCcw,
  },
  needs_human: {
    label: "Needs human",
    className: "bg-orange-100 text-orange-900 dark:bg-orange-900/40 dark:text-orange-100",
    Icon: UserRound,
  },
  hard_failure: {
    label: "Hard failure",
    className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
    Icon: XCircle,
  },
  running: {
    label: "Running",
    className: "bg-navy-900/10 text-navy-900 dark:bg-navy-800/40 dark:text-slate-200",
    Icon: Loader2,
  },
  unknown: {
    label: "Unknown",
    className: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
    Icon: HelpCircle,
  },
};

export function StatusChip({ status }: { status: RunStatusChip }) {
  const cfg = CONFIG[status] ?? CONFIG.unknown;
  const { Icon, label, className } = cfg;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${className}`}
    >
      <Icon
        className={`h-3.5 w-3.5 ${status === "running" ? "animate-spin" : ""}`}
        aria-hidden
      />
      {label}
    </span>
  );
}

export function riskLabel(risk: "read" | "reversible_write" | "irreversible"): string {
  if (risk === "read") return "Read-only";
  if (risk === "reversible_write") return "Reversible";
  return "Irreversible";
}
