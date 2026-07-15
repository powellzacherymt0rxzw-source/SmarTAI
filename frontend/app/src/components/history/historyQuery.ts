import type {
  HistoryInterpretation,
  HistorySort,
  TaskHistoryQuery,
  TaskStatus,
} from "@/types";

export const DEFAULT_HISTORY_QUERY: TaskHistoryQuery = {
  page: 1,
  page_size: 25,
  sort: "updated_desc",
};

const PAGE_SIZES = new Set([25, 50, 100]);
const SORT_VALUES = new Set<HistorySort>([
  "updated_desc",
  "updated_asc",
  "created_desc",
  "created_asc",
  "name_asc",
  "name_desc",
  "attention_first",
  "stage_asc",
  "stage_desc",
]);
const STATUS_VALUES = new Set<TaskStatus>([
  "draft",
  "extracting_problems",
  "problems_ready",
  "parsing_submissions",
  "submissions_ready",
  "grading",
  "graded",
  "error",
]);

export function parseHistorySearchParams(params: URLSearchParams): TaskHistoryQuery {
  const page = positiveInteger(params.get("page"), 1);
  const rawPageSize = positiveInteger(params.get("page_size"), 25);
  const pageSize = PAGE_SIZES.has(rawPageSize) ? rawPageSize as 25 | 50 | 100 : 25;
  const rawSort = params.get("sort") as HistorySort | null;
  const statuses = splitValues(params.get("status")).filter(isTaskStatus);

  return compactHistoryQuery({
    page,
    page_size: pageSize,
    q: clean(params.get("q")),
    semester_id: clean(params.get("semester")),
    course_id: clean(params.get("course")),
    tag_ids: splitValues(params.get("tags")),
    statuses,
    unfinished: parseBoolean(params.get("unfinished")),
    needs_attention: parseBoolean(params.get("needs_attention") ?? params.get("attention")),
    sort: rawSort && SORT_VALUES.has(rawSort) ? rawSort : "updated_desc",
  });
}

export function serializeHistoryQuery(query: TaskHistoryQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("page", String(query.page));
  params.set("page_size", String(query.page_size));
  params.set("sort", query.sort);
  setWhenPresent(params, "q", query.q);
  setWhenPresent(params, "semester", query.semester_id);
  setWhenPresent(params, "course", query.course_id);
  setWhenPresent(params, "tags", query.tag_ids?.join(","));
  setWhenPresent(params, "status", query.statuses?.join(","));
  if (query.unfinished) params.set("unfinished", "true");
  if (query.needs_attention) params.set("needs_attention", "true");
  return params;
}

export function patchHistoryQuery(
  query: TaskHistoryQuery,
  patch: Partial<TaskHistoryQuery>,
  options: { keepPage?: boolean } = {},
): TaskHistoryQuery {
  return compactHistoryQuery({
    ...query,
    ...patch,
    page: options.keepPage ? patch.page ?? query.page : patch.page ?? 1,
  });
}

export function applyHistoryInterpretation(
  query: TaskHistoryQuery,
  interpretation: HistoryInterpretation,
): TaskHistoryQuery {
  return compactHistoryQuery({
    ...query,
    ...interpretation.filters,
    sort: interpretation.sort ?? query.sort,
    page: 1,
  });
}

export function clearHistoryCondition(query: TaskHistoryQuery, field: string): TaskHistoryQuery {
  switch (field) {
    case "q":
    case "query":
      return patchHistoryQuery(query, { q: undefined });
    case "semester":
    case "semester_id":
      return patchHistoryQuery(query, { semester_id: undefined });
    case "course":
    case "course_id":
      return patchHistoryQuery(query, { course_id: undefined });
    case "tag":
    case "tags":
    case "tag_ids":
      return patchHistoryQuery(query, { tag_ids: undefined });
    case "status":
    case "statuses":
      return patchHistoryQuery(query, { statuses: undefined });
    case "unfinished":
      return patchHistoryQuery(query, { unfinished: undefined });
    case "needs_attention":
      return patchHistoryQuery(query, { needs_attention: undefined });
    case "sort":
      return patchHistoryQuery(query, { sort: "updated_desc" });
    default:
      return query;
  }
}

