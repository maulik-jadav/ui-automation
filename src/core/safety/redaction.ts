/** Mask regulated / sensitive patterns before writing evidence or artifacts. */

const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;
const LONG_ACCOUNT = /\b\d{10,17}\b/g;
const CARD = /\b(?:\d[ -]*?){13,19}\b/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
const DOB = /\b(?:0?[1-9]|1[0-2])[\/\-](?:0?[1-9]|[12]\d|3[01])[\/\-](?:19|20)\d{2}\b/g;
const API_KEYISH = /\b(AIza[0-9A-Za-z\-_]{20,}|sk-[A-Za-z0-9]{20,})\b/g;
const PASSWORDISH = /\b(password|passwd|pwd)\s*[:=]\s*\S+/gi;

export function redactString(s: string): string {
  return s
    .replace(SSN, "[REDACTED-SSN]")
    .replace(EMAIL, "[REDACTED-EMAIL]")
    .replace(PHONE, "[REDACTED-PHONE]")
    .replace(DOB, "[REDACTED-DOB]")
    .replace(API_KEYISH, "[REDACTED-KEY]")
    .replace(PASSWORDISH, "$1=[REDACTED]")
    .replace(CARD, (m) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19) return m;
      return "[REDACTED-CARD]";
    })
    .replace(LONG_ACCOUNT, "[REDACTED-ACCOUNT]");
}

export function redactDeep<T>(value: T): T {
  if (typeof value === "string") {
    return redactString(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => redactDeep(v)) as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const lower = k.toLowerCase();
      if (
        lower.includes("cookie") ||
        lower.includes("authorization") ||
        lower.includes("apikey") ||
        lower.includes("api_key") ||
        lower.includes("password") ||
        lower === "suppass" ||
        lower === "csrf"
      ) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out as T;
  }
  return value;
}
