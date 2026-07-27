import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, List, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  effectiveCorrectionScore,
  formatConfidence,
  formatPercent,
  formatScore,
  type QuestionSummary,
  type ResultsModel,
  type StudentSummary,
} from "@/components/tasks/resultsModel";
import { MarkdownMath } from "@/components/ui/MarkdownMath";
import type { Locale } from "@/i18n/messages";
import { cn } from "@/lib/cn";
import {
  matchReviewItems,
  questionSearchItems,
  studentSearchItems,
  type ReviewSearchItem,
  type ReviewSearchMatch,
} from "@/lib/reviewDetail";
import { ResultQuestionSidebar, type ResultQuestionState } from "@/routes/tasks/results/ResultQuestionSidebar";
import type { Correction } from "@/types";

/** A05: read-only formal-result detail with independent student and question dimensions. */
export function StudentAnalysisDetail({ locale, taskId, studentId, model }: { locale: Locale; taskId: string; studentId: string; model: ResultsModel }) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const studentQuery = searchParams.get("student_q") ?? "";
  const questionQuery = searchParams.get("question_q") ?? "";
  const selectedQuestionId = searchParams.get("question") ?? "all";
  const returnQuery = searchParams.get("return") ?? "";
  const allQuestions = selectedQuestionId === "all";
  const student = model.students.find((item) => item.id === studentId) ?? null;
  const question = allQuestions ? null : model.questions.find((item) => item.id === selectedQuestionId) ?? null;
  const studentMatches = useMemo(() => matchReviewItems(studentSearchItems(model.students), studentQuery), [model.students, studentQuery]);
  const questionMatches = useMemo(() => matchReviewItems(questionSearchItems(model.questions), questionQuery), [model.questions, questionQuery]);
  const visibleQuestions = useMemo(() => questionMatches.map((match) => model.questions.find((item) => item.id === match.item.id)).filter((item): item is QuestionSummary => Boolean(item)), [model.questions, questionMatches]);
  const studentIndex = studentMatches.findIndex((match) => match.item.id === studentId);
  const questionIndex = questionMatches.findIndex((match) => match.item.id === selectedQuestionId);
  const previousStudent = studentIndex > 0 ? studentMatches[studentIndex - 1]?.item : null;
  const nextStudent = studentIndex >= 0 && studentIndex < studentMatches.length - 1 ? studentMatches[studentIndex + 1]?.item : null;
  const previousQuestion = questionIndex > 0 ? questionMatches[questionIndex - 1]?.item : null;
  const nextQuestion = questionIndex >= 0 && questionIndex < questionMatches.length - 1 ? questionMatches[questionIndex + 1]?.item : null;
  const studentsRoot = `/tasks/${encodeURIComponent(taskId)}/results/students`;
  const listHref = returnQuery ? `${studentsRoot}?${returnQuery}` : studentsRoot;
  const [activeQuestionId, setActiveQuestionId] = useState(selectedQuestionId === "all" ? visibleQuestions[0]?.id ?? null : selectedQuestionId);

  const buildHref = useCallback((nextStudentId: string, nextQuestionId: string, includeQuestionHash = true) => {
    const next = new URLSearchParams(searchParams);
    if (nextQuestionId === "all") next.delete("question");
    else next.set("question", nextQuestionId);
    const serialized = next.toString();
    const hash = includeQuestionHash && nextQuestionId !== "all" ? `#question-${encodeURIComponent(nextQuestionId)}` : "";
    return `${studentsRoot}/${encodeURIComponent(nextStudentId)}${serialized ? `?${serialized}` : ""}${hash}`;
  }, [searchParams, studentsRoot]);

  const setFilter = (key: "student_q" | "question_q", value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

  const goTo = useCallback((nextStudentId: string, nextQuestionId: string) => navigate(buildHref(nextStudentId, nextQuestionId)), [buildHref, navigate]);
  const goToStudent = useCallback((nextStudentId: string) => navigate(buildHref(nextStudentId, selectedQuestionId, false)), [buildHref, navigate, selectedQuestionId]);

  const scrollToQuestion = useCallback((nextQuestionId: string) => {
    setActiveQuestionId(nextQuestionId);
    document.getElementById(`question-${nextQuestionId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  useEffect(() => {
    if (!allQuestions) {
      setActiveQuestionId(selectedQuestionId);
      return;
    }
    if (!visibleQuestions.some((item) => item.id === activeQuestionId)) {
      setActiveQuestionId(visibleQuestions[0]?.id ?? null);
    }
  }, [activeQuestionId, allQuestions, selectedQuestionId, visibleQuestions]);

  useEffect(() => {
    if (!allQuestions || !visibleQuestions.length) return undefined;
    const syncActiveQuestion = () => {
      const atDocumentEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 8;
      if (atDocumentEnd) {
        setActiveQuestionId(visibleQuestions[visibleQuestions.length - 1].id);
        return;
      }
      let activeId = visibleQuestions[0].id;
      for (const item of visibleQuestions) {
        const element = document.getElementById(`question-${item.id}`);
        if (element && element.getBoundingClientRect().top <= 112) activeId = item.id;
      }
      setActiveQuestionId(activeId);
    };
    syncActiveQuestion();
    window.addEventListener("scroll", syncActiveQuestion, { passive: true });
    return () => window.removeEventListener("scroll", syncActiveQuestion);
  }, [allQuestions, visibleQuestions]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || isEditableTarget(event.target)) return;
      if (event.key === "ArrowLeft" && previousStudent) {
        event.preventDefault();
        goToStudent(previousStudent.id);
      } else if (event.key === "ArrowRight" && nextStudent) {
        event.preventDefault();
        goToStudent(nextStudent.id);
      } else if (!allQuestions && event.key === "ArrowUp" && previousQuestion) {
        event.preventDefault();
        goTo(studentId, previousQuestion.id);
      } else if (!allQuestions && event.key === "ArrowDown" && nextQuestion) {
        event.preventDefault();
        goTo(studentId, nextQuestion.id);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [allQuestions, goTo, goToStudent, nextQuestion, nextStudent, previousQuestion, previousStudent, selectedQuestionId, studentId]);

  if (!student) {
    return <DetailState locale={locale} title={tx(locale, `当前正式结果中没有学生 ${studentId}。`, `Student ${studentId} is not present in this formal result.`)} href={listHref} />;
  }
  if (!allQuestions && !question) {
    return <DetailState locale={locale} title={tx(locale, `当前正式结果中没有题目 ${selectedQuestionId}。`, `Question ${selectedQuestionId} is not present in this formal result.`)} href={buildHref(student.id, "all")} />;
  }

  const pendingReviewCount = student.corrections.filter((correction) => correctionNeedsFormalReview(correction) && correction.review_status !== "confirmed").length;
  const validCorrectionCount = student.corrections.filter((correction) => correction.max_score > 0).length;
  const studentReturn = searchParams.toString();

  return (
    <section className="rounded-[10px] border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to={listHref} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-primary hover:underline"><ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />{tx(locale, "返回学生分析总览", "Back to student overview")}</Link>
          <h2 className="mt-2 text-[22px] font-bold tracking-[-0.01em] text-foreground">{student.name}</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">{student.id} · {allQuestions ? tx(locale, "全部题目长视图", "All-questions view") : question?.label}</p>
        </div>
        <StudentStepButtons locale={locale} previous={previousStudent} next={nextStudent} onSelect={goToStudent} />
      </div>

      <DimensionBar
        className="mt-4"
        locale={locale}
        dimension="student"
        value={studentQuery}
        current={{ id: student.id, primary: student.name, secondary: student.id, exactValues: [student.id, student.name], searchable: [student.id, student.name] }}
        matches={studentMatches}
        allItems={studentSearchItems(model.students)}
        previous={previousStudent}
        next={nextStudent}
        onQuery={(value) => setFilter("student_q", value)}
        onSelect={goToStudent}
      />
      <QuestionFilterBar
        locale={locale}
        value={questionQuery}
        matches={questionMatches}
        onQuery={(value) => setFilter("question_q", value)}
        onSelect={(id) => goTo(student.id, id)}
        onShowAll={() => goTo(student.id, "all")}
        showingAll={allQuestions}
      />

      <p className="mt-2 text-[10px] text-muted-foreground">{tx(locale, "学生与题目筛选互不影响。输入框聚焦时方向键只编辑文本；退出后 ←/→ 切换学生，单题模式下 ↑/↓ 切换题目。", "Student and question filters stay independent. Arrow keys edit text while focused; after leaving, ←/→ switch students and ↑/↓ switch questions in focused mode.")}</p>

      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-6">
        <DetailMetric label={tx(locale, "总分", "Total score")} value={`${formatScore(student.totalScore)} / ${formatScore(student.totalMax)}`} tone="primary" />
        <DetailMetric label={tx(locale, "得分率", "Score rate")} value={formatPercent(student.percent)} tone="accent" />
        <DetailMetric label={tx(locale, "平均置信度", "Mean confidence")} value={formatConfidence(student.avgConfidence)} tone="primary" />
        <DetailMetric label={tx(locale, "及格状态", "Pass status")} value={student.percent === null ? "—" : student.percent >= 60 ? tx(locale, "及格", "Passed") : tx(locale, "未及格", "Failed")} tone={student.percent !== null && student.percent < 60 ? "danger" : "accent"} />
        <DetailMetric label={tx(locale, "低置信题次", "Low-confidence items")} value={String(student.lowConfidenceCount)} tone="warning" />
        <DetailMetric label={tx(locale, "仍待确认", "Pending confirmation")} value={String(pendingReviewCount)} tone="danger" />
      </div>

      <div className="mt-5 grid items-start gap-4 lg:grid-cols-[132px_minmax(0,1fr)]">
        <ResultQuestionSidebar
          locale={locale}
          questions={visibleQuestions}
          activeId={activeQuestionId}
          onSelect={allQuestions ? scrollToQuestion : (id) => goTo(student.id, id)}
          stateForQuestion={(item) => questionStateForStudent(student, item.id)}
        />
        <div className="min-w-0">
          {allQuestions ? (
            <AllQuestionsView locale={locale} taskId={taskId} student={student} questions={visibleQuestions} validCorrectionCount={validCorrectionCount} studentReturn={studentReturn} onFocus={(id) => goTo(student.id, id)} />
          ) : question ? (
            <FocusedQuestionView locale={locale} taskId={taskId} student={student} question={question} studentReturn={studentReturn} previous={previousQuestion} next={nextQuestion} onSelect={(id) => goTo(student.id, id)} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function QuestionFilterBar({ locale, value, matches, showingAll, onQuery, onSelect, onShowAll }: {
  locale: Locale;
  value: string;
  matches: ReviewSearchMatch[];
  showingAll: boolean;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onShowAll: () => void;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const [open, setOpen] = useState(false);
  const composingRef = useRef(false);

  useEffect(() => {
    if (!composingRef.current) setDraftValue(value);
  }, [value]);

  return (
    <section className="relative mt-2.5 rounded-[9px] border bg-background p-2.5" aria-label={tx(locale, "题目筛选", "Question filter")}>
      <div className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{tx(locale, "搜索题目", "Search questions")}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={draftValue}
            inputMode="search"
            onFocus={() => setOpen(true)}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              const nextValue = event.currentTarget.value;
              setDraftValue(nextValue);
              window.setTimeout(() => onQuery(nextValue), 0);
            }}
            onChange={(event) => {
              const nextValue = event.target.value;
              setDraftValue(nextValue);
              if (!composingRef.current) onQuery(nextValue);
              setOpen(true);
            }}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            placeholder={tx(locale, "输入题号、题型、题干，或“积分题”", "Number, type, stem, or “integration”")}
            className="h-10 w-full rounded-[8px] border bg-card pl-10 pr-10 text-xs text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
          {draftValue ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setDraftValue(""); onQuery(""); setOpen(false); }} aria-label={tx(locale, "清空题目筛选", "Clear question filter")} className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X aria-hidden="true" className="h-3.5 w-3.5" /></button> : null}
          {open && draftValue.trim() && draftValue === value ? <SearchResults locale={locale} matches={matches} onSelect={(id) => { onSelect(id); setOpen(false); }} /> : null}
        </label>
        {!showingAll ? <button type="button" onClick={onShowAll} className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-[8px] border bg-card px-3 text-xs font-semibold text-foreground hover:bg-muted"><List aria-hidden="true" className="h-4 w-4" />{tx(locale, "全部题目", "All questions")}</button> : null}
      </div>
      <p className="mt-2 px-1 text-[10px] leading-4 text-muted-foreground">{tx(locale, "搜索只筛选题目，当前学生保持不变；输入中文时在选词完成后应用。", "Search filters questions only and keeps the current student; IME text is applied after composition.")}</p>
    </section>
  );
}

function DimensionBar({ className, locale, dimension, value, current, matches, allItems, previous, next, allMode = false, onQuery, onSelect, onAll }: {
  className?: string;
  locale: Locale;
  dimension: "student" | "question";
  value: string;
  current: ReviewSearchItem | null;
  matches: ReviewSearchMatch[];
  allItems: ReviewSearchItem[];
  previous: ReviewSearchItem | null;
  next: ReviewSearchItem | null;
  allMode?: boolean;
  onQuery: (value: string) => void;
  onSelect: (id: string) => void;
  onAll?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftValue, setDraftValue] = useState(value);
  const composingRef = useRef(false);
  const isStudent = dimension === "student";

  useEffect(() => {
    if (!composingRef.current) setDraftValue(value);
  }, [value]);

  return (
    <section className={cn("relative grid gap-2 rounded-[9px] border bg-background px-3 py-2 md:grid-cols-[96px_150px_minmax(170px,1fr)_180px_96px] md:items-center", className)} aria-label={isStudent ? tx(locale, "学生导航", "Student navigation") : tx(locale, "题目导航", "Question navigation")}>
      <NavButton disabled={!previous || allMode} onClick={() => previous && onSelect(previous.id)} icon={isStudent ? ArrowLeft : ArrowUp} label={isStudent ? tx(locale, "上一位", "Previous") : tx(locale, "上一题", "Previous Q")} shortcut={isStudent ? "←" : "↑"} />
      <div className="min-w-0 px-2 text-center"><p className="truncate text-[12px] font-bold text-foreground">{allMode ? tx(locale, "全部题目", "All questions") : current?.primary ?? "—"}</p><p className="truncate text-[10px] text-muted-foreground">{allMode ? tx(locale, "学生保持不变", "Student stays fixed") : current?.secondary}</p></div>
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={draftValue}
          inputMode="search"
          onFocus={() => setOpen(true)}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            const nextValue = event.currentTarget.value;
            setDraftValue(nextValue);
            window.setTimeout(() => onQuery(nextValue), 0);
          }}
          onChange={(event) => {
            const nextValue = event.target.value;
            setDraftValue(nextValue);
            if (!composingRef.current) onQuery(nextValue);
            setOpen(true);
          }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          placeholder={isStudent ? tx(locale, "输入姓名、学号或“低置信”", "Name, ID, or low confidence") : tx(locale, "输入题号、题型、题干或“积分题”", "Number, type, stem, or integration")}
          className="h-8 w-full rounded-[7px] border bg-card pl-9 pr-8 text-[11px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        />
        {draftValue ? <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { setDraftValue(""); onQuery(""); setOpen(false); }} aria-label={tx(locale, "清空当前维度筛选", "Clear this dimension filter")} className="absolute right-1.5 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"><X aria-hidden="true" className="h-3.5 w-3.5" /></button> : null}
        {open && draftValue.trim() && draftValue === value ? <SearchResults locale={locale} matches={matches} onSelect={(id) => { onSelect(id); setOpen(false); }} /> : null}
      </div>
      <select value={allMode ? "all" : current?.id ?? ""} onChange={(event) => event.target.value === "all" ? onAll?.() : onSelect(event.target.value)} aria-label={isStudent ? tx(locale, "直接选择学生", "Select student directly") : tx(locale, "直接选择题目", "Select question directly")} className="h-8 w-full rounded-[7px] border bg-card px-2 text-[11px] font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15">
        {!isStudent ? <option value="all">{tx(locale, "全部题目长视图", "All-questions view")}</option> : null}
        {allItems.map((item) => <option key={item.id} value={item.id}>{item.primary} · {item.secondary}</option>)}
      </select>
      <NavButton disabled={!next || allMode} onClick={() => next && onSelect(next.id)} icon={isStudent ? ArrowRight : ArrowDown} label={isStudent ? tx(locale, "下一位", "Next") : tx(locale, "下一题", "Next Q")} shortcut={isStudent ? "→" : "↓"} trailing />
    </section>
  );
}

function SearchResults({ locale, matches, onSelect }: { locale: Locale; matches: ReviewSearchMatch[]; onSelect: (id: string) => void }) {
  return <div className="absolute left-0 right-0 top-9 z-30 max-h-60 overflow-y-auto rounded-[8px] border bg-card p-1.5 shadow-lg">{matches.length ? matches.slice(0, 12).map((match) => <button key={match.item.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onSelect(match.item.id)} className="flex w-full items-center gap-3 rounded-[6px] px-2.5 py-2 text-left hover:bg-muted"><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-foreground">{match.item.primary}</span><span className="block truncate text-[10px] text-muted-foreground">{match.item.secondary}</span></span><span className={cn("rounded-full px-2 py-1 text-[9px] font-semibold", match.kind === "exact" ? "bg-emerald-100 text-emerald-700" : "bg-blue-50 text-primary")}>{match.kind === "exact" ? tx(locale, "完全匹配", "Exact") : tx(locale, "相关匹配", "Related")}</span></button>) : <p className="px-3 py-4 text-center text-xs text-muted-foreground">{tx(locale, "没有匹配项，可清空当前筛选。", "No matches. Clear this filter to reset.")}</p>}</div>;
}

function AllQuestionsView({ locale, taskId, student, questions, validCorrectionCount, studentReturn, onFocus }: { locale: Locale; taskId: string; student: StudentSummary; questions: QuestionSummary[]; validCorrectionCount: number; studentReturn: string; onFocus: (id: string) => void }) {
  return (
    <section aria-labelledby="student-all-questions-title">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 id="student-all-questions-title" className="text-[16px] font-bold text-foreground">{tx(locale, "全部题目", "All questions")}</h3><p className="mt-1 text-[11px] text-muted-foreground">{tx(locale, "长滚动视图保留每道题的答案与最终结果；可筛选后只看匹配题。", "The long view keeps each answer and final result; filter to narrow the questions.")}</p></div><span className="text-[11px] text-muted-foreground">{tx(locale, `${questions.length} 道筛选结果 · ${validCorrectionCount} 道可计算得分率`, `${questions.length} filtered · ${validCorrectionCount} with comparable rates`)}</span></div>
      {questions.length ? <div className="mt-3 grid gap-3">{questions.map((question) => <QuestionResultCard key={question.id} locale={locale} taskId={taskId} student={student} question={question} studentReturn={studentReturn} compact onFocus={() => onFocus(question.id)} />)}</div> : <PanelEmpty locale={locale} text={tx(locale, "当前题目筛选没有结果；清空题目筛选即可恢复。", "No questions match this filter; clear the question filter to restore all.")} />}
    </section>
  );
}

function FocusedQuestionView({ locale, taskId, student, question, studentReturn, previous, next, onSelect }: { locale: Locale; taskId: string; student: StudentSummary; question: QuestionSummary; studentReturn: string; previous: ReviewSearchItem | null; next: ReviewSearchItem | null; onSelect: (id: string) => void }) {
  return (
    <section aria-labelledby="student-focused-question-title">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 id="student-focused-question-title" className="text-[16px] font-bold text-foreground">{tx(locale, "单题聚焦", "Focused question")}</h3><p className="mt-1 text-[11px] text-muted-foreground">{tx(locale, "学生保持不变；题目筛选、选择和上下键只改变题目维度。", "The student stays fixed; question search, selection, and ↑/↓ change only the question dimension.")}</p></div><QuestionStepButtons locale={locale} previous={previous} next={next} onSelect={onSelect} /></div>
      <div className="mt-3"><QuestionResultCard locale={locale} taskId={taskId} student={student} question={question} studentReturn={studentReturn} /></div>
      <div className="mt-3 flex justify-end"><QuestionStepButtons locale={locale} previous={previous} next={next} onSelect={onSelect} /></div>
    </section>
  );
}

function QuestionResultCard({ locale, taskId, student, question, studentReturn, compact = false, onFocus }: { locale: Locale; taskId: string; student: StudentSummary; question: QuestionSummary; studentReturn: string; compact?: boolean; onFocus?: () => void }) {
  const correction = student.corrections.find((item) => item.q_id === question.id);
  const answer = student.answerByQuestion.get(question.id);
  if (!correction) return <article className="rounded-[9px] border px-4 py-5"><p className="text-[12px] text-muted-foreground">{question.label} · {tx(locale, "当前学生没有该题批改结果。", "No grading result is available for this student.")}</p></article>;
  const finalScore = effectiveCorrectionScore(correction);
  const percent = correction.max_score > 0 ? (finalScore / correction.max_score) * 100 : null;
  return (
    <article id={`question-${question.id}`} className="scroll-mt-24 rounded-[9px] border px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><div className="flex flex-wrap items-center gap-2"><h4 className="text-[15px] font-bold text-foreground">{question.label}</h4><span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{question.type || tx(locale, "未标题型", "Unlabelled type")}</span><ReviewStatus locale={locale} correction={correction} /></div><p className="mt-1 text-[11px] text-muted-foreground">{tx(locale, `最终 ${formatScore(finalScore)} / ${formatScore(correction.max_score)} · ${formatPercent(percent)} · 置信度 ${formatConfidence(correction.confidence)}`, `Final ${formatScore(finalScore)} / ${formatScore(correction.max_score)} · ${formatPercent(percent)} · confidence ${formatConfidence(correction.confidence)}`)}</p></div>
        <div className="flex flex-wrap items-center gap-2">{compact && onFocus ? <button type="button" onClick={onFocus} className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-primary px-3 text-[11px] font-semibold text-primary-foreground"><List aria-hidden="true" className="h-3.5 w-3.5" />{tx(locale, "单题查看", "Focus")}</button> : null}<Link to={questionDetailHref(taskId, student.id, question.id, studentReturn)} className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border bg-card px-3 text-[11px] font-semibold text-primary hover:bg-muted">{tx(locale, "题目分析", "Question analysis")}<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></Link></div>
      </div>

      <div className={cn("mt-3 grid gap-3", compact ? "lg:grid-cols-2" : "xl:grid-cols-2")}>
        <ContentPanel title={tx(locale, "学生作答", "Student answer")}><MarkdownMath className={cn("text-[13px] leading-6 text-foreground", compact && "line-clamp-5")}>{answer?.content || tx(locale, "未识别到该题作答。", "No answer was recognized for this question.")}</MarkdownMath></ContentPanel>
        <ContentPanel title={tx(locale, "AI 判定与依据", "AI decision & rationale")} meta={`${formatScore(correction.score)} / ${formatScore(correction.max_score)}`}><MarkdownMath className={cn("text-[12px] leading-5 text-muted-foreground", compact && "line-clamp-5")}>{correction.comment || tx(locale, "AI 未返回文字依据。", "The AI returned no written rationale.")}</MarkdownMath><div className="mt-3 grid grid-cols-3 gap-2"><SmallSignal label={tx(locale, "置信度", "Confidence")} value={formatConfidence(correction.confidence)} /><SmallSignal label={tx(locale, "专家数", "Experts")} value={String(correction.expert_results?.length ?? 0)} /><SmallSignal label={tx(locale, "合成方式", "Synthesis")} value={formatSynthesis(correction.synthesis_method, locale)} /></div></ContentPanel>
        <ContentPanel title={tx(locale, "教师最终结果", "Teacher final result")} meta={`${formatScore(finalScore)} / ${formatScore(correction.max_score)}`}><p className="text-[12px] leading-5 text-foreground">{correction.teacher_comment?.trim() || tx(locale, "教师未另加评语；最终分沿用确认后的结果。", "No separate teacher comment; the confirmed score remains final.")}</p><p className="mt-3 text-[10px] text-muted-foreground">{tx(locale, `状态：${reviewStatusText(locale, correction)}`, `Status: ${reviewStatusText(locale, correction)}`)}</p></ContentPanel>
        <ContentPanel title={tx(locale, "题干与评分标准", "Question & rubric")}><MarkdownMath className={cn("text-[12px] leading-5 text-foreground", compact && "line-clamp-3")}>{question.stem || tx(locale, "未提供题干。", "No question stem was provided.")}</MarkdownMath><div className="my-3 border-t" /><MarkdownMath className={cn("text-[12px] leading-5 text-muted-foreground", compact && "line-clamp-3")}>{question.criterion || tx(locale, "未提供评分标准。", "No rubric was provided.")}</MarkdownMath></ContentPanel>
      </div>
    </article>
  );
}

function ContentPanel({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return <section className="min-w-0 rounded-[8px] bg-muted/45 px-4 py-3"><div className="flex items-center justify-between gap-3"><h5 className="text-[11px] font-bold text-foreground">{title}</h5>{meta ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-primary">{meta}</span> : null}</div><div className="mt-2">{children}</div></section>;
}

function DetailMetric({ label, value, tone }: { label: string; value: string; tone: "primary" | "accent" | "warning" | "danger" }) {
  return <div className="rounded-[9px] border px-3 py-3"><strong className={cn("text-[17px] leading-6", tone === "primary" && "text-primary", tone === "accent" && "text-teal-500", tone === "warning" && "text-amber-500", tone === "danger" && "text-rose-500")}>{value}</strong><span className="mt-1 block text-[10px] font-medium text-muted-foreground">{label}</span></div>;
}

function SmallSignal({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-[7px] bg-card px-2 py-2"><span className="block truncate text-[9px] text-muted-foreground">{label}</span><strong className="mt-0.5 block truncate text-[10px] text-foreground" title={value}>{value}</strong></div>;
}

function StudentStepButtons({ locale, previous, next, onSelect }: { locale: Locale; previous: ReviewSearchItem | null; next: ReviewSearchItem | null; onSelect: (id: string) => void }) {
  return <div className="flex items-center gap-2"><button type="button" disabled={!previous} onClick={() => previous && onSelect(previous.id)} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border bg-card px-3 text-[11px] font-semibold text-foreground hover:bg-muted disabled:opacity-35"><ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />{tx(locale, "上一位", "Previous")}</button><button type="button" disabled={!next} onClick={() => next && onSelect(next.id)} className="inline-flex h-9 items-center gap-1.5 rounded-[7px] border bg-card px-3 text-[11px] font-semibold text-foreground hover:bg-muted disabled:opacity-35">{tx(locale, "下一位", "Next")}<ArrowRight aria-hidden="true" className="h-3.5 w-3.5" /></button></div>;
}

function QuestionStepButtons({ locale, previous, next, onSelect }: { locale: Locale; previous: ReviewSearchItem | null; next: ReviewSearchItem | null; onSelect: (id: string) => void }) {
  return <div className="flex items-center gap-2"><button type="button" disabled={!previous} onClick={() => previous && onSelect(previous.id)} className="inline-flex h-8 items-center gap-1 rounded-[7px] border bg-card px-3 text-[10px] font-semibold text-foreground hover:bg-muted disabled:opacity-35"><ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />{tx(locale, "上一题", "Previous Q")}</button><button type="button" disabled={!next} onClick={() => next && onSelect(next.id)} className="inline-flex h-8 items-center gap-1 rounded-[7px] border bg-card px-3 text-[10px] font-semibold text-foreground hover:bg-muted disabled:opacity-35">{tx(locale, "下一题", "Next Q")}<ArrowDown aria-hidden="true" className="h-3.5 w-3.5" /></button></div>;
}

function NavButton({ disabled, onClick, icon: Icon, label, shortcut, trailing = false }: { disabled: boolean; onClick: () => void; icon: typeof ArrowLeft; label: string; shortcut: string; trailing?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="inline-flex h-8 items-center justify-center gap-1 whitespace-nowrap rounded-[7px] border bg-card px-2 text-[10px] font-semibold text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-35">{!trailing ? <Icon aria-hidden="true" className="h-3.5 w-3.5" /> : null}<span>{label}</span><kbd className="rounded bg-muted px-1 py-0.5 font-mono text-[8px] text-muted-foreground">{shortcut}</kbd>{trailing ? <Icon aria-hidden="true" className="h-3.5 w-3.5" /> : null}</button>;
}

function ReviewStatus({ locale, correction }: { locale: Locale; correction: Correction }) {
  const confirmed = correction.review_status === "confirmed";
  const edited = correction.review_status === "edited" || typeof correction.teacher_score === "number" || Boolean(correction.teacher_comment?.trim());
  const required = correctionNeedsFormalReview(correction);
  const label = confirmed ? tx(locale, "已确认", "Confirmed") : edited ? tx(locale, "已修改", "Edited") : required ? tx(locale, "待确认", "Pending") : tx(locale, "无必审项", "No required review");
  return <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-semibold", confirmed ? "bg-emerald-100 text-emerald-700" : edited ? "bg-blue-50 text-primary" : required ? "bg-rose-100 text-rose-700" : "bg-slate-100 text-slate-600")}>{label}</span>;
}

function DetailState({ locale, title, href }: { locale: Locale; title: string; href: string }) {
  return <section className="rounded-[10px] border bg-card px-6 py-12 text-center"><h2 className="text-[18px] font-bold text-foreground">{title}</h2><Link to={href} className="mt-5 inline-flex h-9 items-center gap-2 rounded-[8px] bg-primary px-4 text-[12px] font-semibold text-primary-foreground"><ArrowLeft aria-hidden="true" className="h-4 w-4" />{tx(locale, "返回学生总览", "Back to student overview")}</Link></section>;
}

function PanelEmpty({ locale, text }: { locale: Locale; text: string }) {
  return <div className="mt-3 rounded-[9px] border border-dashed px-5 py-10 text-center text-[12px] text-muted-foreground" aria-label={tx(locale, "空结果", "Empty result")}>{text}</div>;
}

function questionDetailHref(taskId: string, studentId: string, questionId: string, studentReturn: string): string {
  const params = new URLSearchParams({ student: studentId });
  if (studentReturn) params.set("student_return", studentReturn);
  return `/tasks/${encodeURIComponent(taskId)}/results/questions/${encodeURIComponent(questionId)}?${params.toString()}`;
}

function correctionNeedsFormalReview(correction: Correction): boolean {
  const confidence = normalizeConfidence(correction.confidence);
  return (confidence !== null && confidence < 0.65) || correction.requires_human_review || correction.review_reasons?.some((reason) => reason === "high_indecisiveness" || reason === "score_spread_high") || correction.synthesis_method === "all_failed" || correction.synthesis_method === "quota_exhausted" || correctionHasDisagreement(correction);
}

function questionStateForStudent(student: StudentSummary, questionId: string): ResultQuestionState {
  const correction = student.corrections.find((item) => item.q_id === questionId);
  if (!correction) return "muted";
  if (correction.review_status === "confirmed") return "ready";
  return correctionNeedsFormalReview(correction) ? "warning" : "ready";
}

function correctionHasDisagreement(correction: Correction): boolean {
  if (correction.review_reasons?.some((reason) => reason === "high_indecisiveness" || reason === "score_spread_high")) return true;
  const scores = correction.expert_results?.map((result) => Number(result.score)).filter(Number.isFinite) ?? [];
  return scores.length > 1 && correction.max_score > 0 && Math.max(...scores) - Math.min(...scores) > Math.max(1, correction.max_score * 0.25);
}

function reviewStatusText(locale: Locale, correction: Correction): string {
  if (correction.review_status === "confirmed") return tx(locale, "已确认", "Confirmed");
  if (correction.review_status === "edited" || typeof correction.teacher_score === "number" || correction.teacher_comment?.trim()) return tx(locale, "教师已修改", "Teacher edited");
  return correctionNeedsFormalReview(correction) ? tx(locale, "仍待确认", "Pending confirmation") : tx(locale, "无必审项", "No required review");
}

function formatSynthesis(value: string | null | undefined, locale: Locale): string {
  const labels: Record<string, [string, string]> = { single: ["单专家", "Single"], median: ["中位数", "Median"], multi_sample: ["多次采样", "Multi-sample"], weighted_average: ["加权平均", "Weighted"], judge_agent: ["裁判模型", "Judge"], degraded_to_single: ["降级单专家", "Fallback"], all_failed: ["全部失败", "Failed"], quota_exhausted: ["额度耗尽", "Quota"] };
  const pair = value ? labels[value] : null;
  return pair ? pair[locale === "en-US" ? 1 : 0] : value || "—";
}

function normalizeConfidence(value: number | null | undefined): number | null { if (typeof value !== "number" || !Number.isFinite(value)) return null; return value > 1 ? value / 100 : value; }
function isEditableTarget(target: EventTarget | null): boolean { return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)); }
function tx(locale: Locale, zh: string, en: string): string { return locale === "en-US" ? en : zh; }
