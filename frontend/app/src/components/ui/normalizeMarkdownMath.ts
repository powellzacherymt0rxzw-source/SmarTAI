/** Normalize the math delimiters commonly returned by the problem parser. */
export function normalizeMarkdownMath(value: string): string {
  const normalized = repairStackedPartialDerivatives(value.replace(/\r\n?/g, "\n"));

  // remark-math understands $...$ / $$...$$, but not the TeX delimiters that
  // LLMs frequently return. Keep already-normalized markdown untouched.
  const withDelimiters = normalized
    .replace(/\\\[([\s\S]*?)\\\]/g, "$$$$$1$$$$")
    .replace(/\\\(([\s\S]*?)\\\)/g, "$$$1$$");

  const withEnvironments = wrapBareLatexEnvironments(withDelimiters);
  let inDisplayMath = false;
  let inCodeFence = false;

  // Extraction from PDFs often loses the original delimiters entirely. Wrap
  // standalone formula lines so they are still rendered as math instead of
  // appearing as a block of ordinary text. Lines containing prose are left
  // unchanged to avoid accidentally italicizing natural-language text.
  return withEnvironments
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      const fence = trimmed.match(/^(`{3,}|~{3,})/u);
      if (fence) {
        if (inCodeFence) {
          inCodeFence = false;
        } else {
          inCodeFence = true;
        }
        return line;
      }
      if (inCodeFence) {
        return line;
      }
      if (trimmed === "$$") {
        inDisplayMath = !inDisplayMath;
        return line;
      }
      if (inDisplayMath) {
        return line;
      }
      if (!trimmed) {
        return line;
      }
      if (/^(?:[-*+]\s+|\d+[.)]\s+|#{1,6}\s+|>|```)/u.test(trimmed)) {
        return line;
      }
      const hasBegin = /\\begin\{[A-Za-z*]+\}/u.test(trimmed);
      const hasEnd = /\\end\{[A-Za-z*]+\}/u.test(trimmed);
      if (hasBegin !== hasEnd) {
        return line;
      }
      return normalizeUnprotectedLine(line);
    })
    .join("\n");
}

function repairStackedPartialDerivatives(value: string): string {
  return value.replace(
    /∂\s*([A-Za-z][A-Za-z0-9]*)\s*\n\s*∂\s*([A-Za-z][A-Za-z0-9]*)/gu,
    (_match: string, numerator: string, denominator: string) =>
      `\\frac{\\partial ${numerator}}{\\partial ${denominator}}`,
  );
}

function wrapMathSegment(segment: string): string {
  const firstContentIndex = segment.search(/\S/u);
  if (firstContentIndex < 0) {
    return segment;
  }
  const lastContentIndex = segment.search(/\s*$/u);
  const content = segment.slice(firstContentIndex, lastContentIndex);
  if (!isFormulaLike(content)) {
    return segment;
  }
  return `${segment.slice(0, firstContentIndex)}$${content}$${segment.slice(lastContentIndex)}`;
}

function isFormulaLike(content: string): boolean {
  const commands = [...content.matchAll(/\\([A-Za-z]+)/gu)].map((match) => match[1]);
  if (commands.some((command) => !KNOWN_LATEX_COMMANDS.has(command))) {
    return false;
  }
  const hasStrongMathSignal =
    /[=^_\\∂∫√∇×·±∞∑∏∈∉∩∪⊂⊆→⇒]/u.test(content) ||
    (/[+\-*/]/u.test(content) && !/[A-Za-z]{4,}/u.test(content)) ||
    /^[A-Za-z][A-Za-z0-9_]*\s*\([^)]*\)$/u.test(content);
  return hasStrongMathSignal && /[A-Za-z\u0370-\u03ff∂∫√∇]/u.test(content);
}

