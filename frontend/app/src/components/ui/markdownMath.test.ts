import { describe, it, expect } from "vitest";
import { normalizeMarkdownMath } from "./normalizeMarkdownMath";

describe("normalizeMarkdownMath", () => {
  it("passes assertion checks", () => {

    const sample = "设 F 具有一阶连续偏导数, w = w(x, y, z) 是方程\nF(x - aw, y - bw, z - cw) = 1\n∂x + b∂w";
    const normalized = normalizeMarkdownMath(sample);

    if (!normalized.includes("$F(x - aw, y - bw, z - cw) = 1$")) {
      throw new Error("standalone formula lines should be wrapped for remark-math");
    }

    if (normalizeMarkdownMath(String.raw`\(x^2\)`) !== "$x^2$") {
      throw new Error("TeX inline delimiters should be converted to remark-math delimiters");
    }

    const rubricBullet = "- Correct answer: 5 points";
    if (normalizeMarkdownMath(rubricBullet) !== rubricBullet) {
      throw new Error("ordinary markdown list items must not be treated as formulas");
    }

    const casesFormula = String.raw`设参数方程为
    \begin{cases}
    x=\varphi(t),\\
    y=\psi(t),
    \end{cases}
    t \in [0,2\pi].`;
    const normalizedCases = normalizeMarkdownMath(casesFormula);
    if (!normalizedCases.includes(String.raw`$$
    \begin{cases}
    x=\varphi(t),\\
    y=\psi(t),
    \end{cases}
    $$`)) {
      throw new Error("multi-line LaTeX environments should be kept in one display-math block");
    }

    const mixedInline = String.raw`求函数 f(x)=e^{a|x|} (a \neq 0) 在 (-\pi, \pi) 内的 Fourier 系数。`;
    const normalizedInline = normalizeMarkdownMath(mixedInline);
    if (!normalizedInline.includes(String.raw`$f(x)=e^{a|x|} (a \neq 0)$`)) {
      throw new Error("math embedded in Chinese prose should receive inline delimiters");
    }
    if (!normalizedInline.includes(String.raw`$(-\pi, \pi)$`)) {
      throw new Error("a second inline formula in the same prose line should also be normalized");
    }

    const stackedDerivatives = "试求∂w\n∂x + b∂w\n∂y + c∂w\n∂z 的值。";
    if (!normalizeMarkdownMath(stackedDerivatives).includes(String.raw`\frac{\partial w}{\partial x} + b\frac{\partial w}{\partial y} + c\frac{\partial w}{\partial z}`)) {
      throw new Error("PDF line breaks between partial-derivative numerator and denominator should be repaired");
    }

    const codeFence = "```latex\n\\alpha + x\n```";
    if (normalizeMarkdownMath(codeFence) !== codeFence) {
      throw new Error("LaTeX-looking content inside code fences must stay code");
    }

    const mixedExistingMath = String.raw`已有 $x^2$，同时还有 \alpha \neq 1。`;
    const normalizedExistingMath = normalizeMarkdownMath(mixedExistingMath);
    if (!normalizedExistingMath.includes(String.raw`$x^2$`) || !normalizedExistingMath.includes(String.raw`$\alpha \neq 1$`)) {
      throw new Error("existing math and new inline LaTeX should coexist on one prose line");
    }
  });
});
