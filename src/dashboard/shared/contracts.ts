/** Shared API contracts between dashboard server and web. */

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

export interface TestUrlRequest {
  url: string;
}

export interface TestUrlResponse {
  allowed: boolean;
  reason: string;
}

export interface RedactRequest {
  text: string;
}

export interface RedactResponse {
  redacted: string;
}
