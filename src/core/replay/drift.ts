import type { CapabilityArtifact, DriftStatus, Observation } from "../types.js";

export interface DriftResult {
  status: DriftStatus;
  matched: string[];
  missing: string[];
  url: string;
  message: string;
}

/** Compare live observation against artifact fingerprint screen signatures. */
export function checkDrift(
  artifact: CapabilityArtifact,
  observation: Observation
): DriftResult {
  const sigs = artifact.fingerprint?.screenSignature ?? [];
  const blob = `${observation.url}\n${observation.flattenedText}\n${observation.title ?? ""}`;
  const matched: string[] = [];
  const missing: string[] = [];
  for (const s of sigs) {
    if (blob.toLowerCase().includes(s.toLowerCase())) matched.push(s);
    else missing.push(s);
  }
  if (sigs.length === 0) {
    return {
      status: "degraded",
      matched,
      missing,
      url: observation.url,
      message: "No fingerprint screenSignature configured",
    };
  }
  const ratio = matched.length / sigs.length;
  let status: DriftStatus = "mismatch";
  if (ratio === 1) status = "match";
  else if (ratio >= 0.5) status = "degraded";
  return {
    status,
    matched,
    missing,
    url: observation.url,
    message: `Drift ${status}: ${matched.length}/${sigs.length} signatures present`,
  };
}

export function applyTenantOverride(
  artifact: CapabilityArtifact,
  tenantId?: string
): CapabilityArtifact {
  if (!tenantId || !artifact.tenant_overrides?.[tenantId]) return artifact;
  const override = artifact.tenant_overrides[tenantId];
  const clone = structuredClone(artifact);
  if (override.startPath) {
    clone.preconditions.startUrl = override.startPath;
  }
  if (override.stepLocatorPatches) {
    for (const patch of override.stepLocatorPatches) {
      const step = clone.steps[patch.stepIndex];
      if (step && "locator" in step) {
        (step as { locator: unknown }).locator = patch.locator;
      }
    }
  }
  if (override.labelRewrites) {
    const rewrite = (s?: string) => {
      if (!s) return s;
      let out = s;
      for (const [from, to] of Object.entries(override.labelRewrites!)) {
        out = out.split(from).join(to);
      }
      return out;
    };
    for (const step of clone.steps) {
      if ("locator" in step) {
        step.locator.primary.name = rewrite(step.locator.primary.name);
        step.locator.primary.text = rewrite(step.locator.primary.text);
        for (const f of step.locator.fallbacks) {
          f.name = rewrite(f.name);
          f.text = rewrite(f.text);
        }
      }
    }
  }
  return clone;
}
