import type { Observation, ObservedElement } from "../types.js";

export interface ActRequest {
  kind: "navigate" | "click" | "type" | "select" | "waitFor" | "extract";
  path?: string;
  element?: ObservedElement;
  value?: string;
  timeoutMs?: number;
}

export interface ActResult {
  ok: boolean;
  value?: string;
  error?: string;
}

export interface LocateRequest {
  role?: string;
  name?: string;
  text?: string;
  css?: string;
  frame?: string[];
}

/**
 * Surface seam between recorded flows and how we perceive/act.
 * PlaywrightWebAdapter is the web implementation.
 * DesktopSurfaceStub documents the future OS-accessibility path.
 */
export interface SurfaceAdapter {
  observe(): Promise<Observation>;
  locate(request: LocateRequest): Promise<ObservedElement | null>;
  act(request: ActRequest): Promise<ActResult>;
  snapshot(): Promise<unknown>;
  screenshot(path: string): Promise<void>;
  getUrl(): string;
  close(): Promise<void>;
}

/** Documented stub — not implemented. Would wrap OS accessibility APIs. */
export class DesktopSurfaceStub implements SurfaceAdapter {
  observe(): Promise<Observation> {
    throw new Error("DesktopSurfaceStub: not implemented — use OS AX APIs");
  }
  locate(): Promise<ObservedElement | null> {
    throw new Error("DesktopSurfaceStub: not implemented");
  }
  act(): Promise<ActResult> {
    throw new Error("DesktopSurfaceStub: not implemented");
  }
  snapshot(): Promise<unknown> {
    throw new Error("DesktopSurfaceStub: not implemented");
  }
  screenshot(): Promise<void> {
    throw new Error("DesktopSurfaceStub: not implemented");
  }
  getUrl(): string {
    return "desktop://";
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}
