import { useEffect, useMemo, useState } from "react";
import { runEvidenceUrl, subscribeRunEvents } from "../api";
import type { RunProgressEvent } from "../types";
import { Card } from "./Card";
import { Skeleton } from "./Skeleton";
import { StatusChip } from "./StatusChip";
import type { RunStatusChip } from "../types";

interface TimelineStep {
  id: string;
  label: string;
  detail?: string;
  at: number;
}

export function LiveRunView({
  runId,
  onDone,
}: {
  runId: string | null;
  onDone?: (result: Record<string, unknown> | null, status: RunStatusChip) => void;
}) {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<RunProgressEvent[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [status, setStatus] = useState<RunStatusChip>("running");
  const [message, setMessage] = useState<string>("Waiting for automation…");

  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    setScreenshot(null);
    setStatus("running");
    setMessage("Connecting to live run…");
    setConnected(false);

    const unsub = subscribeRunEvents(
      runId,
      (ev) => {
        setEvents((prev) => [...prev.slice(-80), ev]);
        if (ev.type === "connected") setConnected(true);
        if (ev.message) setMessage(String(ev.message));
        if (ev.screenshotRel) {
          setScreenshot(runEvidenceUrl(runId, String(ev.screenshotRel)));
        }
        if (ev.type === "handoff") {
          setStatus("needs_human");
          setMessage(String(ev.message ?? "Automation paused for a person"));
        }
        if (ev.type === "error") {
          setMessage(String(ev.message ?? ev.error ?? "Error"));
        }
        if (ev.type === "done") {
          const result = ev.result as Record<string, unknown> | undefined;
          const st = (result?.status as RunStatusChip) ?? (ev.error ? "hard_failure" : "unknown");
          setStatus(st);
          if (result?.message) setMessage(String(result.message));
          else if (ev.error) setMessage(String(ev.error));
          onDone?.(result ?? null, st);
        }
      },
      () => setConnected(false)
    );
    return unsub;
  }, [runId, onDone]);

  const timeline = useMemo(() => {
    const steps: TimelineStep[] = [];
    for (const ev of events) {
      if (ev.type === "run_started") {
        steps.push({
          id: `start-${steps.length}`,
          label: "Run started",
          detail: ev.message as string | undefined,
          at: ev.elapsedMs ?? 0,
        });
      } else if (ev.type === "observe" || ev.type === "decide" || ev.type === "act") {
        steps.push({
          id: `${ev.type}-${ev.stepIndex}-${steps.length}`,
          label: ev.type.charAt(0).toUpperCase() + ev.type.slice(1),
          detail:
            (ev.action as string) ||
            (ev.result as string) ||
            (ev.message as string) ||
            `Step ${ev.stepIndex ?? "?"}`,
          at: ev.elapsedMs ?? 0,
        });
      } else if (ev.type === "screenshot") {
        steps.push({
          id: `shot-${steps.length}`,
          label: "Screenshot captured",
          detail: `Step ${ev.stepIndex ?? "?"}`,
          at: ev.elapsedMs ?? 0,
        });
      } else if (ev.type === "handoff") {
        steps.push({
          id: `handoff-${steps.length}`,
          label: "Handoff requested",
          detail: String(ev.message ?? ""),
          at: ev.elapsedMs ?? 0,
        });
      } else if (ev.type === "done") {
        steps.push({
          id: `done-${steps.length}`,
          label: "Run finished",
          at: ev.elapsedMs ?? 0,
        });
      }
    }
    return steps.slice(-12);
  }, [events]);

  if (!runId) {
    return (
      <Card>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Start a run to see live steps and screenshots here.
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <Card className="lg:col-span-2" padding="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Step timeline</h3>
          <span
            className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500 animate-pulse-soft" : "bg-slate-400"}`}
            aria-label={connected ? "Live connected" : "Connecting"}
          />
        </div>
        <ol className="max-h-80 space-y-2 overflow-y-auto text-sm" aria-label="Run steps">
          {timeline.length === 0 ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            timeline.map((s) => (
              <li
                key={s.id}
                className="rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50"
              >
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-slate-800 dark:text-slate-200">{s.label}</span>
                  <span className="text-xs text-slate-500">{s.at ? `${(s.at / 1000).toFixed(1)}s` : ""}</span>
                </div>
                {s.detail ? (
                  <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">{s.detail}</p>
                ) : null}
              </li>
            ))
          )}
        </ol>
      </Card>

      <Card className="lg:col-span-2" padding="p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Live screen</h3>
        <div className="flex min-h-[220px] items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-950">
          {screenshot ? (
            <img
              src={screenshot}
              alt="Latest automation screenshot"
              className="max-h-80 w-full object-contain"
            />
          ) : (
            <p className="px-4 text-center text-sm text-slate-500">Screenshots appear as steps run</p>
          )}
        </div>
      </Card>

      <Card className="lg:col-span-1" padding="p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">Status</h3>
        <StatusChip status={status} />
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">{message}</p>
        <p className="mt-4 font-mono text-xs text-slate-500">Run {runId}</p>
      </Card>
    </div>
  );
}
