import type { Page } from "playwright";
import type { OutcomeRule, LocatorStrategy, ErrorClass } from "../types.js";

export interface OutcomeMatch {
  rule: OutcomeRule;
  matchedText: string;
}

async function strategyVisible(
  page: Page,
  match: LocatorStrategy
): Promise<string | null> {
  try {
    if (match.frame?.length) {
      let scope: Page | import("playwright").Frame = page;
      for (const sel of match.frame) {
        const handle = await scope.locator(sel).first().elementHandle();
        if (!handle) return null;
        const frame = await handle.contentFrame();
        if (!frame) return null;
        scope = frame;
      }
      const text = match.text ?? match.name;
      if (!text) return null;
      const loc = scope.getByText(text, { exact: false });
      if ((await loc.count()) > 0) {
        return (await loc.first().innerText()).trim();
      }
      return null;
    }

    const text = match.text ?? match.name;
    if (match.strategy === "text" || match.strategy === "role") {
      if (!text) return null;
      const loc =
        match.strategy === "role" && match.role
          ? page.getByRole(match.role as "heading", {
              name: text,
              exact: false,
            })
          : page.getByText(text, { exact: false });
      if ((await loc.count()) > 0) {
        return (await loc.first().innerText()).trim();
      }
    }
    if (match.strategy === "css" && match.css) {
      const loc = page.locator(match.css);
      if ((await loc.count()) > 0) {
        return (await loc.first().innerText()).trim();
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function findMatchingOutcome(
  page: Page,
  outcomes: OutcomeRule[]
): Promise<OutcomeMatch | null> {
  for (const rule of outcomes) {
    const matchedText = await strategyVisible(page, rule.match);
    if (matchedText !== null) {
      return { rule, matchedText };
    }
  }
  return null;
}

/** Built-in page detectors beyond artifact-declared outcomes. */
export async function detectPageConditions(page: Page): Promise<{
  classification: OutcomeRule["classification"] | null;
  code?: string;
  message?: string;
  error_class?: ErrorClass;
} | null> {
  const body = await page.locator("body").innerText().catch(() => "");
  const url = page.url();
  const title = await page.title().catch(() => "");

  if (/Server Error in '\/' Application/i.test(body) || /HTTP 500/i.test(body)) {
    return {
      classification: "failure",
      code: "HTTP_5XX",
      message: "Application error page detected",
      error_class: "http_5xx",
    };
  }
  if (
    /session (has )?expired|please log in again|log back in/i.test(body)
  ) {
    return {
      classification: "recoverable",
      code: "SESSION_EXPIRED",
      message: "Session expired — re-login required",
      error_class: "session",
    };
  }
  void url;
  // Intentional start at /login is not a session failure.
  if (/Access Denied/i.test(body)) {
    return {
      classification: "business_outcome",
      code: "PERMISSION_DENIED",
      message: "Access Denied",
      error_class: "permission",
    };
  }
  if (/No (records|member) found/i.test(body)) {
    return {
      classification: "business_outcome",
      code: "MEMBER_NOT_FOUND",
      message: "No records found",
      error_class: "not_found",
    };
  }
  if (
    /does not meet the minimum|required field|invalid |must be|validation/i.test(
      body
    ) &&
    /banner-err|banner-error|color:#c00|#c00/i.test(
      (await page.content().catch(() => "")) || ""
    )
  ) {
    return {
      classification: "business_outcome",
      code: "VALIDATION_REJECTED",
      message: "Validation error displayed",
      error_class: "validation",
    };
  }
  if (/System temporarily unavailable|Please wait\.\.\./i.test(body)) {
    return {
      classification: "recoverable",
      code: "SYSTEM_BUSY",
      message: "Transient busy / please wait",
    };
  }
  if (/Cutoff passed/i.test(body)) {
    return {
      classification: "business_outcome",
      code: "CUTOFF_PASSED",
      message: "Business cutoff passed",
    };
  }
  void title;
  return null;
}

/** @deprecated Prefer detectPageConditions; kept for tests */
export function classifyMessage(
  message: string
): OutcomeRule["classification"] | null {
  const m = message.toLowerCase();
  if (m.includes("no member found") || m.includes("no records found"))
    return "business_outcome";
  if (m.includes("access denied")) return "business_outcome";
  if (m.includes("session expired")) return "recoverable";
  if (m.includes("temporarily unavailable")) return "recoverable";
  if (m.includes("must be at least") || m.includes("validation"))
    return "business_outcome";
  if (m.includes("cutoff passed")) return "business_outcome";
  if (m.includes("server error")) return "failure";
  return null;
}
