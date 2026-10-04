import { BookOpen, Play, Sparkles, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { PageHeader, PrimaryButton } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { StatusChip } from "../components/StatusChip";
import { useApp } from "../context/AppContext";
import type { OverviewResponse } from "../types";

export function Home() {
  const { health, healthLoading, handoffCount } = useApp();
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api
      .overview()
      .then(setOverview)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <div>
      <PageHeader
        title="Home"
        purpose="See how automation is doing today and jump to the next thing you need to do."
        action={
          <PrimaryButton onClick={() => window.location.assign("/run")}>
            <Play className="h-4 w-4" aria-hidden />
            Run a task
          </PrimaryButton>
        }
      />

      <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {error ? (
          <div className="sm:col-span-2 xl:col-span-4">
            <ErrorState message={error} onRetry={() => window.location.reload()} />
          </div>
        ) : !overview ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28" />)
        ) : (
          <>
            <StatCard label="Tasks in library" value={String(overview.tasksInLibrary)} />
            <StatCard label="Runs today" value={String(overview.runsToday)} />
            <StatCard
              label="Success rate today"
              value={
                overview.successRate == null
                  ? "—"
                  : `${Math.round(overview.successRate * 100)}%`
              }
            />
            <StatCard label="Need your help" value={String(handoffCount)} highlight={handoffCount > 0} />
          </>
        )}
      </div>

      <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Quick actions</h2>
      <div className="mb-10 grid gap-4 md:grid-cols-3">
        <ActionCard
          to="/teach"
          icon={Sparkles}
          title="Teach a new task"
          description="Show the system how to do something once — it saves a reusable task."
        />
        <ActionCard
          to="/library"
          icon={BookOpen}
          title="Task library"
          description="Review, approve, and compare saved tasks across tenants."
        />
        <ActionCard
          to="/handoff"
          icon={UserRound}
          title="Needs your help"
          description="Claim stuck runs and hand control back to automation when done."
          badge={handoffCount > 0 ? handoffCount : undefined}
        />
      </div>

      <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Recent activity</h2>
      <Card className="mb-8">
        {!overview ? (
          <Skeleton className="h-32" />
        ) : overview.recent.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">No runs yet — try Run a task.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {overview.recent.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <StatusChip status={r.status} />
                <span className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200">
                  {r.artifactName ?? r.id}
                </span>
                <span className="text-xs text-slate-500">
                  {r.startedAt ? new Date(r.startedAt).toLocaleString() : "—"}
                </span>
                <Link
                  to={`/history/${r.id}`}
                  className="text-sm font-semibold text-navy-800 hover:underline dark:text-navy-700"
                >
                  Details
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <h2 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">System health</h2>
      <Card>
        {healthLoading && !health ? (
          <Skeleton className="h-20" />
        ) : !health ? (
          <p className="text-sm text-slate-600">Health unavailable</p>
        ) : (
          <div className="flex flex-wrap gap-4">
            <HealthPill ok={health.coreserv.reachable} label="CoreServ" detail={health.coreserv.detail} />
            <HealthPill
              ok={health.gemini.keyPresent && health.gemini.reachable}
              label="Gemini"
              detail={health.gemini.detail}
            />
            <HealthPill ok={health.safety.loaded} label="Safety rules" />
            <HealthPill ok={!health.busy} label={health.busy ? "Busy running" : "Ready"} />
            {health.harness.enabled ? (
              <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
                Test harness on
              </span>
            ) : null}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <Card className={highlight ? "ring-2 ring-orange-400/60" : ""}>
      <p className="text-sm text-slate-600 dark:text-slate-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-navy-900 dark:text-slate-100">{value}</p>
    </Card>
  );
}

function ActionCard({
  to,
  icon: Icon,
  title,
  description,
  badge,
}: {
  to: string;
  icon: typeof Sparkles;
  title: string;
  description: string;
  badge?: number;
}) {
  return (
    <Link
      to={to}
      className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-navy-800/30 hover:shadow-md dark:border-slate-700 dark:bg-slate-900/80"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-navy-900/10 text-navy-900 group-hover:bg-navy-900 group-hover:text-white dark:bg-navy-800/30">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div>
          <p className="font-semibold text-slate-900 dark:text-slate-100">
            {title}
            {badge ? (
              <span className="ml-2 rounded-full bg-orange-500 px-2 py-0.5 text-xs text-white">{badge}</span>
            ) : null}
          </p>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p>
        </div>
      </div>
    </Link>
  );
}

function HealthPill({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <div
      className={`rounded-lg px-3 py-2 text-sm ${
        ok
          ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
          : "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100"
      }`}
      title={detail}
    >
      <span className="font-medium">{label}</span>
      <span className="ml-2 text-xs opacity-80">{ok ? "OK" : "Issue"}</span>
    </div>
  );
}
