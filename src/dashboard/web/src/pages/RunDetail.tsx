import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api";
import { AdvancedDetails } from "../components/AdvancedDetails";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { PageHeader, PrimaryButton } from "../components/PageHeader";
import { ResultCard } from "../components/ResultCard";
import { SkeletonLines } from "../components/Skeleton";
import { StatusChip } from "../components/StatusChip";
import type { RunDetailResponse, RunStatusChip } from "../types";

export function RunDetail() {
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
  const message =
    data?.result && typeof data.result.message === "string" ? data.result.message : undefined;

  return (
    <div>
      <PageHeader
        title={`Run ${id}`}
        purpose="Evidence bundle for this automation run — steps, screenshots, and outcome."
        action={
          <Link to={`/history/${id}/report`}>
            <PrimaryButton>
              <FileText className="h-4 w-4" aria-hidden />
              Printable report
            </PrimaryButton>
          </Link>
        }
      />

      {error ? <ErrorState message={error} /> : null}
      {!data && !error ? <SkeletonLines count={6} /> : null}

      {data ? (
        <>
          <div className="mb-6 flex flex-wrap items-center gap-3">
            <StatusChip status={status} />
            {data.meta?.tenant ? (
              <span className="text-sm text-slate-600">Tenant: {String(data.meta.tenant)}</span>
            ) : null}
          </div>

          {["success", "business_outcome", "recovered", "needs_human", "hard_failure"].includes(
            status
          ) ? (
            <div className="mb-8">
              <ResultCard status={status} message={message} />
            </div>
          ) : null}

          {data.screenshots.length > 0 ? (
            <Card className="mb-6">
              <h2 className="font-semibold">Screenshots</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.screenshots.map((src) => (
                  <img
                    key={src}
                    src={src}
                    alt="Run evidence screenshot"
                    className="rounded-lg border border-slate-200 object-cover dark:border-slate-700"
                  />
                ))}
              </div>
            </Card>
          ) : null}

          <Card className="mb-6">
            <h2 className="font-semibold">Steps log</h2>
            {data.steps.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No step log entries.</p>
            ) : (
              <ol className="mt-4 max-h-96 space-y-2 overflow-y-auto text-xs">
                {data.steps.map((s, i) => (
                  <li key={i} className="rounded bg-slate-50 p-2 dark:bg-slate-900">
                    <pre>{JSON.stringify(s, null, 2)}</pre>
                  </li>
                ))}
              </ol>
            )}
          </Card>

          <AdvancedDetails summary="Technical details (meta & result JSON)">
            <pre className="max-h-96 overflow-auto text-xs">{JSON.stringify(data, null, 2)}</pre>
          </AdvancedDetails>
        </>
      ) : null}
    </div>
  );
}
