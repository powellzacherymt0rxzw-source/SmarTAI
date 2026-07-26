import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  LoaderCircle,
  Pencil,
  RotateCcw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { normalizeAPIError } from "@/api/client";
import { useTask, useUpdateStudentIdentity } from "@/api/hooks/tasks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import { Button } from "@/components/ui/Button";
import { MarkdownMath } from "@/components/ui/MarkdownMath";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";
import { cn } from "@/lib/cn";
import {
  answerMap,
  buildSubmissionQuestions,
  getAnswerState,
  type SubmissionAnswerState,
  type SubmissionQuestion,
} from "@/lib/submissionReview";
import { getTaskDestination } from "@/lib/taskFlow";
import type { StudentAnswerInfo, StudentSubmission } from "@/types";

const STATUS_KEYS: Record<SubmissionAnswerState, MessageKey> = {
  recognized: "studentSubmissionStatusRecognized",
  flagged: "studentSubmissionStatusFlagged",
  empty: "studentSubmissionStatusEmpty",
  missing: "studentSubmissionStatusMissing",
};

/** S04: one student's identity and all recognized answers, without S05 editing. */
export function StudentSubmissionOverviewPage() {
  const { taskId, studentId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const taskQuery = useTask(taskId);
  const identityMutation = useUpdateStudentIdentity();
  const [identityOpen, setIdentityOpen] = useState(false);
  const [identityId, setIdentityId] = useState("");
  const [identityName, setIdentityName] = useState("");
  const [identityError, setIdentityError] = useState<string | null>(null);
  const filterQuery = searchParams.get("filter") ?? "";
  const selectedQuestionId = searchParams.get("question") ?? "";

  const students = useMemo(
    () => Object.values(taskQuery.data?.student_data ?? {}).sort(compareStudents),
    [taskQuery.data?.student_data],
  );
  const student = useMemo(
    () => students.find((candidate) => candidate.stu_id === studentId),
    [studentId, students],
  );
  const questions = useMemo(
    () => buildSubmissionQuestions(Object.values(taskQuery.data?.problem_data ?? {}), students),
    [students, taskQuery.data?.problem_data],
  );
  const answers = useMemo(() => student ? answerMap(student) : new Map<string, StudentAnswerInfo>(), [student]);
  const filteredQuestions = useMemo(
    () => questions.filter((question) => matchesQuestionFilter(question, answers.get(question.id), filterQuery)),
    [answers, filterQuery, questions],
  );
  const stats = useMemo(() => getStudentStats(questions, answers), [answers, questions]);
  const currentStudentIndex = student ? students.findIndex((candidate) => candidate.stu_id === student.stu_id) : -1;
  const previousStudent = currentStudentIndex > 0 ? students[currentStudentIndex - 1] : null;
  const nextStudent = currentStudentIndex >= 0 && currentStudentIndex < students.length - 1
    ? students[currentStudentIndex + 1]
    : null;

  useEffect(() => {
    setIdentityOpen(false);
    setIdentityId(student?.stu_id ?? "");
    setIdentityName(student?.stu_name ?? "");
    setIdentityError(null);
  }, [student?.stu_id, student?.stu_name]);

  useEffect(() => {
    if (!selectedQuestionId || !questions.some((question) => question.id === selectedQuestionId)) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(questionDomId(selectedQuestionId))?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [questions, selectedQuestionId]);

  if (taskQuery.isSuccess && taskId && taskQuery.data.status !== "submissions_ready") {
    return <Navigate replace to={getTaskDestination(taskQuery.data)} />;
  }

  function updateFilter(nextValue: string) {
    const next = new URLSearchParams(searchParams);
    if (nextValue.trim()) next.set("filter", nextValue);
    else next.delete("filter");
    setSearchParams(next, { replace: true });
  }

  function updateSelectedQuestion(nextQuestionId: string) {
    const next = new URLSearchParams(searchParams);
    if (nextQuestionId) next.set("question", nextQuestionId);
    else next.delete("question");
    setSearchParams(next, { replace: true });
  }

  function goToStudent(target: StudentSubmission | null) {
    if (!target || !taskId) return;
    navigate({
      pathname: studentPath(taskId, target.stu_id),
      search: searchParams.toString() ? `?${searchParams.toString()}` : "",
    });
  }

  async function saveIdentity() {
    if (!taskId || !student || !taskQuery.data) return;
    const nextId = identityId.trim();
    const nextName = identityName.trim();
    if (!nextId || !nextName) {
      setIdentityError(t("studentSubmissionIdentityRequired"));
      return;
    }
    setIdentityError(null);

    try {
      const result = await identityMutation.mutateAsync({
        taskId,
        currentStudentId: student.stu_id,
        expectedWorkflowRevision: taskQuery.data.workflow_revision,
        studentId: nextId,
        studentName: nextName,
      });
      setIdentityOpen(false);
      toast.success(t("studentSubmissionIdentitySaved"));
      if (result.student.stu_id !== student.stu_id) {
        navigate({
          pathname: studentPath(taskId, result.student.stu_id),
          search: searchParams.toString() ? `?${searchParams.toString()}` : "",
        }, { replace: true });
      }
    } catch (error) {
      setIdentityError(identityErrorMessage(error, t));
    }
  }

  return (
    <div className="w-full max-w-[1300px]">
      <div className="flex min-h-9 items-center justify-between gap-4">
        <h1 className="min-w-0 truncate text-[28px] font-bold leading-9 tracking-[-0.02em] text-foreground sm:text-[30px]">
          {t("studentSubmissionTitle")}
        </h1>
        <Link
          to={taskId ? `/tasks/${encodeURIComponent(taskId)}/submissions` : "/history"}
          className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t("studentSubmissionBackMatrix")}
        </Link>
      </div>
      <NewTaskStepper currentStep={3} />

      {taskQuery.isLoading ? (
        <PageState title={t("studentSubmissionLoading")} busy />
      ) : taskQuery.isError ? (
        <PageState
          title={t("studentSubmissionLoadError")}
          action={t("studentSubmissionRetry")}
          onAction={() => void taskQuery.refetch()}
        />
      ) : !taskId || !studentId ? (
        <PageState title={t("studentSubmissionTaskMissing")} href="/history" action={t("studentSubmissionBackHistory")} />
      ) : !student ? (
        <PageState
          title={t("studentSubmissionNotFound")}
          description={t("studentSubmissionNotFoundDescription")}
          href={`/tasks/${encodeURIComponent(taskId)}/submissions`}
          action={t("studentSubmissionBackMatrix")}
        />
      ) : (
        <section className="mt-[22px] min-w-0" aria-labelledby="student-submission-heading">
          <h2 id="student-submission-heading" className="sr-only">{student.stu_name || student.stu_id}</h2>

          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-5">
            <StudentMetric
              label={t("studentSubmissionMetricIdentity")}
              value={t(student.identity_status === "needs_review" ? "studentSubmissionIdentityReview" : "studentSubmissionIdentityMatched")}
              tone={student.identity_status === "needs_review" ? "warning" : "accent"}
              detail={student.identity_match_method ? t(identityMethodKey(student.identity_match_method)) : "—"}
            />
            <StudentMetric
              label={t("studentSubmissionMetricCoverage")}
              value={formatPercent(stats.answered, stats.total)}
              detail={`${stats.answered}/${stats.total}`}
            />
            <StudentMetric
              label={t("studentSubmissionMetricReview")}
              value={String(stats.review)}
              detail={t("studentSubmissionMetricQuestions")}
              tone={stats.review > 0 ? "danger" : "accent"}
            />
            <StudentMetric
              label={t("studentSubmissionMetricSource")}
              value={student.source_filename ? "1" : "—"}
              detail={student.source_filename ? t("studentSubmissionMetricFile") : t("studentSubmissionMetricUnknown")}
              tone="neutral"
            />
          </dl>

          <div className="mt-6 grid min-h-[52px] grid-cols-2 gap-2 rounded-[10px] border bg-card p-1.5 lg:grid-cols-[150px_minmax(260px,1fr)_150px_210px_auto] lg:items-center">
            <Button
              type="button"
              variant="ghost"
              className="order-1 h-10 justify-start px-3 lg:order-none"
              disabled={!previousStudent}
              onClick={() => goToStudent(previousStudent)}
              aria-label={previousStudent ? `${t("studentSubmissionPreviousStudent")} ${previousStudent.stu_id} ${previousStudent.stu_name}` : t("studentSubmissionNoPrevious")}
            >
              <ArrowLeft aria-hidden="true" className="h-4 w-4" />
              <span className="truncate">{previousStudent?.stu_name || t("studentSubmissionPreviousStudent")}</span>
            </Button>

            <label className="order-3 col-span-2 min-w-0 lg:order-none lg:col-span-1">
              <span className="sr-only">{t("studentSubmissionStudentSelector")}</span>
              <select
                value={student.stu_id}
                onChange={(event) => goToStudent(students.find((candidate) => candidate.stu_id === event.target.value) ?? null)}
                className="h-10 w-full rounded-[7px] border-0 bg-slate-50 px-3 text-[13px] font-semibold text-foreground outline-none focus:ring-2 focus:ring-primary/20 dark:bg-slate-900/50"
              >
                {students.map((candidate) => (
                  <option key={candidate.stu_id} value={candidate.stu_id}>
                    {candidate.stu_id} · {candidate.stu_name || t("studentSubmissionUnknownName")}
                  </option>
                ))}
              </select>
            </label>

            <Button
              type="button"
              variant="ghost"
              className="order-2 h-10 justify-end px-3 lg:order-none"
              disabled={!nextStudent}
              onClick={() => goToStudent(nextStudent)}
              aria-label={nextStudent ? `${t("studentSubmissionNextStudent")} ${nextStudent.stu_id} ${nextStudent.stu_name}` : t("studentSubmissionNoNext")}
            >
              <span className="truncate">{nextStudent?.stu_name || t("studentSubmissionNextStudent")}</span>
              <ArrowRight aria-hidden="true" className="h-4 w-4" />
            </Button>

            <label className="order-4 col-span-2 min-w-0 lg:order-none lg:col-span-1">
              <span className="sr-only">{t("studentSubmissionQuestionSelector")}</span>
              <select
                value={selectedQuestionId}
                onChange={(event) => updateSelectedQuestion(event.target.value)}
                className="h-10 w-full rounded-[7px] border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              >
                <option value="">{t("studentSubmissionAllQuestions")}</option>
                {questions.map((question) => (
                  <option key={question.id} value={question.id}>{question.label} · {question.type || t("studentSubmissionUnknownType")}</option>
                ))}
              </select>
            </label>

            <Button
              type="button"
              variant="secondary"
              className="order-5 col-span-2 h-10 px-4 lg:order-none lg:col-span-1"
              onClick={() => {
                setIdentityOpen((open) => !open);
                setIdentityError(null);
              }}
            >
              {identityOpen ? <X aria-hidden="true" className="h-4 w-4" /> : <Pencil aria-hidden="true" className="h-4 w-4" />}
              {t(identityOpen ? "studentSubmissionCloseIdentity" : "studentSubmissionEditIdentity")}
            </Button>
          </div>

          {identityOpen ? (
            <form
              className="mt-3 rounded-[10px] border border-amber-200 bg-amber-50/45 p-4 dark:border-amber-900 dark:bg-amber-950/15"
              onSubmit={(event) => {
                event.preventDefault();
                void saveIdentity();
              }}
            >
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">{t("studentSubmissionIdentityTitle")}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{t("studentSubmissionIdentityDescription")}</p>
                </div>
                {student.source_filename ? (
                  <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" title={student.source_filename}>
                    <FileText aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                    <span className="max-w-[280px] truncate">{student.source_filename}</span>
                  </span>
                ) : null}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  {t("studentSubmissionStudentId")}
                  <input
                    value={identityId}
                    maxLength={160}
                    onChange={(event) => setIdentityId(event.target.value)}
                    className="h-10 rounded-[7px] border bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                </label>
                <label className="grid gap-1.5 text-xs font-medium text-foreground">
                  {t("studentSubmissionStudentName")}
                  <input
                    value={identityName}
                    maxLength={160}
                    onChange={(event) => setIdentityName(event.target.value)}
                    className="h-10 rounded-[7px] border bg-card px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                  />
                </label>
                <Button type="submit" className="h-10 px-5" disabled={identityMutation.isPending}>
                  {identityMutation.isPending ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}
                  {t(identityMutation.isPending ? "studentSubmissionIdentitySaving" : "studentSubmissionIdentitySave")}
                </Button>
              </div>
              {identityError ? <p className="mt-2 text-xs font-medium text-danger" role="alert">{identityError}</p> : null}
            </form>
          ) : null}

          <div className="mt-4">
            <label className="relative block min-w-0">
              <span className="sr-only">{t("studentSubmissionSearchLabel")}</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={filterQuery}
                onChange={(event) => updateFilter(event.target.value)}
                placeholder={t("studentSubmissionSearchPlaceholder")}
                className="h-12 w-full rounded-[10px] border bg-card pl-11 pr-11 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              {filterQuery ? (
                <button
                  type="button"
                  onClick={() => updateFilter("")}
                  className="absolute right-3 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("studentSubmissionClearFilter")}
                >
                  <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </label>
            <p className="mt-2 px-1 text-[11px] leading-5 text-muted-foreground">
              {filterQuery ? t("studentSubmissionFilterApplied") : t("studentSubmissionFilterHint")}
            </p>
          </div>

          <div className="mt-4 overflow-hidden rounded-[10px] border bg-card">
            <header className="flex min-h-[48px] items-center justify-between gap-3 border-b bg-slate-50 px-4 dark:bg-slate-900/40 sm:px-5">
              <h3 className="text-sm font-semibold text-foreground">{t("studentSubmissionAllAnswersTitle")}</h3>
              <span className="text-xs text-muted-foreground">{filteredQuestions.length}/{questions.length} {t("studentSubmissionQuestionsSuffix")}</span>
            </header>
            {filteredQuestions.length > 0 ? (
              <div className="divide-y">
                {filteredQuestions.map((question) => (
                  <AnswerSection
                    key={question.id}
                    question={question}
                    answer={answers.get(question.id)}
                    selected={question.id === selectedQuestionId}
                    reviewHref={answerReviewPath(taskId, student.stu_id, question.id, filterQuery)}
                    t={t}
                  />
                ))}
              </div>
            ) : (
              <div className="flex min-h-[220px] items-center justify-center px-6 text-center">
                <div>
                  <AlertCircle aria-hidden="true" className="mx-auto h-6 w-6 text-muted-foreground" />
                  <p className="mt-3 text-sm font-semibold text-foreground">{t("studentSubmissionNoQuestionMatches")}</p>
                  <button type="button" className="mt-2 text-sm font-semibold text-primary hover:underline" onClick={() => updateFilter("")}>
                    {t("studentSubmissionClearFilter")}
                  </button>
                </div>
              </div>
            )}
          </div>

          <footer className="mt-5 flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-xs leading-5 text-muted-foreground">{t("studentSubmissionS05Boundary")}</p>
            <Link
              to={`/tasks/${encodeURIComponent(taskId)}/submissions`}
              className="inline-flex h-9 w-full shrink-0 items-center justify-center rounded-[7px] border bg-card px-4 text-sm font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
            >
              {t("studentSubmissionBackMatrix")}
            </Link>
          </footer>
        </section>
      )}
    </div>
  );
}

function AnswerSection({
  question,
  answer,
  selected,
  reviewHref,
  t,
}: {
  question: SubmissionQuestion;
  answer?: StudentAnswerInfo;
  selected: boolean;
  reviewHref: string;
  t: (key: MessageKey) => string;
}) {
  const state = getAnswerState(answer);
  return (
    <article
      id={questionDomId(question.id)}
      className={cn("scroll-mt-24 px-4 py-4 transition-colors sm:px-5", selected && "bg-primary/[0.035] ring-1 ring-inset ring-primary/25")}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-bold text-foreground">{question.label}</h4>
            <span className="text-xs text-muted-foreground">{question.type || t("studentSubmissionUnknownType")}</span>
          </div>
          {question.stem ? <MarkdownMath className="mt-1 line-clamp-2 text-xs text-muted-foreground">{question.stem}</MarkdownMath> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AnswerStateBadge state={state} t={t} />
          <Link
            to={reviewHref}
            className="inline-flex h-7 items-center justify-center rounded-[7px] border bg-card px-3 text-[11px] font-semibold text-primary outline-none hover:bg-primary/5 focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("studentSubmissionReviewAnswer")}
            <ArrowRight aria-hidden="true" className="ml-1 h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      <div className="mt-3 rounded-[8px] bg-slate-50 px-4 py-3 dark:bg-slate-900/45">
        {answer?.content?.trim() ? (
          <MarkdownMath>{answer.content}</MarkdownMath>
        ) : (
          <p className="text-sm text-muted-foreground">{t(state === "missing" ? "studentSubmissionMissingAnswer" : "studentSubmissionBlankAnswer")}</p>
        )}
      </div>
      {answer?.flag?.length ? (
        <p className="mt-2 text-xs leading-5 text-amber-700 dark:text-amber-200">
          {t("studentSubmissionRecognitionFlagPrefix")}{answer.flag.join(" · ")}
        </p>
      ) : null}
    </article>
  );
}

function AnswerStateBadge({ state, t }: { state: SubmissionAnswerState; t: (key: MessageKey) => string }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center justify-center rounded-full px-3 text-[11px] font-semibold",
        state === "recognized" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-200",
        state === "flagged" && "bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-200",
        (state === "empty" || state === "missing") && "bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-200",
      )}
    >
      {t(STATUS_KEYS[state])}
    </span>
  );
}

