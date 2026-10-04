import {
  FunctionCallingMode,
  GoogleGenerativeAI,
  SchemaType,
  type FunctionDeclaration,
  type GenerativeModel,
} from "@google/generative-ai";
import type { AgentDecision, Observation } from "../types.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompts.js";

const takeActionFn: FunctionDeclaration = {
  name: "take_action",
  description:
    "Take exactly one UI action toward the goal, or mark the goal done with outputs.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      kind: {
        type: SchemaType.STRING,
        format: "enum",
        enum: ["navigate", "click", "type", "waitFor", "extract", "done"],
        description: "Action kind",
      },
      ref: {
        type: SchemaType.NUMBER,
        description: "Element ref number from the observation list",
      },
      value: { type: SchemaType.STRING },
      path: { type: SchemaType.STRING },
      outputName: { type: SchemaType.STRING },
      reasoning: { type: SchemaType.STRING },
      done: { type: SchemaType.BOOLEAN },
      outputs: {
        type: SchemaType.OBJECT,
        properties: {},
      },
    },
    required: ["kind", "reasoning"],
  },
};

/** Prefer env override, then models known to support generateContent for this key. */
export const GEMINI_MODEL_FALLBACKS = [
  process.env.GEMINI_MODEL,
  "gemini-3.6-flash",
  "gemini-flash-latest",
  "gemini-3.5-flash",
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-3-flash-preview",
].filter((m, i, a): m is string => Boolean(m) && a.indexOf(m) === i);

export class GeminiLlmClient {
  private genAI: GoogleGenerativeAI;
  private model: GenerativeModel;
  private modelQueue: string[];
  modelName: string;

  constructor(apiKey: string, modelName?: string) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelQueue = modelName
      ? [modelName, ...GEMINI_MODEL_FALLBACKS.filter((m) => m !== modelName)]
      : [...GEMINI_MODEL_FALLBACKS];
    this.modelName = this.modelQueue[0];
    this.model = this.buildModel(this.modelName);
  }

  private buildModel(name: string): GenerativeModel {
    return this.genAI.getGenerativeModel({
      model: name,
      systemInstruction: SYSTEM_PROMPT,
      tools: [{ functionDeclarations: [takeActionFn] }],
      toolConfig: {
        functionCallingConfig: { mode: FunctionCallingMode.ANY },
      },
    });
  }

  private rotateModel(reason: string): boolean {
    if (this.modelQueue.length <= 1) return false;
    const failed = this.modelQueue.shift()!;
    this.modelName = this.modelQueue[0];
    this.model = this.buildModel(this.modelName);
    console.warn(
      `Gemini model unavailable (${failed}): ${reason.slice(0, 120)} → trying ${this.modelName}`
    );
    return true;
  }

  async decide(args: {
    goal: string;
    inputs: Record<string, unknown>;
    observation: Observation;
    recentSteps: string[];
  }): Promise<AgentDecision> {
    const prompt = buildUserPrompt(args);
    const maxAttempts = 10;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.model.generateContent(prompt);
        const response = result.response;
        const calls = response.functionCalls?.() ?? [];

        if (calls.length > 0) {
          return normalizeDecision((calls[0].args ?? {}) as Record<string, unknown>);
        }

        const text = response.text?.() ?? "";
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            return normalizeDecision(JSON.parse(match[0]) as Record<string, unknown>);
          } catch {
            /* fall through */
          }
        }
        throw new Error(`Gemini returned no function call. Raw: ${text.slice(0, 400)}`);
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        const notFound = /404|not found|no longer available|not available to new users/i.test(
          msg
        );
        const retryable = /503|429|high demand|temporarily|Unavailable|RESOURCE_EXHAUSTED/i.test(
          msg
        );

        if (notFound && this.rotateModel(msg)) {
          continue;
        }
        if (retryable && attempt < maxAttempts) {
          // After a few 503s on one model, try the next fallback
          if (attempt > 0 && attempt % 3 === 0 && this.rotateModel(msg)) {
            continue;
          }
          const waitMs = Math.min(12000, 1500 * attempt);
          console.warn(
            `Gemini transient (${this.modelName} attempt ${attempt}/${maxAttempts}), retry in ${waitMs}ms…`
          );
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        break;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }
}

function normalizeDecision(raw: Record<string, unknown>): AgentDecision {
  const kind = String(raw.kind ?? "done") as AgentDecision["kind"];
  return {
    kind,
    ref: raw.ref !== undefined ? Number(raw.ref) : undefined,
    value: raw.value !== undefined ? String(raw.value) : undefined,
    path: raw.path !== undefined ? String(raw.path) : undefined,
    outputName:
      raw.outputName !== undefined ? String(raw.outputName) : undefined,
    reasoning: String(raw.reasoning ?? ""),
    done: Boolean(raw.done) || kind === "done",
    outputs:
      raw.outputs && typeof raw.outputs === "object"
        ? (raw.outputs as Record<string, unknown>)
        : undefined,
  };
}
