import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  FileCheck2,
  List,
  Loader2,
  Plus,
  Save,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Link, Navigate, useBeforeUnload, useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useTask, useUpdateProblem } from "@/api/hooks/tasks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { MarkdownMath } from "@/components/ui/MarkdownMath";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import { isProgrammingProblem } from "@/lib/questionPreparation";
import type { AICompletionProvenance, AICompletionTarget, ProblemInfo, TestCase } from "@/types";

const SECTIONS = ["content", "rubric", "answer", "code", "tests"] as const;
type PreparationSection = (typeof SECTIONS)[number];

const SECTION_META: Record<PreparationSection, { title: string; description: string }> = {
  content: { title: "题干校对", description: "只处理题干内容；其他资料分别在对应页面完成。" },
  rubric: { title: "评分标准", description: "逐题校对评分依据，避免与标答或测试样例混在同一长页。" },
  answer: { title: "标答", description: "逐题查看或补充参考答案；批量资料导入将在独立流程中完成。" },
  code: { title: "示例正确代码", description: "只为编程题维护可运行的参考实现，并单独确认 AI 生成来源。" },
  tests: { title: "测试样例", description: "只为编程题维护可执行的输入、预期输出与说明。" },
};
const SECTION_META_EN: Record<PreparationSection, { title: string; description: string }> = {
  content: { title: "Problem Stem", description: "Review only the stem here. Each other material has its own focused page." },
  rubric: { title: "Grading Rubric", description: "Review grading criteria without mixing answers or test cases into the same long page." },
  answer: { title: "Reference Answer", description: "Review or add one answer at a time. Bulk material import remains a separate flow." },
  code: { title: "Reference Solution Code", description: "Maintain a runnable reference implementation for programming problems and confirm AI provenance separately." },
  tests: { title: "Test Cases", description: "Maintain executable inputs, expected outputs, and notes for programming problems only." },
};

