import { Rocket } from "lucide-react";
import { useState } from "react";
import { api, isApiError } from "../api";
import { AdvancedDetails } from "../components/AdvancedDetails";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { LiveRunView } from "../components/LiveRunView";
import { PageHeader, PrimaryButton, SecondaryButton } from "../components/PageHeader";
import { SkeletonLines } from "../components/Skeleton";
import { useApp } from "../context/AppContext";
import type { PreflightResponse } from "../types";

const EXAMPLE_GOALS = [
  "Look up a member savings balance after login",
  "Find a member by ID and open their profile",
  "Transfer between accounts with confirmation",
];

export function Teach() {
  const { tenant, pushToast } = useApp();
  const [goal, setGoal] = useState(EXAMPLE_GOALS[0]);
  const [maxSteps, setMaxSteps] = useState(12);
  const [headless, setHeadless] = useState(false);
  const [preflight, setPreflight] = useState<PreflightResponse | null>(null);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runPreflight() {
    setPreflightLoading(true);
    setError(null);
    try {
      setPreflight(await api.preflight());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreflightLoading(false);
    }
  }

  async function startDiscovery() {
    setStarting(true);
    setError(null);
    try {
      const res = await api.discover({
        goal: goal.trim(),
        maxSteps,
        headless,
        tenant,
      });
      setRunId(res.runId);
      pushToast({ kind: "success", title: "Teaching run started", message: res.runId });
    } catch (e) {
      const msg = isApiError(e) ? e.message : e instanceof Error ? e.message : String(e);
      setError(msg);
      pushToast({ kind: "error", title: "Could not start teaching", message: msg });
    } finally {
      setStarting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Teach a new task"
        purpose="Describe what you want in plain English. The system explores the app once and saves a task you can replay."
        action={
          <PrimaryButton onClick={() => void startDiscovery()} disabled={starting || !goal.trim()}>
            <Rocket className="h-4 w-4" aria-hidden />
            {starting ? "Starting…" : "Start teaching run"}
          </PrimaryButton>
        }
      />

      {error ? <div className="mb-6"><ErrorState message={error} /></div> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <label htmlFor="goal" className="block text-sm font-medium text-slate-800 dark:text-slate-200">
            Goal
          </label>
          <textarea
            id="goal"
            rows={4}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
            placeholder="What should this task accomplish?"
          />
          <p className="mt-2 text-xs text-slate-500">Examples:</p>
          <ul className="mt-1 flex flex-wrap gap-2">
            {EXAMPLE_GOALS.map((g) => (
              <li key={g}>
                <button
                  type="button"
                  onClick={() => setGoal(g)}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
                >
                  {g}
                </button>
              </li>
            ))}
          </ul>

          <div className="mt-4">
          <AdvancedDetails summary="Advanced options">
            <div className="space-y-3 text-sm">
              <label className="flex items-center gap-2">
                <span className="w-28">Max steps</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={maxSteps}
                  onChange={(e) => setMaxSteps(Number(e.target.value))}
                  className="w-20 rounded border border-slate-300 px-2 py-1 dark:border-slate-600 dark:bg-slate-900"
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={headless}
                  onChange={(e) => setHeadless(e.target.checked)}
                />
                Run headless (no visible browser)
              </label>
            </div>
          </AdvancedDetails>
          </div>
        </Card>

        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100">Preflight checks</h3>
            <SecondaryButton onClick={() => void runPreflight()} disabled={preflightLoading}>
              {preflightLoading ? "Checking…" : "Run preflight"}
            </SecondaryButton>
          </div>
          {preflightLoading ? (
            <SkeletonLines count={4} />
          ) : preflight ? (
            <ul className="space-y-2 text-sm">
              {preflight.checks.map((c) => (
                <li
                  key={c.id}
                  className={`flex items-start gap-2 rounded-lg px-3 py-2 ${
                    c.ok
                      ? "bg-emerald-50 dark:bg-emerald-950/30"
                      : "bg-red-50 dark:bg-red-950/30"
                  }`}
                >
                  <span aria-hidden>{c.ok ? "✓" : "✗"}</span>
                  <div>
                    <p className="font-medium">{c.label}</p>
                    {c.detail ? <p className="text-xs text-slate-600 dark:text-slate-400">{c.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Run preflight before a live demo to confirm CoreServ, keys, and safety are ready.
            </p>
          )}
        </Card>
      </div>

      <div className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">Live run</h2>
        <LiveRunView runId={runId} />
      </div>
    </div>
  );
}
