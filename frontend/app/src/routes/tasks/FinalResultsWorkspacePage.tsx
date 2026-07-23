import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  FileDown,
  FileText,
  LayoutDashboard,
  ListChecks,
  LoaderCircle,
  Users,
} from "lucide-react";
import type { ComponentType, ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { useTask, useTaskFinalization, useTaskResult } from "@/api/hooks/tasks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import {
  buildResultsModel,
  clampPercent,
  formatPercent,
  type QuestionSummary,
  type ResultsModel,
  type StudentSummary,
} from "@/components/tasks/ResultsLayout";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/messages";
import { cn } from "@/lib/cn";
import { formatTaskTime, getTaskDestination } from "@/lib/taskFlow";
import type { Correction, TaskFinalizationResponse, TaskResultResponse } from "@/types";

type WorkspaceSection = "overview" | "questions" | "students" | "visualizations" | "reports";

interface WorkspaceNavItem {
  key: WorkspaceSection;
  label: string;
  labelEn: string;
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  suffix: string;
}

const WORKSPACE_NAV: WorkspaceNavItem[] = [
  { key: "overview", label: "总览", labelEn: "Overview", icon: LayoutDashboard, suffix: "" },
  { key: "questions", label: "题目分析", labelEn: "Question analysis", icon: ListChecks, suffix: "/questions" },
  { key: "students", label: "学生分析", labelEn: "Student analysis", icon: Users, suffix: "/students" },
  { key: "visualizations", label: "可视化分析", labelEn: "Visual analysis", icon: BarChart3, suffix: "/visualizations" },
  { key: "reports", label: "报告与下载", labelEn: "Reports & downloads", icon: FileDown, suffix: "/reports" },
];

const RESULT_WORKSPACE_STATUSES = new Set(["review_confirmed", "generating_analysis", "finalized"]);

/** A-00: Figma-16 visual language, expanded into the confirmed five-route workspace. */
export function FinalResultsWorkspacePage() {
  const { taskId } = useParams();
  const { locale } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const taskQuery = useTask(taskId);
  const resultQuery = useTaskResult(taskId);
  const finalizationQuery = useTaskFinalization(taskId);
  const task = taskQuery.data;
  const section = sectionFromPath(location.pathname);

  if (taskId && task?.status === "grading") return <Navigate replace to={`/tasks/${taskId}/grading/progress`} />;
  if (taskId && task?.status === "graded") return <Navigate replace to={`/tasks/${taskId}/review`} />;
  if (taskId && task && !RESULT_WORKSPACE_STATUSES.has(task.status)) {
    return <Navigate replace to={getTaskDestination(task)} />;
  }

  if (!taskId) return <Navigate replace to="/history" />;
  if (taskQuery.isLoading || resultQuery.isLoading || finalizationQuery.isLoading) {
    return <WorkspaceState locale={locale} loading />;
  }
  if (taskQuery.isError || resultQuery.isError || finalizationQuery.isError || !task || !finalizationQuery.data) {
    return (
      <WorkspaceState
        locale={locale}
        onRetry={() => void Promise.all([taskQuery.refetch(), resultQuery.refetch(), finalizationQuery.refetch()])}
      />
    );
  }

  const root = `/tasks/${encodeURIComponent(taskId)}/results`;
  const finalization = finalizationQuery.data;
  const result = resultQuery.data;

  return (
    <div className="w-full max-w-[1300px]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
            {tx(locale, "学情分析与导出", "Learning analysis & export")}
          </h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {task.name} · {tx(locale, `正式结果 v${finalization.final_result_version}`, `Formal result v${finalization.final_result_version}`)}
          </p>
        </div>
        <Link to={`/tasks/${encodeURIComponent(taskId)}/review`} className="text-[13px] font-semibold text-primary hover:underline">
          {tx(locale, "返回复核记录", "Review record")}
        </Link>
      </div>

      <NewTaskStepper currentStep={6} />

      <ResultStateBanner locale={locale} finalization={finalization} />

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden overflow-hidden rounded-[10px] border bg-card p-2 lg:block" aria-label={tx(locale, "结果工作区", "Results workspace")}>
          <WorkspaceNavigation locale={locale} root={root} section={section} />
        </aside>

        <label className="block lg:hidden">
          <span className="sr-only">{tx(locale, "切换结果页面", "Switch results page")}</span>
          <select
            value={section}
            onChange={(event) => {
              const item = WORKSPACE_NAV.find((candidate) => candidate.key === event.target.value);
              if (item) navigate(`${root}${item.suffix}`);
            }}
            className="h-11 w-full rounded-[9px] border bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
          >
            {WORKSPACE_NAV.map((item) => (
              <option key={item.key} value={item.key}>{locale === "en-US" ? item.labelEn : item.label}</option>
            ))}
          </select>
        </label>

        <main className="min-w-0">
          <WorkspaceContent
            locale={locale}
            section={section}
            taskId={taskId}
            finalization={finalization}
            result={result}
          />
        </main>
      </div>
    </div>
  );
}

