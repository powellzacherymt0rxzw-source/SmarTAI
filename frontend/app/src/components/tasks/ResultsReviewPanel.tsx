import type { ComponentType } from "react";
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Download,
  FileText,
  ShieldAlert,
  UsersRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { HorizontalScrollHint } from "@/components/ui/HorizontalScrollHint";
import { InlineNotice } from "@/components/ui/InlineNotice";
import { WorkflowSection } from "@/components/ui/WorkflowSection";
import { cn } from "@/lib/cn";
import type { Correction } from "@/types";
import {
  clampPercent,
  formatConfidence,
  formatScore,
  formatPercent,
  hasReviewSignal,
  type QuestionSummary,
  type ResultsModel,
  type StudentSummary,
} from "./ResultsLayout";
import { collectResultReviewItems, type ReviewItem } from "./resultsReviewModel";

export function ResultsReviewPanel({
  taskId,
  model,
  visibleStudents,
}: {
  taskId: string;
  model: ResultsModel;
  visibleStudents?: StudentSummary[];
}) {
  const students = visibleStudents ?? model.students;
  const allReviewItems = collectResultReviewItems(model, model.students);
  const reviewItems = collectResultReviewItems(model, students);
  const lowConfidenceItems = reviewItems.filter((item) => item.category === "low-confidence");
  const disagreementItems = reviewItems.filter((item) => item.category === "expert-disagreement");
  const anomalyItems = reviewItems.filter((item) => item.category === "score-anomaly");
  const canConfirm = allReviewItems.length === 0;

  return (
    <div className="grid gap-4">
      <Card className="grid gap-5">
        <WorkflowSection
          title="结果总览与复核热力图"
          description="先检查低置信、专家分歧和分数异常，再确认复核完成；正式分析和导出应基于教师确认后的最终结果生成。"
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <ReviewMetric icon={UsersRound} label="学生数" value={model.students.length} />
            <ReviewMetric icon={FileText} label="题目数" value={model.questions.length} />
            <ReviewMetric
              icon={BarChart3}
              label="平均分"
              value={`${formatScore(model.classAverageScore)} / ${formatScore(model.classAverageMax)}`}
              detail={formatPercent(model.classAveragePercent)}
            />
            <ReviewMetric
              icon={ShieldAlert}
              label="低置信题次"
              value={model.lowConfidenceCount}
              tone={model.lowConfidenceCount > 0 ? "warning" : "neutral"}
            />
            <ReviewMetric
              icon={AlertTriangle}
              label="需复核题次"
              value={model.reviewCount}
              tone={model.reviewCount > 0 ? "warning" : "neutral"}
            />
            <ReviewMetric
              icon={CheckCircle2}
              label="分析状态"
              value={canConfirm ? "待确认" : "待复核"}
              detail="后端状态待接入"
              tone={canConfirm ? "neutral" : "warning"}
            />
          </div>

          <InlineNotice tone="warning" title="先复核，再生成正式分析与导出">
            当前页面展示的是 AI 原始批改结果的复核视图。教师修改分数、评语、复核备注和教师复核结果层
            仍需后端保存；确认后再生成学情分析、导出报告和发布版标答，避免旧结果污染统计。
          </InlineNotice>

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" disabled title="需后端新增教师复核结果层与复核已确认状态">
              <CheckCircle2 className="h-4 w-4" />
              确认复核完成
            </Button>
            <Button type="button" variant="secondary" disabled title="需后端新增分析、导出和发布版标答生成任务">
              <Download className="h-4 w-4" />
              生成分析与导出
            </Button>
          </div>
        </WorkflowSection>

        <WorkflowSection
          title="学生 x 题目置信度矩阵"
          description="每个单元格基于现有置信度和复核信号前端派生；点击学生单元格进入该学生详情。"
        >
          <ConfidenceHeatmap taskId={taskId} students={students} questions={model.questions} />
        </WorkflowSection>
      </Card>

      <Card className="grid gap-5">
        <WorkflowSection
          title="重点复核队列"
          description="按低置信、专家分歧和分数异常拆开，让老师不用在全班结果里反复查找。"
        >
          <div className="grid gap-3">
            <ReviewQueue title="低置信" items={lowConfidenceItems} taskId={taskId} emptyText="没有低置信题次。" />
            <ReviewQueue title="专家分歧" items={disagreementItems} taskId={taskId} emptyText="现有结果没有明显专家分歧。" />
            <ReviewQueue title="分数异常" items={anomalyItems} taskId={taskId} emptyText="现有结果没有前端可识别的分数异常。" />
          </div>
        </WorkflowSection>

        <WorkflowSection title="分析、导出与正式完成" description="这里先落地流程外壳，后端版本化和导出任务接入后再开放按钮。">
          <div className="grid gap-3 sm:grid-cols-3">
            <FinalizedStep label="1. 确认最终结果" value="待接入" description="保存教师修改后的复核结果层。" />
            <FinalizedStep label="2. 生成正式产物" value="待接入" description="学情分析、导出报告、发布版标答统一基于教师确认后的结果。" />
            <FinalizedStep label="3. 正式完成" value="待接入" description="展示产物版本；如果之后再修改结果，旧产物标记需重新生成。" />
          </div>
          <InlineNotice tone="neutral" title="需重新生成规则">
            已生成分析或导出后，如果教师再次修改最终分数、评语或备注，前端应标记这些产物“需重新生成”，但不自动重跑高成本任务。
          </InlineNotice>
        </WorkflowSection>
      </Card>
    </div>
  );
}

