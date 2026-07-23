import { AlertTriangle, ArrowRight, CheckCircle2, LoaderCircle, Search } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { useTask, useTaskResult, useTeacherComments } from "@/api/hooks/tasks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import { buildResultsModel, effectiveCorrectionScore, formatConfidence, formatPercent, type QuestionSummary, type ResultsModel, type StudentSummary } from "@/components/tasks/ResultsLayout";
import { collectResultReviewItems, type ReviewItem } from "@/components/tasks/resultsReviewModel";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/messages";
import { cn } from "@/lib/cn";
import { isExpertDisagreement, reviewCellKey, selectReviewOverview } from "@/lib/reviewOverview";
import { reviewOverviewText as copy } from "@/lib/reviewOverviewCopy";
import { getTaskDestination } from "@/lib/taskFlow";
import type { Correction } from "@/types";

/** R01: compact Figma-14 review overview backed only by persisted grading results. */
export function ReviewOverviewPage() {
  const { taskId } = useParams();
  const { locale } = useI18n();
  const taskQuery = useTask(taskId);
  const resultQuery = useTaskResult(taskId);
  const commentsQuery = useTeacherComments(taskId);
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const task = taskQuery.data;
  const model = useMemo(() => buildResultsModel(task, resultQuery.data), [resultQuery.data, task]);
  const reviewItems = useMemo(() => collectResultReviewItems(model, model.students), [model]);
  const annotatedKeys = useMemo(() => {
    const keys = new Set(Object.entries(commentsQuery.data?.comments ?? {}).filter(([, comment]) => comment.trim()).map(([key]) => key));
    for (const student of model.students) {
      for (const correction of student.corrections) {
        if (correction.teacher_comment?.trim()) keys.add(reviewCellKey(student.id, correction.q_id));
      }
    }
    return keys;
  }, [commentsQuery.data?.comments, model.students]);
  const confirmedKeys = useMemo(() => new Set(
    model.students.flatMap((student) => student.corrections
      .filter((correction) => correction.review_status === "confirmed")
      .map((correction) => reviewCellKey(student.id, correction.q_id))),
  ), [model.students]);
  const selection = useMemo(
    () => selectReviewOverview(model, reviewItems, annotatedKeys, query),
    [annotatedKeys, model, query, reviewItems],
  );

  if (taskId && task?.status === "grading") return <Navigate replace to={`/tasks/${taskId}/grading/progress`} />;
  if (taskId && task && task.status !== "graded") return <Navigate replace to={getTaskDestination(task)} />;

  const isLoading = taskQuery.isLoading || resultQuery.isLoading;
  const isError = taskQuery.isError || resultQuery.isError;
  const pendingReviewItems = reviewItems.filter((item) => !confirmedKeys.has(reviewCellKey(item.student.id, item.question.id)));
  const firstTarget = pendingReviewItems[0]
    ?? (model.students[0] && model.questions[0]
      ? { student: model.students[0], question: model.questions[0] } as Pick<ReviewItem, "student" | "question">
      : null);
  const targetHref = taskId && firstTarget
    ? reviewDetailHref(taskId, firstTarget.student.id, firstTarget.question.id)
    : null;
  const correctionCount = model.students.reduce((total, student) => total + student.corrections.length, 0);
  const disagreementCount = model.students.reduce(
    (total, student) => total + student.corrections.filter(isExpertDisagreement).length,
    0,
  );

  function submitFilter(event: FormEvent) {
    event.preventDefault();
    setQuery(draftQuery.trim());
  }

  return (
    <div className="w-full max-w-[1300px]">
      <h1 className="min-h-9 text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
        {copy(locale, "title")}
      </h1>
      <NewTaskStepper currentStep={5} />

      {!taskId ? (
        <PageState title={copy(locale, "missingTask")} href="/history" action={copy(locale, "viewHistory")} />
      ) : isLoading ? (
        <PageState title={copy(locale, "loading")} busy />
      ) : isError ? (
        <PageState
          title={copy(locale, "loadError")}
          description={copy(locale, "loadErrorDescription")}
          action={copy(locale, "retry")}
          onAction={() => { void Promise.all([taskQuery.refetch(), resultQuery.refetch(), commentsQuery.refetch()]); }}
        />
      ) : !model.students.length || !model.questions.length ? (
        <PageState title={copy(locale, "empty")} href="/history" action={copy(locale, "viewHistory")} />
      ) : (
        <>
          <div className="mt-5 grid grid-cols-2 gap-4 xl:flex xl:h-[90px] xl:gap-5">
            <MetricCard value={formatMetricPercent(model.classAveragePercent)} label={copy(locale, "average")} tone="primary" />
            <MetricCard value={String(model.lowConfidenceCount)} label={copy(locale, "lowConfidence")} tone="warning" />
            <MetricCard value={String(disagreementCount)} label={copy(locale, "disagreement")} tone="primary" />
            <MetricCard value={`${confirmedKeys.size}/${correctionCount}`} label={copy(locale, "annotated")} tone="accent" />
            {targetHref ? (
              <Link
                to={targetHref}
                className="col-span-2 inline-flex h-10 items-center justify-center gap-2 self-center rounded-[8px] bg-primary px-5 text-center text-[14px] font-semibold text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 xl:-ml-[30px] xl:w-[240px] xl:shrink-0"
              >
                {copy(locale, pendingReviewItems.length ? "startReview" : "viewResult")}
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            ) : null}
          </div>

          <form onSubmit={submitFilter} role="search" className="mt-6">
            <label className="relative block">
              <span className="sr-only">{copy(locale, "searchLabel")}</span>
              <Search aria-hidden="true" className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={draftQuery}
                onChange={(event) => {
                  setDraftQuery(event.target.value);
                  setQuery(event.target.value.trim());
                }}
                placeholder={copy(locale, "searchPlaceholder")}
                className="h-12 w-full rounded-[10px] border bg-card pl-14 pr-28 text-[14px] text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => { setDraftQuery(""); setQuery(""); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"
                >
                  {copy(locale, "clear")}
                </button>
              ) : null}
            </label>
          </form>

          {query ? (
            <p className="mt-2 text-[12px] text-muted-foreground" aria-live="polite">
              {selection.explanation === "no-match"
                ? copy(locale, "noMatch")
                : copy(locale, "filtered")
                    .replace("{students}", String(selection.students.length))
                    .replace("{questions}", String(selection.questions.length))
                    .replace("{cells}", String(selection.matchedCellKeys.size))}
            </p>
          ) : null}

          <div className={cn("grid gap-[30px] pb-8 lg:grid-cols-[minmax(0,820px)_minmax(300px,438px)]", query ? "mt-5" : "mt-7")}>
            <ReviewHeatmap
              locale={locale}
              taskId={taskId}
              model={model}
              students={selection.students}
              questions={selection.questions}
              matchedCellKeys={selection.matchedCellKeys}
              reviewItems={reviewItems}
              annotatedKeys={annotatedKeys}
              confirmedKeys={confirmedKeys}
            />
            <ReviewQueue
              locale={locale}
              taskId={taskId}
              items={pendingReviewItems.filter((item) => selection.matchedCellKeys.has(reviewCellKey(item.student.id, item.question.id))).slice(0, 4)}
            />
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ value, label, tone }: { value: string; label: string; tone: "primary" | "warning" | "accent" }) {
  return (
    <section className="flex min-h-[90px] min-w-0 flex-1 flex-col justify-center rounded-[10px] border bg-card px-5 xl:w-[250px] xl:flex-none">
      <strong className={cn(
        "text-[28px] font-bold leading-8 tracking-[-0.02em]",
        tone === "primary" && "text-primary",
        tone === "warning" && "text-amber-500",
        tone === "accent" && "text-teal-500",
      )}>{value}</strong>
      <span className="mt-2 text-[13px] font-medium text-muted-foreground">{label}</span>
    </section>
  );
}

