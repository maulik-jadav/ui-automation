import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join, normalize, relative, resolve, sep } from "node:path";

const ROOT = resolve(process.cwd());

/** Resolve a path under cwd; throw on traversal. */
export function safePath(...parts: string[]): string {
  for (const p of parts) {
    if (
      p.includes("\0") ||
      p === ".." ||
      p.includes(".." + sep) ||
      p.includes(sep + "..") ||
      p.includes("/..") ||
      p.includes("../") ||
      p.includes("..\\")
    ) {
      throw new Error("Path traversal blocked");
    }
  }
  const candidate = normalize(resolve(ROOT, ...parts));
  const rel = relative(ROOT, candidate);
  if (rel.startsWith("..") || rel.includes(`..${sep}`)) {
    throw new Error("Path traversal blocked");
  }
  if (!candidate.startsWith(ROOT + sep) && candidate !== ROOT) {
    throw new Error("Path traversal blocked");
  }
  return candidate;
}

export function safeEvidencePath(runId: string, ...rest: string[]): string {
  if (!/^[\w.-]+$/.test(runId)) throw new Error("Invalid run id");
  for (const p of rest) {
    if (p.includes("..") || p.startsWith("/") || p.includes("\0")) {
      throw new Error("Invalid evidence path segment");
    }
  }
  const candidates = [
    safePath("evidence", runId, ...rest),
    safePath("evidence", `replay-${runId}`, ...rest),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

export function resolveEvidenceDir(runId: string): string {
  if (!/^[\w.-]+$/.test(runId)) throw new Error("Invalid run id");
  const a = safePath("evidence", runId);
  const b = safePath("evidence", `replay-${runId}`);
  const c = safePath("evidence", `stability-${runId}`);
  if (existsSync(a) && statSync(a).isDirectory()) return a;
  if (existsSync(b) && statSync(b).isDirectory()) return b;
  if (existsSync(c) && statSync(c).isDirectory()) return c;
  // strip replay- prefix if caller passed full folder name
  const direct = safePath("evidence", runId);
  if (existsSync(direct) && statSync(direct).isDirectory()) return direct;
  throw new Error(`Evidence not found for run ${runId}`);
}

export function listEvidenceDirs(): string[] {
  const dir = safePath("evidence");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => {
    try {
      return (
        !name.includes("..") &&
        /^[\w.-]+$/.test(name) &&
        statSync(join(dir, name)).isDirectory()
      );
    } catch {
      return false;
    }
  });
}

export function assertUnder(root: string, file: string): string {
  const rootReal = realpathSync(root);
  const fileReal = realpathSync(file);
  if (!fileReal.startsWith(rootReal + sep) && fileReal !== rootReal) {
    throw new Error("Path traversal blocked");
  }
  return fileReal;
}
