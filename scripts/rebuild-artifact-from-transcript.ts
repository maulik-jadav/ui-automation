/**
 * Rebuild capability artifact from an existing discovery transcript.json
 * Usage: npx tsx scripts/rebuild-artifact-from-transcript.ts evidence/3bb6d11f/transcript.json
 */
import { readFileSync } from "node:fs";
import { buildArtifactFromTranscript } from "../src/core/artifact/artifactBuilder.js";
import { saveArtifact } from "../src/core/artifact/artifactStore.js";
import type { DiscoveryTranscript } from "../src/core/types.js";

const path = process.argv[2];
if (!path) {
  console.error("Usage: npx tsx scripts/rebuild-artifact-from-transcript.ts <transcript.json>");
  process.exit(1);
}
const transcript = JSON.parse(readFileSync(path, "utf8")) as DiscoveryTranscript;
const outputs: Record<string, unknown> = {};
for (const s of transcript.steps) {
  const d = s.decision;
  if (d.kind === "done" || d.done) {
    if (d.outputName && d.value !== undefined) outputs[d.outputName] = d.value;
    if (d.outputs) Object.assign(outputs, d.outputs);
  }
  if (d.kind === "extract" && d.outputName && d.value !== undefined) {
    outputs[d.outputName] = d.value;
  }
}
const baseUrl = process.env.MOCK_APP_BASE_URL ?? "http://localhost:4000";
const artifact = buildArtifactFromTranscript({
  transcript,
  outputs,
  baseUrl,
  irreversibleSeen: false,
});
const out = saveArtifact(artifact);
console.log(JSON.stringify({ artifactPath: out, outputs, steps: artifact.steps.length }, null, 2));
