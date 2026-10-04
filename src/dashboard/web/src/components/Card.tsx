import type { ReactNode } from "react";

export function Card({
  children,
  className = "",
  padding = "p-5",
}: {
  children: ReactNode;
  className?: string;
  padding?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200/80 bg-white shadow-sm dark:border-slate-700/60 dark:bg-slate-900/80 ${padding} ${className}`}
    >
      {children}
    </div>
  );
}
