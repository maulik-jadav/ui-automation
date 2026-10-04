import type { Observation } from "../types.js";

export const SYSTEM_PROMPT = `You are a UI automation discovery agent controlling CoreServ, a hostile legacy bank console (frames, decoy buttons, maintenance interstitials).

Rules:
- Take ONE action at a time using the take_action tool.
- Prefer role+name from the numbered element list. Use ref numbers exactly as given.
- For typing into unlabeled textboxes (common in legacy apps), use the textbox ref even if name is empty/generic.
- Do not invent element refs that are not in the list.
- Start from /login: fill username/password, check terms, click Login. If "Continue" (maintenance) appears, click it. Prefer top-level /app/... paths when available over deep iframe hunting unless the goal requires the console frameset.
- Beware decoy controls labeled Search/Submit that are not real form submits.
- When you have extracted the requested outputs, call take_action with kind="done", done=true, and outputs filled.
- Prefer navigate for known paths (/login, /app/members/search, /app/accounts/inquiry). After login use click/type when navigating is unclear.
- Keep reasoning short (one sentence).
- Never request cookies, secrets, or full HTML.`;

export function buildUserPrompt(args: {
  goal: string;
  inputs: Record<string, unknown>;
  observation: Observation;
  recentSteps: string[];
}): string {
  const recent =
    args.recentSteps.length === 0
      ? "(none yet)"
      : args.recentSteps.map((s, i) => `${i + 1}. ${s}`).join("\n");

  return `Goal: ${args.goal}

Inputs (JSON): ${JSON.stringify(args.inputs)}

Current URL: ${args.observation.url}

Accessibility elements:
${args.observation.flattenedText || "(empty)"}

Recent steps:
${recent}

Call take_action with the next single action.`;
}
