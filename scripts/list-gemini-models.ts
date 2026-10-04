/**
 * Lists Gemini models available to the configured API key that support generateContent.
 * Usage: npx tsx scripts/list-gemini-models.ts
 * Does not print the API key.
 */
import "dotenv/config";

const key = process.env.GEMINI_API_KEY;
if (!key || key.includes("your_gemini")) {
  console.error("Set GEMINI_API_KEY in .env");
  process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
const res = await fetch(url);
if (!res.ok) {
  console.error(`ListModels failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
const data = (await res.json()) as {
  models?: { name?: string; supportedGenerationMethods?: string[] }[];
};
const usable = (data.models ?? [])
  .filter((m) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
  .map((m) => String(m.name ?? "").replace(/^models\//, ""))
  .filter(Boolean)
  .sort();

console.log(`generateContent models (${usable.length}):`);
for (const n of usable) console.log(`  ${n}`);

const flash = usable.filter((n) => /flash/i.test(n));
console.log("\nSuggested GEMINI_MODEL / fallbacks (flash first):");
for (const n of flash.slice(0, 12)) console.log(`  ${n}`);
