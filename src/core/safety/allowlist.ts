import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface AllowlistConfig {
  allowedBaseUrls: string[];
  allowedActionKinds: string[];
}

export class AllowlistViolation extends Error {
  readonly code = "ALLOWLIST_VIOLATION";
  constructor(message: string) {
    super(message);
    this.name = "AllowlistViolation";
  }
}

let cached: AllowlistConfig | null = null;

export function loadAllowlist(): AllowlistConfig {
  if (cached) return cached;
  const path = join(process.cwd(), "src/config/allowlist.json");
  cached = JSON.parse(readFileSync(path, "utf8")) as AllowlistConfig;
  return cached;
}

export function assertAllowedUrl(url: string): void {
  const { allowedBaseUrls } = loadAllowlist();
  const ok = allowedBaseUrls.some(
    (base) =>
      url === base ||
      url.startsWith(base + "/") ||
      url.startsWith(base + "?")
  );
  if (!ok) {
    throw new AllowlistViolation(`URL blocked by allowlist: ${url}`);
  }
}

export function assertAllowedAction(kind: string): void {
  const { allowedActionKinds } = loadAllowlist();
  if (!allowedActionKinds.includes(kind)) {
    throw new AllowlistViolation(`Action kind blocked by allowlist: ${kind}`);
  }
}

export function resetAllowlistCache(): void {
  cached = null;
}