function ReviewHeatmap({
  locale,
  taskId,
  model,
  students,
  questions,
  matchedCellKeys,
  reviewItems,
  annotatedKeys,
  confirmedKeys,
}: {
  locale: Locale;
  taskId: string;
  model: ResultsModel;
  students: StudentSummary[];
  questions: QuestionSummary[];
  matchedCellKeys: Set<string>;
  reviewItems: ReviewItem[];
  annotatedKeys: Set<string>;
  confirmedKeys: Set<string>;
}) {
  const reviewByKey = new Map(reviewItems.map((item) => [reviewCellKey(item.student.id, item.question.id), item]));
  const questionById = new Map(model.questions.map((question) => [question.id, question]));

  return (
    <section className="h-[308px] min-w-0 overflow-hidden rounded-[10px] border bg-card" aria-labelledby="review-heatmap-title">
      <h2 id="review-heatmap-title" className="sr-only">{copy(locale, "heatmap")}</h2>
      {!students.length || !questions.length ? (
        <div className="flex h-full flex-col items-center justify-center px-8 text-center">
          <Search aria-hidden="true" className="h-7 w-7 text-muted-foreground" />
          <p className="mt-3 max-w-md text-sm text-muted-foreground">{copy(locale, "noMatch")}</p>
        </div>
      ) : (
        <div className="h-full overflow-auto overscroll-contain">
          <table className="min-w-[780px] border-separate border-spacing-x-2 border-spacing-y-2 px-2 py-1 text-left">
            <thead className="sticky top-0 z-10 bg-card">
              <tr>
                <th className="w-[164px] min-w-[164px] px-1 py-1 text-[12px] font-semibold text-muted-foreground">
                  <span className="sr-only">{locale === "en-US" ? "Student" : "学生"}</span>
                </th>
                {questions.map((question) => (
                  <th key={question.id} className="min-w-[64px] px-1 py-1 text-center text-[12px] font-semibold text-muted-foreground">
                    {question.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {students.map((student) => {
                const correctionByQuestion = new Map(student.corrections.map((correction) => [correction.q_id, correction]));
                return (
                  <tr key={student.id}>
                    <th className="max-w-[164px] truncate px-1 py-1 text-[12px] font-semibold text-foreground" title={`${student.id} ${student.name}`}>
                      {student.id} {student.name !== student.id ? student.name : ""}
                    </th>
                    {questions.map((question) => {
                      const correction = correctionByQuestion.get(question.id);
                      const key = reviewCellKey(student.id, question.id);
                      if (!correction || !matchedCellKeys.has(key)) return <td key={question.id} className="h-9 min-w-[64px]" />;
                      return (
                        <td key={question.id} className="h-9 min-w-[64px] px-0.5">
                          <ReviewCell
                            locale={locale}
                            href={reviewDetailHref(taskId, student.id, question.id)}
                            correction={correction}
                            item={reviewByKey.get(key)}
                            annotated={annotatedKeys.has(key)}
                            confirmed={confirmedKeys.has(key)}
                            question={questionById.get(question.id)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReviewCell({ locale, href, correction, item, annotated, confirmed, question }: { locale: Locale; href: string; correction: Correction; item?: ReviewItem; annotated: boolean; confirmed: boolean; question?: QuestionSummary }) {
  const state = confirmed ? "confirmed" : annotated ? "commented" : item?.category === "low-confidence" ? "low" : item ? "review" : "ok";
  const label = copy(locale, state);
  const detail = `${question?.label ?? correction.q_id} · ${formatPercent(correction.max_score > 0 ? (effectiveCorrectionScore(correction) / correction.max_score) * 100 : null)} · ${formatConfidence(correction.confidence)}`;
  return (
    <Link
      to={href}
      aria-label={`${label} · ${detail}`}
      title={`${label} · ${detail}`}
      className={cn(
        "flex h-9 min-w-[64px] items-center justify-center rounded-[7px] text-[11px] font-semibold outline-none transition hover:brightness-95 focus-visible:ring-2 focus-visible:ring-ring",
        state === "ok" && "bg-teal-100 text-teal-600 dark:bg-teal-950/60 dark:text-teal-300",
        state === "low" && "bg-amber-100 text-amber-500 dark:bg-amber-950/50 dark:text-amber-300",
        state === "review" && "bg-red-100 text-red-500 dark:bg-red-950/45 dark:text-red-300",
        (state === "commented" || state === "confirmed") && "bg-blue-100 text-primary dark:bg-blue-950/55",
      )}
    >
      {label}
    </Link>
  );
}

function ReviewQueue({ locale, taskId, items }: { locale: Locale; taskId: string; items: ReviewItem[] }) {
  return (
    <section className="h-[308px] overflow-hidden rounded-[10px] border bg-card px-7 py-6" aria-labelledby="review-queue-title">
      <h2 id="review-queue-title" className="text-[18px] font-bold leading-6 text-foreground">{copy(locale, "queue")}</h2>
      {!items.length ? (
        <div className="flex h-[220px] flex-col items-center justify-center text-center">
          <CheckCircle2 aria-hidden="true" className="h-7 w-7 text-teal-500" />
          <p className="mt-3 max-w-[300px] text-[13px] leading-5 text-muted-foreground">{copy(locale, "noQueue")}</p>
        </div>
      ) : (
        <ol className="mt-3 h-[224px] space-y-1 overflow-y-auto overscroll-contain pr-1">
          {items.map((item) => (
            <li key={reviewCellKey(item.student.id, item.question.id)}>
              <Link
                to={reviewDetailHref(taskId, item.student.id, item.question.id)}
                className="flex min-h-[48px] items-center gap-3 rounded-[8px] px-1.5 text-[13px] outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {item.student.name} · {item.question.label} · {queueReason(locale, item)}
                </span>
                <span className="inline-flex h-8 min-w-[72px] shrink-0 items-center justify-center rounded-[8px] border bg-card px-3 font-semibold text-foreground">
                  {copy(locale, "review")}
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function PageState({ title, description, busy = false, action, href, onAction }: { title: string; description?: string; busy?: boolean; action?: string; href?: string; onAction?: () => void }) {
  const content = action && href ? (
    <Link to={href} className="mt-5 inline-flex h-10 items-center rounded-[8px] bg-primary px-5 text-sm font-semibold text-primary-foreground">{action}</Link>
  ) : action && onAction ? (
    <button type="button" onClick={onAction} className="mt-5 inline-flex h-10 items-center rounded-[8px] bg-primary px-5 text-sm font-semibold text-primary-foreground">{action}</button>
  ) : null;
  return (
    <section className="mx-auto mt-6 flex min-h-[360px] max-w-[940px] flex-col items-center justify-center rounded-[10px] border bg-card px-6 text-center" aria-busy={busy || undefined}>
      {busy ? <LoaderCircle aria-hidden="true" className="h-7 w-7 animate-spin text-primary" /> : <AlertTriangle aria-hidden="true" className="h-7 w-7 text-muted-foreground" />}
      <h2 className="mt-4 text-base font-semibold text-foreground">{title}</h2>
      {description ? <p className="mt-2 max-w-lg text-sm leading-6 text-muted-foreground">{description}</p> : null}
      {content}
    </section>
  );
}

function queueReason(locale: Locale, item: ReviewItem): string {
  if (item.category === "low-confidence") return copy(locale, "lowReason");
  if (item.category === "expert-disagreement") return copy(locale, "disagreementReason");
  if (item.category === "score-anomaly") return copy(locale, "anomalyReason");
  return copy(locale, "reviewReason");
}

function reviewDetailHref(taskId: string, studentId: string, questionId: string): string {
  return `/tasks/${encodeURIComponent(taskId)}/review/${encodeURIComponent(studentId)}/${encodeURIComponent(questionId)}`;
}

function formatMetricPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(1)}%`;
}
