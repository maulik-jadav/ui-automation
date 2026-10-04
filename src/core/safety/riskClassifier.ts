import type { RiskClass } from "../types.js";

/** Weak fallback only — prefer classifyRiskAtRecordTime. */
const IRREVERSIBLE_NAME = /^(confirm|delete|transfer|wire|close)$/i;

/**
 * Assign risk when recording a step from action kind + page/URL context.
 * Button labels like "Submit" alone are not enough — confirmation/review
 * URLs and irreversible verbs in context mark irreversible.
 */
export function classifyRiskAtRecordTime(args: {
  kind: string;
  elementName?: string;
  url?: string;
  pageText?: string;
}): RiskClass {
  const url = (args.url ?? "").toLowerCase();
  const blob = `${args.elementName ?? ""} ${args.pageText ?? ""}`.toLowerCase();
  const onConfirmSurface =
    /\/confirm|\/review|\/final|close\/|wire|transfer\/confirm|open\/confirm/.test(
      url
    ) || /review new account|confirm (transfer|wire|close|payment)/i.test(blob);

  if (args.kind === "navigate" || args.kind === "waitFor" || args.kind === "extract" || args.kind === "assertOutcome") {
    return "read";
  }

  if (onConfirmSurface && (args.kind === "click" || args.kind === "select")) {
    const name = args.elementName ?? "";
    if (/confirm|submit|yes|post|approve|finalize/i.test(name) || IRREVERSIBLE_NAME.test(name)) {
      return "irreversible";
    }
  }

  if (args.kind === "click" && IRREVERSIBLE_NAME.test(args.elementName ?? "")) {
    return "irreversible";
  }

  if (args.kind === "type" || args.kind === "click" || args.kind === "select") {
    return "reversible_write";
  }
  return "read";
}

/** @deprecated use classifyRiskAtRecordTime — kept for tests / discovery hint */
export function isIrreversibleName(name: string): boolean {
  return IRREVERSIBLE_NAME.test(name) || /submit|confirm|open|transfer|delete/i.test(name);
}
