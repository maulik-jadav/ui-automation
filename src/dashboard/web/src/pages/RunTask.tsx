import { Download, Repeat } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, isApiError } from "../api";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { LiveRunView } from "../components/LiveRunView";
import { PageHeader, PrimaryButton, SecondaryButton } from "../components/PageHeader";
import { ResultCard } from "../components/ResultCard";
import { Skeleton } from "../components/Skeleton";
import { useApp } from "../context/AppContext";
import type { ArtifactSummary, RunStatusChip } from "../types";

export function RunTask() {
  const { runId: routeRunId } = useParams<{ runId?: string }>();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const { tenant, pushToast } = useApp();

  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [artifactId, setArtifactId] = useState("");
  const [memberId, setMemberId] = useState("12345");
  const [runId, setRunId] = useState<string | null>(routeRunId ?? null);
  const [resultStatus, setResultStatus] = useState<RunStatusChip | null>(null);
  const [resultMessage, setResultMessage] = useState<string | undefined>();
  const [running, setRunning] = useState(false);
  const [stabilityRunning, setStabilityRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seededArtifact = useMemo(
    () =>
      artifacts.find(
        (a) =>
          a.id.includes("seeded-lookup") ||
          a.id.includes("lookup_member_savings_balance-seeded-lookup")
      ),
    [artifacts]
  );

  useEffect(() => {
    void api.artifacts().then((list) => {
      setArtifacts(list);
      const fromQuery = search.get("artifact");
      const seeded = list.find(
        (a) =>
          a.id.includes("seeded-lookup") ||
          a.id.includes("lookup_member_savings_balance-seeded-lookup")
      );
      setArtifactId(fromQuery ?? seeded?.id ?? list[0]?.id ?? "");
    });
  }, [search]);

  useEffect(() => {
    if (routeRunId) setRunId(routeRunId);
  }, [routeRunId]);

  const onDone = useCallback(
    (result: Record<string, unknown> | null, status: RunStatusChip) => {
      setRunning(false);
      setStabilityRunning(false);
      setResultStatus(status);
      if (result?.message) setResultMessage(String(result.message));
      if (status === "success" && result?.outputs) {
        const out = result.outputs as Record<string, unknown>;
        if (out.balance != null) {
          setResultMessage(`Balance: ${String(out.balance)}`);
        }
      }
    },
    []
  );

  async function startReplay() {
    if (!artifactId) return;
    setError(null);
    setRunning(true);
    setResultStatus(null);
    setResultMessage(undefined);
    try {
      const res = await api.replay({
        artifactId,
        tenant,
        inputs: { memberId: memberId.trim() },
        headless: false,
        allowHandoff: true,
      });
      setRunId(res.runId);
      navigate(`/run/${res.runId}`, { replace: true });
      pushToast({ kind: "info", title: "Replay started", message: res.runId });
    } catch (e) {
      setRunning(false);
      const msg = isApiError(e) ? e.message : String(e);
      setError(msg);
    }
  }

  async function runStability() {
    if (!artifactId) return;
    setStabilityRunning(true);
    setResultStatus(null);
    try {
      const res = await api.stability({
        artifactId,
        tenant,
        inputs: { memberId: memberId.trim() },
        times: 5,
        headless: true,
      });
      setRunId(res.runId);
      navigate(`/run/${res.runId}`, { replace: true });
      pushToast({ kind: "info", title: "Running 5× stability batch", message: res.runId });
    } catch (e) {
      setStabilityRunning(false);
      pushToast({
        kind: "error",
        title: "Stability run failed",
        message: isApiError(e) ? e.message : String(e),
      });
    }
  }

  function exportResult() {
    const blob = new Blob(
      [
        JSON.stringify(
          { artifactId, memberId, tenant, runId, status: resultStatus, message: resultMessage },
          null,
          2
        ),
      ],
      { type: "application/json" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `run-${runId ?? "export"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Run a task"
        purpose="Pick a saved task, enter inputs, and watch automation replay it with full evidence."
        action={
          <PrimaryButton onClick={() => void startReplay()} disabled={running || !artifactId}>
            {running ? "Running…" : "Run task"}
          </PrimaryButton>
        }
      />

      {error ? <div className="mb-6"><ErrorState message={error} /></div> : null}

      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card>
          <label htmlFor="artifact" className="text-sm font-medium">
            Task
          </label>
          {artifacts.length === 0 ? (
            <Skeleton className="mt-2 h-10" />
          ) : (
            <select
              id="artifact"
              value={artifactId}
              onChange={(e) => setArtifactId(e.target.value)}
              className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            >
              {artifacts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          )}

          <label htmlFor="memberId" className="mt-4 block text-sm font-medium">
            Member ID
          </label>
          <input
            id="memberId"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm dark:border-slate-600 dark:bg-slate-900"
            aria-describedby="member-hint"
          />
          <p id="member-hint" className="mt-2 text-xs text-slate-500">
            Demo: <button type="button" className="underline" onClick={() => setMemberId("12345")}>12345</button>{" "}
            expects success ($4,321.09).{" "}
            <button type="button" className="underline" onClick={() => setMemberId("99999")}>99999</button>{" "}
            returns not found (business outcome).
            {seededArtifact ? ` Seeded task: ${seededArtifact.name}.` : ""}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <SecondaryButton onClick={() => void runStability()} disabled={stabilityRunning || !artifactId}>
              <Repeat className="h-4 w-4" aria-hidden />
              Run 5× stability
            </SecondaryButton>
            {resultStatus ? (
              <SecondaryButton onClick={exportResult}>
                <Download className="h-4 w-4" aria-hidden />
                Export summary
              </SecondaryButton>
            ) : null}
          </div>
        </Card>

        {resultStatus ? (
          <ResultCard
            status={resultStatus}
            message={resultMessage}
            onNext={
              resultStatus === "needs_human"
                ? () => navigate("/handoff")
                : () => navigate(`/history/${runId}`)
            }
          />
        ) : (
          <Card>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Results appear here when the run finishes. You can open full evidence in{" "}
              {runId ? (
                <Link to={`/history/${runId}`} className="font-semibold text-navy-800 underline">
                  run history
                </Link>
              ) : (
                "run history"
              )}
              .
            </p>
          </Card>
        )}
      </div>

      <h2 className="mb-4 text-lg font-semibold">Live replay</h2>
      <LiveRunView runId={runId} onDone={onDone} />
    </div>
  );
}
