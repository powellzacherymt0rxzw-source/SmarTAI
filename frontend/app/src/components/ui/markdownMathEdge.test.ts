import { describe, it, expect } from "vitest";
import { normalizeMarkdownMath } from "./normalizeMarkdownMath";

describe("normalizeMarkdownMath", () => {
  it("passes assertion checks", () => {

    const unmatchedEnvironment = "\\begin{cases}\\nx=1";
    if (normalizeMarkdownMath(unmatchedEnvironment) !== unmatchedEnvironment) {
      throw new Error("an incomplete LaTeX environment should remain readable text instead of a KaTeX error");
    }

    const unknownCommand = "说明：\\customTeacherTag 不是公式。";
    if (normalizeMarkdownMath(unknownCommand) !== unknownCommand) {
      throw new Error("unknown LaTeX commands should not be forced into a red KaTeX error");
    }

    const inlineEnvironment = String.raw`矩阵 \begin{matrix}a & b \\ c & d\end{matrix}。`;
    if (!normalizeMarkdownMath(inlineEnvironment).includes(String.raw`$\begin{matrix}a & b \\ c & d\end{matrix}$`)) {
      throw new Error("single-line LaTeX environments should render as inline math");
    }

    const unicodeOperators = "求 ∇f × ∇g · dS。";
    if (!normalizeMarkdownMath(unicodeOperators).includes("$∇f × ∇g · dS$")) {
      throw new Error("common Unicode vector-calculus operators should be rendered as math");
    }
  });
});