function StudentMetric({
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
      <dd className="mt-2 flex min-w-0 flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:gap-2">
        <span
          className={cn(
            "min-w-0 truncate text-[22px] font-bold leading-7 tracking-[-0.02em]",
            tone === "primary" && "text-primary",
            tone === "accent" && "text-teal-600 dark:text-teal-300",
            tone === "warning" && "text-amber-600 dark:text-amber-300",
            tone === "danger" && "text-red-500 dark:text-red-300",
            tone === "neutral" && "text-foreground",
          )}
          title={value}
        >
          {value}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground">{detail}</span>
      </dd>
    </div>
  );
}

function PageState({
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
    <div className="mt-[45px] flex min-h-[430px] items-center justify-center rounded-[10px] border bg-card px-6 py-10 text-center" role={busy ? "status" : undefined}>
      <div className="max-w-md">
        {busy ? <LoaderCircle aria-hidden="true" className="mx-auto h-7 w-7 animate-spin text-primary" /> : <AlertCircle aria-hidden="true" className="mx-auto h-7 w-7 text-muted-foreground" />}
        <p className="mt-4 text-sm font-semibold text-foreground">{title}</p>
        {description ? <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p> : null}
        {action && onAction ? <button type="button" className={actionClass} onClick={onAction}>{action}</button> : null}
        {action && href ? <Link className={actionClass} to={href}>{action}</Link> : null}
      </div>
    </div>
  );
}