function ConfidenceHeatmap({
  taskId,
  students,
  questions,
}: {
  taskId: string;
  students: StudentSummary[];
  questions: QuestionSummary[];
}) {
  if (!students.length || !questions.length) {
    return <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">暂无可展示的复核矩阵。</div>;
  }

  return (
    <div className="grid gap-2">
      <HorizontalScrollHint />
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[900px] border-collapse text-left text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="sticky left-0 z-10 bg-muted/40 px-3 py-2 font-medium">学生</th>
            {questions.map((question) => (
              <th key={question.id} className="px-2 py-2 font-medium">
                <Link to={`/tasks/${taskId}/questions/${question.id}`} className="hover:text-foreground">
                  {question.label}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {students.map((student) => (
            <tr key={student.id} className="align-top">
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left font-medium">
                <Link to={`/tasks/${taskId}/results/${student.id}`} className="grid gap-0.5 hover:text-primary">
                  <span>{student.name}</span>
                  <span className="text-xs font-normal text-muted-foreground">{student.id}</span>
                </Link>
              </th>
              {questions.map((question) => {
                const correction = student.corrections.find((item) => item.q_id === question.id);
                return (
                  <td key={`${student.id}-${question.id}`} className="px-2 py-2">
                    <ConfidenceCell taskId={taskId} student={student} question={question} correction={correction} />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}

function ConfidenceCell({
  taskId,
  student,
  question,
  correction,
}: {
  taskId: string;
  student: StudentSummary;
  question: QuestionSummary;
  correction?: Correction;
}) {
  if (!correction) {
    return (
      <div className="grid min-h-14 content-center rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
        未批改
      </div>
    );
  }

  const percent = correction.max_score > 0 ? (correction.score / correction.max_score) * 100 : null;
  const title = `${student.name} ${question.label}: ${formatScore(correction.score)} / ${formatScore(correction.max_score)}, 置信度 ${formatConfidence(correction.confidence)}`;

  return (
    <Link
      to={`/tasks/${taskId}/results/${encodeURIComponent(student.id)}#question-${encodeURIComponent(question.id)}`}
      title={title}
      className={cn(
        "grid min-h-14 content-center gap-0.5 rounded-md border px-2 py-1 text-xs transition hover:-translate-y-0.5 hover:shadow-sm",
        confidenceCellClass(correction),
      )}
    >
      <span className="font-semibold">{formatConfidence(correction.confidence)}</span>
      <span className="text-muted-foreground">
        {formatScore(correction.score)} / {formatScore(correction.max_score)}
      </span>
      {hasReviewSignal(correction) ? <span className="font-medium text-warning">需看</span> : <span>{formatPercent(percent)}</span>}
    </Link>
  );
}

function ReviewQueue({
  title,
  items,
  taskId,
  emptyText,
}: {
  title: string;
  items: ReviewItem[];
  taskId: string;
  emptyText: string;
}) {
  const shown = items.slice(0, 5);

  return (
    <section className="grid content-start gap-3 rounded-lg border p-3">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-xs text-muted-foreground">{items.length} 项待看</span>
      </div>
      {shown.length ? (
        <div className="grid gap-2">
          {shown.map((item) => (
            <div
              key={`${title}-${item.student.id}-${item.correction.q_id}`}
              className="grid gap-3 rounded-md bg-muted/30 p-3 md:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.student.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {item.question.label} · {formatScore(item.correction.score)} / {formatScore(item.correction.max_score)} ·
                      置信度 {formatConfidence(item.correction.confidence)}
                    </p>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-7">
                  {item.reasons.map((reason) => (
                    <span key={reason} className="text-xs text-muted-foreground">
                      {reason}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <Link to={`/tasks/${taskId}/results/${encodeURIComponent(item.student.id)}#question-${encodeURIComponent(item.correction.q_id)}`}>
                  <Button type="button" variant="ghost" className="h-8 px-2">
                    学生
                  </Button>
                </Link>
                <Link to={`/tasks/${taskId}/questions/${item.question.id}?studentId=${encodeURIComponent(item.student.id)}`}>
                  <Button type="button" variant="ghost" className="h-8 px-2">
                    题目
                  </Button>
                </Link>
              </div>
            </div>
          ))}
          {items.length > shown.length ? (
            <p className="text-xs text-muted-foreground">还有 {items.length - shown.length} 项，可通过矩阵或学生/题目详情继续查看。</p>
          ) : null}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">{emptyText}</div>
      )}
    </section>
  );
}

function ReviewMetric({
  icon: Icon,
  label,
  value,
  detail,
  tone = "neutral",
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  detail?: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={cn("h-4 w-4", tone === "warning" ? "text-warning" : "")} />
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold">{value}</div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function FinalizedStep({ label, value, description }: { label: string; value: string; description: string }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
    </div>
  );
}

function confidenceCellClass(correction: Correction) {
  if (hasReviewSignal(correction)) {
    return "border-warning/50 bg-warning/10 text-foreground";
  }
  if (correction.confidence >= 0.85) {
    return "border-accent/30 bg-accent/5 text-foreground";
  }
  if (correction.confidence >= 0.65) {
    return "border-primary/20 bg-primary/5 text-foreground";
  }
  return "border-danger/40 bg-danger/10 text-foreground";
}
