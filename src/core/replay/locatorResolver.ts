import type { Page, Frame, Locator } from "playwright";
import type { Locator as ArtifactLocator, LocatorStrategy } from "../types.js";

export interface ResolveResult {
  resolved: boolean;
  locator?: Locator;
  strategyUsed?: LocatorStrategy;
  matchCount?: number;
  error?: string;
  error_class?: "locator_unresolved" | "locator_ambiguous";
}

async function getScope(
  page: Page,
  framePath?: string[]
): Promise<Page | Frame> {
  if (!framePath?.length) return page;
  let current: Page | Frame = page;
  for (const sel of framePath) {
    const handle = await current.locator(sel).first().elementHandle();
    if (!handle) throw new Error(`Frame not found: ${sel}`);
    const content = await handle.contentFrame();
    if (!content) throw new Error(`No content frame for: ${sel}`);
    current = content;
  }
  return current;
}

async function tryStrategy(
  page: Page,
  strategy: LocatorStrategy
): Promise<{ loc: Locator; count: number } | null> {
  const scope = await getScope(page, strategy.frame);

  if (strategy.strategy === "role" || strategy.strategy === "label_proximity") {
    const role = (strategy.role ?? "generic") as Parameters<Page["getByRole"]>[0];
    if (role === "textbox" && !strategy.name) {
      const boxes = scope.getByRole("textbox");
      const count = await boxes.count();
      if (count === 0) return null;
      return { loc: boxes.first(), count };
    }
    const opts: { name?: string | RegExp; exact?: boolean } = {};
    if (strategy.namePattern) {
      opts.name = new RegExp(strategy.namePattern, "i");
    } else if (strategy.name) {
      opts.name = strategy.name;
      opts.exact = false;
    }
    const loc = scope.getByRole(role, opts);
    const count = await loc.count();
    if (count === 0) return null;
    return { loc: loc.first(), count };
  }

  if (strategy.strategy === "text" && strategy.text) {
    const loc = scope.getByText(strategy.text, { exact: false });
    const count = await loc.count();
    if (count === 0) return null;
    return { loc: loc.first(), count };
  }

  if (strategy.strategy === "css" && strategy.css) {
    const loc = scope.locator(strategy.css);
    const count = await loc.count();
    if (count === 0) return null;
    return { loc: loc.first(), count };
  }

  return null;
}

export async function resolveLocator(
  page: Page,
  locator: ArtifactLocator,
  opts: { allowAmbiguousFirst?: boolean } = {}
): Promise<ResolveResult> {
  const strategies = [locator.primary, ...locator.fallbacks];
  let lastAmbiguous: ResolveResult | null = null;

  for (const strategy of strategies) {
    try {
      const hit = await tryStrategy(page, strategy);
      if (!hit) continue;
      if (hit.count > 1 && !opts.allowAmbiguousFirst) {
        lastAmbiguous = {
          resolved: false,
          matchCount: hit.count,
          strategyUsed: strategy,
          error_class: "locator_ambiguous",
          error: `Ambiguous locator (${hit.count} matches) for ${strategy.strategy}:${strategy.role ?? ""}:${strategy.name ?? strategy.text ?? strategy.css ?? ""}`,
        };
        continue; // try next strategy that might be unique
      }
      return {
        resolved: true,
        locator: hit.loc,
        strategyUsed: strategy,
        matchCount: hit.count,
      };
    } catch {
      /* try next */
    }
  }

  if (lastAmbiguous) return lastAmbiguous;

  return {
    resolved: false,
    error_class: "locator_unresolved",
    error: `No strategy resolved uniquely: ${describeLocator(locator)}`,
  };
}

export function describeLocator(locator: ArtifactLocator): string {
  const p = locator.primary;
  return `${p.strategy}:${p.role ?? ""}:${p.name ?? p.text ?? p.css ?? ""}`;
}

export function orderedStrategies(locator: ArtifactLocator): LocatorStrategy[] {
  return [locator.primary, ...locator.fallbacks];
}

export function describeStrategy(s: LocatorStrategy): string {
  return `${s.strategy}/${s.confidence}:${s.role ?? ""}:${s.name ?? s.text ?? s.css ?? ""}`;
}
