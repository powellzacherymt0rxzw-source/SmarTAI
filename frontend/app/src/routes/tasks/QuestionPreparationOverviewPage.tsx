import { ChevronRight, LoaderCircle, Search, Sparkles } from "lucide-react";
import { useDeferredValue, useEffect, useMemo } from "react";
import { Link, Navigate, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useTask } from "@/api/hooks/tasks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";
import { cn } from "@/lib/cn";
import {
  buildQuestionPreparationRows,
  selectQuestionPreparationRows,
  stripMissingFirstRule,
  type QuestionPreparationRow,
  type QuestionPreparationRule,
  type QuestionPreparationSort,
} from "@/lib/questionPreparation";
import type { AICompletionTarget, ProblemInfo } from "@/types";

const RULE_LABEL_KEYS: Record<QuestionPreparationRule, MessageKey> = {
  missing_answer: "questionOverviewRuleMissingAnswer",
  missing_rubric: "questionOverviewRuleMissingRubric",
  missing_code: "questionOverviewRuleMissingCode",
  programming: "questionOverviewRuleProgramming",
  proof: "questionOverviewRuleProof",
  keyword: "questionOverviewRuleKeyword",
  missing_first: "questionOverviewRuleMissingFirst",
};

export function QuestionPreparationOverviewPage() {
  const { taskId } = useParams();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useI18n();
  const taskQuery = useTask(taskId, { pollAICompletion: true });
  const query = searchParams.get("q") ?? "";
  const deferredQuery = useDeferredValue(query);
  const sort = normalizeSort(searchParams.get("sort"));

  const rows = useMemo(
    () => buildQuestionPreparationRows(Object.values(taskQuery.data?.problem_data ?? {})),
    [taskQuery.data?.problem_data],
  );
  const selection = useMemo(
    () => selectQuestionPreparationRows(rows, deferredQuery, sort),
    [deferredQuery, rows, sort],
  );
  const coverage = useMemo(() => getCoverage(rows), [rows]);

  useEffect(() => {
    if (!selection.rules.includes("missing_first") || sort === "missing") return;
    const next = new URLSearchParams(searchParams);
    next.set("sort", "missing");
    setSearchParams(next, { replace: true });
  }, [searchParams, selection.rules, setSearchParams, sort]);

  if (taskQuery.isSuccess && taskQuery.data.status === "draft") {
    return <Navigate replace to={`/tasks/${taskId}/upload/problems`} />;
  }

  if (taskQuery.isSuccess && taskQuery.data.status === "extracting_problems") {
    return <Navigate replace to={`/tasks/${taskId}/problems/progress`} />;
  }

  function updateQuery(nextQuery: string) {
    const next = new URLSearchParams(searchParams);
    if (nextQuery.trim()) next.set("q", nextQuery);
    else next.delete("q");
    setSearchParams(next, { replace: true });
  }

  function updateSort(nextSort: QuestionPreparationSort) {
    const next = new URLSearchParams(searchParams);
    if (nextSort === "number") next.delete("sort");
    else next.set("sort", nextSort);

    if (nextSort !== "missing" && selection.rules.includes("missing_first")) {
      const nextQuery = stripMissingFirstRule(next.get("q") ?? "");
      if (nextQuery) next.set("q", nextQuery);
      else next.delete("q");
    }
    setSearchParams(next, { replace: true });
  }

  return (
    <div className="w-full max-w-[1300px]">
      <h1 className="min-h-9 text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
        {t("questionOverviewTitle")}
      </h1>
      <NewTaskStepper currentStep={1} />

      <section className="mt-[22px] min-w-0" aria-labelledby="question-preparation-matrix">
        <h2 id="question-preparation-matrix" className="sr-only">{t("questionOverviewTitle")}</h2>

        <dl className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <CoverageMetric label={t("questionOverviewCoverageReview")} ready={coverage.reviewed} total={coverage.total} />
          <CoverageMetric label={t("questionOverviewCoverageRubric")} ready={coverage.rubrics} total={coverage.total} />
          <CoverageMetric label={t("questionOverviewCoverageAnswer")} ready={coverage.answers} total={coverage.total} />
          <CoverageMetric
            label={t("questionOverviewCoverageTests")}
            ready={coverage.tests}
            total={coverage.programming}
            emptyLabel={t("questionOverviewNoProgramming")}
          />
        </dl>

        <div className="mt-4 min-w-0">
          <label className="relative min-w-0">
            <span className="sr-only">{t("questionOverviewSearchLabel")}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-[16px] h-4 w-4 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => updateQuery(event.target.value)}
              placeholder={t("questionOverviewSearchPlaceholder")}
              className="h-12 w-full min-w-0 rounded-[10px] border bg-card pl-11 pr-4 text-[13px] leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
            />
          </label>
          <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="min-w-0 truncate px-1 text-[11px] leading-4 text-muted-foreground" title={getRuleDescription(selection.rules, t)}>
              {getRuleDescription(selection.rules, t)}
            </p>
            <label className="w-full min-w-0 shrink-0 sm:w-[160px]">
              <span className="sr-only">{t("questionOverviewSortLabel")}</span>
              <select
                value={selection.effectiveSort}
                onChange={(event) => updateSort(event.target.value as QuestionPreparationSort)}
                className="h-9 w-full min-w-0 rounded-[8px] border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              >
                <option value="number">{t("questionOverviewSortNumber")}</option>
                <option value="missing">{t("questionOverviewSortMissing")}</option>
                <option value="type">{t("questionOverviewSortType")}</option>
              </select>
            </label>
          </div>
        </div>

        <div className="mt-4 min-w-0 overflow-hidden rounded-[10px] border bg-card">
          {taskQuery.isLoading ? (
            <QuestionTableLoading />
          ) : taskQuery.isError ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center">
              <p className="text-sm font-semibold text-foreground">{t("questionOverviewLoadError")}</p>
              <button
                type="button"
                className="mt-3 h-9 rounded-[7px] border bg-card px-4 text-sm font-semibold text-foreground hover:bg-muted"
                onClick={() => void taskQuery.refetch()}
              >
                {t("questionOverviewRetry")}
              </button>
            </div>
          ) : !taskId ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center">
              <p className="text-sm font-semibold text-foreground">{t("questionOverviewTaskMissing")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("questionOverviewTaskMissingDescription")}</p>
              <Link className="mt-3 text-sm font-semibold text-primary hover:underline" to="/">
                {t("questionOverviewBackWorkspace")}
              </Link>
            </div>
          ) : (
            <QuestionMatrix
              rows={selection.rows}
              taskId={taskId}
              returnPath={buildReturnPath(location.pathname, query, selection.effectiveSort)}
              t={t}
            />
          )}

          {!taskQuery.isLoading && !taskQuery.isError && taskId ? (
            <footer className="flex min-h-[58px] flex-col gap-2 border-t px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between xl:px-5">
              <p className="text-xs text-muted-foreground">
                {t("questionOverviewShowingPrefix")}{selection.rows.length}{t("questionOverviewShowingSeparator")}{rows.length}{t("questionOverviewShowingSuffix")}
              </p>
              {taskQuery.data?.ai_completion_job_id ? (
                <div className="flex min-w-0 flex-col gap-2 rounded-[7px] border border-blue-100 bg-blue-50/60 px-3 py-2 sm:flex-row sm:items-center dark:border-blue-900 dark:bg-blue-950/20">
                  <span className="inline-flex min-w-0 items-center gap-2 text-xs font-semibold text-primary">
                    <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    <span className="truncate">{t("questionOverviewAIRunning")}</span>
                  </span>
                  <Link
                    to={`/tasks/${taskId}/questions/ai-complete/progress/${encodeURIComponent(taskQuery.data.ai_completion_job_id)}`}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-[6px] bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("questionOverviewReturnAIProgress")}
                  </Link>
                </div>
              ) : taskQuery.data?.ai_completion_error ? (
                <div className="flex min-w-0 flex-col gap-2 rounded-[7px] border border-red-100 bg-red-50/60 px-3 py-2 sm:flex-row sm:items-center dark:border-red-900 dark:bg-red-950/20">
                  <span className="min-w-0 truncate text-xs font-semibold text-danger">{t("questionOverviewAIFailed")}</span>
                  <Link
                    to={`/tasks/${taskId}/questions/ai-complete`}
                    className="inline-flex h-8 shrink-0 items-center justify-center rounded-[6px] bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("questionOverviewRetryAI")}
                  </Link>
                </div>
              ) : (
                <div className="grid gap-2 sm:flex sm:items-center">
                  <Link
                    to={`/tasks/${taskId}/questions/import`}
                    className="inline-flex h-9 w-full items-center justify-center rounded-[7px] border bg-card px-4 text-sm font-semibold text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
                  >
                    {t("questionOverviewBulkImport")}
                  </Link>
                  <Link
                    to={`/tasks/${taskId}/questions/ai-complete`}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[7px] bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
                  >
                    <Sparkles aria-hidden="true" className="h-4 w-4" />
                    {t("questionOverviewAIComplete")}
                  </Link>
                  <Link
                    to={`/tasks/${taskId}/upload/submissions`}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[7px] border bg-card px-4 text-sm font-semibold text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
                  >
                    {t("questionOverviewContinue")}
                    <ChevronRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </div>
              )}
            </footer>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function QuestionMatrix({
  rows,
  taskId,
  returnPath,
  t,
}: {
  rows: QuestionPreparationRow[];
  taskId: string;
  returnPath: string;
  t: (key: MessageKey) => string;
}) {
  return (
    <div className="max-h-[calc(100vh-515px)] min-h-[280px] w-full overflow-auto overscroll-contain">
      <table className="w-full min-w-[980px] border-collapse text-left text-[13px]">
        <thead className="sticky top-0 z-10 bg-muted/95 text-[12px] font-semibold text-muted-foreground backdrop-blur-sm">
          <tr className="border-b">
            <th className="w-[110px] px-5 py-3">{t("questionOverviewColumnNumber")}</th>
            <th className="w-[170px] px-3 py-3">{t("questionOverviewColumnReview")}</th>
            <th className="w-[150px] px-3 py-3">{t("questionOverviewColumnType")}</th>
            <th className="w-[170px] px-3 py-3">{t("questionOverviewColumnRubric")}</th>
            <th className="w-[170px] px-3 py-3">{t("questionOverviewColumnAnswer")}</th>
            <th className="w-[170px] px-3 py-3">{t("questionOverviewColumnTests")}</th>
            <th className="w-[100px] px-5 py-3 text-right">{t("questionOverviewColumnAction")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((row) => {
            const basePath = `/tasks/${encodeURIComponent(taskId)}/questions/${encodeURIComponent(row.problem.q_id)}`;
            const rubricStatus = slotPresentation(row.problem, "criterion", row.hasRubric, t);
            const answerStatus = slotPresentation(row.problem, "reference_answer", row.hasAnswer, t);
            const programmingMaterials = programmingMaterialPresentation(row, t);
            return (
              <tr key={row.problem.q_id} className="h-[54px] bg-card transition-colors hover:bg-muted/30">
                <td className="px-5 py-2.5 font-semibold text-foreground">{row.label}</td>
                <td className="px-3 py-2.5">
                  <StatusLink
                    to={withReturnContext(`${basePath}/content`, returnPath)}
                    tone={row.reviewStatus === "confirmed" ? "ready" : "review"}
                    label={t(
                      row.reviewStatus === "confirmed"
                        ? "questionOverviewStatusConfirmed"
                        : row.reviewStatus === "edited"
                          ? "questionOverviewStatusEdited"
                          : "questionOverviewStatusNeedsReview",
                    )}
                  />
                </td>
                <td className="max-w-[180px] truncate px-3 py-2.5 text-muted-foreground" title={row.type || t("questionOverviewUnknownType")}>
                  {row.type || t("questionOverviewUnknownType")}
                </td>
                <td className="px-3 py-2.5">
                  <StatusLink
                    to={withReturnContext(`${basePath}/rubric`, returnPath)}
                    tone={rubricStatus.tone}
                    label={rubricStatus.label}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <StatusLink
                    to={withReturnContext(`${basePath}/answer`, returnPath)}
                    tone={answerStatus.tone}
                    label={answerStatus.label}
                  />
                </td>
                <td className="px-3 py-2.5">
                  {row.isProgramming ? (
                    <StatusLink
                      to={withReturnContext(`${basePath}/${programmingMaterials.section}`, returnPath)}
                      tone={programmingMaterials.tone}
                      label={programmingMaterials.label}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">{t("questionOverviewStatusNotApplicable")}</span>
                  )}
                </td>
                <td className="px-5 py-2.5 text-right">
                  <Link
                    to={withReturnContext(`${basePath}/content`, returnPath)}
                    className="inline-flex h-8 items-center rounded-[6px] px-2.5 text-xs font-semibold text-primary outline-none hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("questionOverviewActionReview")}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 ? (
        <div className="flex min-h-[235px] items-center justify-center border-t px-5 text-center text-sm text-muted-foreground">
          {t("questionOverviewNoMatches")}
        </div>
      ) : null}
    </div>
  );
}

function StatusLink({
  to,
  tone,
  label,
}: {
  to: string;
  tone: "ready" | "missing" | "review" | "generated";
  label: string;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex min-h-7 min-w-[104px] items-center rounded-full px-3 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
        tone === "ready" && "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300",
        tone === "missing" && "bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/50 dark:text-red-300",
        tone === "review" && "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300",
        tone === "generated" && "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/50 dark:text-amber-300",
      )}
    >
      {label}
    </Link>
  );
}

function slotPresentation(
  problem: ProblemInfo,
  target: AICompletionTarget,
  hasValue: boolean,
  t: (key: MessageKey) => string,
  readyLabel = t("questionOverviewStatusReady"),
): SlotPresentation {
  const aiProvenance = problem.ai_completion_provenance?.[target];
  if (aiProvenance?.review_status === "pending") {
    return {
      tone: "generated",
      label: t("questionOverviewStatusAIPending"),
      source: "ai",
      reviewStatus: "pending",
    };
  }
  if (aiProvenance?.review_status === "edited") {
    return {
      tone: "generated",
      label: t("questionOverviewStatusAIEdited"),
      source: "ai",
      reviewStatus: "edited",
    };
  }
  if (!aiProvenance) {
    const materialProvenance = target === "solution_code"
      ? undefined
      : problem.material_provenance?.[target];
    if (materialProvenance?.review_status === "pending") {
      return {
        tone: "generated",
        label: t("questionOverviewStatusImportPending"),
        source: "material",
        reviewStatus: "pending",
      };
    }
    if (materialProvenance?.review_status === "edited") {
      return {
        tone: "generated",
        label: t("questionOverviewStatusImportEdited"),
        source: "material",
        reviewStatus: "edited",
      };
    }
  }
  return hasValue
    ? { tone: "ready", label: readyLabel, source: "stored" }
    : { tone: "missing", label: t("questionOverviewStatusMissing"), source: "stored" };
}

type SlotPresentation = {
  tone: "ready" | "missing" | "generated";
  label: string;
  source: "ai" | "material" | "stored";
  reviewStatus?: "pending" | "edited";
};

function programmingMaterialPresentation(
  row: QuestionPreparationRow,
  t: (key: MessageKey) => string,
): { section: "code" | "tests"; tone: "ready" | "missing" | "generated"; label: string } {
  const codeStatus = slotPresentation(row.problem, "solution_code", row.hasCode, t);
  const testsStatus = slotPresentation(row.problem, "test_cases", row.hasTests, t);
  if (codeStatus.tone === "generated") {
    return {
      section: "code",
      ...codeStatus,
      label: codeStatus.source === "ai" && codeStatus.reviewStatus === "pending"
        ? t("questionOverviewStatusCodeAIPending")
        : codeStatus.label,
    };
  }
  if (testsStatus.tone === "generated") {
    return {
      section: "tests",
      ...testsStatus,
      label: testsStatus.source === "ai" && testsStatus.reviewStatus === "pending"
        ? t("questionOverviewStatusTestsAIPending")
        : testsStatus.label,
    };
  }
  if (!row.hasCode) return { section: "code", ...codeStatus, label: t("questionOverviewStatusCodeMissing") };
  if (!row.hasTests) return { section: "tests", ...testsStatus, label: t("questionOverviewStatusTestsMissing") };
  return {
    section: "tests",
    tone: "ready",
    label: `${t("questionOverviewStatusReady")} · ${row.problem.test_cases?.length ?? 0}${t("questionOverviewTestsCountSuffix")}`,
  };
}

function CoverageMetric({
  label,
  ready,
  total,
  emptyLabel,
}: {
  label: string;
  ready: number;
  total: number;
  emptyLabel?: string;
}) {
  const percentage = total > 0 ? Math.round((ready / total) * 100) : null;
  const tone = percentage === null
    ? "muted"
    : ready === total
      ? "ready"
      : percentage < 50
        ? "attention"
        : "primary";
  return (
    <div className="flex min-h-[104px] min-w-0 flex-col justify-center rounded-[10px] border bg-card px-5 py-4 sm:min-h-[112px] sm:px-6">
      <dt className="order-2 mt-2 truncate text-[13px] font-medium leading-5 text-muted-foreground sm:text-sm" title={label}>{label}</dt>
      <dd className="order-1 flex min-w-0 items-baseline gap-2">
        <span
          className={cn(
            "text-[28px] font-bold leading-8 tracking-[-0.02em] sm:text-[30px] sm:leading-9",
            tone === "primary" && "text-primary",
            tone === "ready" && "text-emerald-600 dark:text-emerald-400",
            tone === "attention" && "text-amber-600 dark:text-amber-400",
            tone === "muted" && "text-muted-foreground",
          )}
        >
          {percentage === null ? "—" : `${percentage}%`}
        </span>
        <span className="min-w-0 truncate text-xs font-medium text-muted-foreground">
          {percentage === null ? emptyLabel : `${ready}/${total}`}
        </span>
      </dd>
    </div>
  );
}

function QuestionTableLoading() {
  return (
    <div className="min-h-[338px] animate-pulse" aria-busy="true">
      <div className="h-10 border-b bg-muted/70" />
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="grid h-[54px] grid-cols-6 items-center gap-5 border-b px-5">
          {Array.from({ length: 6 }, (_, column) => (
            <span key={column} className="h-3 rounded bg-muted" />
          ))}
        </div>
      ))}
    </div>
  );
}

