import { Inbox } from "lucide-react";
import { Link } from "react-router-dom";
import { Card } from "../components/Card";
import { EmptyState } from "../components/EmptyState";
import { PageHeader, PrimaryButton } from "../components/PageHeader";
import { StatusChip } from "../components/StatusChip";
import { useApp } from "../context/AppContext";

export function HandoffInbox() {
  const { handoffs } = useApp();
  const open = handoffs.filter((h) => h.status === "pending" || h.status === "claimed");

  return (
    <div>
      <PageHeader
        title="Needs your help"
        purpose="When automation gets stuck, it pauses here. Claim a run, fix the screen, then resume."
        action={
          <Link to="/lab">
            <PrimaryButton>Simulate in test lab</PrimaryButton>
          </Link>
        }
      />

      {open.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="Inbox is clear"
          description="No runs are waiting for a person. Use Test lab to trigger a demo handoff for training."
          action={
            <Link to="/lab">
              <PrimaryButton>Open test lab</PrimaryButton>
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {open.map((h) => (
            <li key={h.id}>
              <Link to={`/handoff/${h.id}`}>
                <Card className="transition hover:shadow-md">
                  <div className="flex flex-wrap items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${
                        h.status === "pending"
                          ? "bg-orange-100 text-orange-900"
                          : "bg-amber-100 text-amber-900"
                      }`}
                    >
                      {h.status}
                    </span>
                    <StatusChip status="needs_human" />
                    <span className="flex-1 font-medium text-slate-900 dark:text-slate-100">
                      {h.goalOrCapability}
                    </span>
                    <span className="text-xs text-slate-500">
                      {new Date(h.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">{h.reason}</p>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
