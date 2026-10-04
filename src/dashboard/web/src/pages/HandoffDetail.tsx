import { Pause, Play, User } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, isApiError } from "../api";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { PageHeader, PrimaryButton, SecondaryButton } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { useApp } from "../context/AppContext";
import type { Controller, InterventionRequest } from "../types";

function controllerLabel(c: Controller): "AUTOMATION" | "YOU" | "PAUSED" {
  if (c === "AUTOMATION" || c === "agent") return "AUTOMATION";
  if (c === "HUMAN" || c === "human" || c === "RESUMING") return "YOU";
  return "PAUSED";
}

const CONTROLLER_STYLE: Record<string, string> = {
  AUTOMATION: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950/50",
  YOU: "bg-sky-100 text-sky-900 dark:bg-sky-950/50",
  PAUSED: "bg-orange-100 text-orange-900 dark:bg-orange-950/50",
};

export function HandoffDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { pushToast, playHandoffBeep } = useApp();
  const [item, setItem] = useState<(InterventionRequest & { humanActions?: unknown[] }) | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);
  const [screenUrl, setScreenUrl] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    void api
      .intervention(id)
      .then(setItem)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    const tick = () => {
      setScreenUrl(api.interventionScreenUrl(id));
    };
    tick();
    const t = window.setInterval(tick, 2500);
    return () => clearInterval(t);
  }, [id]);

  async function claim() {
    if (!id) return;
    setBusy(true);
    try {
      const claimed = await api.claimIntervention(id);
      setItem((prev) => ({ ...prev!, ...claimed }));
      pushToast({ kind: "success", title: "Run claimed", message: "You have control" });
      playHandoffBeep();
    } catch (e) {
      pushToast({
        kind: "error",
        title: "Could not claim",
        message: isApiError(e) ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    if (!id) return;
    setBusy(true);
    try {
      const resumed = await api.resumeIntervention(id, note.trim() || undefined);
      setItem((prev) => ({ ...prev!, ...resumed }));
      pushToast({ kind: "success", title: "Automation resumed" });
      navigate("/handoff");
    } catch (e) {
      pushToast({
        kind: "error",
        title: "Resume failed",
        message: isApiError(e) ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  async function simulateDemo() {
    setBusy(true);
    try {
      await api.testlabFault("demo-handoff");
      pushToast({
        kind: "info",
        title: "Demo handoff started",
        message: "Watch this inbox for a new item",
      });
    } catch (e) {
      pushToast({
        kind: "error",
        title: "Demo handoff failed",
        message: isApiError(e) ? e.message : String(e),
      });
    } finally {
      setBusy(false);
    }
  }

  if (!id) return <ErrorState message="Missing intervention id" />;

  const controller = item ? controllerLabel(item.currentController) : "PAUSED";

  return (
    <div>
      <PageHeader
        title="Handoff detail"
        purpose="See why automation stopped, take control in the browser window, then resume when the screen is ready."
        action={
          <div className="flex flex-wrap gap-2">
            <SecondaryButton onClick={() => void simulateDemo()} disabled={busy}>
              Simulate demo handoff
            </SecondaryButton>
            {item?.status === "pending" ? (
              <PrimaryButton onClick={() => void claim()} disabled={busy}>
                <User className="h-4 w-4" aria-hidden />
                Claim run
              </PrimaryButton>
            ) : null}
            {item && (item.status === "claimed" || item.status === "pending") ? (
              <PrimaryButton onClick={() => void resume()} disabled={busy}>
                <Play className="h-4 w-4" aria-hidden />
                Resume automation
              </PrimaryButton>
            ) : null}
          </div>
        }
      />

      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {!item && !error ? <Skeleton className="mb-6 h-40" /> : null}

      {item ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold ${CONTROLLER_STYLE[controller]}`}
              >
                {controller === "AUTOMATION" ? (
                  <Play className="h-4 w-4" aria-hidden />
                ) : controller === "YOU" ? (
                  <User className="h-4 w-4" aria-hidden />
                ) : (
                  <Pause className="h-4 w-4" aria-hidden />
                )}
                {controller === "YOU" ? "YOU" : controller}
              </span>
              <span className="text-sm text-slate-500 capitalize">Status: {item.status}</span>
            </div>
            <h2 className="mt-4 text-lg font-semibold">{item.goalOrCapability}</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{item.reason}</p>
            <p className="mt-4 text-xs text-slate-500">
              Run ID:{" "}
              <Link to={`/history/${item.runId}`} className="font-mono text-navy-800 underline">
                {item.runId}
              </Link>
            </p>
            {item.liveSessionHint ? (
              <p className="mt-2 rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-900">{item.liveSessionHint}</p>
            ) : null}
            <label htmlFor="note" className="mt-4 block text-sm font-medium">
              Note for audit (optional)
            </label>
            <textarea
              id="note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            />
          </Card>

          <Card padding="p-4">
            <h3 className="mb-2 text-sm font-semibold">Live screen (polled)</h3>
            <div className="flex min-h-[240px] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-950">
              {screenUrl ? (
                <img
                  src={screenUrl}
                  alt="Latest screenshot for this handoff"
                  className="max-h-80 w-full object-contain"
                  onError={() => setScreenUrl(null)}
                />
              ) : (
                <p className="px-4 text-center text-sm text-slate-500">
                  Screenshot not available yet — complete the step in the Playwright window.
                </p>
              )}
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