export function countHistoryFilters(query: TaskHistoryQuery): number {
  return Number(Boolean(query.q))
    + Number(Boolean(query.semester_id))
    + Number(Boolean(query.course_id))
    + (query.tag_ids?.length ?? 0)
    + (query.statuses?.length ?? 0)
    + Number(Boolean(query.unfinished))
    + Number(Boolean(query.needs_attention))
    + Number(query.sort !== "updated_desc");
}

export interface SemesterOption {
  id: string;
  academicYear: string;
  season: "autumn" | "winter" | "spring" | "summer";
}

export function buildSemesterOptions(now = new Date()): SemesterOption[] {
  const current = getCurrentSemester(now);
  const end = nextSemester(current);
  const options: SemesterOption[] = [];
  let cursor: SemesterOption = {
    id: "2025-2026-autumn",
    academicYear: "2025-2026",
    season: "autumn",
  };

  while (compareSemester(cursor, end) <= 0 && options.length < 40) {
    options.push(cursor);
    cursor = nextSemester(cursor);
  }
  return options;
}

function getCurrentSemester(now: Date): SemesterOption {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 8 && month <= 11) return semester(year, "autumn");
  if (month === 12) return semester(year, "winter");
  if (month <= 2) return semester(year - 1, "winter");
  if (month <= 5) return semester(year - 1, "spring");
  return semester(year - 1, "summer");
}

function semester(startYear: number, season: SemesterOption["season"]): SemesterOption {
  const academicYear = `${startYear}-${startYear + 1}`;
  return { id: `${academicYear}-${season}`, academicYear, season };
}

function nextSemester(current: SemesterOption): SemesterOption {
  const startYear = Number(current.academicYear.slice(0, 4));
  switch (current.season) {
    case "autumn": return semester(startYear, "winter");
    case "winter": return semester(startYear, "spring");
    case "spring": return semester(startYear, "summer");
    case "summer": return semester(startYear + 1, "autumn");
  }
}

function compareSemester(a: SemesterOption, b: SemesterOption): number {
  return semesterRank(a) - semesterRank(b);
}

function semesterRank(value: SemesterOption): number {
  const startYear = Number(value.academicYear.slice(0, 4));
  const seasonIndex = ["autumn", "winter", "spring", "summer"].indexOf(value.season);
  return startYear * 4 + seasonIndex;
}

function compactHistoryQuery(query: TaskHistoryQuery): TaskHistoryQuery {
  return {
    page: Math.max(1, Math.floor(query.page)),
    page_size: query.page_size,
    ...(query.q?.trim() ? { q: query.q.trim() } : {}),
    ...(query.semester_id ? { semester_id: query.semester_id } : {}),
    ...(query.course_id ? { course_id: query.course_id } : {}),
    ...(query.tag_ids?.length ? { tag_ids: unique(query.tag_ids) } : {}),
    ...(query.statuses?.length ? { statuses: unique(query.statuses) } : {}),
    ...(query.unfinished ? { unfinished: true } : {}),
    ...(query.needs_attention ? { needs_attention: true } : {}),
    sort: query.sort,
  };
}

function positiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | null): boolean | undefined {
  return value === "true" || value === "1" ? true : undefined;
}

function splitValues(value: string | null): string[] {
  return value ? unique(value.split(",").map((item) => item.trim()).filter(Boolean)) : [];
}

function clean(value: string | null): string | undefined {
  return value?.trim() || undefined;
}

function isTaskStatus(value: string): value is TaskStatus {
  return STATUS_VALUES.has(value as TaskStatus);
}

function setWhenPresent(params: URLSearchParams, key: string, value?: string) {
  if (value) params.set(key, value);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