export function QuestionPreparationDetailPage() {
  const { taskId, questionId, section: rawSection } = useParams();
  const section = isPreparationSection(rawSection) ? rawSection : "content";
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const taskQuery = useTask(taskId);
  const updateProblem = useUpdateProblem();
  const { locale } = useI18n();
  const sectionMeta = getSectionMeta(section, locale);

  const problems = useMemo(
    () => sortProblems(Object.values(taskQuery.data?.problem_data ?? {}), locale),
    [locale, taskQuery.data?.problem_data],
  );
  const query = searchParams.get("q") ?? "";
  const view = searchParams.get("view") === "all" ? "all" : "single";
  const filtered = useMemo(() => filterProblems(problems, query), [problems, query]);
  const currentIndex = filtered.findIndex((problem) => problem.q_id === questionId);
  const current = currentIndex >= 0 ? filtered[currentIndex] : null;
  const previous = currentIndex > 0 ? filtered[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < filtered.length - 1 ? filtered[currentIndex + 1] : null;

  if (!taskId) {
    return <EmptyState title={tx(locale, "缺少任务 ID", "Task ID is missing")} description={tx(locale, "请从题目准备总览重新进入。", "Reopen this page from Problem Preparation Overview.")} />;
  }
  if (rawSection && !isPreparationSection(rawSection)) {
    const serialized = searchParams.toString();
    return <Navigate to={`/tasks/${taskId}/questions/${encodeURIComponent(questionId ?? "")}/content${serialized ? `?${serialized}` : ""}`} replace />;
  }
  if (taskQuery.data?.status === "draft") {
    return <Navigate to={`/tasks/${taskId}/upload/problems`} replace />;
  }
  if (taskQuery.data?.status === "extracting_problems") {
    return <Navigate to={`/tasks/${taskId}/problems/progress`} replace />;
  }

  const setQuery = (value: string) => {
    const nextParams = new URLSearchParams(searchParams);
    if (value.trim()) nextParams.set("q", value);
    else nextParams.delete("q");
    setSearchParams(nextParams, { replace: true });
  };
  const setView = (nextView: "single" | "all") => {
    const nextParams = new URLSearchParams(searchParams);
    if (nextView === "all") nextParams.set("view", "all");
    else nextParams.delete("view");
    setSearchParams(nextParams, { replace: true });
  };
  const goToProblem = (targetId: string) => {
    navigate(buildSectionHref(taskId, targetId, section, searchParams));
  };

  const requestedReturnPath = searchParams.get("from");
  const returnPath = requestedReturnPath?.startsWith(`/tasks/${taskId}/questions`)
    ? requestedReturnPath
    : `/tasks/${taskId}/questions`;
  const readOnly = Boolean(taskQuery.data && taskQuery.data.status !== "problems_ready");

  return (
    <div className="w-full max-w-[1300px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link
            to={returnPath}
            className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
            {tx(locale, "返回题目准备总览", "Back to Problem Preparation")}
          </Link>
          <h1 className="text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
            {sectionMeta.title}
          </h1>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{sectionMeta.description}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {section !== "content" && section !== "code" ? (
            <Link
              to={`/tasks/${taskId}/questions/import?targets=${section === "rubric" ? "rubric" : section === "answer" ? "answer" : "tests"}`}
              className="inline-flex h-8 items-center rounded-[7px] border bg-card px-3 text-xs font-semibold text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              {tx(locale, "批量导入此类资料", "Bulk Import This Material")}
            </Link>
          ) : null}
          {current && isSectionMissing(current, section) && sectionTarget(section) ? (
            <Link
              to={`/tasks/${taskId}/questions/ai-complete?q_id=${encodeURIComponent(current.q_id)}&target=${sectionTarget(section)}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-[7px] bg-primary px-3 text-xs font-semibold text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
              {tx(locale, "AI 补全此项", "AI Complete This Item")}
            </Link>
          ) : null}
          <span className="text-xs text-muted-foreground">{taskQuery.data?.name ?? ""}</span>
        </div>
      </div>
      <NewTaskStepper currentStep={1} />

      <nav aria-label={tx(locale, "题目资料类型", "Problem material type")} className="mt-7 overflow-x-auto border-b">
        <div className="flex min-w-max gap-7">
          {SECTIONS.map((item) => (
            <Link
              key={item}
              to={buildSectionHref(taskId, questionId ?? filtered[0]?.q_id ?? "", item, searchParams)}
              className={cn(
                "border-b-2 px-1 pb-3 text-sm font-medium transition-colors",
                item === section
                  ? "border-primary font-semibold text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {getSectionMeta(item, locale).title}
            </Link>
          ))}
        </div>
      </nav>

      <section className="mt-5 rounded-[10px] border bg-card p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_220px_auto] lg:items-end">
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            {tx(locale, "智能筛选题目", "Smart Problem Filter")}
            <span className="relative block">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tx(locale, "题号、题型、内容，或“缺标答 / 缺评分 / 编程题”", "Number, type, text, or “missing answer / missing rubric / programming”")}
                className="h-10 w-full rounded-md border bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
            </span>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            {tx(locale, "当前筛选结果", "Current Filtered Result")}
            <span className="relative block">
              <select
                value={current?.q_id ?? ""}
                onChange={(event) => goToProblem(event.target.value)}
                disabled={filtered.length === 0 || view === "all"}
                className="h-10 w-full appearance-none rounded-md border bg-background px-3 pr-9 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
              >
                {filtered.map((problem) => (
                  <option key={problem.q_id} value={problem.q_id}>
                    {problem.number || problem.q_id} · {problem.type || tx(locale, "未分类", "Uncategorized")}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            </span>
          </label>
          <div className="grid grid-cols-2 rounded-md border bg-muted/40 p-1" role="group" aria-label={tx(locale, "查看方式", "View mode")}>
            <button
              type="button"
              onClick={() => setView("single")}
              aria-pressed={view === "single"}
              className={cn("h-8 rounded px-3 text-xs font-medium", view === "single" ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}
            >
              {tx(locale, "单题", "Single")}
            </button>
            <button
              type="button"
              onClick={() => setView("all")}
              aria-pressed={view === "all"}
              className={cn("h-8 rounded px-3 text-xs font-medium", view === "all" ? "bg-card text-primary shadow-sm" : "text-muted-foreground")}
            >
              {tx(locale, "全部", "All")}
            </button>
          </div>
        </div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {tx(locale, "当前为可解释的本地筛选；“缺标答、缺评分、编程题、已确认”等条件可直接组合使用。", "This is an explainable local filter. Conditions such as “missing answer”, “missing rubric”, “programming”, and “confirmed” can be combined.")}
        </p>
      </section>

      {taskQuery.isLoading ? (
        <LoadingPanel />
      ) : taskQuery.isError ? (
        <EmptyState
          title={tx(locale, "无法读取题目", "Problems could not be loaded")}
          description={tx(locale, "请检查连接后重试。", "Check the connection and retry.")}
          action={<Button onClick={() => void taskQuery.refetch()}>{tx(locale, "重新加载", "Reload")}</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState title={tx(locale, "没有匹配的题目", "No matching problems")} description={tx(locale, "清空或调整筛选条件后重试。", "Clear or adjust the filter and try again.")} />
      ) : view === "all" ? (
        <AllQuestionsView
          taskId={taskId}
          section={section}
          problems={filtered}
          searchParams={searchParams}
          locale={locale}
        />
      ) : current ? (
        <SingleQuestionView
          taskId={taskId}
          section={section}
          problem={current}
          position={currentIndex + 1}
          total={filtered.length}
          previous={previous}
          next={next}
          searchParams={searchParams}
          updateProblem={updateProblem}
          readOnly={readOnly}
          locale={locale}
        />
      ) : (
        <EmptyState
          title={tx(locale, "当前题目不在筛选结果中", "This problem is outside the filtered results")}
          description={tx(locale, "选择一个匹配题目，或清空筛选条件。", "Choose a matching problem or clear the filter.")}
          action={<Button onClick={() => goToProblem(filtered[0].q_id)}>{tx(locale, "打开第一个结果", "Open First Result")}</Button>}
        />
      )}
    </div>
  );
}

function SingleQuestionView({
  taskId,
  section,
  problem,
  position,
  total,
  previous,
  next,
  searchParams,
  updateProblem,
  readOnly,
  locale,
}: {
  taskId: string;
  section: PreparationSection;
  problem: ProblemInfo;
  position: number;
  total: number;
  previous: ProblemInfo | null;
  next: ProblemInfo | null;
  searchParams: URLSearchParams;
  updateProblem: ReturnType<typeof useUpdateProblem>;
  readOnly: boolean;
  locale: string;
}) {
  const [stem, setStem] = useState(problem.stem ?? "");
  const [criterion, setCriterion] = useState(problem.criterion ?? "");
  const [referenceAnswer, setReferenceAnswer] = useState(problem.reference_answer ?? "");
  const [solutionCode, setSolutionCode] = useState(problem.solution_code ?? "");
  const [testCases, setTestCases] = useState<TestCase[]>(problem.test_cases ?? []);
  const [saved, setSaved] = useState(false);
  const previousQuestionIdRef = useRef(problem.q_id);

  useEffect(() => {
    setStem(problem.stem ?? "");
    setCriterion(problem.criterion ?? "");
    setReferenceAnswer(problem.reference_answer ?? "");
    setSolutionCode(problem.solution_code ?? "");
    setTestCases(problem.test_cases ?? []);
    if (previousQuestionIdRef.current !== problem.q_id) setSaved(false);
    previousQuestionIdRef.current = problem.q_id;
  }, [problem]);

  const currentValue = section === "content"
    ? stem
    : section === "rubric"
      ? criterion
      : section === "answer"
        ? referenceAnswer
        : solutionCode;
  const originalValue = section === "content"
    ? problem.stem
    : section === "rubric"
      ? problem.criterion
      : section === "answer"
        ? problem.reference_answer ?? ""
        : problem.solution_code ?? "";
  const dirty = section === "tests"
    ? JSON.stringify(testCases) !== JSON.stringify(problem.test_cases ?? [])
    : currentValue !== originalValue;
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    dirty && (
      currentLocation.pathname !== nextLocation.pathname ||
      currentLocation.search !== nextLocation.search
    )
  ));

  useBeforeUnload(useCallback((event) => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  }, [dirty]));

  const save = async (confirm = false) => {
    const patch = section === "content"
      ? { stem }
      : section === "rubric"
        ? { criterion }
        : section === "answer"
          ? { reference_answer: referenceAnswer }
          : section === "code"
            ? { solution_code: solutionCode }
            : { test_cases: testCases };
    try {
      await updateProblem.mutateAsync({
        taskId,
        qId: problem.q_id,
        ...patch,
        ...(confirm ? { review_status: "confirmed" as const } : {}),
      });
      setSaved(true);
    } catch {
      setSaved(false);
    }
  };

  const isProgramming = isProgrammingProblem(problem);
  const canEdit = !readOnly && (!["code", "tests"].includes(section) || isProgramming);
  const provenanceTarget = sectionTarget(section);
  const provenance = provenanceTarget ? problem.ai_completion_provenance?.[provenanceTarget] : undefined;
  const sectionConfirmed = sectionReviewStatus(problem, section) === "confirmed";

  return (
    <section className="mt-5 rounded-[10px] border bg-card p-5 sm:p-7">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-xl font-bold">{problemLabel(problem, locale)}</h2>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-muted-foreground dark:bg-slate-800">
              {problem.type || tx(locale, "未分类", "Uncategorized")}
            </span>
            <SectionReviewBadge problem={problem} section={section} locale={locale} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">{tx(locale, `筛选结果中的第 ${position} / ${total} 题`, `${position} of ${total} filtered problems`)}</p>
        </div>
        <div className="flex gap-2">
          <QuestionArrow taskId={taskId} section={section} target={previous} direction="previous" searchParams={searchParams} locale={locale} />
          <QuestionArrow taskId={taskId} section={section} target={next} direction="next" searchParams={searchParams} locale={locale} />
        </div>
      </div>

      <div className="py-5">
        {readOnly ? (
          <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            {tx(locale, "当前任务已进入后续处理阶段，本页只读；返回题目准备阶段后才能修改。", "This task has entered a later processing stage, so this page is read-only.")}
          </p>
        ) : null}
        {provenance ? <AIProvenanceNotice provenance={provenance} locale={locale} /> : null}
        {["code", "tests"].includes(section) && !isProgramming ? (
          <div className="rounded-lg border border-dashed px-5 py-10 text-center text-sm text-muted-foreground">
            {tx(locale, "这不是编程题，无需配置示例代码或测试样例。", "This is not a programming problem, so solution code and test cases are not required.")}
          </div>
        ) : section === "tests" ? (
          <TestCaseEditor
            cases={testCases}
            onChange={(nextCases) => { setSaved(false); setTestCases(nextCases); }}
            disabled={updateProblem.isPending || readOnly}
            locale={locale}
          />
        ) : (
          <label className="grid gap-2 text-sm font-semibold text-foreground">
            {getSectionMeta(section, locale).title}
            <textarea
              value={currentValue}
              onChange={(event) => {
                setSaved(false);
                if (section === "content") setStem(event.target.value);
                else if (section === "rubric") setCriterion(event.target.value);
                else if (section === "answer") setReferenceAnswer(event.target.value);
                else setSolutionCode(event.target.value);
              }}
              rows={section === "content" ? 10 : 8}
              disabled={readOnly || updateProblem.isPending}
              placeholder={section === "answer"
                ? tx(locale, "输入参考答案；如需批量导入，请在后续独立导入页处理。", "Enter the reference answer. Bulk import is handled in a separate flow.")
                : section === "code"
                  ? tx(locale, "输入可运行的示例正确代码。", "Enter runnable reference solution code.")
                  : tx(locale, "输入内容", "Enter content")}
              className={cn("min-h-[210px] w-full resize-y rounded-lg border bg-background px-4 py-3 text-sm font-normal leading-6 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15", section === "code" && "font-mono text-xs")}
            />
          </label>
        )}
      </div>

      {updateProblem.isError ? (
        <p role="alert" className="mb-3 text-sm text-danger">{tx(locale, "保存失败；任务可能正在处理其他阶段，请刷新后重试。", "Save failed. The task may be processing another stage; refresh and retry.")}</p>
      ) : null}
      {saved ? <p role="status" className="mb-3 text-sm text-accent">{tx(locale, "已保存。", "Saved.")}</p> : null}
      {canEdit ? <div className="flex flex-col-reverse gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="secondary"
          disabled={updateProblem.isPending || (!dirty && sectionConfirmed)}
          onClick={() => void save(true)}
        >
          {updateProblem.isPending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Check aria-hidden="true" className="h-4 w-4" />}
          {tx(locale, "保存并确认", "Save & Confirm")}
        </Button>
        <Button type="button" disabled={!dirty || updateProblem.isPending} onClick={() => void save(false)}>
          {updateProblem.isPending ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Save aria-hidden="true" className="h-4 w-4" />}
          {tx(locale, "保存修改", "Save Changes")}
        </Button>
      </div> : null}

      {blocker.state === "blocked" ? (
        <UnsavedChangesDialog
          title={tx(locale, "离开且不保存？", "Leave without saving?")}
          description={tx(locale, "当前题目的修改尚未保存，切换页面后会丢失。", "This problem has unsaved changes that will be lost.")}
          stayLabel={tx(locale, "继续编辑", "Keep Editing")}
          leaveLabel={tx(locale, "放弃修改", "Discard Changes")}
          onStay={() => blocker.reset()}
          onLeave={() => blocker.proceed()}
        />
      ) : null}
    </section>
  );
}

function AllQuestionsView({
  taskId,
  section,
  problems,
  searchParams,
  locale,
}: {
  taskId: string;
  section: PreparationSection;
  problems: ProblemInfo[];
  searchParams: URLSearchParams;
  locale: string;
}) {
  return (
    <section className="mt-5 grid gap-3" aria-label={tx(locale, `${getSectionMeta(section, locale).title}全部题目`, `All problems: ${getSectionMeta(section, locale).title}`)}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <List aria-hidden="true" className="h-4 w-4" />
        {tx(locale, `仅纵向展示“${getSectionMeta(section, locale).title}”这一维度；点击某题进入编辑。`, `Only ${getSectionMeta(section, locale).title} is shown in this vertical view. Select a problem to edit it.`)}
      </div>
      {problems.map((problem) => (
        <Link
          key={problem.q_id}
          to={buildSectionHref(taskId, problem.q_id, section, withoutView(searchParams))}
          className="rounded-[10px] border bg-card p-5 transition-colors hover:border-primary/50 hover:bg-blue-50/30 dark:hover:bg-blue-950/10"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="font-semibold">{problemLabel(problem, locale)}</span>
              <span className="text-xs text-muted-foreground">{problem.type || tx(locale, "未分类", "Uncategorized")}</span>
            </div>
            <SectionReviewBadge problem={problem} section={section} locale={locale} />
          </div>
          <div className="mt-3 rounded-md bg-slate-50 px-4 py-3 dark:bg-slate-900/30">
            <SectionPreview problem={problem} section={section} locale={locale} />
          </div>
        </Link>
      ))}
    </section>
  );
}

function SectionPreview({ problem, section, locale }: { problem: ProblemInfo; section: PreparationSection; locale: string }) {
  if (section === "tests") {
    const count = problem.test_cases?.length ?? 0;
    return <p className="text-sm text-muted-foreground">{count > 0 ? tx(locale, `${count} 个测试样例`, `${count} test case(s)`) : tx(locale, "缺少测试样例", "Missing test cases")}</p>;
  }
  const value = section === "content"
    ? problem.stem
    : section === "rubric"
      ? problem.criterion
      : section === "answer"
        ? problem.reference_answer
        : problem.solution_code;
  return value ? <MarkdownMath className="line-clamp-4">{value}</MarkdownMath> : <p className="text-sm text-warning">{tx(locale, "缺失", "Missing")}</p>;
}

function TestCaseEditor({ cases, onChange, disabled, locale }: { cases: TestCase[]; onChange: (cases: TestCase[]) => void; disabled: boolean; locale: string }) {
  if (cases.length === 0) {
    return (
      <div className="rounded-lg border border-dashed px-5 py-10 text-center">
        <FileCheck2 aria-hidden="true" className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-semibold">{tx(locale, "尚无测试样例", "No test cases yet")}</p>
        <p className="mt-1 text-xs text-muted-foreground">{tx(locale, "手动添加一个样例；批量导入将在独立页面完成。", "Add one case manually. Bulk import remains a separate flow.")}</p>
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => onChange([emptyTestCase()])}
          disabled={disabled}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          {tx(locale, "添加测试样例", "Add Test Case")}
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      {cases.map((testCase, index) => (
        <article key={index} className="rounded-lg border bg-slate-50 p-4 dark:bg-slate-900/30">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">{tx(locale, `测试样例 ${index + 1}`, `Test Case ${index + 1}`)}</h3>
            <button
              type="button"
              onClick={() => onChange(cases.filter((_, itemIndex) => itemIndex !== index))}
              disabled={disabled}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-danger"
              aria-label={tx(locale, `删除测试样例 ${index + 1}`, `Delete test case ${index + 1}`)}
            >
              <Trash2 aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <CaseField label={tx(locale, "输入", "Input")} value={testCase.input} disabled={disabled} onChange={(value) => updateCase(cases, index, { input: value }, onChange)} />
            <CaseField label={tx(locale, "预期输出", "Expected Output")} value={testCase.expected_output} disabled={disabled} onChange={(value) => updateCase(cases, index, { expected_output: value }, onChange)} />
          </div>
          <div className="mt-3">
            <CaseField label={tx(locale, "说明（可选）", "Description (optional)")} value={testCase.description} rows={2} disabled={disabled} onChange={(value) => updateCase(cases, index, { description: value }, onChange)} />
          </div>
        </article>
      ))}
      <Button type="button" variant="secondary" className="w-fit" onClick={() => onChange([...cases, emptyTestCase()])} disabled={disabled}>
        <Plus aria-hidden="true" className="h-4 w-4" />
        {tx(locale, "添加测试样例", "Add Test Case")}
      </Button>
    </div>
  );
}

function CaseField({ label, value, rows = 4, disabled, onChange }: { label: string; value: string; rows?: number; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      <textarea
        value={value}
        rows={rows}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="w-full resize-y rounded-md border bg-card px-3 py-2 font-mono text-xs leading-5 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </label>
  );
}

function QuestionArrow({ taskId, section, target, direction, searchParams, locale }: { taskId: string; section: PreparationSection; target: ProblemInfo | null; direction: "previous" | "next"; searchParams: URLSearchParams; locale: string }) {
  const label = direction === "previous" ? tx(locale, "上一题", "Previous") : tx(locale, "下一题", "Next");
  const icon = direction === "previous" ? <ArrowLeft aria-hidden="true" className="h-4 w-4" /> : <ArrowRight aria-hidden="true" className="h-4 w-4" />;
  if (!target) return <Button type="button" variant="secondary" disabled>{direction === "previous" ? icon : null}{label}{direction === "next" ? icon : null}</Button>;
  return (
    <Link
      to={buildSectionHref(taskId, target.q_id, section, searchParams)}
      className="inline-flex h-9 min-w-0 items-center justify-center gap-2 rounded-md border bg-card px-3 text-sm font-medium text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
    >
      {direction === "previous" ? icon : null}{label}{direction === "next" ? icon : null}
    </Link>
  );
}

function AIProvenanceNotice({ provenance, locale }: { provenance: AICompletionProvenance; locale: string }) {
  const status = provenance.review_status;
  const statusLabel = status === "confirmed"
    ? tx(locale, "AI 生成，已确认", "AI Generated, Confirmed")
    : status === "edited"
      ? tx(locale, "AI 生成，已修改待确认", "AI Generated, Edited")
      : tx(locale, "AI 生成，待确认", "AI Generated, Needs Confirmation");
  return (
    <div className="mb-4 flex min-w-0 flex-col gap-2 rounded-[8px] border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900 dark:bg-amber-950/20 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-2">
        <Sparkles aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-600" />
        <span className="text-xs font-semibold text-amber-800 dark:text-amber-200">{statusLabel}</span>
      </div>
      {provenance.provider_id ? <span className="truncate text-[11px] text-muted-foreground" title={provenance.provider_id}>{provenance.provider_id}</span> : null}
    </div>
  );
}

function SectionReviewBadge({ problem, section, locale }: { problem: ProblemInfo; section: PreparationSection; locale: string }) {
  if (section === "content") return <ReviewBadge status={problem.review_status} locale={locale} />;
  const target = sectionTarget(section);
  if (!target) return null;
  if (problem.ai_completion_provenance?.[target]) {
    return <SlotAIReviewBadge problem={problem} section={section} locale={locale} />;
  }
  const material = materialSlotProvenance(problem, target);
  if (!material) return null;
  const label = material.review_status === "confirmed"
    ? tx(locale, "导入资料已确认", "Imported, Confirmed")
    : material.review_status === "edited"
      ? tx(locale, "导入资料已修改", "Imported, Edited")
      : tx(locale, "导入资料待确认", "Imported, Review");
  return (
    <span className={cn(
      "rounded-full px-2.5 py-1 text-xs font-medium",
      material.review_status === "confirmed"
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
        : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
    )}>
      {label}
    </span>
  );
}

function SlotAIReviewBadge({ problem, section, locale }: { problem: ProblemInfo; section: PreparationSection; locale: string }) {
  const target = sectionTarget(section);
  const provenance = target ? problem.ai_completion_provenance?.[target] : undefined;
  if (!provenance) return null;
  const label = provenance.review_status === "confirmed"
    ? tx(locale, "AI 已确认", "AI Confirmed")
    : provenance.review_status === "edited"
      ? tx(locale, "AI 已修改", "AI Edited")
      : tx(locale, "AI 待确认", "AI Review");
  return <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", provenance.review_status === "confirmed" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300")}>{label}</span>;
}

function ReviewBadge({ status, locale }: { status?: ProblemInfo["review_status"]; locale: string }) {
  if (status === "confirmed") return <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">{tx(locale, "已确认", "Confirmed")}</span>;
  if (status === "edited") return <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-medium text-blue-700">{tx(locale, "已修改待确认", "Edited, Needs Confirmation")}</span>;
  return <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">{tx(locale, "待确认", "Needs Review")}</span>;
}

function LoadingPanel() {
  return <div className="mt-5 flex min-h-64 items-center justify-center rounded-[10px] border bg-card"><Loader2 aria-hidden="true" className="h-6 w-6 animate-spin text-primary" /></div>;
}

function isPreparationSection(value?: string): value is PreparationSection {
  return Boolean(value && SECTIONS.includes(value as PreparationSection));
}

function sectionTarget(section: PreparationSection): AICompletionTarget | null {
  if (section === "rubric") return "criterion";
  if (section === "answer") return "reference_answer";
  if (section === "code") return "solution_code";
  if (section === "tests") return "test_cases";
  return null;
}

function materialSlotProvenance(problem: ProblemInfo, target: AICompletionTarget) {
  if (target === "solution_code") return undefined;
  return problem.material_provenance?.[target];
}

function sectionReviewStatus(problem: ProblemInfo, section: PreparationSection) {
  if (section === "content") return problem.review_status;
  const target = sectionTarget(section);
  if (!target) return undefined;
  return problem.ai_completion_provenance?.[target]?.review_status
    ?? materialSlotProvenance(problem, target)?.review_status;
}

function isSectionMissing(problem: ProblemInfo, section: PreparationSection): boolean {
  if (section === "rubric") return !problem.criterion?.trim();
  if (section === "answer") return !problem.reference_answer?.trim();
  if (section === "code") return isProgrammingProblem(problem) && !problem.solution_code?.trim();
  if (section === "tests") return isProgrammingProblem(problem) && (problem.test_cases?.length ?? 0) === 0;
  return false;
}

function buildSectionHref(taskId: string, questionId: string, section: PreparationSection, params: URLSearchParams): string {
  const suffix = params.toString();
  return `/tasks/${taskId}/questions/${encodeURIComponent(questionId)}/${section}${suffix ? `?${suffix}` : ""}`;
}

function withoutView(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  next.delete("view");
  return next;
}

function sortProblems(problems: ProblemInfo[], locale: string): ProblemInfo[] {
  return [...problems].sort((a, b) => (a.number || a.q_id).localeCompare(b.number || b.q_id, locale, { numeric: true }));
}

function filterProblems(problems: ProblemInfo[], rawQuery: string): ProblemInfo[] {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return problems;
  const tokens = query.split(/[\s,，;；]+/).filter(Boolean);
  return problems.filter((problem) => tokens.every((token) => {
    if (["缺标答", "missing-answer", "no-answer"].includes(token)) return !problem.reference_answer?.trim();
    if (["缺评分", "缺标准", "missing-rubric"].includes(token)) return !problem.criterion?.trim();
    if (["缺代码", "缺示例代码", "missing-code"].includes(token)) return isProgrammingProblem(problem) && !problem.solution_code?.trim();
    if (["编程题", "编程", "programming"].includes(token)) return isProgrammingProblem(problem);
    if (["已确认", "confirmed"].includes(token)) return problem.review_status === "confirmed";
    if (["待确认", "needs-review"].includes(token)) return problem.review_status !== "confirmed";
    const haystack = [problem.number, problem.q_id, problem.type, problem.stem, problem.criterion, problem.reference_answer ?? "", problem.solution_code ?? ""].join(" ").toLocaleLowerCase();
    return haystack.includes(token);
  }));
}

function emptyTestCase(): TestCase {
  return { input: "", expected_output: "", description: "", source: "teacher", sandbox_feasible: true };
}

function updateCase(cases: TestCase[], index: number, patch: Partial<TestCase>, onChange: (cases: TestCase[]) => void) {
  onChange(cases.map((testCase, itemIndex) => itemIndex === index ? { ...testCase, ...patch } : testCase));
}

function getSectionMeta(section: PreparationSection, locale: string) {
  return locale === "zh-CN" ? SECTION_META[section] : SECTION_META_EN[section];
}

function tx(locale: string, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}

function problemLabel(problem: ProblemInfo, locale: string): string {
  const value = problem.number || problem.q_id;
  return tx(locale, `第 ${value} 题`, `Problem ${value}`);
}
