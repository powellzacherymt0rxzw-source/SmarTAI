import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CheckCircle2,
  FileText,
  Keyboard,
  LoaderCircle,
  RotateCcw,
  Save,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useState, type FocusEvent, type ReactNode } from "react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { normalizeAPIError } from "@/api/client";
import { useTask, useUpdateStudentAnswer } from "@/api/hooks/tasks";
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
import type { StudentSubmission } from "@/types";

type PickerMatch = {
  item: PickerItem;
  kind: "all" | "exact" | "related";
};

type PickerItem = {
  id: string;
  primary: string;
  secondary: string;
  searchable: string;
  exactValues: string[];
};

const STATUS_KEYS: Record<SubmissionAnswerState, MessageKey> = {
  recognized: "studentSubmissionStatusRecognized",
  flagged: "studentSubmissionStatusFlagged",
  empty: "studentSubmissionStatusEmpty",
  missing: "studentSubmissionStatusMissing",
};

/** S05: focused correction for exactly one student × one question. */
export function StudentAnswerReviewPage() {
  const { taskId, studentId, questionId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const taskQuery = useTask(taskId);
  const answerMutation = useUpdateStudentAnswer();
  const [contentDraft, setContentDraft] = useState("");
  const [flagDraft, setFlagDraft] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);

  const studentFilter = searchParams.get("studentFilter") ?? "";
  const questionFilter = searchParams.get("questionFilter") ?? "";
  const students = useMemo(
    () => Object.values(taskQuery.data?.student_data ?? {}).sort(compareStudents),
    [taskQuery.data?.student_data],
  );
  const questions = useMemo(
    () => buildSubmissionQuestions(Object.values(taskQuery.data?.problem_data ?? {}), students),
    [students, taskQuery.data?.problem_data],
  );
  const student = useMemo(
    () => students.find((candidate) => candidate.stu_id === studentId),
    [studentId, students],
  );
  const question = useMemo(
    () => questions.find((candidate) => candidate.id === questionId),
    [questionId, questions],
  );
  const answer = student && question ? answerMap(student).get(question.id) : undefined;
  const studentItems = useMemo(
    () => students.map((candidate) => studentPickerItem(candidate, t)),
    [students, t],
  );
  const questionItems = useMemo(() => questions.map(questionPickerItem), [questions]);
  const studentMatches = useMemo(
    () => matchPickerItems(studentItems, studentFilter),
    [studentFilter, studentItems],
  );
  const questionMatches = useMemo(
    () => matchPickerItems(questionItems, questionFilter),
    [questionFilter, questionItems],
  );
  const navigableStudents = useMemo(
    () => selectNavigable(students, studentMatches, studentFilter, (value) => value.stu_id),
    [studentFilter, studentMatches, students],
  );
  const navigableQuestions = useMemo(
    () => selectNavigable(questions, questionMatches, questionFilter, (value) => value.id),
    [questionFilter, questionMatches, questions],
  );
  const studentNeighbors = neighbors(navigableStudents, studentId, (value) => value.stu_id);
  const questionNeighbors = neighbors(navigableQuestions, questionId, (value) => value.id);

  const originalContent = answer?.content ?? "";
  const originalFlags = (answer?.flag ?? []).join("\n");
  const isDirty = contentDraft !== originalContent || flagDraft !== originalFlags;

  useEffect(() => {
    setContentDraft(originalContent);
    setFlagDraft(originalFlags);
    setSaveError(null);
  }, [questionId, studentId, originalContent, originalFlags]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isKeyboardNavigationBlocked(event.target)) return;

      if (event.key === "ArrowLeft" && studentNeighbors.previous) {
        event.preventDefault();
        goToStudent(studentNeighbors.previous);
      } else if (event.key === "ArrowRight" && studentNeighbors.next) {
        event.preventDefault();
        goToStudent(studentNeighbors.next);
      } else if (event.key === "ArrowUp" && questionNeighbors.previous) {
        event.preventDefault();
        goToQuestion(questionNeighbors.previous);
      } else if (event.key === "ArrowDown" && questionNeighbors.next) {
        event.preventDefault();
        goToQuestion(questionNeighbors.next);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // Navigation callbacks intentionally follow the latest draft and route.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDirty, questionNeighbors.next, questionNeighbors.previous, studentNeighbors.next, studentNeighbors.previous]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [isDirty]);

  if (taskQuery.isSuccess && taskId && taskQuery.data.status !== "submissions_ready") {
    return <Navigate replace to={getTaskDestination(taskQuery.data)} />;
  }

  function setFilter(key: "studentFilter" | "questionFilter", value: string) {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value.trim()) next.set(key, value);
      else next.delete(key);
      return next;
    }, { replace: true });
  }

  function confirmLeave() {
    return !isDirty || window.confirm(t("answerReviewUnsavedConfirm"));
  }

  function goToStudent(target: StudentSubmission | null) {
    if (!target || !taskId || !questionId || !confirmLeave()) return;
    navigate({
      pathname: reviewPath(taskId, target.stu_id, questionId),
      search: searchParams.toString() ? `?${searchParams.toString()}` : "",
    });
  }

  function goToQuestion(target: SubmissionQuestion | null) {
    if (!target || !taskId || !studentId || !confirmLeave()) return;
    navigate({
      pathname: reviewPath(taskId, studentId, target.id),
      search: searchParams.toString() ? `?${searchParams.toString()}` : "",
    });
  }

  async function saveAnswer(moveNext: boolean) {
    if (!taskId || !student || !question || !taskQuery.data) return;
    setSaveError(null);
    try {
      await answerMutation.mutateAsync({
        taskId,
        studentId: student.stu_id,
        qId: question.id,
        expectedWorkflowRevision: taskQuery.data.workflow_revision,
        content: contentDraft,
        flag: parseFlags(flagDraft),
      });
      toast.success(t("answerReviewSaved"));
      if (moveNext && questionNeighbors.next) {
        navigate({
          pathname: reviewPath(taskId, student.stu_id, questionNeighbors.next.id),
          search: searchParams.toString() ? `?${searchParams.toString()}` : "",
        });
      } else {
        await taskQuery.refetch();
      }
    } catch (error) {
      setSaveError(answerErrorMessage(error, t));
    }
  }

  const backHref = buildBackHref(taskId, studentId, questionId, searchParams);
  const state = getAnswerState(answer);

  return (
    <div className="w-full max-w-[1300px]">
      <div className="flex min-h-9 items-center justify-between gap-4">
        <h1 className="min-w-0 truncate text-[28px] font-bold leading-9 tracking-[-0.02em] text-foreground sm:text-[30px]">
          {t("answerReviewTitle")}
        </h1>
        <Link
          to={backHref}
          onClick={(event) => {
            if (!confirmLeave()) event.preventDefault();
          }}
          className="inline-flex shrink-0 items-center gap-1.5 text-[13px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          {t(searchParams.get("from") === "student" ? "answerReviewBackStudent" : "answerReviewBackMatrix")}
        </Link>
      </div>
      <NewTaskStepper currentStep={2} />

      {taskQuery.isLoading ? (
        <PageState title={t("answerReviewLoading")} busy />
      ) : taskQuery.isError ? (
        <PageState title={t("answerReviewLoadError")} action={t("answerReviewRetry")} onAction={() => void taskQuery.refetch()} />
      ) : !taskId || !studentId || !questionId ? (
        <PageState title={t("answerReviewRouteMissing")} href="/history" action={t("studentSubmissionBackHistory")} />
      ) : !student || !question ? (
        <PageState
          title={t("answerReviewNotFound")}
          description={t("answerReviewNotFoundDescription")}
          href={`/tasks/${encodeURIComponent(taskId)}/submissions`}
          action={t("answerReviewBackMatrix")}
        />
      ) : (
        <section className="mt-[22px] min-w-0" aria-label={`${student.stu_id} · ${question.label}`}>
          <DimensionNavigation
            ariaLabel={t("answerReviewStudentNavigation")}
            currentLabel={student.stu_name || student.stu_id}
            currentDetail={student.stu_id}
            previous={studentNeighbors.previous}
            next={studentNeighbors.next}
            previousLabel={(value) => value.stu_name || value.stu_id}
            nextLabel={(value) => value.stu_name || value.stu_id}
            onPrevious={() => goToStudent(studentNeighbors.previous)}
            onNext={() => goToStudent(studentNeighbors.next)}
            previousText={t("answerReviewPreviousStudent")}
            nextText={t("answerReviewNextStudent")}
            previousIcon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
            nextIcon={<ArrowRight aria-hidden="true" className="h-4 w-4" />}
            shortcut={t("answerReviewStudentShortcut")}
          >
            <SmartPicker
              label={t("answerReviewStudentSearchLabel")}
              placeholder={t("answerReviewStudentSearchPlaceholder")}
              query={studentFilter}
              matches={studentMatches}
              currentId={student.stu_id}
              onQueryChange={(value) => setFilter("studentFilter", value)}
              onSelect={(id) => goToStudent(students.find((candidate) => candidate.stu_id === id) ?? null)}
              t={t}
            />
          </DimensionNavigation>

          <div className="mt-3">
            <DimensionNavigation
              ariaLabel={t("answerReviewQuestionNavigation")}
              currentLabel={`${t("answerReviewQuestionPrefix")}${question.label}`}
              currentDetail={question.type || t("studentSubmissionUnknownType")}
              previous={questionNeighbors.previous}
              next={questionNeighbors.next}
              previousLabel={(value) => `${t("answerReviewQuestionPrefix")}${value.label}`}
              nextLabel={(value) => `${t("answerReviewQuestionPrefix")}${value.label}`}
              onPrevious={() => goToQuestion(questionNeighbors.previous)}
              onNext={() => goToQuestion(questionNeighbors.next)}
              previousText={t("answerReviewPreviousQuestion")}
              nextText={t("answerReviewNextQuestion")}
              previousIcon={<ArrowUp aria-hidden="true" className="h-4 w-4" />}
              nextIcon={<ArrowDown aria-hidden="true" className="h-4 w-4" />}
              shortcut={t("answerReviewQuestionShortcut")}
            >
              <SmartPicker
                label={t("answerReviewQuestionSearchLabel")}
                placeholder={t("answerReviewQuestionSearchPlaceholder")}
                query={questionFilter}
                matches={questionMatches}
                currentId={question.id}
                onQueryChange={(value) => setFilter("questionFilter", value)}
                onSelect={(id) => goToQuestion(questions.find((candidate) => candidate.id === id) ?? null)}
                t={t}
              />
            </DimensionNavigation>
          </div>

          <article className="mt-4 overflow-hidden rounded-[10px] border bg-card">
            <header className="flex min-h-[48px] flex-wrap items-center justify-between gap-3 border-b bg-slate-50 px-5 py-2 dark:bg-slate-900/40">
              <div>
                <h2 className="text-sm font-semibold text-foreground">{t("answerReviewRecognizedTextTitle")}</h2>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{t("answerReviewRecognizedTextDescription")}</p>
              </div>
              <AnswerStateBadge state={state} t={t} />
            </header>
            <label className="block p-4 sm:p-5">
              <span className="sr-only">{t("answerReviewContentLabel")}</span>
              <textarea
                value={contentDraft}
                onChange={(event) => setContentDraft(event.target.value)}
                placeholder={t("answerReviewContentPlaceholder")}
                className="min-h-[92px] w-full resize-y rounded-[8px] border bg-slate-50 px-4 py-3 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/15 dark:bg-slate-900/45"
              />
            </label>
          </article>

          <div className="mt-4 grid gap-4 lg:grid-cols-[0.94fr_1.06fr]">
            <article className="min-h-[155px] rounded-[10px] border bg-card p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-foreground">{t("answerReviewQuestionContextTitle")}</h2>
                <span className="rounded-full bg-primary/10 px-3 py-1 text-[11px] font-semibold text-primary">
                  {question.type || t("studentSubmissionUnknownType")}
                </span>
              </div>
              {question.stem ? (
                <MarkdownMath className="mt-4 text-foreground">{question.stem}</MarkdownMath>
              ) : (
                <p className="mt-4 text-sm leading-6 text-muted-foreground">{t("answerReviewStemUnavailable")}</p>
              )}
            </article>

            <article className="min-h-[155px] rounded-[10px] border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">{t("answerReviewRecognitionTitle")}</h2>
                  <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{t("answerReviewRecognitionDescription")}</p>
                </div>
                {flagDraft ? (
                  <button
                    type="button"
                    onClick={() => setFlagDraft("")}
                    className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary outline-none hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <RotateCcw aria-hidden="true" className="h-3 w-3" />
                    {t("answerReviewClearFlags")}
                  </button>
                ) : null}
              </div>
              <label className="mt-3 block">
                <span className="sr-only">{t("answerReviewFlagsLabel")}</span>
                <textarea
                  value={flagDraft}
                  onChange={(event) => setFlagDraft(event.target.value)}
                  placeholder={t("answerReviewFlagsPlaceholder")}
                  className="min-h-[64px] w-full resize-y rounded-[8px] border bg-slate-50 px-3 py-2.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:bg-card focus:ring-2 focus:ring-primary/15 dark:bg-slate-900/45"
                />
              </label>
            </article>
          </div>

          <article className="mt-4 flex flex-col gap-3 rounded-[10px] border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-teal-50 text-teal-600 dark:bg-teal-950/40 dark:text-teal-300">
                <FileText aria-hidden="true" className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-foreground">{t("answerReviewSourceTitle")}</h2>
                <p className="mt-1 truncate text-xs text-muted-foreground" title={student.source_filename ?? undefined}>
                  {student.source_filename || t("answerReviewSourceUnknown")}
                </p>
              </div>
            </div>
            <p className="max-w-[610px] text-[11px] leading-5 text-muted-foreground">{t("answerReviewSourceUnavailable")}</p>
          </article>

          {saveError ? (
            <p className="mt-3 rounded-[8px] border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200" role="alert">
              {saveError}
            </p>
          ) : null}

          <div className="mt-4 flex flex-col gap-3 rounded-[10px] border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
              <Keyboard aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span>{t("answerReviewKeyboardHint")}</span>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                type="button"
                variant="secondary"
                className="h-10 px-5"
                disabled={answerMutation.isPending || !isDirty}
                onClick={() => void saveAnswer(false)}
              >
                {answerMutation.isPending ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Save aria-hidden="true" className="h-4 w-4" />}
                {t(answerMutation.isPending ? "answerReviewSaving" : "answerReviewSave")}
              </Button>
              <Button
                type="button"
                className="h-10 px-5"
                disabled={answerMutation.isPending || !isDirty || !questionNeighbors.next}
                onClick={() => void saveAnswer(true)}
              >
                <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
                {t("answerReviewSaveNext")}
                <ArrowDown aria-hidden="true" className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="mt-3">
            <CompactQuestionNavigation
              current={`${t("answerReviewQuestionPrefix")}${question.label}`}
              previous={questionNeighbors.previous}
              next={questionNeighbors.next}
              onPrevious={() => goToQuestion(questionNeighbors.previous)}
              onNext={() => goToQuestion(questionNeighbors.next)}
              t={t}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function DimensionNavigation<T>({
  ariaLabel,
  currentLabel,
  currentDetail,
  previous,
  next,
  previousLabel,
  nextLabel,
  onPrevious,
  onNext,
  previousText,
  nextText,
  previousIcon,
  nextIcon,
  shortcut,
  children,
}: {
  ariaLabel: string;
  currentLabel: string;
  currentDetail: string;
  previous: T | null;
  next: T | null;
  previousLabel: (value: T) => string;
  nextLabel: (value: T) => string;
  onPrevious: () => void;
  onNext: () => void;
  previousText: string;
  nextText: string;
  previousIcon: ReactNode;
  nextIcon: ReactNode;
  shortcut: string;
  children: ReactNode;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="grid min-h-[58px] gap-2 rounded-[10px] border bg-card p-2 sm:grid-cols-2 xl:grid-cols-[175px_225px_minmax(300px,1fr)_175px_150px] xl:items-center"
    >
      <Button type="button" variant="ghost" className="h-10 justify-start px-3" disabled={!previous} onClick={onPrevious}>
        {previousIcon}
        <span className="min-w-0 truncate">{previous ? previousLabel(previous) : previousText}</span>
      </Button>
      <div className="flex h-10 min-w-0 items-center rounded-[7px] bg-primary/[0.055] px-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-primary">{currentLabel}</p>
          <p className="truncate text-[10px] text-muted-foreground">{currentDetail}</p>
        </div>
      </div>
      <div className="relative col-span-2 min-w-0 sm:col-span-2 xl:col-span-1">{children}</div>
      <Button type="button" variant="ghost" className="h-10 justify-end px-3" disabled={!next} onClick={onNext}>
        <span className="min-w-0 truncate">{next ? nextLabel(next) : nextText}</span>
        {nextIcon}
      </Button>
      <span className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[7px] bg-slate-50 px-3 text-[11px] text-muted-foreground dark:bg-slate-900/45">
        <Keyboard aria-hidden="true" className="h-3.5 w-3.5" />
        {shortcut}
      </span>
    </nav>
  );
}

function SmartPicker({
  label,
  placeholder,
  query,
  matches,
  currentId,
  onQueryChange,
  onSelect,
  t,
}: {
  label: string;
  placeholder: string;
  query: string;
  matches: PickerMatch[];
  currentId: string;
  onQueryChange: (value: string) => void;
  onSelect: (id: string) => void;
  t: (key: MessageKey) => string;
}) {
  const [open, setOpen] = useState(false);

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  }

  return (
    <div className="relative" onFocusCapture={() => setOpen(true)} onBlurCapture={handleBlur}>
      <label className="relative block">
        <span className="sr-only">{label}</span>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={placeholder}
          className="h-10 w-full rounded-[7px] border-0 bg-slate-50 pl-9 pr-9 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-primary/20 dark:bg-slate-900/50"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("answerReviewClearSearch")}
          >
            <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </label>
      {open ? (
        <div className="absolute left-0 right-0 top-[44px] z-40 max-h-[280px] overflow-auto rounded-[9px] border bg-card p-1.5 shadow-xl">
          <p className="px-2 py-1 text-[10px] leading-4 text-muted-foreground">
            {query ? `${matches.length} ${t("answerReviewMatches")}` : t("answerReviewLocalMatchHint")}
          </p>
          {matches.length ? matches.slice(0, 12).map(({ item, kind }) => (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelect(item.id);
                setOpen(false);
              }}
              className={cn(
                "flex min-h-[44px] w-full items-center justify-between gap-3 rounded-[7px] px-2.5 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                item.id === currentId && "bg-primary/[0.055]",
              )}
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold text-foreground">{item.primary}</span>
                <span className="block truncate text-[10px] text-muted-foreground">{item.secondary}</span>
              </span>
              {kind !== "all" ? (
                <span className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                  kind === "exact" ? "bg-teal-100 text-teal-700 dark:bg-teal-950/60 dark:text-teal-200" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
                )}>
                  {t(kind === "exact" ? "answerReviewExactMatch" : "answerReviewRelatedMatch")}
                </span>
              ) : null}
            </button>
          )) : (
            <p className="px-3 py-5 text-center text-xs text-muted-foreground">{t("answerReviewNoMatches")}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function CompactQuestionNavigation({
  current,
  previous,
  next,
  onPrevious,
  onNext,
  t,
}: {
  current: string;
  previous: SubmissionQuestion | null;
  next: SubmissionQuestion | null;
  onPrevious: () => void;
  onNext: () => void;
  t: (key: MessageKey) => string;
}) {
  return (
    <nav aria-label={t("answerReviewBottomQuestionNavigation")} className="grid gap-2 rounded-[10px] border bg-card p-2 sm:grid-cols-[1fr_180px_1fr] sm:items-center">
      <Button type="button" variant="ghost" className="h-10 justify-start" disabled={!previous} onClick={onPrevious}>
        <ArrowUp aria-hidden="true" className="h-4 w-4" />
        {previous ? `${t("answerReviewQuestionPrefix")}${previous.label}` : t("answerReviewPreviousQuestion")}
      </Button>
      <span className="order-first flex h-10 items-center justify-center rounded-[7px] bg-primary/[0.055] text-[13px] font-semibold text-primary sm:order-none">{current}</span>
      <Button type="button" variant="ghost" className="h-10 justify-end" disabled={!next} onClick={onNext}>
        {next ? `${t("answerReviewQuestionPrefix")}${next.label}` : t("answerReviewNextQuestion")}
        <ArrowDown aria-hidden="true" className="h-4 w-4" />
      </Button>
    </nav>
  );
}

function AnswerStateBadge({ state, t }: { state: SubmissionAnswerState; t: (key: MessageKey) => string }) {
  return (
    <span className={cn(
      "inline-flex h-7 shrink-0 items-center justify-center rounded-full px-3 text-[11px] font-semibold",
      state === "recognized" && "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-200",
      state === "flagged" && "bg-amber-100 text-amber-700 dark:bg-amber-950/70 dark:text-amber-200",
      (state === "empty" || state === "missing") && "bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-200",
    )}>
      {t(STATUS_KEYS[state])}
    </span>
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

function matchPickerItems(items: PickerItem[], query: string): PickerMatch[] {
  const normalized = normalize(query);
  if (!normalized) return items.map((item) => ({ item, kind: "all" }));

  return items
    .map((item): PickerMatch | null => {
      if (item.exactValues.some((value) => normalizeComparable(value) === normalizeComparable(normalized))) {
        return { item, kind: "exact" };
      }
      const descriptor = normalize(item.searchable);
      const terms = normalized.split(/\s+/).filter(Boolean);
      if (descriptor.includes(normalized) || terms.every((term) => descriptor.includes(term))) {
        return { item, kind: "related" };
      }
      return null;
    })
    .filter((match): match is PickerMatch => match !== null)
    .sort((a, b) => Number(b.kind === "exact") - Number(a.kind === "exact"));
}

function studentPickerItem(student: StudentSubmission, t: (key: MessageKey) => string): PickerItem {
  const name = student.stu_name || student.stu_id;
  return {
    id: student.stu_id,
    primary: `${student.stu_id} · ${name}`,
    secondary: t(student.identity_status === "needs_review" ? "studentSubmissionIdentityReview" : "studentSubmissionIdentityMatched"),
    searchable: `${student.stu_id} ${name}`,
    exactValues: [student.stu_id, name],
  };
}

function questionPickerItem(question: SubmissionQuestion): PickerItem {
  const descriptor = `${question.label} ${question.id} ${question.type} ${question.stem}`;
  const aliases: string[] = [];
  if (/\\int|∫|积分/i.test(descriptor)) aliases.push("积分 积分题 integral integration");
  if (/证明|prove|proof/i.test(descriptor)) aliases.push("证明 证明题 proof");
  if (/编程|代码|algorithm|code|python|java/i.test(descriptor)) aliases.push("编程 编程题 代码 算法 programming");
  if (/计算|calculate|compute/i.test(descriptor)) aliases.push("计算 计算题 calculation");
  return {
    id: question.id,
    primary: `Q${question.label}`,
    secondary: question.type || question.stem || question.id,
    searchable: `${descriptor} ${aliases.join(" ")}`,
    exactValues: [question.id, question.label, `q${question.label}`, `第${question.label}题`, question.type],
  };
}

function selectNavigable<T>(
  values: T[],
  matches: PickerMatch[],
  query: string,
  getId: (value: T) => string,
) {
  if (!query.trim() || !matches.length) return values;
  const ids = new Set(matches.map((match) => match.item.id));
  return values.filter((value) => ids.has(getId(value)));
}

function neighbors<T>(values: T[], currentId: string | undefined, getId: (value: T) => string) {
  const index = values.findIndex((value) => getId(value) === currentId);
  return {
    previous: index > 0 ? values[index - 1] : null,
    next: index >= 0 && index < values.length - 1 ? values[index + 1] : null,
  };
}

function buildBackHref(
  taskId: string | undefined,
  studentId: string | undefined,
  questionId: string | undefined,
  searchParams: URLSearchParams,
) {
  if (!taskId) return "/history";
  if (searchParams.get("from") === "student" && studentId) {
    const params = new URLSearchParams();
    if (questionId) params.set("question", questionId);
    const overviewFilter = searchParams.get("overviewFilter");
    if (overviewFilter) params.set("filter", overviewFilter);
    const query = params.toString();
    return `${studentPath(taskId, studentId)}${query ? `?${query}` : ""}`;
  }
  const returnParams = searchParams.get("returnParams");
  return `/tasks/${encodeURIComponent(taskId)}/submissions${returnParams ? `?${returnParams}` : ""}`;
}

function answerErrorMessage(error: unknown, t: (key: MessageKey) => string) {
  const normalized = normalizeAPIError(error);
  const detail = normalized.payload?.detail;
  const code = detail && typeof detail === "object" && "code" in detail
    ? String((detail as { code: unknown }).code)
    : "";
  if (code === "task_workflow_changed") return t("answerReviewStale");
  if (code === "task_workflow_busy" || normalized.status === 409) return t("answerReviewUnavailable");
  return t("answerReviewSaveError");
}

function parseFlags(value: string) {
  return value
    .split(/\r?\n/)
    .map((flag) => flag.trim())
    .filter(Boolean);
}

function isKeyboardNavigationBlocked(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']"));
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase();
}

function normalizeComparable(value: string) {
  return normalize(value).replace(/第|题|\s/g, "").replace(/^q/i, "");
}

function reviewPath(taskId: string, studentId: string, questionId: string) {
  return `${studentPath(taskId, studentId)}/questions/${encodeURIComponent(questionId)}`;
}

function studentPath(taskId: string, studentId: string) {
  return `/tasks/${encodeURIComponent(taskId)}/students/${encodeURIComponent(studentId)}`;
}

function compareStudents(a: StudentSubmission, b: StudentSubmission) {
  return a.stu_id.localeCompare(b.stu_id, undefined, { numeric: true, sensitivity: "base" });
}
