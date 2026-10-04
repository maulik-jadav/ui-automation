import {
  chromium,
  type Browser,
  type Page,
  type Frame,
  type Locator,
} from "playwright";
import type { Observation, ObservedElement } from "../types.js";
import type { ActRequest, ActResult, SurfaceAdapter } from "./SurfaceAdapter.js";

type AxNode = {
  role?: { value?: string } | string;
  name?: { value?: string } | string;
  childIds?: string[];
  backendDOMNodeId?: number;
  ignore?: boolean;
};

function axString(v: { value?: string } | string | undefined): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  return String(v.value ?? "");
}

function flattenCdpAx(
  nodes: AxNode[],
  elements: ObservedElement[],
  framePath: string[] | undefined,
  counter: { n: number }
): void {
  const byId = new Map<string, AxNode>();
  // CDP returns nodes with nodeId
  for (const n of nodes as Array<AxNode & { nodeId: string }>) {
    byId.set(n.nodeId, n);
  }

  const interesting = new Set([
    "textbox",
    "searchbox",
    "button",
    "link",
    "heading",
    "cell",
    "combobox",
    "checkbox",
    "option",
    "row",
  ]);

  const visit = (nodeId: string) => {
    const node = byId.get(nodeId);
    if (!node || node.ignore) return;
    const role = axString(node.role).toLowerCase();
    const name = axString(node.name).trim();
    if (interesting.has(role) || (role === "generic" && name.length > 0)) {
      counter.n += 1;
      elements.push({
        ref: counter.n,
        role: role === "searchbox" ? "textbox" : role,
        name,
        frame: framePath,
      });
    }
    for (const childId of node.childIds ?? []) {
      visit(childId);
    }
  };

  // Roots: nodes that are not children of others
  const childSet = new Set<string>();
  for (const n of nodes as Array<AxNode & { nodeId: string }>) {
    for (const c of n.childIds ?? []) childSet.add(c);
  }
  for (const n of nodes as Array<AxNode & { nodeId: string }>) {
    if (!childSet.has(n.nodeId)) visit(n.nodeId);
  }
}

async function snapshotViaCdp(
  page: Page,
  frame: Frame | null,
  elements: ObservedElement[],
  framePath: string[] | undefined,
  counter: { n: number }
): Promise<void> {
  // CDP AX tree is page-scoped; for iframes use DOM scrape with frame path prefix.
  if (!frame) {
    try {
      const client = await page.context().newCDPSession(page);
      await client.send("Accessibility.enable").catch(() => undefined);
      const { nodes } = (await client.send("Accessibility.getFullAXTree")) as {
        nodes: Array<AxNode & { nodeId: string }>;
      };
      flattenCdpAx(nodes, elements, framePath, counter);
      await client.detach().catch(() => undefined);
      return;
    } catch {
      /* fall through to DOM scrape */
    }
  }

  const target: Page | Frame = frame ?? page;
  const frameEls = await target.evaluate(() => {
    const out: { role: string; name: string }[] = [];
    const push = (role: string, name: string) => {
      const n = (name || "").trim();
      if (n || role === "textbox") out.push({ role, name: n });
    };
    document.querySelectorAll("a").forEach((a) =>
      push("link", a.textContent || "")
    );
    document
      .querySelectorAll("button, input[type=submit]")
      .forEach((b) =>
        push(
          "button",
          (b as HTMLElement).innerText || (b as HTMLInputElement).value || ""
        )
      );
    document
      .querySelectorAll("input[type=text], input:not([type]), textarea")
      .forEach((i) => {
        const el = i as HTMLInputElement;
        const label =
          el.getAttribute("aria-label") ||
          el.labels?.[0]?.textContent ||
          el.placeholder ||
          "";
        push("textbox", label);
      });
    document
      .querySelectorAll("td, th")
      .forEach((c) => push("cell", c.textContent || ""));
    document
      .querySelectorAll("h1,h2,h3")
      .forEach((h) => push("heading", h.textContent || ""));
    return out;
  });
  for (const fe of frameEls) {
    counter.n += 1;
    elements.push({
      ref: counter.n,
      role: fe.role,
      name: fe.name,
      frame: framePath,
    });
  }
}

