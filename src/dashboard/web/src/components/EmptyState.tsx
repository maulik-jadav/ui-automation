import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50 px-6 py-14 text-center dark:border-slate-600 dark:bg-slate-900/40"
      role="status"
    >
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-navy-900/10 text-navy-800 dark:bg-navy-800/30 dark:text-navy-700">
        <Icon className="h-7 w-7" aria-hidden />
      </div>
      <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      <p className="mt-2 max-w-md text-sm text-slate-600 dark:text-slate-400">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
