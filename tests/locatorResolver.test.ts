import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeLocator,
  orderedStrategies,
} from "../src/core/replay/locatorResolver.js";
import type { Locator } from "../src/core/types.js";

describe("locatorResolver", () => {
  const locator: Locator = {
    primary: {
      strategy: "role",
      role: "button",
      name: "Search",
      confidence: "high",
    },
    fallbacks: [
      { strategy: "text", text: "Search", confidence: "medium" },
      { strategy: "css", css: "button", confidence: "low" },
    ],
  };

  it("orders primary before fallbacks", () => {
    const ordered = orderedStrategies(locator);
    assert.equal(ordered.length, 3);
    assert.equal(ordered[0].strategy, "role");
    assert.equal(ordered[1].strategy, "text");
    assert.equal(ordered[2].strategy, "css");
    assert.equal(ordered[0].confidence, "high");
    assert.equal(ordered[2].confidence, "low");
  });

  it("describes locators readably", () => {
    assert.equal(describeLocator(locator), "role:button:Search");
  });
});
