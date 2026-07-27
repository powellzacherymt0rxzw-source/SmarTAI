import { AlertCircle, ChevronRight, RotateCcw, Search } from "lucide-react";
import { useDeferredValue, useMemo } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useTask } from "@/api/hooks/tasks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";
import { cn } from "@/lib/cn";
import {
  answerMap,
  buildSubmissionQuestions,
  getAnswerState,
  getSubmissionReviewStats,
  selectSubmissionReview,
  studentNeedsAttention,
  type SubmissionAnswerState,
  type SubmissionQuestion,
  type SubmissionReviewFilter,
  type SubmissionReviewSelection,
  type SubmissionReviewSort,
} from "@/lib/submissionReview";
import { getTaskDestination } from "@/lib/taskFlow";
import type { StudentAnswerInfo, StudentSubmission } from "@/types";

const EXPLANATION_KEYS: Record<SubmissionReviewSelection["explanation"], MessageKey> = {
  all: "submissionReviewFilterAllHint",
  student: "submissionReviewFilterStudentHint",
  question: "submissionReviewFilterQuestionHint",
  review: "submissionReviewFilterReviewHint",
  missing: "submissionReviewFilterMissingHint",
  identity: "submissionReviewFilterIdentityHint",
  no_match: "submissionReviewFilterNoMatchHint",
};

