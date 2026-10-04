import { History as HistoryIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PageHeader } from "../components/PageHeader";
import { SecondaryButton } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { StatusChip } from "../components/StatusChip";
import type { RunSummary, RunStatusChip } from "../types";

const STATUS_OPTIONS: (RunStatusChip | "")[] = [
  "",
  "success",
  "business_outcome",
  "recovered",
  "needs_human",
  "hard_failure",
  "running",
];

export function History() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [error, setError] = useState<string | null>(null);

  function load() {
    setError(null);
    void api
      .runs({ status: status || undefined, q: q || undefined })
      .then(setRuns)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  useEffect(() => {
    load();
  }, [status]);

  return (
    <div>
      <PageHeader
        title="Run history & reports"
        purpose="Find past runs, open evidence, and print a summary report for supervisors."
        action={<SecondaryButton onClick={load}>Refresh</SecondaryButton>}
      />

      <Card className="mb-6">
        <div className="flex flex-wrap gap-4">
          <label className="text-sm">
            <span className="font-medium">Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="ml-2 rounded-lg border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s || "all"} value={s}>
                  {s || "All"}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 min-w-[200px] items-center gap-2 text-sm">
            <span className="font-medium shrink-0">Search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && load()}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-1.5 dark:border-slate-600 dark:bg-slate-900"
              placeholder="Run id or task name"
            />
            <SecondaryButton onClick={load}>Apply</SecondaryButton>
          </label>
        </div>
      </Card>

      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {runs === null ? (
        <Skeleton className="h-64" />
      ) : runs.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title="No runs match"
          description="Try clearing filters or run a task from the library."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900/80">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
              <tr>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Task / goal</th>
                <th className="px-4 py-3 font-semibold">Kind</th>
                <th className="px-4 py-3 font-semibold">Started</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="px-4 py-3">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="px-4 py-3 font-medium">{r.artifactName ?? r.id}</td>
                  <td className="px-4 py-3 capitalize text-slate-600">{r.kind}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/history/${r.id}`}
                      className="font-semibold text-navy-800 hover:underline dark:text-navy-700"
                    >
                      Details
                    </Link>
                    <span className="mx-2 text-slate-300">|</span>
                    <Link
                      to={`/history/${r.id}/report`}
                      className="text-navy-800 hover:underline dark:text-navy-700"
                    >
                      Report
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
