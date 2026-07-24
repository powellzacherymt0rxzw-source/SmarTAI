import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  List,
  LoaderCircle,
  Save,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { normalizeAPIError } from "@/api/client";
import { useTask, useTaskResult, useUpdateCorrectionReview } from "@/api/hooks/tasks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import {
  buildResultsModel,
  effectiveCorrectionScore,
  formatConfidence,
  formatScore,
  type QuestionSummary,
  type StudentSummary,
} from "@/components/tasks/resultsModel";
import { MarkdownMath } from "@/components/ui/MarkdownMath";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/messages";
import { cn } from "@/lib/cn";
import {
  matchReviewItems,
  questionSearchItems,
  studentSearchItems,
  type ReviewSearchItem,
  type ReviewSearchMatch,
} from "@/lib/reviewDetail";
import { getTaskDestination } from "@/lib/taskFlow";
import type { Correction } from "@/types";

/** R02: focused, auditable teacher review across independent student/question dimensions. */
export function ReviewDetailPage() {
  const { taskId, studentId, questionId } = useParams();
  const { locale } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const taskQuery = useTask(taskId);
  const resultQuery = useTaskResult(taskId);
  const updateReview = useUpdateCorrectionReview();
  const model = useMemo(() => buildResultsModel(taskQuery.data, resultQuery.data), [resultQuery.data, taskQuery.data]);
  const student = model.students.find((item) => item.id === studentId) ?? null;
  const allQuestions = questionId === "all";
  const question = allQuestions ? null : model.questions.find((item) => item.id === questionId) ?? null;
  const correction = student && question
    ? student.corrections.find((item) => item.q_id === question.id) ?? null
    : null;
  const answer = student && question ? student.answerByQuestion.get(question.id) : null;
  const studentQuery = searchParams.get("student") ?? "";
  const questionQuery = searchParams.get("question") ?? "";
  const students = useMemo(() => matchReviewItems(studentSearchItems(model.students), studentQuery), [model.students, studentQuery]);
  const questions = useMemo(() => matchReviewItems(questionSearchItems(model.questions), questionQuery), [model.questions, questionQuery]);
  const visibleQuestions = useMemo(
    () => questions.map((match) => model.questions.find((item) => item.id === match.item.id)).filter((item): item is QuestionSummary => Boolean(item)),
    [model.questions, questions],
  );
  const studentIndex = students.findIndex((match) => match.item.id === studentId);
  const questionIndex = questions.findIndex((match) => match.item.id === questionId);
  const previousStudent = studentIndex > 0 ? students[studentIndex - 1]?.item : null;
  const nextStudent = studentIndex >= 0 && studentIndex < students.length - 1 ? students[studentIndex + 1]?.item : null;
  const previousQuestion = questionIndex > 0 ? questions[questionIndex - 1]?.item : null;
  const nextQuestion = questionIndex >= 0 && questionIndex < questions.length - 1 ? questions[questionIndex + 1]?.item : null;
  const persistedScore = correction ? effectiveCorrectionScore(correction) : 0;
  const persistedComment = correction?.teacher_comment ?? "";
  const [score, setScore] = useState(String(persistedScore));
  const [comment, setComment] = useState(persistedComment);
  const [scoreError, setScoreError] = useState("");
  const searchParamsRef = useRef(searchParams);
  const dirty = Boolean(correction) && (score !== String(persistedScore) || comment !== persistedComment);
  const blocker = useBlocker(dirty && !updateReview.isPending);

  useEffect(() => {
    searchParamsRef.current = searchParams;
  }, [searchParams]);

  useEffect(() => {
    setScore(String(persistedScore));
    setComment(persistedComment);
    setScoreError("");
  }, [correction?.q_id, persistedComment, persistedScore, student?.id]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm(tx(locale, "当前修改尚未保存，确定离开吗？", "Your changes are not saved. Leave this item?"))) blocker.proceed();
    else blocker.reset();
  }, [blocker, locale]);

  const buildHref = useCallback((nextStudentId: string, nextQuestionId: string) => {
    const serialized = searchParams.toString();
    return `/tasks/${encodeURIComponent(taskId ?? "")}/review/${encodeURIComponent(nextStudentId)}/${encodeURIComponent(nextQuestionId)}${serialized ? `?${serialized}` : ""}`;
  }, [searchParams, taskId]);

  const setFilter = useCallback((key: "student" | "question", value: string) => {
    const next = new URLSearchParams(searchParamsRef.current);
    if (value.trim()) next.set(key, value);
    else next.delete(key);
    searchParamsRef.current = next;
    setSearchParams(next, { replace: true });
  }, [setSearchParams]);

  const goTo = useCallback((nextStudentId: string, nextQuestionId: string) => {
    navigate(buildHref(nextStudentId, nextQuestionId));
  }, [buildHref, navigate]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isInteractiveTarget(event.target)) return;
      if (event.key === "ArrowLeft" && previousStudent && studentId && questionId) {
        event.preventDefault();
        goTo(previousStudent.id, questionId);
      } else if (event.key === "ArrowRight" && nextStudent && studentId && questionId) {
        event.preventDefault();
        goTo(nextStudent.id, questionId);
      } else if (!allQuestions && event.key === "ArrowUp" && previousQuestion && studentId) {
        event.preventDefault();
        goTo(studentId, previousQuestion.id);
      } else if (!allQuestions && event.key === "ArrowDown" && nextQuestion && studentId) {
        event.preventDefault();
        goTo(studentId, nextQuestion.id);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [allQuestions, goTo, nextQuestion, nextStudent, previousQuestion, previousStudent, questionId, studentId]);

  if (taskId && taskQuery.data?.status === "grading") return <Navigate replace to={`/tasks/${taskId}/grading/progress`} />;
  if (taskId && taskQuery.data && ![
    "graded", "review_confirmed", "generating_analysis", "finalized",
  ].includes(taskQuery.data.status)) return <Navigate replace to={getTaskDestination(taskQuery.data)} />;

  const loading = taskQuery.isLoading || resultQuery.isLoading;
  const failed = taskQuery.isError || resultQuery.isError;

  async function saveReview(confirm: boolean) {
    if (!taskId || !student || !question || !correction || !taskQuery.data) return;
    const numericScore = Number(score);
    if (!Number.isFinite(numericScore) || numericScore < 0 || numericScore > correction.max_score) {
      const message = tx(locale, `请输入 0–${formatScore(correction.max_score)} 之间的分数。`, `Enter a score from 0 to ${formatScore(correction.max_score)}.`);
      setScoreError(message);
      return;
    }
    setScoreError("");
    try {
      await updateReview.mutateAsync({
        taskId,
        studentId: student.id,
        qId: question.id,
        expected_workflow_revision: taskQuery.data.workflow_revision,
        teacher_score: numericScore,
        teacher_comment: comment,
        confirm,
      });
      toast.success(confirm
        ? tx(locale, "复核结果已确认", "Review confirmed")
        : tx(locale, "复核修改已保存", "Review changes saved"));
    } catch (error) {
      const normalized = normalizeAPIError(error);
      toast.error(tx(locale, "保存失败", "Save failed"), { description: normalized.message });
      if (normalized.status === 409) void Promise.all([taskQuery.refetch(), resultQuery.refetch()]);
    }
  }

  return (
    <div className="w-full max-w-[1300px] pb-8">
      <div className="flex min-h-9 flex-col-reverse items-start justify-between gap-3 sm:flex-row sm:gap-5">
        <h1 className="text-[28px] font-bold leading-9 tracking-[-0.02em] text-foreground sm:text-[30px]">
          {allQuestions
            ? tx(locale, `复核详情：${student?.name ?? "—"} · 全部题目`, `Review Detail: ${student?.name ?? "—"} · All Questions`)
            : tx(locale, `复核详情：${student?.name ?? "—"} · ${question?.label ?? "—"}`, `Review Detail: ${student?.name ?? "—"} · ${question?.label ?? "—"}`)}
        </h1>
        {taskId ? (
          <Link to={`/tasks/${taskId}/review`} className="inline-flex h-9 shrink-0 self-end items-center gap-1.5 rounded-[8px] border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted sm:self-auto">
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            {tx(locale, "返回复核总览", "Back to Review Overview")}
          </Link>
        ) : null}
      </div>
      <NewTaskStepper currentStep={5} />

      {!taskId ? (
        <PageState title={tx(locale, "缺少任务 ID", "Task ID is missing")} />
      ) : loading ? (
        <PageState title={tx(locale, "正在加载复核详情…", "Loading review detail…")} busy />
      ) : failed ? (
        <PageState title={tx(locale, "无法加载复核详情", "Could not load review detail")} action={tx(locale, "重试", "Retry")} onAction={() => void Promise.all([taskQuery.refetch(), resultQuery.refetch()])} />
      ) : !student || (!allQuestions && (!question || !correction)) ? (
        <PageState title={tx(locale, "找不到对应的学生或题目", "Student or question not found")} href={`/tasks/${taskId}/review`} action={tx(locale, "返回总览", "Back to Overview")} />
      ) : (
        <>
          <DimensionBar
            className="mt-5"
            locale={locale}
            dimension="student"
            value={studentQuery}
            current={{ id: student.id, primary: student.name, secondary: student.id, exactValues: [], searchable: [] }}
            matches={students}
            previous={previousStudent}
            next={nextStudent}
            onQuery={(value) => setFilter("student", value)}
            onSelect={(id) => goTo(id, questionId ?? "all")}
          />
          <DimensionBar
            className="mt-2.5"
            locale={locale}
            dimension="question"
            value={questionQuery}
            current={question ? questionSearchItems([question])[0] : null}
            matches={questions}
            previous={previousQuestion}
            next={nextQuestion}
            allMode={allQuestions}
            onQuery={(value) => setFilter("question", value)}
            onSelect={(id) => goTo(student.id, id)}
            onAll={() => goTo(student.id, "all")}
          />

          {allQuestions ? (
            <AllQuestionsView
              locale={locale}
              student={student}
              questions={visibleQuestions}
              onFocus={(id) => goTo(student.id, id)}
            />
          ) : question && correction ? (
            <>
              <section className="mt-3.5 min-h-[140px] rounded-[10px] border bg-card px-7 py-5" aria-labelledby="student-answer-title">
                <div className="flex items-center justify-between gap-4">
                  <h2 id="student-answer-title" className="text-[17px] font-bold text-foreground">{tx(locale, "学生作答", "Student Answer")}</h2>
                  <span className="text-xs text-muted-foreground">{student.id} · {question.label}</span>
                </div>
                {answer?.content ? (
                  <MarkdownMath className="mt-3 text-[14px] leading-6 text-foreground">{answer.content}</MarkdownMath>
                ) : (
                  <p className="mt-5 text-sm text-muted-foreground">{tx(locale, "未识别到这道题的作答。", "No answer was recognized for this question.")}</p>
                )}
              </section>

              <div className="mt-[18px] grid gap-5 lg:grid-cols-[minmax(0,600px)_minmax(0,650px)] lg:gap-10">
                <section className="min-h-[220px] rounded-[10px] border bg-card px-7 py-5" aria-labelledby="ai-review-title">
                  <div className="flex items-center justify-between gap-3">
                    <h2 id="ai-review-title" className="text-[17px] font-bold text-foreground">{tx(locale, "AI 判定与依据", "AI Decision & Rationale")}</h2>
                    <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-primary dark:bg-blue-950/50">
                      {formatScore(correction.score)} / {formatScore(correction.max_score)}
                    </span>
                  </div>
                  <MarkdownMath className="mt-3 line-clamp-4 text-[13px] leading-6 text-muted-foreground">{correction.comment || tx(locale, "AI 未返回文字说明。", "The AI returned no written rationale.")}</MarkdownMath>
                  <dl className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                    <Signal label={tx(locale, "置信度", "Confidence")} value={formatConfidence(correction.confidence)} />
                    <Signal label={tx(locale, "专家数", "Experts")} value={String(Math.max(1, correction.expert_results?.length ?? 0))} />
                    <Signal label={tx(locale, "合成方式", "Synthesis")} value={formatSynthesis(correction.synthesis_method, locale)} />
                  </dl>
                  {correction.expert_results?.length ? (
                    <details className="mt-3 text-xs text-muted-foreground">
                      <summary className="cursor-pointer font-semibold text-foreground">{tx(locale, "查看各专家原始结果", "View original expert results")}</summary>
                      <ul className="mt-2 space-y-1.5">
                        {correction.expert_results.map((expert, index) => (
                          <li key={`${expert.provider}-${index}`} className="rounded-md bg-muted/60 px-3 py-2">
                            {expert.provider} · {formatScore(expert.score)}/{formatScore(expert.max_score)} · {formatConfidence(expert.confidence)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </section>

                <section className="min-h-[220px] rounded-[10px] border bg-card px-7 py-5" aria-labelledby="teacher-review-title">
                  <div className="flex items-center justify-between gap-3">
                    <h2 id="teacher-review-title" className="text-[17px] font-bold text-foreground">{tx(locale, "教师最终结果", "Teacher Final Result")}</h2>
                    <ReviewStatus status={correction.review_status} locale={locale} />
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-[150px_minmax(0,1fr)]">
                    <label className="grid content-start gap-1.5 text-xs font-medium text-muted-foreground">
                      {tx(locale, "最终得分", "Final Score")}
                      <span className="flex h-11 items-center rounded-[8px] border bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                        <input
                          value={score}
                          onChange={(event) => setScore(event.target.value)}
                          inputMode="decimal"
                          aria-invalid={Boolean(scoreError)}
                          className="min-w-0 flex-1 bg-transparent px-3 text-sm font-semibold text-foreground outline-none"
                        />
                        <span className="border-l px-3 text-xs">/ {formatScore(correction.max_score)}</span>
                      </span>
                    </label>
                    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                      {tx(locale, "教师评语", "Teacher Comment")}
                      <textarea
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                        rows={2}
                        maxLength={4000}
                        placeholder={tx(locale, "可选：记录改分依据或给学生的反馈", "Optional: explain the override or add student feedback")}
                        className="h-14 resize-none rounded-[8px] border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                      />
                    </label>
                  </div>
                  {scoreError ? <p className="mt-1 text-xs font-medium text-red-500">{scoreError}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                    <button type="button" onClick={() => void saveReview(false)} disabled={updateReview.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] border bg-card px-4 text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-60">
                      {updateReview.isPending ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Save aria-hidden="true" className="h-3.5 w-3.5" />}
                      {tx(locale, "保存修改", "Save Changes")}
                    </button>
                    <button type="button" onClick={() => void saveReview(true)} disabled={updateReview.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-primary px-4 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60">
                      <Check aria-hidden="true" className="h-3.5 w-3.5" />
                      {tx(locale, "确认复核", "Confirm Review")}
                    </button>
                  </div>
                </section>
              </div>

              <section className="mt-3.5 grid min-h-[76px] gap-4 rounded-[10px] border bg-card px-6 py-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-center" aria-labelledby="rubric-title">
                <div className="min-w-0">
                  <h2 id="rubric-title" className="text-[13px] font-bold text-foreground">{tx(locale, "评分标准", "Rubric")}</h2>
                  <MarkdownMath className="mt-1 line-clamp-2 text-[12px] leading-5 text-muted-foreground">{question.criterion || tx(locale, "未提供评分标准。", "No rubric was provided.")}</MarkdownMath>
                </div>
                <QuestionButtons locale={locale} previous={previousQuestion} next={nextQuestion} onSelect={(id) => goTo(student.id, id)} />
              </section>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function DimensionBar({ className, locale, dimension, value, current, matches, previous, next, allMode = false, onQuery, onSelect, onAll }: {
  className?: string;
  locale: Locale;
  dimension: "student" | "question";
  value: string;
  current: ReviewSearchItem | null;
  matches: ReviewSearchMatch[];
  previous: ReviewSearchItem | null;
  next: ReviewSearchItem | null;
  allMode?: boolean;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const student = dimension === "student";
  return (
    <section className={cn("relative grid min-h-[50px] gap-2 rounded-[10px] border bg-card px-3 py-2 md:grid-cols-[132px_minmax(170px,0.7fr)_minmax(300px,1.5fr)_190px] md:items-center", className)} aria-label={student ? tx(locale, "学生导航", "Student navigation") : tx(locale, "题目导航", "Question navigation")}>
      <NavButton disabled={!previous || allMode} onClick={() => previous && onSelect(previous.id)} icon={student ? ArrowLeft : ArrowUp} label={student ? tx(locale, "上一位", "Previous") : tx(locale, "上一题", "Previous Q")} shortcut={student ? "←" : "↑"} />
      <div className="min-w-0 px-2 text-center">
        <p className="truncate text-[13px] font-bold text-foreground">{allMode ? tx(locale, "全部题目长视图", "All Questions View") : current?.primary ?? "—"}</p>
        <p className="truncate text-[11px] text-muted-foreground">{allMode ? tx(locale, "学生不变，筛选题目后可进入单题", "Student stays fixed; filter and open one question") : current?.secondary}</p>
      </div>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={value}
          onFocus={() => setOpen(true)}
          onChange={(event) => { onQuery(event.target.value); setOpen(true); }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder={student ? tx(locale, "姓名、学号，或“低置信”", "Name, ID, or “low confidence”") : tx(locale, "题号、题型、题干，或“积分题”", "Number, type, stem, or “integration”")}
          className="h-8 w-full rounded-[7px] border bg-background pl-9 pr-9 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        {open && value.trim() ? (
          <div className="absolute left-0 right-0 top-9 z-30 max-h-60 overflow-y-auto rounded-[8px] border bg-card p-1.5 shadow-lg">
            {matches.length ? matches.slice(0, 12).map((match) => (
              <button key={match.item.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onSelect(match.item.id); setOpen(false); }} className="flex w-full items-center gap-3 rounded-[6px] px-2.5 py-2 text-left hover:bg-muted">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-foreground">{match.item.primary}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{match.item.secondary}</span>
                </span>
                <span className={cn("rounded-full px-2 py-1 text-[10px] font-semibold", match.kind === "exact" ? "bg-emerald-100 text-emerald-700" : "bg-blue-50 text-primary")}>{match.kind === "exact" ? tx(locale, "完全匹配", "Exact") : tx(locale, "相关匹配", "Related")}</span>
              </button>
            )) : <p className="px-3 py-4 text-center text-xs text-muted-foreground">{tx(locale, "没有匹配项，可清空筛选。", "No matches. Clear the filter to reset.")}</p>}
          </div>
        ) : null}
      </div>
      {allMode && onAll ? (
        <button type="button" onClick={() => matches[0] && onSelect(matches[0].item.id)} disabled={!matches.length} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-[7px] border bg-card px-3 text-xs font-semibold text-primary hover:bg-muted disabled:opacity-50"><List aria-hidden="true" className="h-3.5 w-3.5" />{tx(locale, "进入单题", "Focus One")}</button>
      ) : (
        <div className="flex items-center gap-1.5">
          {!student && onAll ? <button type="button" onClick={onAll} className="inline-flex h-8 flex-1 items-center justify-center rounded-[7px] border bg-card px-2 text-[11px] font-semibold text-foreground hover:bg-muted">{tx(locale, "全部", "All")}</button> : null}
          <NavButton compact disabled={!next} onClick={() => next && onSelect(next.id)} icon={student ? ArrowRight : ArrowDown} label={student ? tx(locale, "下一位", "Next") : tx(locale, "下一题", "Next Q")} shortcut={student ? "→" : "↓"} />
        </div>
      )}
    </section>
  );
}

function NavButton({ disabled, onClick, icon: Icon, label, shortcut, compact = false }: { disabled: boolean; onClick: () => void; icon: typeof ArrowLeft; label: string; shortcut: string; compact?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className={cn("inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[7px] border bg-card px-3 text-[11px] font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-35", compact && "flex-1")}><Icon aria-hidden="true" className="h-3.5 w-3.5" /><span>{label}</span><kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[9px] text-muted-foreground">{shortcut}</kbd></button>;
}

function AllQuestionsView({ locale, student, questions, onFocus }: { locale: Locale; student: StudentSummary; questions: QuestionSummary[]; onFocus: (id: string) => void }) {
  return (
    <section className="mt-3.5" aria-labelledby="all-questions-title">
      <div className="flex items-center justify-between gap-4">
        <h2 id="all-questions-title" className="text-[17px] font-bold text-foreground">{tx(locale, `${student.name} 的全部题目`, `All questions for ${student.name}`)}</h2>
        <span className="text-xs text-muted-foreground">{tx(locale, `${questions.length} 道筛选结果`, `${questions.length} filtered questions`)}</span>
      </div>
      {questions.length ? <div className="mt-3 grid gap-3">
        {questions.map((question) => {
          const correction = student.corrections.find((item) => item.q_id === question.id);
          const answer = student.answerByQuestion.get(question.id);
          if (!correction) return null;
          return (
            <article key={question.id} className="rounded-[10px] border bg-card px-6 py-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h3 className="text-sm font-bold text-foreground">{question.label} · {question.type || tx(locale, "未分类", "Uncategorized")}</h3><p className="mt-1 text-xs text-muted-foreground">{formatScore(effectiveCorrectionScore(correction))}/{formatScore(correction.max_score)} · {formatConfidence(correction.confidence)}</p></div>
                <div className="flex items-center gap-2"><ReviewStatus status={correction.review_status} locale={locale} /><button type="button" onClick={() => onFocus(question.id)} className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-primary px-3 text-xs font-semibold text-primary-foreground">{tx(locale, "进入单题复核", "Open Focused Review")}<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></button></div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-[8px] bg-muted/55 px-4 py-3"><p className="text-[11px] font-semibold text-muted-foreground">{tx(locale, "学生作答", "Student Answer")}</p><MarkdownMath className="mt-1 line-clamp-4 text-[13px] leading-5">{answer?.content || tx(locale, "未识别到作答。", "No answer recognized.")}</MarkdownMath></div>
                <div className="rounded-[8px] bg-muted/55 px-4 py-3"><p className="text-[11px] font-semibold text-muted-foreground">{tx(locale, "AI 依据 / 教师结果", "AI Rationale / Teacher Result")}</p><p className="mt-1 line-clamp-4 text-[13px] leading-5 text-foreground">{correction.teacher_comment?.trim() || correction.comment || "—"}</p></div>
              </div>
            </article>
          );
        })}
      </div> : <PageState title={tx(locale, "当前筛选没有题目", "No questions match this filter")} />}
    </section>
  );
}

function QuestionButtons({ locale, previous, next, onSelect }: { locale: Locale; previous: ReviewSearchItem | null; next: ReviewSearchItem | null; onSelect: (id: string) => void }) {
  return <div className="grid grid-cols-2 gap-2"><button type="button" disabled={!previous} onClick={() => previous && onSelect(previous.id)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[7px] border bg-card text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-35"><ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />{tx(locale, "上一题 ↑", "Previous ↑")}</button><button type="button" disabled={!next} onClick={() => next && onSelect(next.id)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[7px] border bg-card text-xs font-semibold text-foreground hover:bg-muted disabled:opacity-35">{tx(locale, "下一题 ↓", "Next ↓")}<ArrowDown aria-hidden="true" className="h-3.5 w-3.5" /></button></div>;
}

function Signal({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[7px] bg-muted/60 px-3 py-2"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 truncate font-semibold text-foreground" title={value}>{value}</dd></div>;
}

function ReviewStatus({ status = "pending", locale }: { status?: Correction["review_status"]; locale: Locale }) {
  return <span className={cn("rounded-full px-3 py-1 text-[11px] font-semibold", status === "confirmed" ? "bg-emerald-100 text-emerald-700" : status === "edited" ? "bg-blue-50 text-primary" : "bg-amber-100 text-amber-700")}>{status === "confirmed" ? tx(locale, "已确认", "Confirmed") : status === "edited" ? tx(locale, "已修改", "Edited") : tx(locale, "待复核", "Pending")}</span>;
}

function PageState({ title, busy = false, action, href, onAction }: { title: string; busy?: boolean; action?: string; href?: string; onAction?: () => void }) {
  const button = action && href ? <Link to={href} className="mt-4 inline-flex h-9 items-center rounded-[8px] bg-primary px-4 text-xs font-semibold text-primary-foreground">{action}</Link> : action && onAction ? <button type="button" onClick={onAction} className="mt-4 inline-flex h-9 items-center rounded-[8px] bg-primary px-4 text-xs font-semibold text-primary-foreground">{action}</button> : null;
  return <section className="mt-5 flex min-h-[260px] flex-col items-center justify-center rounded-[10px] border bg-card px-6 text-center" aria-busy={busy || undefined}>{busy ? <LoaderCircle aria-hidden="true" className="h-7 w-7 animate-spin text-primary" /> : <AlertTriangle aria-hidden="true" className="h-7 w-7 text-muted-foreground" />}<p className="mt-3 text-sm font-semibold text-foreground">{title}</p>{button}</section>;
}

function formatSynthesis(value: string | null | undefined, locale: Locale) {
  const labels: Record<string, [string, string]> = { single: ["单专家", "Single"], median: ["中位数", "Median"], multi_sample: ["多次采样", "Multi-sample"], weighted_average: ["加权平均", "Weighted"], judge_agent: ["裁判模型", "Judge"], degraded_to_single: ["降级单专家", "Fallback"], all_failed: ["全部失败", "Failed"], quota_exhausted: ["额度耗尽", "Quota"] };
  const pair = value ? labels[value] : null;
  return pair ? (locale === "en-US" ? pair[1] : pair[0]) : (value || "—");
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, button, a, summary, [contenteditable='true'], [role='dialog']"));
}

function tx(locale: Locale, zh: string, en: string) {
  return locale === "en-US" ? en : zh;
}
