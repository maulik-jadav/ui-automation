import { Beaker, CheckCircle2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { api, isApiError } from "../api";
import { Card } from "../components/Card";
import { ErrorState } from "../components/ErrorState";
import { PageHeader, PrimaryButton, SecondaryButton } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";
import { useApp } from "../context/AppContext";

export function TestLab() {
  const { demoChecklist, toggleChecklistItem, resetChecklist, pushToast, health } = useApp();
  const [faults, setFaults] = useState<{ id: string; explanation: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [arming, setArming] = useState<string | null>(null);

  useEffect(() => {
    void api
      .testlabFaults()
      .then(setFaults)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, []);

  async function trigger(fault: string) {
    setArming(fault);
    try {
      const res = await api.testlabFault(fault);
      pushToast({
        kind: "success",
        title: `Fault: ${fault}`,
        message:
          res && typeof res === "object" && "explanation" in res
            ? String((res as { explanation: string }).explanation)
            : "Applied",
      });
    } catch (e) {
      pushToast({
        kind: "error",
        title: "Fault failed",
        message: isApiError(e) ? e.message : String(e),
      });
    } finally {
      setArming(null);
    }
  }

  const doneCount = demoChecklist.filter((i) => i.done).length;

  return (
    <div>
      <PageHeader
        title="Test lab"
        purpose="Inject realistic CoreServ faults and walk through the guided demo checklist."
        action={
          <SecondaryButton onClick={() => void trigger("reset")} disabled={arming !== null}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            Reset mock app
          </SecondaryButton>
        }
      />

      {!health?.harness.enabled ? (
        <Card className="mb-6 border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <p className="text-sm text-amber-950 dark:text-amber-100">
            Test harness is off on the server. Start CoreServ with{" "}
            <code className="rounded bg-white/60 px-1">ENABLE_TEST_HARNESS=1</code> to arm faults.
          </p>
        </Card>
      ) : null}

      {error ? <ErrorState message={error} /> : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Beaker className="h-5 w-5" aria-hidden />
            Fault injection
          </h2>
          {loading ? (
            <Skeleton className="h-48" />
          ) : (
            <ul className="space-y-3">
              {faults.map((f) => (
                <li key={f.id}>
                  <Card padding="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-mono text-sm font-semibold">{f.id}</p>
                        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{f.explanation}</p>
                      </div>
                      <PrimaryButton
                        onClick={() => void trigger(f.id)}
                        disabled={arming !== null}
                        className="shrink-0"
                      >
                        {arming === f.id ? "Arming…" : "Arm fault"}
                      </PrimaryButton>
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            <SecondaryButton onClick={() => void trigger("clear-sessions")} disabled={arming !== null}>
              Clear sessions
            </SecondaryButton>
            <SecondaryButton onClick={() => void trigger("demo-handoff")} disabled={arming !== null}>
              Demo handoff
            </SecondaryButton>
          </div>
        </div>

        <div>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Guided demo checklist</h2>
            <span className="text-sm text-slate-600">
              {doneCount}/{demoChecklist.length} complete
            </span>
          </div>
          <Card>
            <ul className="space-y-2">
              {demoChecklist.map((item) => (
                <li key={item.id}>
                  <label className="flex cursor-pointer items-start gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <input
                      type="checkbox"
                      checked={item.done}
                      onChange={() => toggleChecklistItem(item.id)}
                      className="mt-1"
                    />
                    <span className={`text-sm ${item.done ? "text-slate-500 line-through" : ""}`}>
                      {item.label}
                    </span>
                    {item.done ? (
                      <CheckCircle2 className="ml-auto h-4 w-4 text-emerald-600" aria-hidden />
                    ) : null}
                  </label>
                </li>
              ))}
            </ul>
            <SecondaryButton className="mt-4" onClick={resetChecklist}>
              Reset checklist
            </SecondaryButton>
          </Card>
        </div>
      </div>
    </div>
  );
}
