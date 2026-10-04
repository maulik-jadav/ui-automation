/**
 * Hostile markup helpers — ASP.NET-style meaningless IDs, nested tables, legacy look.
 * Toggle with HOSTILE=0 for slightly cleaner markup during debugging.
 */
import { createHash } from "node:crypto";

const HOSTILE = process.env.HOSTILE !== "0";
const SEED = process.env.HOSTILE_SEED ?? "memberbank-v1";

let counter = 0;

function hash(s: string): number {
  const h = createHash("sha256").update(`${SEED}:${s}`).digest();
  return h.readUInt32BE(0);
}

/** Stable-per-run meaningless control id */
export function ctlId(hint = "x"): string {
  if (!HOSTILE) return `field_${hint}`;
  counter += 1;
  const n = (hash(`${hint}:${counter}`) % 9000) + 1000;
  return `ctl00_ContentPlaceHolder1_${hint}${n}`;
}

export function cls(...parts: string[]): string {
  if (!HOSTILE) return parts.join(" ");
  return parts.map((p, i) => `c${(hash(p + i) % 40) + 1} x${(hash(p) % 20) + 1}`).join(" ");
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function money(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Deep nested table wrapper (5+ levels look) */
export function nest(inner: string, depth = 5): string {
  if (!HOSTILE || depth <= 0) return inner;
  let html = inner;
  for (let i = 0; i < depth; i++) {
    html = `<table border="0" cellpadding="0" cellspacing="0" width="100%" class="${cls("wrap")}"><tr><td>${html}</td></tr></table>`;
  }
  return html;
}

export function spacer(w = 8, h = 1): string {
  return `<td width="${w}" height="${h}"><img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" width="${w}" height="${h}" alt="" /></td>`;
}

export function labelCell(text: string): string {
  return `<td align="right" nowrap="nowrap" class="${cls("lbl")}"><font face="Tahoma" size="1">${esc(text)}</font></td>`;
}

export function fieldRow(
  label: string,
  controlHtml: string,
  error?: string
): string {
  const err = error
    ? `<div style="color:#c00;font-size:10px;font-family:Tahoma;">${esc(error)}</div>`
    : "";
  return `<tr>${labelCell(label)}${spacer(6)}<td class="${cls("fld")}">${controlHtml}${err}</td></tr>`;
}

export type ButtonKind = "submit" | "image" | "link" | "div" | "td";

/** Duplicate-friendly action control */
export function actionButton(
  text: string,
  opts: {
    kind?: ButtonKind;
    href?: string;
    onclick?: string;
    name?: string;
    title?: string;
    decoy?: boolean;
  } = {}
): string {
  const kind = opts.kind ?? (HOSTILE ? "link" : "submit");
  const style =
    "font-family:Tahoma;font-size:11px;background:#ece9d8;border:1px solid #003c74;padding:2px 10px;cursor:pointer;color:#000;text-decoration:none;";
  if (opts.decoy) {
    return `<a href="javascript:void(0)" style="${style}" title="Not available">${esc(text)}</a>`;
  }
  if (kind === "link") {
    return `<a href="${opts.href ?? "javascript:void(0)"}" onclick="${esc(opts.onclick ?? "return true;")}" style="${style}" title="${esc(opts.title ?? text)}">${esc(text)}</a>`;
  }
  if (kind === "div") {
    return `<div onclick="${esc(opts.onclick ?? "")}" style="${style}display:inline-block;" title="${esc(opts.title ?? text)}">${esc(text)}</div>`;
  }
  if (kind === "td") {
    return `<table cellpadding="0" cellspacing="0" style="display:inline;"><tr><td onclick="${esc(opts.onclick ?? "")}" style="${style}" title="${esc(opts.title ?? "")}">${esc(text || "…")}</td></tr></table>`;
  }
  if (kind === "image") {
    // 1x1 pixel styled as button via background — no alt on purpose (hostility)
    return `<input type="image" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7" name="${esc(opts.name ?? "btn")}" title="${esc(opts.title ?? text)}" style="width:72px;height:22px;border:1px solid #003c74;background:#ece9d8;vertical-align:middle;" onclick="${esc(opts.onclick ?? "return true;")}" />`;
  }
  return `<input type="submit" value="${esc(text)}" name="${esc(opts.name ?? "btn")}" style="${style}" />`;
}

export const LEGACY_CSS = `
html,body{margin:0;padding:0;background:#c0c0c0;font-family:Tahoma,Verdana,Arial,sans-serif;font-size:11px;color:#000;}
a{color:#0000ee;font-size:11px;}
input,select,textarea{font-family:Tahoma,Arial,sans-serif;font-size:11px;border:1px solid #7f9db9;}
.banner-err{background:#ffe0e0;border:1px solid #c00;color:#800;padding:6px;margin:4px 0;}
.banner-info{background:#e0f0ff;border:1px solid #06c;color:#036;padding:6px;margin:4px 0;}
.banner-warn{background:#fff8e0;border:1px solid #c80;color:#630;padding:6px;margin:4px 0;}
.grid{border-collapse:collapse;background:#fff;width:100%;}
.grid th,.grid td{border:1px solid #808080;padding:2px 5px;font-size:11px;}
.grid th{background:#ece9d8;cursor:pointer;}
.btn{font-family:Tahoma;font-size:11px;background:#ece9d8;border:1px outset #fff;padding:2px 10px;cursor:pointer;}
.denied{background:#400;color:#fff;padding:12px;font-weight:bold;}
`;

export function pageShell(title: string, body: string, extraHead = ""): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>${LEGACY_CSS}</style>${extraHead}</head>
<body bgcolor="#ffffff">${nest(body, HOSTILE ? 3 : 0)}</body></html>`;
}

export function accessDenied(reason = "Contact your security administrator"): string {
  return pageShell(
    "Access Denied",
    `<div class="denied">Access Denied - Contact your security administrator</div>
     <p><font face="Tahoma" size="1">${esc(reason)}</font></p>`
  );
}

export function resetHostileCounter(): void {
  counter = 0;
}
