import { CheckCircle2, TriangleAlert } from "lucide-react";
import { InlineNotice } from "@/components/ui/InlineNotice";
import { cn } from "@/lib/cn";
import type { GradingGuard, ModelReadiness } from "@/lib/taskActionGuards";
import type { ProblemInfo, StudentSubmission } from "@/types";
import { getSubmissionMatrixStats } from "./SubmissionReviewMatrix";

export function PreGradingConfirmPanel({
  problems,
  students,
  taskDocCount,
  modelReadiness,
  gradingGuard,
}: {
  problems: ProblemInfo[];
  students: StudentSubmission[];
  taskDocCount: number;
  modelReadiness: ModelReadiness;
  gradingGuard: GradingGuard;
}) {
  const problemSummary = getProblemSummary(problems);
  const submissionStats = getSubmissionMatrixStats(problems, students);
  const risks = buildRiskItems({
    problemSummary,
    submissionStats,
    taskDocCount,
    gradingGuard,
    modelReadiness,
  });
  const hardBlockers = risks.filter((risk) => risk.level === "danger");
  const warnings = risks.filter((risk) => risk.level === "warning");

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ConfirmMetric label="题目" value={`${problems.length}`} detail={`评分标准 ${problemSummary.criteriaReady}/${problems.length}`} />
        <ConfirmMetric label="学生" value={`${students.length}`} detail={`识别格 ${submissionStats.recognizedCells}/${submissionStats.expectedCells}`} />
        <ConfirmMetric label="资料" value={`${taskDocCount}`} detail={`标答 ${problemSummary.answersReady}/${problems.length}`} />
        <ConfirmMetric
          label="BYOK 专家"
          value={modelReadiness.isLoading ? "读取中" : `${modelReadiness.enabledCount}`}
          detail={modelReadiness.disabledReason ?? "可用于本次批改"}
          tone={modelReadiness.disabledReason ? "warning" : "success"}
        />
      </div>

      {hardBlockers.length > 0 ? (
        <InlineNotice tone="danger" title="还不能开始批改">
          {hardBlockers.map((risk) => risk.text).join("；")}
        </InlineNotice>
      ) : warnings.length > 0 ? (
        <InlineNotice tone="warning" title="开始前建议确认">
          {warnings.map((risk) => risk.text).join("；")}
        </InlineNotice>
      ) : (
        <InlineNotice tone="success" title="可以开始批改">
          题目、作答和模型来源已满足启动条件。正式批改前仍可回到上方表格修改识别内容。
        </InlineNotice>
      )}

      <div className="grid gap-2 text-sm">
        {risks.length === 0 ? (
          <ConfirmLine tone="success" text="暂无明显风险。" />
        ) : (
          risks.map((risk) => <ConfirmLine key={risk.text} tone={risk.level} text={risk.text} />)
        )}
      </div>
    </div>
  );
}

type RiskLevel = "success" | "warning" | "danger";

function ConfirmMetric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "success" | "warning" | "neutral";
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold",
          tone === "success" ? "text-accent" : tone === "warning" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</div>
    </div>
  );
}

function ConfirmLine({ tone, text }: { tone: RiskLevel; text: string }) {
  const Icon = tone === "success" ? CheckCircle2 : TriangleAlert;
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md px-2 py-1.5",
        tone === "danger"
          ? "text-danger"
          : tone === "warning"
            ? "text-warning"
            : "text-muted-foreground",
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="leading-6">{text}</span>
    </div>
  );
}

function buildRiskItems({
  problemSummary,
  submissionStats,
  taskDocCount,
  gradingGuard,
  modelReadiness,
}: {
  problemSummary: ReturnType<typeof getProblemSummary>;
  submissionStats: ReturnType<typeof getSubmissionMatrixStats>;
  taskDocCount: number;
  gradingGuard: GradingGuard;
  modelReadiness: ModelReadiness;
}) {
  const risks: Array<{ level: RiskLevel; text: string }> = [];

  if (modelReadiness.disabledReason) {
    risks.push({ level: "danger", text: modelReadiness.disabledReason });
  }
  if (gradingGuard.reason && !modelReadiness.disabledReason) {
    risks.push({ level: gradingGuard.disabled ? "danger" : "warning", text: gradingGuard.reason });
  }
  if (problemSummary.missingCriteria > 0) {
    risks.push({ level: "warning", text: `${problemSummary.missingCriteria} 道题缺少评分标准。` });
  }
  if (problemSummary.missingAnswers > 0) {
    risks.push({ level: "warning", text: `${problemSummary.missingAnswers} 道题缺少标答，AI 会更多依赖题干与评分标准。` });
  }
  if (problemSummary.missingTests > 0) {
    risks.push({ level: "warning", text: `${problemSummary.missingTests} 道编程题缺少测试样例。` });
  }
  if (submissionStats.missingCells > 0) {
    risks.push({ level: "warning", text: `${submissionStats.missingCells} 个学生-题目格缺少识别答案。` });
  }
  if (submissionStats.flaggedCells > 0 || submissionStats.emptyCells > 0) {
    risks.push({ level: "warning", text: `${submissionStats.flaggedCells + submissionStats.emptyCells} 个作答格建议复核。` });
  }
  if (taskDocCount === 0) {
    risks.push({ level: "warning", text: "本任务暂未添加资料；若题目依赖讲义或教材，建议先补充资料范围。" });
  }

  return risks;
}

function getProblemSummary(problems: ProblemInfo[]) {
  const programming = problems.filter(isProgrammingProblem);
  return {
    criteriaReady: problems.filter((problem) => hasText(problem.criterion)).length,
    missingCriteria: problems.filter((problem) => !hasText(problem.criterion)).length,
    answersReady: problems.filter((problem) => hasText(problem.reference_answer)).length,
    missingAnswers: problems.filter((problem) => !hasText(problem.reference_answer)).length,
    testsReady: programming.filter((problem) => (problem.test_cases?.length ?? 0) > 0).length,
    missingTests: programming.filter((problem) => (problem.test_cases?.length ?? 0) === 0).length,
  };
}

function isProgrammingProblem(problem: ProblemInfo) {
  const text = `${problem.type ?? ""} ${problem.stem ?? ""}`.toLowerCase();
  return ["编程", "程序", "代码", "python", "java", "c++", "javascript", "program", "coding", "algorithm"].some((token) =>
    text.includes(token),
  );
}

function hasText(value?: string | null) {
  return Boolean(value?.trim());
}
