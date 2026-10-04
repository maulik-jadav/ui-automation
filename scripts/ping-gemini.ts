import "dotenv/config";
import { GoogleGenerativeAI } from "@google/generative-ai";

async function main(): Promise<void> {
  const key = process.env.GEMINI_API_KEY;
  if (!key || key.includes("your_gemini")) {
    console.log("STATUS: missing_or_placeholder");
    process.exit(1);
  }
  const models = [
    process.env.GEMINI_MODEL || "gemini-3.6-flash",
    "gemini-3.6-flash",
    "gemini-flash-latest",
    "gemini-3.5-flash",
    "gemini-3.8-flash",
  ];
  const genAI = new GoogleGenerativeAI(key);
  let ok = false;
  for (const m of [...new Set(models)]) {
    try {
      const model = genAI.getGenerativeModel({ model: m });
      const r = await model.generateContent("Reply with exactly: OK");
      const text = r.response.text?.() ?? "";
      console.log(`GENERATE ${m}: OK (${JSON.stringify(text).slice(0, 80)})`);
      ok = true;
      break;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`GENERATE ${m}: FAIL — ${msg.replace(/\n/g, " ").slice(0, 180)}`);
    }
  }
  console.log(ok ? "STATUS: working" : "STATUS: not_working");
  process.exit(ok ? 0 : 2);
}

main();