function getStudentStats(questions: SubmissionQuestion[], answers: Map<string, StudentAnswerInfo>) {
  let answered = 0;
  let review = 0;
  for (const question of questions) {
    const answer = answers.get(question.id);
    if (answer?.content?.trim()) answered += 1;
    if (getAnswerState(answer) !== "recognized") review += 1;
  }
  return { answered, review, total: questions.length };
}

function matchesQuestionFilter(question: SubmissionQuestion, answer: StudentAnswerInfo | undefined, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const state = getAnswerState(answer);
  const wantsMissing = ["缺失", "空白", "未作答", "missing", "blank"].some((token) => normalized.includes(token));
  const wantsReview = ["待复核", "需复核", "异常", "低置信", "review", "flag"].some((token) => normalized.includes(token));
  const wantsRecognized = ["已识别", "正常", "recognized", "ready"].some((token) => normalized.includes(token));
  if (wantsMissing && state !== "missing" && state !== "empty") return false;
  if (wantsReview && state === "recognized") return false;
  if (wantsRecognized && state !== "recognized") return false;

  const residual = normalized
    .replace(/缺失|空白|未作答|missing|blank|待复核|需复核|异常|低置信|review|flag|已识别|正常|recognized|ready/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!residual) return true;
  return `${question.label} ${question.id} ${question.type} ${question.stem} ${answer?.content ?? ""}`
    .toLocaleLowerCase()
    .includes(residual);
}

