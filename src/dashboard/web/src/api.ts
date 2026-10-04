import type {
  ArtifactDetailResponse,
  ArtifactSummary,
  DiscoverRequest,
  HealthResponse,
  InterventionRequest,
  OverviewResponse,
  PreflightResponse,
  ReplayRequest,
  RunDetailResponse,
  RunProgressEvent,
  RunSummary,
  SafetyConfigResponse,
  StabilityRequest,
  StartRunResponse,
} from "./types";

class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function parseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function request<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await parseJson(res);
  if (!res.ok) {
    const msg =
      body && typeof body === "object" && "error" in body
        ? String((body as { error: string }).error)
        : res.statusText;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export const api = {
  health: (deep = false) =>
    request<HealthResponse>(`/api/health${deep ? "?deep=1" : ""}`),
  overview: () => request<OverviewResponse>("/api/overview"),
  preflight: () => request<PreflightResponse>("/api/preflight"),
  artifacts: () => request<ArtifactSummary[]>("/api/artifacts"),
  artifact: (id: string) => request<ArtifactDetailResponse>(`/api/artifacts/${encodeURIComponent(id)}`),
  approveArtifact: (id: string) =>
    request<{ artifact: unknown }>(`/api/artifacts/${encodeURIComponent(id)}/approve`, {
      method: "POST",
    }),
  driftArtifact: (id: string, tenant?: string) =>
    request<unknown>(
      `/api/artifacts/${encodeURIComponent(id)}/drift${tenant ? `?tenant=${encodeURIComponent(tenant)}` : ""}`,
      { method: "POST", body: JSON.stringify({ tenant }) }
    ),
  discover: (body: DiscoverRequest) =>
    request<StartRunResponse>("/api/discover", { method: "POST", body: JSON.stringify(body) }),
  replay: (body: ReplayRequest) =>
    request<StartRunResponse>("/api/replay", { method: "POST", body: JSON.stringify(body) }),
  stability: (body: StabilityRequest) =>
    request<StartRunResponse>("/api/stability", { method: "POST", body: JSON.stringify(body) }),
  runs: (params?: { status?: string; task?: string; q?: string }) => {
    const q = new URLSearchParams();
    if (params?.status) q.set("status", params.status);
    if (params?.task) q.set("task", params.task);
    if (params?.q) q.set("q", params.q);
    const qs = q.toString();
    return request<RunSummary[]>(`/api/runs${qs ? `?${qs}` : ""}`);
  },
  run: (id: string) => request<RunDetailResponse>(`/api/runs/${encodeURIComponent(id)}`),
  interventions: () => request<InterventionRequest[]>("/api/interventions"),
  intervention: (id: string) =>
    request<InterventionRequest & { humanActions?: unknown[] }>(
      `/api/interventions/${encodeURIComponent(id)}`
    ),
  claimIntervention: (id: string) =>
    request<InterventionRequest>(`/api/interventions/${encodeURIComponent(id)}/claim`, {
      method: "POST",
    }),
  resumeIntervention: (id: string, note?: string) =>
    request<InterventionRequest>(`/api/interventions/${encodeURIComponent(id)}/resume`, {
      method: "POST",
      body: JSON.stringify(note ? { note } : {}),
    }),
  interventionScreenUrl: (id: string) =>
    `/api/interventions/${encodeURIComponent(id)}/screen?t=${Date.now()}`,
  safetyConfig: () => request<SafetyConfigResponse>("/api/safety/config"),
  safetyTestUrl: (url: string) =>
    request<{ allowed: boolean; reason: string }>("/api/safety/test-url", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  safetyRedact: (text: string) =>
    request<{ redacted: string }>("/api/safety/redact", {
      method: "POST",
      body: JSON.stringify({ text }),
    }),
  safetyBlocked: () => request<unknown[]>("/api/safety/blocked"),
  safetyApprovals: () => request<unknown[]>("/api/safety/approvals"),
  safetyAudit: () => request<unknown[]>("/api/safety/audit"),
  testlabFaults: () => request<{ id: string; explanation: string }[]>("/api/testlab/faults"),
  testlabFault: (fault: string) =>
    request<unknown>(`/api/testlab/${encodeURIComponent(fault)}`, { method: "POST" }),
};

export function runEvidenceUrl(runId: string, rel: string): string {
  const clean = rel.replace(/^\.?\//, "");
  if (clean.startsWith("screenshots/")) {
    const file = clean.replace("screenshots/", "");
    return `/api/runs/${encodeURIComponent(runId)}/evidence/screenshots/${file}`;
  }
  return `/api/runs/${encodeURIComponent(runId)}/evidence/${clean}`;
}

export function subscribeRunEvents(
  runId: string,
  onEvent: (event: RunProgressEvent) => void,
  onError?: (err: Event) => void
): () => void {
  const es = new EventSource(`/api/runs/${encodeURIComponent(runId)}/events`);
  es.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data) as RunProgressEvent);
    } catch {
      /* ignore */
    }
  };
  es.onerror = (e) => onError?.(e);
  return () => es.close();
}

export type InterventionSsePayload =
  | { type: "snapshot"; items: InterventionRequest[] }
  | { type: "update"; items: InterventionRequest[] };

export function subscribeInterventionEvents(
  onPayload: (payload: InterventionSsePayload) => void
): () => void {
  const es = new EventSource("/api/interventions/events");
  es.onmessage = (msg) => {
    try {
      onPayload(JSON.parse(msg.data) as InterventionSsePayload);
    } catch {
      /* ignore */
    }
  };
  return () => es.close();
}

export function pendingHandoffCount(items: InterventionRequest[]): number {
  return items.filter((i) => i.status === "pending" || i.status === "claimed").length;
}