async function cssPathFor(
  page: Page,
  element: ObservedElement
): Promise<string | undefined> {
  try {
    const loc = await resolvePlaywrightLocator(page, element);
    if (!loc) return undefined;
    return await loc.evaluate((el: Element) => {
      const parts: string[] = [];
      let cur: Element | null = el;
      while (cur && cur.nodeType === 1 && parts.length < 6) {
        let part = cur.tagName.toLowerCase();
        if (cur.id) {
          part += `#${cur.id}`;
          parts.unshift(part);
          break;
        }
        const parent: Element | null = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(
            (c) => (c as Element).tagName === cur!.tagName
          );
          if (siblings.length > 1) {
            part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
          }
        }
        parts.unshift(part);
        cur = parent;
      }
      return parts.join(" > ");
    });
  } catch {
    return undefined;
  }
}

async function resolvePlaywrightLocator(
  page: Page,
  element: ObservedElement
): Promise<Locator | null> {
  let scope: Page | Frame = page;
  if (element.frame?.length) {
    for (const frameSel of element.frame) {
      const handle = await page.locator(frameSel).first().elementHandle();
      if (!handle) return null;
      const contentFrame = await handle.contentFrame();
      if (!contentFrame) return null;
      scope = contentFrame;
    }
  }

  const role = element.role as Parameters<Page["getByRole"]>[0];
  const name = element.name || undefined;

  if (role === "textbox" || role === "searchbox") {
    if (name) {
      try {
        const byRole = scope.getByRole("textbox", { name });
        if ((await byRole.count()) > 0) return byRole.first();
      } catch {
        /* fall through */
      }
    }
    const boxes = scope.getByRole("textbox");
    if ((await boxes.count()) >= 1) return boxes.first();
  }

  if (name) {
    const loc = scope.getByRole(role, { name, exact: false });
    if ((await loc.count()) > 0) return loc.first();
    const byText = scope.getByText(name, { exact: false });
    if ((await byText.count()) > 0) return byText.first();
  }

  const byRole = scope.getByRole(role);
  if ((await byRole.count()) === 1) return byRole.first();
  return null;
}

export class PlaywrightWebAdapter implements SurfaceAdapter {
  private browser: Browser | null = null;
  private context: import("playwright").BrowserContext | null = null;
  private page: Page | null = null;
  private baseUrl: string;
  private headless: boolean;
  dialogLog: { type: string; message: string; action: string; ts: string }[] = [];
  /** When set, Chromium listens for CDP attach (handoff / debugging). */
  cdpPort?: number;