function WorkspaceNavigation({ locale, root, section }: { locale: Locale; root: string; section: WorkspaceSection }) {
  return (
    <nav className="grid gap-1">
      {WORKSPACE_NAV.map((item) => {
        const Icon = item.icon;
        const active = item.key === section;
        return (
          <Link
            key={item.key}
            to={`${root}${item.suffix}`}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex h-11 items-center gap-3 rounded-[8px] px-3 text-[13px] font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
              active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon aria-hidden={true} className="h-[17px] w-[17px]" />
            <span>{locale === "en-US" ? item.labelEn : item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

function ResultStateBanner({ locale, finalization }: { locale: Locale; finalization: TaskFinalizationResponse }) {
  const stale = finalization.final_result_dirty || finalization.analysis_status === "stale";
  return (
    <section className={cn(
      "mt-5 flex min-h-16 flex-wrap items-center gap-4 rounded-[10px] border px-5 py-3",
      stale ? "border-amber-200 bg-amber-50" : "border-blue-100 bg-blue-50/80",
    )}>
      <span className={cn("inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full", stale ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-primary")}>
        {stale ? <AlertTriangle aria-hidden="true" className="h-[18px] w-[18px]" /> : <CheckCircle2 aria-hidden="true" className="h-[18px] w-[18px]" />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-bold text-foreground">
          {stale
            ? tx(locale, "结果已修改，需要重新确认正式版本", "Results changed; reconfirm the formal version")
            : tx(locale, `正式结果 v${finalization.final_result_version} 已保存`, `Formal result v${finalization.final_result_version} saved`)}
        </p>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {tx(locale, "确认时间", "Confirmed")}：{formatTaskTime(finalization.final_result_updated_at ?? undefined, true, locale)} · {analysisStatusLabel(locale, finalization.analysis_status)}
        </p>
      </div>
    </section>
  );
}

function WorkspaceContent({
  locale,
  section,
  taskId,
  finalization,
  result,
}: {
  locale: Locale;
  section: WorkspaceSection;
  taskId: string;
  finalization: TaskFinalizationResponse;
  result?: TaskResultResponse;
}) {
  const questions = Object.values(result?.problem_data ?? {});
  const students = result?.results ?? [];
  const model = buildResultsModel(undefined, result);

  if (section === "overview") {
    return <ResultsOverview locale={locale} taskId={taskId} finalization={finalization} model={model} />;
  }

  if (section === "questions") {
    return (
      <section className="rounded-[10px] border bg-card p-5">
        <SectionHeading locale={locale} title="题目分析" titleEn="Question analysis" description={`当前正式版本包含 ${questions.length} 道题。`} descriptionEn={`The current formal version contains ${questions.length} questions.`} />
        <div className="mt-4 divide-y rounded-[9px] border">
          {questions.slice(0, 6).map((question, index) => (
            <div key={question.q_id ?? index} className="grid gap-1 px-4 py-3 sm:grid-cols-[90px_120px_minmax(0,1fr)] sm:items-center">
              <strong className="text-[13px] text-foreground">{question.number || question.q_id || `Q${index + 1}`}</strong>
              <span className="text-[12px] text-muted-foreground">{question.type || "—"}</span>
              <span className="truncate text-[13px] text-foreground">{question.stem || "—"}</span>
            </div>
          ))}
          {!questions.length ? <EmptyRow locale={locale} /> : null}
        </div>
      </section>
    );
  }

  if (section === "students") {
    return (
      <section className="rounded-[10px] border bg-card p-5">
        <SectionHeading locale={locale} title="学生分析" titleEn="Student analysis" description={`当前正式版本包含 ${students.length} 位学生。`} descriptionEn={`The current formal version contains ${students.length} students.`} />
        <div className="mt-4 divide-y rounded-[9px] border">
          {students.slice(0, 6).map((student) => {
            const earned = student.corrections.reduce((sum, correction) => sum + effectiveScore(correction), 0);
            const possible = student.corrections.reduce((sum, correction) => sum + correction.max_score, 0);
            return (
              <div key={student.student_id} className="flex items-center justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <strong className="block truncate text-[13px] text-foreground">{student.student_id} · {student.student_name || student.student_id}</strong>
                  <span className="text-[12px] text-muted-foreground">{student.corrections.length} {tx(locale, "道作答", "responses")}</span>
                </div>
                <span className="shrink-0 text-[14px] font-bold text-primary">{earned.toFixed(1)} / {possible.toFixed(1)}</span>
              </div>
            );
          })}
          {!students.length ? <EmptyRow locale={locale} /> : null}
        </div>
      </section>
    );
  }

  const isReports = section === "reports";
  return (
    <section className="rounded-[10px] border bg-card p-5">
      <SectionHeading
        locale={locale}
        title={isReports ? "报告与下载" : "可视化分析"}
        titleEn={isReports ? "Reports & downloads" : "Visual analysis"}
        description={isReports ? "报告文件按正式结果版本生成并保留版本关系。" : "图表只基于已确认的正式结果版本生成。"}
        descriptionEn={isReports ? "Report files are generated against a formal result version." : "Charts are generated only from a confirmed formal result version."}
      />
      <div className="mt-5 flex min-h-[220px] flex-col items-center justify-center rounded-[9px] border border-dashed bg-muted/30 px-6 text-center">
        {isReports ? <FileText aria-hidden="true" className="h-8 w-8 text-muted-foreground" /> : <BarChart3 aria-hidden="true" className="h-8 w-8 text-muted-foreground" />}
        <p className="mt-3 text-[15px] font-bold text-foreground">{analysisStatusTitle(locale, finalization.analysis_status, isReports)}</p>
        <p className="mt-1 max-w-lg text-[13px] leading-5 text-muted-foreground">
          {tx(locale, "当前没有可下载或可展示的派生文件；原始批改结果与正式版本不会因此丢失。", "No derived artifact is available yet; the grading result and formal version remain preserved.")}
        </p>
        {finalization.final_result_dirty ? (
          <Link to={`/tasks/${encodeURIComponent(taskId)}/review`} className="mt-4 text-[13px] font-semibold text-primary hover:underline">
            {tx(locale, "返回复核并重新确认", "Return to review and reconfirm")}
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function ResultsOverview({
  locale,
  taskId,
  finalization,
  model,
}: {
  locale: Locale;
  taskId: string;
  finalization: TaskFinalizationResponse;
  model: ResultsModel;
}) {
  const root = `/tasks/${encodeURIComponent(taskId)}/results`;
  const scoreDistribution = buildScoreDistribution(model.students);
  const strongestBucket = Math.max(1, ...scoreDistribution.map((bucket) => bucket.count));
  const weakQuestions = [...model.questions]
    .filter((question) => question.avgPercent !== null)
    .sort((left, right) => (left.avgPercent ?? 0) - (right.avgPercent ?? 0))
    .slice(0, 3);
  const studentPreview = [...model.students]
    .sort((left, right) => (left.percent ?? Number.POSITIVE_INFINITY) - (right.percent ?? Number.POSITIVE_INFINITY))
    .slice(0, 3);
  const validStudentPercents = model.students
    .map((student) => student.percent)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const passCount = validStudentPercents.filter((value) => value >= 60).length;
  const passRate = validStudentPercents.length ? (passCount / validStudentPercents.length) * 100 : null;
  const reviewConclusion = finalization.required_review_count
    ? tx(
        locale,
        `${finalization.confirmed_required_count}/${finalization.required_review_count} 项已确认`,
        `${finalization.confirmed_required_count}/${finalization.required_review_count} confirmed`,
      )
    : tx(locale, "无强制复核项", "No required reviews");

  return (
    <section className="rounded-[10px] border bg-card p-5">
      <SectionHeading
        locale={locale}
        title="结果总览"
        titleEn="Results overview"
        description="正式结果的简洁班级摘要；详细信息分别进入独立分析页面。"
        descriptionEn="A concise class summary of the formal result, with focused pages for details."
      />

      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Metric value={String(model.students.length)} label={tx(locale, "学生数", "Students")} tone="primary" />
        <Metric value={String(model.questions.length)} label={tx(locale, "题目数", "Questions")} tone="accent" />
        <Metric value={formatPercent(model.classAveragePercent)} label={tx(locale, "班级平均得分率", "Class mean score")} tone="warning" />
        <Metric value={formatPercent(passRate)} label={tx(locale, "及格率（≥60%）", "Pass rate (≥60%)")} tone="primary" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <OverviewPanel
          title={tx(locale, "分数分布", "Score distribution")}
          subtitle={tx(locale, "按学生总得分率分桶", "Students grouped by total score rate")}
          href={`${root}/visualizations`}
          linkLabel={tx(locale, "查看可视化", "View visualizations")}
        >
          {validStudentPercents.length ? (
            <div className="flex h-[118px] items-end justify-between gap-3 pt-3" aria-label={tx(locale, "学生分数分布", "Student score distribution")}>
              {scoreDistribution.map((bucket) => (
                <div key={bucket.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
                  <span className="text-[11px] font-semibold text-muted-foreground">{bucket.count}</span>
                  <span
                    className="w-full max-w-10 rounded-t-[6px] bg-primary"
                    style={{ height: `${Math.max(5, (bucket.count / strongestBucket) * 76)}px` }}
                    title={`${bucket.label}: ${bucket.count}`}
                  />
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">{bucket.label}</span>
                </div>
              ))}
            </div>
          ) : <CompactEmpty locale={locale} />}
        </OverviewPanel>

        <OverviewPanel
          title={tx(locale, "薄弱题目预览", "Lowest-scoring questions")}
          subtitle={tx(locale, "按平均得分率从低到高", "Ordered by mean score rate")}
          href={`${root}/questions`}
          linkLabel={tx(locale, "查看题目分析", "View questions")}
        >
          {weakQuestions.length ? (
            <div className="mt-3 grid gap-3">
              {weakQuestions.map((question) => (
                <QuestionPreviewRow key={question.id} locale={locale} question={question} />
              ))}
            </div>
          ) : <CompactEmpty locale={locale} />}
        </OverviewPanel>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <OverviewPanel
          title={tx(locale, "学生表现预览", "Student performance preview")}
          subtitle={tx(locale, "低得分率优先，仅显示 3 位", "Lowest score rates first; 3 students shown")}
          href={`${root}/students`}
          linkLabel={tx(locale, "查看学生分析", "View students")}
        >
          {studentPreview.length ? (
            <div className="mt-2 divide-y">
              {studentPreview.map((student) => <StudentPreviewRow key={student.id} locale={locale} student={student} />)}
            </div>
          ) : <CompactEmpty locale={locale} />}
        </OverviewPanel>

        <OverviewPanel
          title={tx(locale, "复核与产物", "Review & artifacts")}
          subtitle={reviewConclusion}
          href={`${root}/reports`}
          linkLabel={tx(locale, "查看报告状态", "View report status")}
        >
          <div className="mt-3 grid gap-2 text-[12px]">
            <StatusLine
              label={tx(locale, "正式结果", "Formal result")}
              value={`v${finalization.final_result_version}`}
              tone="primary"
            />
            <StatusLine
              label={tx(locale, "分析状态", "Analysis status")}
              value={analysisStatusLabel(locale, finalization.analysis_status)}
              tone={finalization.analysis_status === "stale" ? "warning" : "neutral"}
            />
            <StatusLine
              label={tx(locale, "报告下载", "Report downloads")}
              value={tx(locale, "尚未生成，进入报告页查看", "Not generated; see report page")}
              tone="neutral"
            />
          </div>
        </OverviewPanel>
      </div>
    </section>
  );
}

function OverviewPanel({
  title,
  subtitle,
  href,
  linkLabel,
  children,
}: {
  title: string;
  subtitle: string;
  href: string;
  linkLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-[9px] border px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[14px] font-bold text-foreground">{title}</h3>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{subtitle}</p>
        </div>
        <Link to={href} className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
          {linkLabel}
          <ArrowRight aria-hidden="true" className="h-3 w-3" />
        </Link>
      </div>
      {children}
    </section>
  );
}

function QuestionPreviewRow({ locale, question }: { locale: Locale; question: QuestionSummary }) {
  const percent = clampPercent(question.avgPercent);
  return (
    <div className="grid grid-cols-[minmax(72px,0.8fr)_minmax(120px,1.4fr)_38px] items-center gap-3">
      <span className="truncate text-[12px] font-semibold text-foreground">{question.label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-muted">
        <span className="block h-full rounded-full bg-amber-400" style={{ width: `${percent}%` }} />
      </span>
      <span className="text-right text-[11px] font-semibold text-muted-foreground">{formatPercent(question.avgPercent)}</span>
      <span className="col-span-3 -mt-2 truncate text-[10px] text-muted-foreground">
        {question.stem || tx(locale, "暂无题干摘要", "No stem preview")}
      </span>
    </div>
  );
}

function StudentPreviewRow({ locale, student }: { locale: Locale; student: StudentSummary }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2 first:pt-1 last:pb-0">
      <span className="truncate text-[12px] font-semibold text-foreground">{student.name} · {student.id}</span>
      <span className="text-[11px] text-muted-foreground">
        {student.lowConfidenceCount ? tx(locale, `${student.lowConfidenceCount} 个低置信题次`, `${student.lowConfidenceCount} low-confidence`) : tx(locale, "无低置信题次", "No low-confidence items")}
      </span>
      <span className="min-w-10 text-right text-[12px] font-bold text-primary">{formatPercent(student.percent)}</span>
    </div>
  );
}

function StatusLine({ label, value, tone }: { label: string; value: string; tone: "primary" | "warning" | "neutral" }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-[7px] bg-muted/60 px-3 py-2">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className={cn("text-right font-semibold", tone === "primary" && "text-primary", tone === "warning" && "text-amber-600", tone === "neutral" && "text-foreground")}>{value}</span>
    </div>
  );
}

function CompactEmpty({ locale }: { locale: Locale }) {
  return <p className="flex min-h-[82px] items-center justify-center text-[12px] text-muted-foreground">{tx(locale, "当前版本没有可统计的数据。", "No statistical data is available in this version.")}</p>;
}

function buildScoreDistribution(students: StudentSummary[]) {
  const buckets = [
    { label: "<60", min: Number.NEGATIVE_INFINITY, max: 60, count: 0 },
    { label: "60–69", min: 60, max: 70, count: 0 },
    { label: "70–79", min: 70, max: 80, count: 0 },
    { label: "80–89", min: 80, max: 90, count: 0 },
    { label: "90–100", min: 90, max: Number.POSITIVE_INFINITY, count: 0 },
  ];
  for (const student of students) {
    if (student.percent === null || !Number.isFinite(student.percent)) continue;
    const bucket = buckets.find((candidate) => student.percent! >= candidate.min && student.percent! < candidate.max);
    if (bucket) bucket.count += 1;
  }
  return buckets;
}

function SectionHeading({ locale, title, titleEn, description, descriptionEn }: { locale: Locale; title: string; titleEn: string; description: string; descriptionEn: string }) {
  return (
    <div>
      <h2 className="text-[20px] font-bold tracking-[-0.01em] text-foreground">{locale === "en-US" ? titleEn : title}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">{locale === "en-US" ? descriptionEn : description}</p>
    </div>
  );
}

function Metric({ value, label, tone }: { value: string; label: string; tone: "primary" | "accent" | "warning" }) {
  return (
    <div className="rounded-[9px] border px-4 py-4">
      <strong className={cn("text-[26px] leading-8", tone === "primary" && "text-primary", tone === "accent" && "text-teal-500", tone === "warning" && "text-amber-500")}>{value}</strong>
      <span className="mt-1 block text-[12px] font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

function EmptyRow({ locale }: { locale: Locale }) {
  return <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">{tx(locale, "当前版本没有可展示的数据。", "No displayable data is available in this version.")}</div>;
}

function WorkspaceState({ locale, loading = false, onRetry }: { locale: Locale; loading?: boolean; onRetry?: () => void }) {
  return (
    <div className="flex min-h-[420px] flex-col items-center justify-center rounded-[10px] border bg-card px-6 text-center">
      {loading ? <LoaderCircle aria-hidden="true" className="h-8 w-8 animate-spin text-primary" /> : <AlertTriangle aria-hidden="true" className="h-8 w-8 text-amber-500" />}
      <h1 className="mt-4 text-lg font-bold text-foreground">{loading ? tx(locale, "正在读取正式结果…", "Loading formal results…") : tx(locale, "正式结果暂时无法读取", "Formal results are unavailable")}</h1>
      {!loading && onRetry ? <button type="button" onClick={onRetry} className="mt-4 rounded-[8px] bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">{tx(locale, "重试", "Retry")}</button> : null}
    </div>
  );
}

function sectionFromPath(pathname: string): WorkspaceSection {
  if (pathname.endsWith("/questions")) return "questions";
  if (pathname.endsWith("/students")) return "students";
  if (pathname.endsWith("/visualizations")) return "visualizations";
  if (pathname.endsWith("/reports")) return "reports";
  return "overview";
}

function effectiveScore(correction: Correction): number {
  return typeof correction.teacher_score === "number" && Number.isFinite(correction.teacher_score)
    ? correction.teacher_score
    : Number(correction.score) || 0;
}

function analysisStatusLabel(locale: Locale, status: TaskFinalizationResponse["analysis_status"]): string {
  const labels = {
    not_generated: ["分析尚未生成", "Analysis not generated"],
    generating: ["分析生成中", "Analysis generating"],
    ready: ["分析已生成", "Analysis ready"],
    stale: ["分析已过期", "Analysis stale"],
  } as const;
  return labels[status][locale === "en-US" ? 1 : 0];
}

function analysisStatusTitle(locale: Locale, status: TaskFinalizationResponse["analysis_status"], reports: boolean): string {
  if (status === "generating") return tx(locale, "正在生成，请稍后查看", "Generation in progress");
  if (status === "stale") return tx(locale, "已有内容与当前结果版本不一致", "Existing artifacts are stale");
  if (status === "ready") return reports ? tx(locale, "报告索引准备中", "Report index is being prepared") : tx(locale, "分析内容准备中", "Analysis view is being prepared");
  return reports ? tx(locale, "尚未生成正式报告", "Formal reports not generated") : tx(locale, "尚未生成可视化分析", "Visual analysis not generated");
}

function tx(locale: Locale, zh: string, en: string): string {
  return locale === "en-US" ? en : zh;
}
