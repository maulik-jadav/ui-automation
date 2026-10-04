import {
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  UserRound,
  XCircle,
  ArrowRight,
} from "lucide-react";
import type { RunStatusChip } from "../types";
import { Card } from "./Card";

type ResultState = Extract<
  RunStatusChip,
  "success" | "business_outcome" | "recovered" | "needs_human" | "hard_failure"
>;

const RESULT: Record<
  ResultState,
  {
    label: string;
    nextAction: string;
    border: string;
    bg: string;
    Icon: typeof CheckCircle2;
  }
> = {
  success: {
    label: "Success",
    nextAction: "Save this run to history or run again with different inputs.",
    border: "border-emerald-300 dark:border-emerald-700",
    bg: "bg-emerald-50/80 dark:bg-emerald-950/30",
    Icon: CheckCircle2,
  },
  business_outcome: {
    label: "Expected business outcome",
    nextAction: "Review the message — this may be normal (e.g. member not found).",
    border: "border-sky-300 dark:border-sky-700",
    bg: "bg-sky-50/80 dark:bg-sky-950/30",
    Icon: AlertCircle,
  },
  recovered: {
    label: "Recovered after retry",
    nextAction: "Check which recovery strategy was used before unattended runs.",
    border: "border-amber-300 dark:border-amber-700",
    bg: "bg-amber-50/80 dark:bg-amber-950/30",
    Icon: RotateCcw,
  },
  needs_human: {
    label: "Needs your help",
    nextAction: "Open Needs your help to claim and finish the step.",
    border: "border-orange-300 dark:border-orange-700",
    bg: "bg-orange-50/80 dark:bg-orange-950/30",
    Icon: UserRound,
  },
  hard_failure: {
    label: "Hard failure",
    nextAction: "Open run details, fix the task or environment, then retry.",
    border: "border-red-300 dark:border-red-700",
    bg: "bg-red-50/80 dark:bg-red-950/30",
    Icon: XCircle,
  },
};

export function ResultCard({
  status,
  message,
  onNext,
}: {
  status: RunStatusChip;
  message?: string;
  onNext?: () => void;
}) {
  const key = (
    status in RESULT ? status : "hard_failure"
  ) as ResultState;
  const cfg = RESULT[key];
  const { Icon, label, nextAction, border, bg } = cfg;

  return (
    <Card className={`${border} ${bg}`} padding="p-6">
      <div className="flex gap-4">
        <Icon className="h-8 w-8 shrink-0 text-navy-900 dark:text-slate-200" aria-hidden />
        <div className="flex-1">
          <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{label}</p>
          {message ? (
            <p className="mt-2 text-sm text-slate-700 dark:text-slate-300">{message}</p>
          ) : null}
          <p className="mt-3 flex items-start gap-2 text-sm text-slate-600 dark:text-slate-400">
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{nextAction}</span>
          </p>
          {onNext ? (
            <button
              type="button"
              onClick={onNext}
              className="mt-4 text-sm font-semibold text-navy-800 underline-offset-2 hover:underline dark:text-navy-700"
            >
              Go to next step
            </button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