  constructor(opts: {
    baseUrl: string;
    headless?: boolean;
    cdpPort?: number;
  }) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.headless = opts.headless ?? false;
    this.cdpPort = opts.cdpPort;
  }

  async launch(): Promise<void> {
    const args =
      this.cdpPort != null
        ? [`--remote-debugging-port=${this.cdpPort}`]
        : undefined;
    this.browser = await chromium.launch({ headless: this.headless, args });
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await this.context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: false,
    });
    this.page = await this.context.newPage();
    this.page.on("dialog", async (dialog) => {
      const entry = {
        type: dialog.type(),
        message: dialog.message(),
        action: "accept",
        ts: new Date().toISOString(),
      };
      this.dialogLog.push(entry);
      await dialog.accept().catch(() => dialog.dismiss());
    });
    this.context.on("page", async (popup) => {
      await popup.waitForLoadState("domcontentloaded").catch(() => undefined);
    });
  }

  getContext(): import("playwright").BrowserContext {
    if (!this.context) throw new Error("Browser not launched");
    return this.context;
  }

  async stopTracing(path: string): Promise<void> {
    if (!this.context) return;
    await this.context.tracing.stop({ path }).catch(() => undefined);
  }

  getPage(): Page {
    if (!this.page) throw new Error("Browser not launched");
    return this.page;
  }

  getUrl(): string {
    return this.page?.url() ?? "";
  }

  async locate(request: {
    role?: string;
    name?: string;
    text?: string;
    css?: string;
    frame?: string[];
  }): Promise<ObservedElement | null> {
    const obs = await this.observe();
    return (
      obs.elements.find((e) => {
        if (request.role && e.role !== request.role) return false;
        if (request.name && !e.name.includes(request.name)) return false;
        if (request.text && !e.name.includes(request.text)) return false;
        if (request.frame && JSON.stringify(e.frame) !== JSON.stringify(request.frame))
          return false;
        return true;
      }) ?? null
    );
  }

  async snapshot(): Promise<unknown> {
    return this.observe();
  }

  async observe(): Promise<Observation> {
    const page = this.getPage();
    const elements: ObservedElement[] = [];
    const counter = { n: 0 };

    await snapshotViaCdp(page, null, elements, undefined, counter);

    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      const frameElement = await frame.frameElement().catch(() => null);
      if (!frameElement) continue;
      const frameId = await frameElement.getAttribute("id");
      const frameName = await frameElement.getAttribute("name");
      const frameTitle = await frameElement.getAttribute("title");
      const sel = frameId
        ? `iframe#${frameId}`
        : frameName
          ? `iframe[name="${frameName}"]`
          : frameTitle
            ? `iframe[title="${frameTitle}"]`
            : "iframe";
      await snapshotViaCdp(page, frame, elements, [sel], counter);
    }

    for (const el of elements) {
      el.cssPath = await cssPathFor(page, el);
    }

    const flattenedText = elements
      .map((e) => {
        const fr = e.frame?.length ? ` (frame: ${e.frame.join(" > ")})` : "";
        return `[${e.ref}] role=${e.role} name=${JSON.stringify(e.name)}${fr}`;
      })
      .join("\n");

    return {
      url: page.url(),
      elements,
      flattenedText,
      title: await page.title().catch(() => undefined),
    };
  }

  async act(request: ActRequest): Promise<ActResult> {
    const page = this.getPage();
    try {
      switch (request.kind) {
        case "navigate": {
          const path = request.path ?? "/";
          const url = path.startsWith("http")
            ? path
            : `${this.baseUrl}${path}`;
          await page.goto(url, { waitUntil: "domcontentloaded" });
          return { ok: true };
        }
        case "click": {
          if (!request.element)
            return { ok: false, error: "click requires element" };
          const loc = await resolvePlaywrightLocator(page, request.element);
          if (!loc)
            return {
              ok: false,
              error: `Could not resolve ref ${request.element.ref}`,
            };
          await loc.click({ timeout: request.timeoutMs ?? 5000 });
          await page.waitForLoadState("domcontentloaded").catch(() => undefined);
          return { ok: true };
        }
        case "type": {
          if (!request.element)
            return { ok: false, error: "type requires element" };
          const loc = await resolvePlaywrightLocator(page, request.element);
          if (!loc)
            return {
              ok: false,
              error: `Could not resolve ref ${request.element.ref}`,
            };
          await loc.fill(request.value ?? "", {
            timeout: request.timeoutMs ?? 5000,
          });
          return { ok: true };
        }
        case "select": {
          if (!request.element)
            return { ok: false, error: "select requires element" };
          const loc = await resolvePlaywrightLocator(page, request.element);
          if (!loc)
            return {
              ok: false,
              error: `Could not resolve ref ${request.element.ref}`,
            };
          await loc.selectOption({ label: request.value }).catch(async () => {
            await loc.selectOption({ value: request.value });
          });
          return { ok: true };
        }
        case "waitFor": {
          if (!request.element)
            return { ok: false, error: "waitFor requires element" };
          const loc = await resolvePlaywrightLocator(page, request.element);
          if (!loc)
            return {
              ok: false,
              error: `Could not resolve ref ${request.element.ref}`,
            };
          await loc.waitFor({
            state: "visible",
            timeout: request.timeoutMs ?? 10000,
          });
          return { ok: true };
        }
        case "extract": {
          if (!request.element)
            return { ok: false, error: "extract requires element" };
          const loc = await resolvePlaywrightLocator(page, request.element);
          if (!loc)
            return {
              ok: false,
              error: `Could not resolve ref ${request.element.ref}`,
            };
          const text = (
            await loc.innerText().catch(() => loc.inputValue())
          ).trim();
          return { ok: true, value: text };
        }
        default:
          return { ok: false, error: `Unknown action kind` };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async screenshot(path: string): Promise<void> {
    await this.getPage().screenshot({ path, fullPage: true });
  }

  async close(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }
}

export { resolvePlaywrightLocator };