function identityErrorMessage(error: unknown, t: (key: MessageKey) => string) {
  const normalized = normalizeAPIError(error);
  const detail = normalized.payload?.detail;
  const code = detail && typeof detail === "object" && "code" in detail
    ? String((detail as { code: unknown }).code)
    : "";
  switch (code) {
    case "student_id_conflict":
      return t("studentSubmissionIdentityConflict");
    case "task_workflow_changed":
      return t("studentSubmissionIdentityStale");
    case "student_identity_edit_unavailable":
    case "task_workflow_busy":
      return t("studentSubmissionIdentityUnavailable");
    case "student_identity_required":
      return t("studentSubmissionIdentityRequired");
    default:
      return t("studentSubmissionIdentityError");
  }
}

function identityMethodKey(method: NonNullable<StudentSubmission["identity_match_method"]>): MessageKey {
  if (method === "roster") return "studentSubmissionIdentityMethodRoster";
  if (method === "manual_review") return "studentSubmissionIdentityMethodManual";
  return "studentSubmissionIdentityMethodFilename";
}

function formatPercent(ready: number, total: number) {
  return total > 0 ? `${Math.round((ready / total) * 100)}%` : "—";
}

function questionDomId(questionId: string) {
  return `student-question-${encodeURIComponent(questionId)}`;
}

function studentPath(taskId: string, targetStudentId: string) {
  return `/tasks/${encodeURIComponent(taskId)}/students/${encodeURIComponent(targetStudentId)}`;
}

function answerReviewPath(taskId: string, studentId: string, questionId: string, overviewFilter: string) {
  const params = new URLSearchParams({ from: "student" });
  if (overviewFilter) params.set("overviewFilter", overviewFilter);
  return `${studentPath(taskId, studentId)}/questions/${encodeURIComponent(questionId)}?${params.toString()}`;
}

function compareStudents(a: StudentSubmission, b: StudentSubmission) {
  return a.stu_id.localeCompare(b.stu_id, undefined, { numeric: true, sensitivity: "base" });
}
