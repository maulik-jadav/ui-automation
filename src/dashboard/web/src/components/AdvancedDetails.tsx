import { ChevronDown } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

export function AdvancedDetails({
  summary,
  children,
  defaultOpen = false,
}: {
  summary: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-700">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left text-sm font-medium text-slate-800 dark:text-slate-200"
      >
        {summary}
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>
      {open ? (
        <div id={panelId} className="border-t border-slate-200 px-4 py-3 dark:border-slate-700">
          {children}
        </div>
      ) : null}
    </div>
  );
}