const KNOWN_LATEX_COMMANDS = new Set([
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "theta", "vartheta", "lambda", "mu", "nu",
  "xi", "pi", "varpi", "rho", "sigma", "tau", "phi", "varphi", "psi", "omega", "partial", "nabla",
  "infty", "neq", "leq", "geq", "approx", "sim", "equiv", "in", "notin", "forall", "exists", "pm", "mp",
  "cdot", "times", "div", "ast", "circ", "otimes", "oplus", "sum", "prod", "int", "iint", "iiint", "oint",
  "lim", "sin", "cos", "tan", "cot", "sec", "csc", "log", "ln", "exp", "det", "gcd", "frac", "dfrac",
  "tfrac", "sqrt", "overline", "underline", "hat", "bar", "vec", "mathbf", "mathrm", "mathit", "mathbb",
  "operatorname", "text", "textbf", "textit", "textnormal", "mathcal", "mathscr", "mathfrak", "mathsf",
  "left", "right", "mid", "vert", "lvert", "rvert", "Vert", "lVert", "rVert", "big", "Big", "bigl", "bigr",
  "Bigl", "Bigr", "begin", "end", "dots", "cdots", "ldots", "vdots", "ddots", "colon", "mod", "bmod", "pmod",
  "quad", "qquad",
]);

function normalizeUnprotectedLine(line: string): string {
  let output = "";
  let cursor = 0;

  while (cursor < line.length) {
    const protectedToken = findProtectedToken(line, cursor);
    if (!protectedToken) {
      output += normalizeTextChunk(line.slice(cursor));
      break;
    }
    output += normalizeTextChunk(line.slice(cursor, protectedToken.start));
    output += protectedToken.value;
    cursor = protectedToken.end;
  }

  return output;
}

function normalizeTextChunk(chunk: string): string {
  if (!/[\u3400-\u9fff]/u.test(chunk)) {
    return wrapMathSegment(chunk);
  }
  return chunk
    .split(/([\u3400-\u9fff\u3001\u3002\uFF01\uFF1A\uFF1B\uFF0C\uFF08\uFF09\u3010\u3011\u201C\u201D]+)/u)
    .map((segment) => (/^[\u3400-\u9fff\u3001\u3002\uFF01\uFF1A\uFF1B\uFF0C\uFF08\uFF09\u3010\u3011\u201C\u201D]+$/u.test(segment) ? segment : wrapMathSegment(segment)))
    .join("");
}

function findProtectedToken(line: string, start: number): { start: number; end: number; value: string } | null {
  for (let index = start; index < line.length; index += 1) {
    const character = line[index];
    if (character === "`") {
      const runLength = countRun(line, index, "`");
      const marker = "`".repeat(runLength);
      const end = line.indexOf(marker, index + runLength);
      if (end >= 0) {
        return { start: index, end: end + runLength, value: line.slice(index, end + runLength) };
      }
      continue;
    }
    if (character !== "$" || isEscaped(line, index)) {
      continue;
    }
    const marker = line.startsWith("$$", index) ? "$$" : "$";
    const end = findUnescaped(line, marker, index + marker.length);
    if (end >= 0) {
      return { start: index, end: end + marker.length, value: line.slice(index, end + marker.length) };
    }
    return { start: index, end: line.length, value: line.slice(index) };
  }
  return null;
}

function countRun(value: string, start: number, character: string): number {
  let count = 0;
  while (value[start + count] === character) count += 1;
  return count;
}

function findUnescaped(value: string, marker: string, start: number): number {
  let index = start;
  while (index < value.length) {
    const candidate = value.indexOf(marker, index);
    if (candidate < 0) return -1;
    if (!isEscaped(value, candidate)) return candidate;
    index = candidate + marker.length;
  }
  return -1;
}

function isEscaped(value: string, index: number): boolean {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function wrapBareLatexEnvironments(value: string): string {
  const lines = value.split("\n");
  const output: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const begin = lines[index].trim().match(/^\\begin\{([A-Za-z*]+)\}$/u);
    if (!begin || lines[index].includes("$")) {
      output.push(lines[index]);
      continue;
    }

    const endMarker = `\\end{${begin[1]}}`;
    // findIndex gives (element, elementIndex); compare the element index, not
    // the element itself, so we locate the matching \end after the \begin line.
    const endIndex = lines.findIndex((line, lineIndex) => lineIndex >= index && line.trim() === endMarker);
    if (endIndex < index || lines.slice(index, endIndex + 1).some((line) => line.includes("$"))) {
      output.push(lines[index]);
      continue;
    }

    // Indent the closing fence to match the \begin line's leading whitespace so
    // the wrapped block stays visually aligned with the environment it contains.
    const indent = lines[index].match(/^\s*/u)?.[0] ?? "";
    output.push("$$", ...lines.slice(index, endIndex + 1), `${indent}$$`);
    index = endIndex;
  }

  return output.join("\n");
}