function getCoverage(rows: QuestionPreparationRow[]) {
  const programmingRows = rows.filter((row) => row.isProgramming);
  return {
    total: rows.length,
    reviewed: rows.filter((row) => row.reviewStatus === "confirmed").length,
    rubrics: rows.filter((row) => row.hasRubric).length,
    answers: rows.filter((row) => row.hasAnswer).length,
    programming: programmingRows.length,
    tests: programmingRows.filter((row) => row.hasTests).length,
  };
}

function getRuleDescription(rules: QuestionPreparationRule[], t: (key: MessageKey) => string): string {
  if (rules.length === 0) return t("questionOverviewDeterministicHint");
  return `${t("questionOverviewRulePrefix")}${rules.map((rule) => t(RULE_LABEL_KEYS[rule])).join(" · ")} · ${t("questionOverviewDeterministicHint")}`;
}

function normalizeSort(value: string | null): QuestionPreparationSort {
  return value === "missing" || value === "type" ? value : "number";
}

function buildReturnPath(pathname: string, query: string, sort: QuestionPreparationSort): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query);
  if (sort !== "number") params.set("sort", sort);
  const serialized = params.toString();
  return serialized ? `${pathname}?${serialized}` : pathname;
}

function withReturnContext(pathname: string, returnPath: string): string {
  const params = new URLSearchParams({ from: returnPath });
  return `${pathname}?${params.toString()}`;
}
