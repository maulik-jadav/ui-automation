import { Shield } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { PageHeader, PrimaryButton, SecondaryButton } from "../components/PageHeader";
import { SkeletonLines } from "../components/Skeleton";
import type { SafetyConfigResponse } from "../types";

export function Safety() {
  const [config, setConfig] = useState<SafetyConfigResponse | null>(null);
  const [blocked, setBlocked] = useState<unknown[]>([]);
  const [approvals, setApprovals] = useState<unknown[]>([]);
  const [audit, setAudit] = useState<unknown[]>([]);
  const [testUrl, setTestUrl] = useState("http://localhost:4000/");
  const [testResult, setTestResult] = useState<{ allowed: boolean; reason: string } | null>(null);
  const [redactIn, setRedactIn] = useState(
    "Member SSN 123-45-6789 email jane@example.com balance $4,321.09"
  );
  const [redactOut, setRedactOut] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      api.safetyConfig(),
      api.safetyBlocked(),
      api.safetyApprovals(),
      api.safetyAudit(),
    ])
      .then(([cfg, b, a, au]) => {
        setConfig(cfg);
        setBlocked(b);
        setApprovals(a);
        setAudit(au);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function runTestUrl() {
    setTestResult(await api.safetyTestUrl(testUrl));
  }

  async function runRedact() {
    const r = await api.safetyRedact(redactIn);
    setRedactOut(r.redacted);
  }

  return (
    <div>
      <PageHeader
        title="Safety center"
        purpose="See what automation is allowed to do, test URLs, preview redaction, and review blocked actions."
        action={
          <SecondaryButton onClick={() => void runTestUrl()}>Test URL now</SecondaryButton>
        }
      />

      {error ? <ErrorState message={error} /> : null}

      {!config ? (
        <SkeletonLines count={8} />
      ) : (
        <>
          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="flex items-center gap-2 font-semibold">
                <Shield className="h-5 w-5 text-navy-800" aria-hidden />
                Active rules
              </h2>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Allowed base URLs</p>
              <ul className="mt-2 list-inside list-disc text-sm">
                {config.allowedBaseUrls.map((u) => (
                  <li key={u} className="font-mono text-xs">
                    {u}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-sm text-slate-600">Allowed action kinds</p>
              <p className="mt-1 text-sm font-mono text-xs">{config.allowedActionKinds.join(", ")}</p>
            </Card>

            <Card>
              <h2 className="font-semibold">Risk legend</h2>
              <ul className="mt-4 space-y-3">
                {config.riskLegend.map((r) => (
                  <li key={r.class} className="rounded-lg border border-slate-100 px-3 py-2 dark:border-slate-800">
                    <p className="font-medium">{r.label}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-400">{r.policy}</p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="mb-8 grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="font-semibold">Test a URL</h2>
              <input
                value={testUrl}
                onChange={(e) => setTestUrl(e.target.value)}
                className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                aria-label="URL to test"
              />
              {testResult ? (
                <p
                  className={`mt-3 rounded-lg px-3 py-2 text-sm ${
                    testResult.allowed
                      ? "bg-emerald-50 text-emerald-900"
                      : "bg-red-50 text-red-900"
                  }`}
                >
                  {testResult.reason}
                </p>
              ) : null}
            </Card>

            <Card>
              <h2 className="font-semibold">Redaction preview</h2>
              <p className="mt-1 text-xs text-slate-500">Always masked: {config.alwaysMasked.join(", ")}</p>
              <textarea
                rows={3}
                value={redactIn}
                onChange={(e) => setRedactIn(e.target.value)}
                className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
              />
              <PrimaryButton className="mt-2" onClick={() => void runRedact()}>
                Preview redaction
              </PrimaryButton>
              {redactOut ? (
                <pre className="mt-3 rounded-lg bg-slate-100 p-3 text-sm dark:bg-slate-950">{redactOut}</pre>
              ) : null}
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="font-semibold">Blocked / policy events</h2>
              {blocked.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">No blocked events in recent evidence.</p>
              ) : (
                <pre className="mt-3 max-h-64 overflow-auto text-xs">{JSON.stringify(blocked, null, 2)}</pre>
              )}
            </Card>
            <Card>
              <h2 className="font-semibold">Approvals queue (draft tasks)</h2>
              {approvals.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">No drafts waiting for approval.</p>
              ) : (
                <pre className="mt-3 max-h-64 overflow-auto text-xs">{JSON.stringify(approvals, null, 2)}</pre>
              )}
              <h3 className="mt-6 font-semibold text-sm">Recent audit</h3>
              <pre className="mt-2 max-h-40 overflow-auto text-xs">{JSON.stringify(audit, null, 2)}</pre>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