export function SubmissionReviewOverviewPage() {
  const { taskId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { locale, t } = useI18n();
  const taskQuery = useTask(taskId);
  const query = searchParams.get("q") ?? "";
  const deferredQuery = useDeferredValue(query);
  const filter = normalizeFilter(searchParams.get("status"));
  const sort = normalizeSort(searchParams.get("sort"));

  const students = useMemo(
    () => Object.values(taskQuery.data?.student_data ?? {}),
    [taskQuery.data?.student_data],
  );
  const questions = useMemo(
    () => buildSubmissionQuestions(Object.values(taskQuery.data?.problem_data ?? {}), students),
    [students, taskQuery.data?.problem_data],
  );
  const stats = useMemo(() => getSubmissionReviewStats(students, questions), [questions, students]);
  const selection = useMemo(
    () => selectSubmissionReview(students, questions, deferredQuery, filter, sort),
    [deferredQuery, filter, questions, sort, students],
  );

  if (taskQuery.isSuccess && taskId) {
    const { status } = taskQuery.data;
    if (status !== "submissions_ready") {
      return <Navigate replace to={getTaskDestination(taskQuery.data)} />;
    }
  }

  function setParam(key: string, value: string, defaultValue: string) {
    const next = new URLSearchParams(searchParams);
    if (!value || value === defaultValue) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  const firstAttentionStudent = selection.students.find((student) => studentNeedsAttention(student, selection.questions))
    ?? selection.students[0];
  const firstAttentionQuestion = firstAttentionStudent
    ? firstReviewQuestion(firstAttentionStudent, selection.questions)
    : null;

  return (
    <div className="w-full max-w-[1300px]">
      <h1 className="min-h-9 text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
        {t("submissionReviewTitle")}
      </h1>
      <NewTaskStepper currentStep={4} />

      <section className="mt-[22px] min-w-0" aria-labelledby="submission-review-matrix">
        <h2 id="submission-review-matrix" className="sr-only">{t("submissionReviewMatrixLabel")}</h2>

        <dl className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
          <ReviewMetric
            label={t("submissionReviewMetricIdentity")}
            value={formatPercent(stats.identityMatched, stats.students)}
            detail={`${stats.identityMatched}/${stats.students}`}
            tone={stats.identityAnomalies > 0 ? "warning" : "accent"}
          />
          <ReviewMetric
            label={t("submissionReviewMetricCoverage")}
            value={formatPercent(stats.answeredCells, stats.expectedCells)}
            detail={`${stats.answeredCells}/${stats.expectedCells}`}
          />
          <ReviewMetric
            label={t("submissionReviewMetricReview")}
            value={String(stats.reviewCells)}
            detail={t("submissionReviewMetricCells")}
            tone={stats.reviewCells > 0 ? "danger" : "accent"}
          />
          <ReviewMetric
            label={t("submissionReviewMetricIdentityIssues")}
            value={String(stats.identityAnomalies)}
            detail={t("submissionReviewMetricStudents")}
            tone={stats.identityAnomalies > 0 ? "warning" : "neutral"}
          />
        </dl>

        <div className="mt-6 min-w-0 rounded-[10px] border bg-card p-2.5 sm:flex sm:min-h-[52px] sm:items-center sm:gap-2.5 sm:p-1.5">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">{t("submissionReviewSearchLabel")}</span>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(event) => setParam("q", event.target.value, "")}
              placeholder={t("submissionReviewSearchPlaceholder")}
              className="h-10 w-full rounded-[7px] border-0 bg-slate-50 pl-10 pr-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20 dark:bg-slate-900/50"
            />
          </label>
          <label className="mt-2 block shrink-0 sm:mt-0 sm:w-[170px]">
            <span className="sr-only">{t("submissionReviewStatusLabel")}</span>
            <select
              value={filter}
              onChange={(event) => setParam("status", event.target.value, "all")}
              className="h-10 w-full rounded-[7px] border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              <option value="all">{t("submissionReviewStatusAll")}</option>
              <option value="review">{t("submissionReviewStatusReview")}</option>
              <option value="missing">{t("submissionReviewStatusMissing")}</option>
              <option value="identity">{t("submissionReviewStatusIdentity")}</option>
            </select>
          </label>
          <label className="mt-2 block shrink-0 sm:mt-0 sm:w-[160px]">
            <span className="sr-only">{t("submissionReviewSortLabel")}</span>
            <select
              value={sort}
              onChange={(event) => setParam("sort", event.target.value, "student_id")}
              className="h-10 w-full rounded-[7px] border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
            >
              <option value="student_id">{t("submissionReviewSortId")}</option>
              <option value="student_name">{t("submissionReviewSortName")}</option>
              <option value="attention">{t("submissionReviewSortAttention")}</option>
            </select>
          </label>
        </div>
        <div className="mt-2 flex min-h-5 items-start justify-between gap-3 px-1">
          <p className="text-[11px] leading-5 text-muted-foreground">
            {t(EXPLANATION_KEYS[selection.explanation])}
            {selection.confidenceAlias ? ` ${t("submissionReviewConfidenceAliasHint")}` : ""}
          </p>
          {query || filter !== "all" || sort !== "student_id" ? (
            <button
              type="button"
              onClick={() => setSearchParams({}, { replace: true })}
              className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary outline-none hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RotateCcw aria-hidden="true" className="h-3 w-3" />
              {t("submissionReviewClearFilters")}
            </button>
          ) : null}
        </div>

        <div className="mt-4 min-w-0 overflow-hidden rounded-[10px] border bg-card">
          {taskQuery.isLoading ? (
            <MatrixState title={t("submissionReviewLoading")} busy />
          ) : taskQuery.isError ? (
            <MatrixState
              title={t("submissionReviewLoadError")}
              action={t("submissionReviewRetry")}
              onAction={() => void taskQuery.refetch()}
            />
          ) : !taskId ? (
            <MatrixState title={t("submissionReviewTaskMissing")} />
          ) : students.length === 0 || questions.length === 0 ? (
            <MatrixState
              title={t("submissionReviewEmptyTitle")}
              description={t("submissionReviewEmptyDescription")}
              href={`/tasks/${taskId}/submissions/upload`}
              action={t("submissionReviewUploadAgain")}
            />
          ) : (
            <SubmissionMatrix
              students={selection.students}
              questions={selection.questions}
              taskId={taskId}
              returnSearch={searchParams.toString()}
              t={t}
            />
          )}

          {!taskQuery.isLoading && !taskQuery.isError && taskId && students.length > 0 && questions.length > 0 ? (
            <footer className="flex min-h-[58px] flex-col gap-2 border-t px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between xl:px-5">
              <p className="text-xs text-muted-foreground">
                {t("submissionReviewShowingPrefix")}{selection.students.length}
                {t("submissionReviewShowingMiddle")}{students.length}
                {t("submissionReviewShowingStudentsSuffix")} · {selection.questions.length}/{questions.length}
                {t("submissionReviewShowingQuestionsSuffix")}
              </p>
              <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
                {firstAttentionStudent && firstAttentionQuestion ? (
                  <Link
                    to={studentReviewPath(taskId, firstAttentionStudent.stu_id, firstAttentionQuestion.id, searchParams.toString())}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[7px] border bg-card px-4 text-sm font-semibold text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
                  >
                    {t("submissionReviewOpenStudent")}
                  </Link>
                ) : null}
                <Link
                  to={`/tasks/${taskId}/grading/preflight`}
                  className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-[7px] bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:w-auto"
                >
                  {locale === "en-US" ? "Pre-Grading Confirmation" : "批改前确认"}
                  <ChevronRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </div>
            </footer>
          ) : null}
        </div>
      </section>
    </div>
  );
}


function SubmissionMatrix({
  students,
  questions,
  taskId,
  returnSearch,
  t,
}: {
  students: StudentSubmission[];
  questions: SubmissionQuestion[];
  taskId: string;
  returnSearch: string;
  t: (key: MessageKey) => string;
}) {
  if (students.length === 0 || questions.length === 0) {
    return (
      <MatrixState
        title={t("submissionReviewNoMatches")}
        description={t("submissionReviewNoMatchesDescription")}
      />
    );
  }

  return (
    <div className="max-h-[calc(100vh-540px)] min-h-[250px] w-full overflow-auto overscroll-contain">
      <table
        className="w-full border-collapse text-left text-[13px]"
        style={{ minWidth: `${Math.max(1020, 360 + questions.length * 112)}px` }}
      >
        <thead className="sticky top-0 z-20 bg-slate-100/95 text-[12px] font-semibold text-muted-foreground backdrop-blur-sm dark:bg-slate-800/95">
          <tr className="h-[42px] border-b">
            <th className="sticky left-0 z-30 w-[150px] bg-slate-100/95 px-5 dark:bg-slate-800/95">
              {t("submissionReviewColumnId")}
            </th>
            <th className="sticky left-[150px] z-30 w-[150px] bg-slate-100/95 px-3 dark:bg-slate-800/95">
              {t("submissionReviewColumnName")}
            </th>
            {questions.map((question) => (
              <th key={question.id} className="w-[112px] px-3 text-center" title={question.type || question.label}>
                {question.label}
              </th>
            ))}
            <th className="w-[90px] px-5 text-right">{t("submissionReviewColumnAction")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {students.map((student) => {
            const answers = answerMap(student);
            const entryQuestion = firstReviewQuestion(student, questions);
            const entryHref = entryQuestion
              ? studentReviewPath(taskId, student.stu_id, entryQuestion.id, returnSearch)
              : studentPath(taskId, student.stu_id);
            return (
              <tr key={student.stu_id} className="h-[52px] bg-card transition-colors hover:bg-muted/25">
                <td className="sticky left-0 z-10 bg-card px-5 font-semibold text-foreground">
                  <Link
                    to={entryHref}
                    className="inline-flex max-w-[130px] items-center gap-2 truncate outline-none hover:text-primary focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
                    title={student.stu_id}
                  >
                    {student.identity_status === "needs_review" ? (
                      <span className="h-2 w-2 shrink-0 rounded-full bg-amber-500" aria-label={t("submissionReviewIdentityNeedsReview")} />
                    ) : null}
                    <span className="truncate">{student.stu_id}</span>
                  </Link>
                </td>
                <td className="sticky left-[150px] z-10 max-w-[150px] truncate bg-card px-3 text-muted-foreground" title={student.stu_name || student.stu_id}>
                  {student.stu_name || student.stu_id}
                </td>
                {questions.map((question) => (
                  <td key={question.id} className="px-3 text-center">
                    <AnswerStatusLink
                      answer={answers.get(question.id)}
                      to={studentReviewPath(taskId, student.stu_id, question.id, returnSearch)}
                      t={t}
                    />
                  </td>
                ))}
                <td className="px-5 text-right">
                  <Link
                    to={entryHref}
                    className="text-xs font-semibold text-primary outline-none hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("submissionReviewOpen")}
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function AnswerStatusLink({
  answer,
  to,
  t,
}: {
  answer?: StudentAnswerInfo;
  to: string;
  t: (key: MessageKey) => string;
}) {
  const state = getAnswerState(answer);
  const labels: Record<SubmissionAnswerState, MessageKey> = {
    recognized: "submissionReviewCellRecognized",
    flagged: "submissionReviewCellFlagged",
    empty: "submissionReviewCellEmpty",
    missing: "submissionReviewCellMissing",
  };
  const title = answer?.flag?.length ? answer.flag.join(" · ") : t(labels[state]);

  return (
    <Link
      to={to}
      title={title}
      aria-label={title}
      className={cn(
        "inline-flex h-7 min-w-[82px] items-center justify-center rounded-full px-3 text-[11px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
        state === "recognized" && "bg-emerald-100 text-emerald-700 hover:bg-emerald-200 dark:bg-emerald-950/70 dark:text-emerald-200",
        state === "flagged" && "bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-950/70 dark:text-amber-200",
        (state === "empty" || state === "missing") && "bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-950/60 dark:text-red-200",
      )}
    >
      {t(labels[state])}
    </Link>
  );
}

function ReviewMetric({
  label,
  value,
  detail,
  tone = "primary",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "primary" | "accent" | "warning" | "danger" | "neutral";
}) {
  return (
    <div className="min-h-[90px] rounded-[10px] border bg-card px-4 py-3.5 sm:px-5">
      <dt className="text-[12px] font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "text-[24px] font-bold leading-7 tracking-[-0.02em]",
            tone === "primary" && "text-primary",
            tone === "accent" && "text-teal-600 dark:text-teal-300",
            tone === "warning" && "text-amber-600 dark:text-amber-300",
            tone === "danger" && "text-red-500 dark:text-red-300",
            tone === "neutral" && "text-foreground",
          )}
        >
          {value}
        </span>
        <span className="text-[11px] text-muted-foreground">{detail}</span>
      </dd>
    </div>
  );
}

function MatrixState({
  title,
  description,
  action,
  onAction,
  href,
  busy = false,
}: {
  title: string;
  description?: string;
  action?: string;
  onAction?: () => void;
  href?: string;
  busy?: boolean;
}) {
  const actionClass = "mt-4 inline-flex h-9 items-center justify-center rounded-[7px] border bg-card px-4 text-sm font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="flex min-h-[300px] items-center justify-center px-6 py-10 text-center" role={busy ? "status" : undefined}>
      <div className="max-w-md">
        <AlertCircle aria-hidden="true" className={cn("mx-auto h-6 w-6 text-muted-foreground", busy && "animate-pulse text-primary")} />
        <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
        {description ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p> : null}
        {action && onAction ? <button type="button" className={actionClass} onClick={onAction}>{action}</button> : null}
        {action && href ? <Link className={actionClass} to={href}>{action}</Link> : null}
      </div>
    </div>
  );
}

function formatPercent(ready: number, total: number) {
  if (total <= 0) return "—";
  return `${Math.round((ready / total) * 100)}%`;
}

function normalizeFilter(value: string | null): SubmissionReviewFilter {
  return value === "review" || value === "missing" || value === "identity" ? value : "all";
}

function normalizeSort(value: string | null): SubmissionReviewSort {
  return value === "student_name" || value === "attention" ? value : "student_id";
}

function studentPath(taskId: string, studentId: string) {
  return `/tasks/${encodeURIComponent(taskId)}/students/${encodeURIComponent(studentId)}`;
}

function studentReviewPath(taskId: string, studentId: string, questionId: string, returnSearch: string) {
  const params = new URLSearchParams({ question: questionId });
  if (returnSearch) params.set("returnParams", returnSearch);
  return `${studentPath(taskId, studentId)}?${params.toString()}`;
}

function firstReviewQuestion(student: StudentSubmission, questions: SubmissionQuestion[]) {
  const answers = answerMap(student);
  return questions.find((question) => getAnswerState(answers.get(question.id)) !== "recognized")
    ?? questions[0]
    ?? null;
}
