import { describe, it, expect } from "vitest";
import { normalizeMarkdownMath } from "./normalizeMarkdownMath";

describe("normalizeMarkdownMath", () => {
  it("passes assertion checks", () => {

    const setDefinition = String.raw`集合 S = \left\{ (x, y, z) \in \mathbb{R}^3 \mid x^2 + y^2 + z^2 = 1, z > 0 \right\}`;
    if (!normalizeMarkdownMath(setDefinition).includes(String.raw`$S = \left\{ (x, y, z) \in \mathbb{R}^3 \mid x^2 + y^2 + z^2 = 1, z > 0 \right\}$`)) {
      throw new Error("set-builder formulas with \\mid should be rendered as math");
    }
  });
});
