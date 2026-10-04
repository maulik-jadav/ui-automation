/** Capability artifact schema — ranked locators, outcomes, provenance, drift. */

export const SCHEMA_VERSION = "1.1.0";

export type Role =
  | "textbox"
  | "button"
  | "link"
  | "heading"
  | "cell"
  | "combobox"
  | "checkbox"
  | "generic"
  | "row"
  | "table"
  | "option";

export type RiskClass = "read" | "reversible_write" | "irreversible";

export type Confidence = "high" | "medium" | "low";

export interface LocatorStrategy {
  strategy: "role" | "text" | "css" | "position" | "label_proximity";
  role?: Role;
  name?: string;
  namePattern?: string;
  text?: string;
  css?: string;
  frame?: string[];
  confidence: Confidence;
  /** Why this strategy is ranked here (reviewable robustness rationale). */
  rationale?: string;
}

export interface Locator {
  primary: LocatorStrategy;
  fallbacks: LocatorStrategy[];
}

export interface OutcomeRule {
  match: LocatorStrategy;
  classification: "continue" | "business_outcome" | "recoverable" | "failure";
  code?: string;
  message?: string;
  recoveryAction?: "retry" | "reauthenticate" | "dismissAndContinue";
}

export type StepAction =
  | {
      kind: "navigate";
      path: string;
      risk_class?: RiskClass;
      known_interstitials?: OutcomeRule[];
      postCondition?: LocatorStrategy;
    }
  | {
      kind: "type";
      locator: Locator;
      valueFrom: string;
      risk_class?: RiskClass;
      known_interstitials?: OutcomeRule[];
    }
  | {
      kind: "click";
      locator: Locator;
      irreversible?: boolean;
      /** Soft-skip if locator missing (login interstitials) */
      optional?: boolean;
      risk_class?: RiskClass;
      known_interstitials?: OutcomeRule[];
    }
  | {
      kind: "select";
      locator: Locator;
      valueFrom: string;
      risk_class?: RiskClass;
    }
  | {
      kind: "waitFor";
      locator: Locator;
      timeoutMs: number;
      risk_class?: RiskClass;
    }
  | {
      kind: "extract";
      locator: Locator;
      outputName: string;
      transform?: "parseCurrency" | "trim" | "none";
      risk_class?: RiskClass;
    }
  | {
      kind: "assertOutcome";
      outcomes: OutcomeRule[];
      risk_class?: RiskClass;
    };

export interface ArtifactInput {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description: string;
  validation?: string;
  example?: string | number | boolean;
  sensitivity?: "none" | "pii" | "secret" | "financial";
}

export interface ArtifactOutput {
  name: string;
  type: "string" | "number" | "boolean";
  description: string;
  shape?: string;
  extractionLocator?: Locator;
}

export interface ArtifactFingerprint {
  vendor: string;
  product: string;
  version: string;
  /** Stable-ish screen signature: URL path pattern + key accessible names. */
  screenSignature: string[];
}

export interface TenantOverride {
  label?: string;
  startPath?: string;
  stepLocatorPatches?: {
    stepIndex: number;
    locator: Locator;
  }[];
  labelRewrites?: Record<string, string>;
}

export interface CapabilityArtifact {
  schema_version: string;
  artifactId: string;
  /** Capability version (semver or integer bump). */
  capabilityVersion: number;
  /** @deprecated use capabilityVersion — kept for older files during migrate */
  version?: number;
  name: string;
  description: string;
  targetApp: {
    name: string;
    baseUrl: string;
    vendorProduct: string;
    surfaceType: "web-modern" | "web-legacy" | "desktop";
  };
  preconditions: {
    startUrl: string;
    requiredRole?: string;
    authState?: "anonymous" | "authenticated";
    loginPath?: string;
  };
  inputs: ArtifactInput[];
  outputs: ArtifactOutput[];
  steps: StepAction[];
  checkpoint: OutcomeRule;
  errorHandling: {
    timeoutMs: number;
    retryPolicy: { maxRetries: number; backoffMs: number };
  };
  safety: {
    allowedActionKinds: StepAction["kind"][];
    requiresApprovalToReplayUnattended: boolean;
  };
  reviewStatus: "draft" | "approved";
  provenance: {
    discoveryRunId: string;
    modelUsed: string;
    recordedAt: string;
    surfaceType: "web-modern" | "web-legacy" | "desktop";
  };
  fingerprint: ArtifactFingerprint;
  tenant_overrides?: Record<string, TenantOverride>;
}

export type ErrorClass =
  | "locator_unresolved"
  | "locator_ambiguous"
  | "timeout"
  | "validation"
  | "permission"
  | "not_found"
  | "dialog"
  | "session"
  | "http_5xx"
  | "allowlist"
  | "checkpoint"
  | "input_validation"
  | "unknown";

export type ReplayResult =
  | {
      status: "success";
      outputs: Record<string, unknown>;
      durationMs: number;
      strategyLog?: string[];
    }
  | {
      status: "business_outcome";
      code: string;
      message: string;
      partialOutputs?: Record<string, unknown>;
      durationMs: number;
    }
  | {
      status: "recovered";
      outputs: Record<string, unknown>;
      recovered: { code: string; message: string; action: string }[];
      durationMs: number;
    }
  | {
      status: "needs_human";
      interventionRequestId: string;
      runId: string;
      stepId: number;
      reason: string;
      durationMs: number;
    }
  | {
      status: "hard_failure";
      stepId: number;
      expected: string;
      observed: string;
      error_class: ErrorClass;
      evidence_paths: string[];
      message: string;
      durationMs: number;
    };

/** @deprecated alias kept for migrate — prefer hard_failure / needs_human */
export type LegacyReplayStatus = "failure" | "paused_for_human";

export interface ObservedElement {
  ref: number;
  role: string;
  name: string;
  frame?: string[];
  value?: string;
  cssPath?: string;
}

export interface Observation {
  url: string;
  elements: ObservedElement[];
  flattenedText: string;
  title?: string;
}

export type AgentActionKind =
  | "navigate"
  | "click"
  | "type"
  | "select"
  | "waitFor"
  | "extract"
  | "done";

export interface AgentDecision {
  kind: AgentActionKind;
  ref?: number;
  value?: string;
  path?: string;
  outputName?: string;
  reasoning: string;
  done?: boolean;
  outputs?: Record<string, unknown>;
}

export interface TranscriptStep {
  stepIndex: number;
  decision: AgentDecision;
  element?: ObservedElement;
  result: "ok" | "error";
  error?: string;
  observationAfter?: string;
  timestamp: string;
}

export interface DiscoveryTranscript {
  runId: string;
  goal: string;
  inputs: Record<string, unknown>;
  modelUsed: string;
  steps: TranscriptStep[];
  startedAt: string;
  finishedAt?: string;
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
  axSnapshotPath?: string;
  paramsRedacted?: Record<string, unknown>;
  liveSessionHint?: string;
  status: "pending" | "claimed" | "resumed" | "cancelled";
  createdAt: string;
  claimedAt?: string;
  claimedBy?: string;
  resumedAt?: string;
  currentController: Controller;
}

export interface LogEntry {
  runId: string;
  stepIndex: number;
  action: string;
  locatorTried?: string;
  strategyUsed?: string;
  result: string;
  latencyMs: number;
  timestamp: string;
  [key: string]: unknown;
}

export type DriftStatus = "match" | "degraded" | "mismatch";
