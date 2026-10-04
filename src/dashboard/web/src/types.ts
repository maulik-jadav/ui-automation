export type RunKind = "discovery" | "replay" | "stability" | "handoff";

export type RunStatusChip =
  | "success"
  | "business_outcome"
  | "recovered"
  | "needs_human"
  | "hard_failure"
  | "running"
  | "unknown";

export interface ArtifactSummary {
  id: string;
  name: string;
  description: string;
  version: number;
  reviewStatus: "draft" | "approved";
  riskClass: "read" | "reversible_write" | "irreversible";
  lastRunStatus?: RunStatusChip;
  successRate?: number;
  tenants: string[];
  filename: string;
  provenanceSource?: string;
}

export interface HealthResponse {
  ok: boolean;
  demoMode: boolean;
  coreserv: { reachable: boolean; url: string; detail?: string };
  gemini: { keyPresent: boolean; reachable: boolean; detail?: string };
  safety: { loaded: boolean; allowedBaseUrls: string[]; allowedActionKinds: string[] };
  harness: { enabled: boolean };
  busy: boolean;
  activeRunId?: string;
}

export interface RunSummary {
  id: string;
  kind: RunKind;
  status: RunStatusChip;
  startedAt?: string;
  durationMs?: number;
  artifactName?: string;
  tenant?: string;
  message?: string;
  evidenceDir: string;
}

export interface OverviewResponse {
  tasksInLibrary: number;
  runsToday: number;
  successRate: number | null;
  recent: RunSummary[];
}

export interface DiscoverRequest {
  goal: string;
  baseUrl?: string;
  startPath?: string;
  maxSteps?: number;
  headless?: boolean;
  inputs?: Record<string, unknown>;
  tenant?: string;
}

export interface ReplayRequest {
  artifactId: string;
  inputs: Record<string, unknown>;
  tenant?: string;
  headless?: boolean;
  allowHandoff?: boolean;
}

export interface StabilityRequest {
  artifactId: string;
  inputs: Record<string, unknown>;
  times?: number;
  tenant?: string;
  headless?: boolean;
}

export interface StartRunResponse {
  runId: string;
  evidenceDir: string;
}

export interface PreflightResponse {
  ok: boolean;
  checks: { id: string; ok: boolean; label: string; detail?: string }[];
}

export type Controller =
  | "AUTOMATION"
  | "PAUSED"
  | "HUMAN"
  | "RESUMING"
  | "agent"
  | "human"
  | "paused_for_human";

export interface InterventionRequest {
  id: string;
  runId: string;
  goalOrCapability: string;
  stepIndex: number;
  reason: string;
  currentUrl?: string;
  screenshotPath?: string;
  status: "pending" | "claimed" | "resumed" | "cancelled";
  createdAt: string;
  claimedAt?: string;
  claimedBy?: string;
  resumedAt?: string;
  currentController: Controller;
  liveSessionHint?: string;
}

export interface RunDetailResponse {
  id: string;
  evidenceDir: string;
  meta: Record<string, unknown> | null;
  result: Record<string, unknown> | null;
  transcript: unknown;
  steps: unknown[];
  humanActions: unknown[];
  screenshots: string[];
  status: RunStatusChip;
}

export interface ArtifactDetailResponse {
  artifact: Record<string, unknown>;
  schemaValid: boolean;
  schemaErrors: string[];
  riskClass: ArtifactSummary["riskClass"];
}

export interface SafetyConfigResponse {
  allowedBaseUrls: string[];
  allowedActionKinds: string[];
  riskLegend: { class: string; label: string; policy: string }[];
  alwaysMasked: string[];
}

export interface RunProgressEvent {
  type: string;
  runId?: string;
  stepIndex?: number;
  maxSteps?: number;
  totalSteps?: number;
  message?: string;
  screenshotRel?: string;
  result?: Record<string, unknown>;
  elapsedMs?: number;
  error?: string;
  [key: string]: unknown;
}

export interface DemoChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

export const DEMO_CHECKLIST_DEFAULT: Omit<DemoChecklistItem, "done">[] = [
  { id: "home", label: "Review home overview and system health" },
  { id: "library", label: "Open task library and inspect seeded lookup task" },
  { id: "run-success", label: "Run lookup with member 12345 — expect success" },
  { id: "run-outcome", label: "Run lookup with member 99999 — expect not found" },
  { id: "handoff", label: "Trigger demo handoff from test lab" },
  { id: "claim", label: "Claim and resume from Needs your help" },
  { id: "safety", label: "Review safety center rules and redaction" },
  { id: "history", label: "Open run history and printable report" },
];
