import { Check, Play } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, isApiError } from "../api";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { PageHeader, PrimaryButton, SecondaryButton } from "../components/PageHeader";
import { SkeletonLines } from "../components/Skeleton";
import { riskLabel } from "../components/StatusChip";
import { useApp } from "../context/AppContext";
import type { ArtifactDetailResponse } from "../types";

type Tab = "overview" | "steps" | "json" | "tenants" | "history";

export function ArtifactDetail() {
  const { id } = useParams<{ id: string }>();
  const { tenant, pushToast } = useApp();
  const [data, setData] = useState<ArtifactDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [approveOpen, setApproveOpen] = useState(false);
  const [drift, setDrift] = useState<unknown>(null);
  const [driftLoading, setDriftLoading] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    setError(null);
    void api
      .artifact(id)
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function approve() {
    if (!id) return;
    try {
      await api.approveArtifact(id);
      pushToast({ kind: "success", title: "Task approved", message: id });
      setApproveOpen(false);
      load();
    } catch (e) {
      pushToast({
        kind: "error",
        title: "Approve failed",
        message: isApiError(e) ? e.message : String(e),
      });
    }
  }

  async function checkDrift() {
    if (!id) return;
    setDriftLoading(true);
    try {
      setDrift(await api.driftArtifact(id, tenant));
      pushToast({ kind: "info", title: "Drift check complete" });
    } catch (e) {
      pushToast({
        kind: "error",
        title: "Drift check failed",
        message: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setDriftLoading(false);
    }
  }

  if (!id) return <ErrorState message="Missing artifact id" />;

  const artifact = data?.artifact as Record<string, unknown> | undefined;
  const steps = (artifact?.steps as unknown[]) ?? [];
  const reviewStatus = String(artifact?.reviewStatus ?? "draft");

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview", label: "Overview" },
    { id: "steps", label: "Steps" },
    { id: "json", label: "Technical JSON" },
    { id: "tenants", label: "Tenants & changes" },
    { id: "history", label: "History" },
  ];

  return (
    <div>
      <PageHeader
        title={String(artifact?.name ?? "Task detail")}
        purpose="Inspect how this task works before you approve it for unattended runs."
        action={
          <div className="flex flex-wrap gap-2">
            <SecondaryButton onClick={() => void checkDrift()} disabled={driftLoading}>
              {driftLoading ? "Checking drift…" : "Check UI drift"}
            </SecondaryButton>
            <Link to={`/run?artifact=${encodeURIComponent(id)}`}>
              <PrimaryButton>
                <Play className="h-4 w-4" aria-hidden />
                Run this task
              </PrimaryButton>
            </Link>
          </div>
        }
      />

      {error ? <ErrorState message={error} onRetry={load} /> : null}

      {!data && !error ? <SkeletonLines count={6} /> : null}

      {data && artifact ? (
        <>
          <div className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-700">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`border-b-2 px-4 py-2 text-sm font-medium ${
                  tab === t.id
                    ? "border-navy-900 text-navy-900 dark:border-navy-700 dark:text-slate-100"
                    : "border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "overview" && (
            <Card>
              <p className="text-slate-700 dark:text-slate-300">{String(artifact.description ?? "")}</p>
              <dl className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                <div>
                  <dt className="text-slate-500">Review status</dt>
                  <dd className="font-medium capitalize">{reviewStatus}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Risk</dt>
                  <dd className="font-medium">{riskLabel(data.riskClass)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Schema</dt>
                  <dd className="font-medium">{data.schemaValid ? "Valid" : "Invalid"}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Artifact ID</dt>
                  <dd className="font-mono text-xs">{id}</dd>
                </div>
              </dl>
              {!data.schemaValid && data.schemaErrors.length ? (
                <ul className="mt-4 list-disc pl-5 text-sm text-red-700 dark:text-red-300">
                  {data.schemaErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : null}
              {reviewStatus === "draft" ? (
                <button
                  type="button"
                  onClick={() => setApproveOpen(true)}
                  className="mt-6 inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
                >
                  <Check className="h-4 w-4" aria-hidden />
                  Approve for replay
                </button>
              ) : null}
              {drift ? (
                <pre className="mt-6 max-h-48 overflow-auto rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-950">
                  {JSON.stringify(drift, null, 2)}
                </pre>
              ) : null}
            </Card>
          )}

          {tab === "steps" && (
            <Card>
              {steps.length === 0 ? (
                <p className="text-sm text-slate-600">No steps recorded.</p>
              ) : (
                <ol className="space-y-3">
                  {steps.map((s, i) => (
                    <li
                      key={i}
                      className="rounded-lg border border-slate-100 px-4 py-3 text-sm dark:border-slate-800"
                    >
                      <span className="font-medium">Step {i + 1}</span>
                      <pre className="mt-2 overflow-x-auto text-xs text-slate-600 dark:text-slate-400">
                        {JSON.stringify(s, null, 2)}
                      </pre>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}

          {tab === "json" && (
            <Card padding="p-0">
              <pre className="max-h-[32rem] overflow-auto p-4 text-xs">{JSON.stringify(artifact, null, 2)}</pre>
            </Card>
          )}

          {tab === "tenants" && (
            <Card>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Tenant-specific overrides and drift results appear here. Current tenant:{" "}
                <strong>{tenant}</strong>.
              </p>
              <pre className="mt-4 overflow-auto rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-950">
                {JSON.stringify(artifact.tenantOverrides ?? {}, null, 2)}
              </pre>
            </Card>
          )}

          {tab === "history" && (
            <Card>
              <p className="text-sm text-slate-600">
                Open{" "}
                <Link to="/history" className="font-semibold text-navy-800 underline">
                  Run history
                </Link>{" "}
                and filter by this task name.
              </p>
            </Card>
          )}
        </>
      ) : null}

      {approveOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal
          aria-labelledby="approve-title"
        >
          <Card className="max-w-md w-full">
            <h2 id="approve-title" className="text-lg font-semibold">
              Approve this task?
            </h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Approved tasks can be replayed unattended when risk rules allow. You are signing off as Operator.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <SecondaryButton onClick={() => setApproveOpen(false)}>Cancel</SecondaryButton>
              <PrimaryButton onClick={() => void approve()}>Confirm approve</PrimaryButton>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
