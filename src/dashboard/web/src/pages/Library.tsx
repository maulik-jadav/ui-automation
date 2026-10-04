import { BookOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { PageHeader, PrimaryButton } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { StatusChip, riskLabel } from "../components/StatusChip";
import type { ArtifactSummary } from "../types";

export function Library() {
  const [items, setItems] = useState<ArtifactSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .artifacts()
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div>
      <PageHeader
        title="Task library"
        purpose="Saved tasks your team can review, approve, and run on demand."
        action={
          <Link to="/teach">
            <PrimaryButton>Teach a new task</PrimaryButton>
          </Link>
        }
      />

      {error ? (
        <ErrorState message={error} onRetry={() => window.location.reload()} />
      ) : items === null ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No tasks yet"
          description="Teach your first task from the app, or seed a demo artifact for lookup."
          action={
            <Link to="/teach">
              <PrimaryButton>Teach a new task</PrimaryButton>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((a) => (
            <Link key={a.id} to={`/library/${encodeURIComponent(a.id)}`}>
              <Card className="h-full transition hover:shadow-md hover:ring-1 hover:ring-navy-800/20">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">{a.name}</h3>
                  {a.lastRunStatus ? <StatusChip status={a.lastRunStatus} /> : null}
                </div>
                <p className="mt-2 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
                  {a.description}
                </p>
                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-500">
                  <div>
                    <dt className="font-medium text-slate-700 dark:text-slate-300">Review</dt>
                    <dd className="capitalize">{a.reviewStatus}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-700 dark:text-slate-300">Risk</dt>
                    <dd>{riskLabel(a.riskClass)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-700 dark:text-slate-300">Version</dt>
                    <dd>v{a.version}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-700 dark:text-slate-300">Success</dt>
                    <dd>
                      {a.successRate != null ? `${Math.round(a.successRate * 100)}%` : "—"}
                    </dd>
                  </div>
                </dl>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
