import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { ErrorState } from "../components/ErrorState";
import { PageHeader, SecondaryButton } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { StatusChip } from "../components/StatusChip";
import type { RunDetailResponse, RunStatusChip } from "../types";

export function RunReport() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<RunDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    void api
      .run(id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  if (!id) return <ErrorState message="Missing run id" />;

  const status = (data?.status ?? "unknown") as RunStatusChip;

  return (
    <div className="print:bg-white">
      <div className="mb-6 print:hidden">
        <PageHeader
          title="Run report"
          purpose="Supervisor-friendly summary — use Print to save as PDF."
          action={
            <div className="flex gap-2">
              <Link to={`/history/${id}`}>
                <SecondaryButton>Back to details</SecondaryButton>
              </Link>
              <SecondaryButton onClick={() => window.print()}>
                <Printer className="h-4 w-4" aria-hidden />
                Print
              </SecondaryButton>
            </div>
          }
        />
      </div>

      {error ? <ErrorState message={error} /> : null}
      {!data && !error ? <Skeleton className="h-48" /> : null}

      {data ? (
        <article className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm print:border-0 print:shadow-none dark:border-slate-700 dark:bg-slate-900">
          <header className="border-b border-slate-200 pb-6 dark:border-slate-700">
            <p className="text-xs font-semibold uppercase tracking-wider text-navy-800">
              Automation Control Dashboard
            </p>
            <h1 className="mt-2 text-2xl font-bold">Run report</h1>
            <p className="mt-1 font-mono text-sm text-slate-600">Run ID: {id}</p>
            <div className="mt-4">
              <StatusChip status={status} />
            </div>
          </header>

          <section className="mt-6 space-y-4 text-sm">
            <div>
              <h2 className="font-semibold text-slate-900 dark:text-slate-100">Task</h2>
              <p>{String(data.meta?.artifactName ?? data.meta?.goal ?? "—")}</p>
            </div>
            <div>
              <h2 className="font-semibold">Started</h2>
              <p>
                {data.meta?.startedAt
                  ? new Date(String(data.meta.startedAt)).toLocaleString()
                  : "—"}
              </p>
            </div>
            <div>
              <h2 className="font-semibold">Outcome message</h2>
              <p>{data.result?.message ? String(data.result.message) : "—"}</p>
            </div>
            <div>
              <h2 className="font-semibold">Evidence</h2>
              <p>{data.screenshots.length} screenshot(s) on file.</p>
            </div>
          </section>

          <footer className="mt-10 border-t border-slate-200 pt-4 text-xs text-slate-500 print:mt-16">
            Generated {new Date().toLocaleString()} · Demo mode · Operator sign-off pending
          </footer>
        </article>
      ) : null}
    </div>
  );
}
