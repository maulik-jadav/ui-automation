import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import type { CapabilityArtifact } from "../types.js";
import { SCHEMA_VERSION } from "../types.js";
import { redactDeep } from "../safety/redaction.js";

const ARTIFACTS_DIR = join(process.cwd(), "artifacts");
const SCHEMA_PATH = join(process.cwd(), "schemas", "capability.schema.json");

export class ArtifactValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactValidationError";
  }
}

/** Lightweight required-field validator (no ajv dependency). */
export function validateArtifact(raw: unknown): CapabilityArtifact {
  if (!raw || typeof raw !== "object") {
    throw new ArtifactValidationError("Artifact must be an object");
  }
  const a = raw as Record<string, unknown>;

  // Migrate legacy artifacts
  if (!a.schema_version) a.schema_version = SCHEMA_VERSION;
  if (a.capabilityVersion == null && typeof a.version === "number") {
    a.capabilityVersion = a.version;
  }
  if (!a.preconditions) {
    a.preconditions = { startUrl: "/login", authState: "anonymous" };
  }
  if (!a.fingerprint) {
    const target = (a.targetApp ?? {}) as Record<string, unknown>;
    a.fingerprint = {
      vendor: String(target.vendorProduct ?? "unknown"),
      product: String(target.name ?? "unknown"),
      version: "unknown",
      screenSignature: ["Member Search", "Search"],
    };
  }
  if (a.provenance && typeof a.provenance === "object") {
    const p = a.provenance as Record<string, unknown>;
    if (!p.surfaceType) {
      const target = (a.targetApp ?? {}) as Record<string, unknown>;
      p.surfaceType = target.surfaceType ?? "web-legacy";
    }
  }

  const required = [
    "schema_version",
    "artifactId",
    "capabilityVersion",
    "name",
    "description",
    "targetApp",
    "preconditions",
    "inputs",
    "outputs",
    "steps",
    "checkpoint",
    "errorHandling",
    "safety",
    "reviewStatus",
    "provenance",
    "fingerprint",
  ];
  for (const key of required) {
    if (a[key] === undefined || a[key] === null) {
      throw new ArtifactValidationError(`Missing required field: ${key}`);
    }
  }
  if (!Array.isArray(a.steps) || a.steps.length === 0) {
    throw new ArtifactValidationError("steps must be a non-empty array");
  }
  if (!["draft", "approved"].includes(String(a.reviewStatus))) {
    throw new ArtifactValidationError("reviewStatus must be draft|approved");
  }

  // Ensure schema file exists (documentation / future ajv)
  if (!existsSync(SCHEMA_PATH)) {
    throw new ArtifactValidationError(`Schema file missing at ${SCHEMA_PATH}`);
  }

  return a as unknown as CapabilityArtifact;
}

export function saveArtifact(artifact: CapabilityArtifact): string {
  const valid = validateArtifact(artifact);
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const path = join(
    ARTIFACTS_DIR,
    `${valid.name}-${valid.artifactId}.json`
  );
  writeFileSync(path, JSON.stringify(redactDeep(valid), null, 2));
  return path;
}

export function loadArtifact(pathOrId: string): CapabilityArtifact {
  let raw: unknown;
  if (existsSync(pathOrId)) {
    raw = JSON.parse(readFileSync(pathOrId, "utf8"));
  } else {
    const candidate = join(ARTIFACTS_DIR, pathOrId);
    if (existsSync(candidate)) {
      raw = JSON.parse(readFileSync(candidate, "utf8"));
    } else if (existsSync(ARTIFACTS_DIR)) {
      const files = readdirSync(ARTIFACTS_DIR).filter((f) => f.endsWith(".json"));
      const match = files.find(
        (f) => f.includes(pathOrId) || f.startsWith(pathOrId)
      );
      if (!match) throw new Error(`Artifact not found: ${pathOrId}`);
      raw = JSON.parse(readFileSync(join(ARTIFACTS_DIR, match), "utf8"));
    } else {
      throw new Error(`Artifact not found: ${pathOrId}`);
    }
  }
  return validateArtifact(raw);
}

export function updateArtifactReview(
  pathOrId: string,
  status: "draft" | "approved"
): CapabilityArtifact {
  const artifact = loadArtifact(pathOrId);
  artifact.reviewStatus = status;
  if (status === "approved") {
    artifact.safety.requiresApprovalToReplayUnattended = false;
  }
  saveArtifact(artifact);
  return artifact;
}

export function validateInputs(
  artifact: CapabilityArtifact,
  inputs: Record<string, unknown>
): void {
  for (const def of artifact.inputs) {
    const val = inputs[def.name];
    if (def.required && (val === undefined || val === null || val === "")) {
      throw new ArtifactValidationError(
        `Missing required input: ${def.name}`
      );
    }
    if (val !== undefined && val !== null && def.validation) {
      const re = new RegExp(def.validation);
      if (!re.test(String(val))) {
        throw new ArtifactValidationError(
          `Input ${def.name} failed validation /${def.validation}/`
        );
      }
    }
  }
}
