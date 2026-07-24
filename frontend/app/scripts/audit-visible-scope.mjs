#!/usr/bin/env node

// Visible-scope audit for the normalized learning workflow.
//
// The redesign makes courses/assignments/submissions/grading/review/release
// first-class visible capabilities for admin/teacher/student roles, so the old
// "hide courses / hide student workspace" rules are gone. Instead this audit
// fails when any *legacy* Task surface remains: old /tasks routes, TaskStepper,
// useTaskProgress, TaskStatus, old task API clients/types, the
// StudentUnavailablePage, and text claiming courses/student access are hidden.

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const srcRoot = path.join(projectRoot, "src");
const mainFile = path.join(srcRoot, "main.tsx");

const scanEntries = [
  { relativePath: "src/main.tsx", required: true },
  { relativePath: "src/components", required: true },
  { relativePath: "src/routes", required: true },
  { relativePath: "src/api", required: true },
  { relativePath: "src/types", required: true },
  { relativePath: "src/hooks", required: false },
  { relativePath: "src/i18n/messages.ts", required: false },
];

// Legacy symbols/route segments that must not survive the redesign.
const legacySymbolRules = [
  {
    id: "legacy-task-stepper",
    description: "Legacy TaskStepper component must be removed.",
    pattern: /\bTaskStepper\b/,
  },
  {
    id: "legacy-use-task-progress",
    description: "Legacy useTaskProgress hook must be removed.",
    pattern: /\buseTaskProgress\b/,
  },
  {
    id: "legacy-task-status",
    description: "Legacy TaskStatus type must be removed.",
    pattern: /\bTaskStatus\b/,
  },
  {
    id: "legacy-task-api-import",
    description: "Legacy task/analytics/kb API clients must be removed.",
    pattern: /from\s+["']@\/api\/(?:tasks|analytics|kb)["']/,
  },
  {
    id: "legacy-task-types-import",
    description: "Legacy task/analytics/kb/lms types must be removed.",
    pattern: /from\s+["']@\/types\/(?:task|analytics|kb|lms)["']/,
  },
  {
    id: "legacy-student-unavailable",
    description: "StudentUnavailablePage must be removed (students have a real workspace now).",
    pattern: /\bStudentUnavailablePage\b|学生端暂未开放/,
  },
  {
    id: "legacy-hidden-course-claim",
    description: "Do not claim courses/student access are hidden — they are core capabilities now.",
    pattern: /课程.*隐藏|学生端.*隐藏|courses.*hidden|student.*hidden|暂未开放.*课程/i,
  },
];

// Legacy /tasks routes are removed (Task 13 deleted the files); the audit now
// fails if any /tasks route segment reappears in the router.
const forbiddenRouteSegments = ["tasks"];

function toRelative(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

async function pathExists(filePath) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function walkFiles(entryPath) {
  const entryStat = await pathExists(entryPath);
  if (!entryStat) {
    return [];
  }
  if (entryStat.isFile()) {
    return [entryPath];
  }
  if (!entryStat.isDirectory()) {
    return [];
  }

  const files = [];
  const dirEntries = await readdir(entryPath, { withFileTypes: true });
  for (const dirEntry of dirEntries) {
    const nestedPath = path.join(entryPath, dirEntry.name);
    if (dirEntry.isDirectory()) {
      files.push(...(await walkFiles(nestedPath)));
    } else if (dirEntry.isFile() && /\.(tsx|ts)$/.test(dirEntry.name) && !dirEntry.name.endsWith(".d.ts")) {
      files.push(nestedPath);
    }
  }
  return files;
}

async function collectVisibleFiles() {
  const missingRequired = [];
  const files = new Set();

  for (const entry of scanEntries) {
    const absolutePath = path.join(projectRoot, entry.relativePath);
    const entryStat = await pathExists(absolutePath);
    if (!entryStat) {
      if (entry.required) {
        missingRequired.push(entry.relativePath);
      }
      continue;
    }
    for (const filePath of await walkFiles(absolutePath)) {
      files.add(filePath);
    }
  }

  return {
    files: [...files].sort(),
    missingRequired,
  };
}

function isCommentOnlyLine(line) {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed.startsWith("*/");
}

function auditLegacySymbols(relativePath, content) {
  const findings = [];
  const lines = content.split(/\r?\n/);

  lines.forEach((line, index) => {
    if (isCommentOnlyLine(line)) {
      return;
    }
    for (const rule of legacySymbolRules) {
      if (rule.pattern.test(line)) {
        findings.push({
          type: "legacy-symbol",
          file: relativePath,
          line: index + 1,
          rule: rule.id,
          message: rule.description,
          excerpt: line.trim().replace(/\s+/g, " "),
        });
      }
    }
  });

  return findings;
}

function routeSegments(routePath) {
  return routePath
    .toLowerCase()
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment && segment !== "*" && !segment.startsWith(":"))
    .map((segment) => segment.replace(/[^a-z0-9-]/g, ""));
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split(/\r?\n/).length;
}

function auditRouter(content) {
  const findings = [];
  const routePattern = /\bpath\s*:\s*(["'`])([^"'`]+)\1/g;
  let match;

  while ((match = routePattern.exec(content)) !== null) {
    const routePath = match[2];
    const segments = routeSegments(routePath);
    const line = lineNumberAt(content, match.index);

    for (const forbiddenSegment of forbiddenRouteSegments) {
      if (segments.some((segment) => segment === forbiddenSegment)) {
        findings.push({
          type: "route",
          file: "src/main.tsx",
          line,
          rule: "forbidden-route-segment",
          message: `Router path must not expose legacy ${forbiddenSegment} route.`,
          excerpt: `path: "${routePath}"`,
        });
      }
    }
  }

  return findings;
}

function printFindings(findings) {
  for (const finding of findings) {
    console.error(`${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`);
    console.error(`  ${finding.excerpt}`);
  }
}

const { files, missingRequired } = await collectVisibleFiles();
const findings = [];

for (const relativePath of missingRequired) {
  findings.push({
    type: "missing-file",
    file: relativePath,
    line: 1,
    rule: "missing-required-visible-source",
    message: "Required visible source file was not found.",
    excerpt: relativePath,
  });
}

for (const filePath of files) {
  const relativePath = toRelative(filePath);
  const content = await readFile(filePath, "utf8");
  findings.push(...auditLegacySymbols(relativePath, content));
}

const mainContent = await pathExists(mainFile).then((mainStat) => (mainStat ? readFile(mainFile, "utf8") : null));
if (mainContent) {
  findings.push(...auditRouter(mainContent));
}

if (findings.length > 0) {
  console.error("FAIL visible scope audit");
  console.error(`Scanned ${files.length} user-visible source files.`);
  printFindings(findings);
  process.exitCode = 1;
} else {
  console.log("PASS visible scope audit");
  console.log(`Scanned ${files.length} user-visible source files.`);
  console.log("Checked for legacy task routes, components, hooks, types, and hidden-capability claims.");
}
