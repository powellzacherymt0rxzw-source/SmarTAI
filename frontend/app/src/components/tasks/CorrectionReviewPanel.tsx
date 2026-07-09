import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Lock, Save, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { useSetTeacherComment } from "@/api/hooks/tasks";
import { Button } from "@/components/ui/Button";
import { HorizontalScrollHint } from "@/components/ui/HorizontalScrollHint";
import { InlineNotice } from "@/components/ui/InlineNotice";
import { Textarea } from "@/components/ui/Input";
import { MarkdownMath } from "@/components/ui/MarkdownMath";
import type { Correction, StudentAnswerInfo } from "@/types";
import { formatConfidence, formatScore, hasReviewSignal, reviewReasonLabel } from "./ResultsLayout";

export function CorrectionReviewPanel({
  taskId,
  studentId,
  qId,
  questionLabel,
  answer,
  correction,
}: {
  taskId: string;
  studentId: string;
  qId: string;
  questionLabel?: string;
  answer?: StudentAnswerInfo;
  correction: Correction;
}) {
  const savedTeacherComment = correction.teacher_comment?.trim() ?? "";
  const [teacherComment, setTeacherComment] = useState(savedTeacherComment);
  const commentMutation = useSetTeacherComment();
  const reviewSignals = useMemo(() => buildReviewSignals(correction), [correction]);
  const isDirty = teacherComment.trim() !== savedTeacherComment;
  const label = questionLabel ?? qId;

  useEffect(() => {
    setTeacherComment(savedTeacherComment);
  }, [savedTeacherComment, studentId, qId]);

  const saveTeacherComment = () => {
    commentMutation.mutate(
      {
        taskId,
        studentId,
        qId,
        comment: teacherComment.trim(),
      },
      {
        onSuccess: () => {
          toast.success(`${label} 教师批注已保存。`);
        },
        onError: (error) => {
          toast.error("教师批注保存失败", { description: getErrorMessage(error) });
        },
      },
    );
  };

  return (
    <div className="grid gap-3">
      <div className="grid gap-3">
        <ReviewTextBlock title="学生作答" body={answer?.content} empty="没有作答文本。" />
        <ReviewTextBlock title="AI 原始评语" body={correction.comment} empty="没有 AI 评语。" />
      </div>

      <div className="rounded-lg border bg-muted/20 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold">AI 原始批改记录</p>
              {hasReviewSignal(correction) ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                  <ShieldAlert className="h-3 w-3" />
                  建议复核
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                  <CheckCircle2 className="h-3 w-3" />
                  未触发复核
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              AI 结果保留为原始记录；教师复核层应在后端接入后单独保存人工分数、人工评语和正式导出版本。
            </p>
          </div>
          <div className="grid gap-1 text-sm text-muted-foreground sm:grid-cols-3 lg:min-w-[320px]">
            <MiniMetric label="AI 得分" value={`${formatScore(correction.score)} / ${formatScore(correction.max_score)}`} />
            <MiniMetric label="置信度" value={formatConfidence(correction.confidence)} />
            <MiniMetric label="综合方式" value={correction.synthesis_method ?? "single"} />
          </div>
        </div>

        {reviewSignals.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {reviewSignals.map((signal) => (
              <span key={signal} className="rounded-full bg-card px-2 py-1 text-xs text-muted-foreground">
                {signal}
              </span>
            ))}
          </div>
        ) : null}

        {correction.steps?.length ? <StepScores steps={correction.steps} /> : null}
        {correction.expert_results?.length ? <ExpertDetails correction={correction} /> : null}
      </div>

      <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-primary">教师复核批注层</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              先保存可追溯的教师批注；人工分数、人工评语与“确认无误”状态需要后端新增字段后开放。
            </p>
          </div>
          <Button type="button" variant="secondary" disabled title="需后端新增逐题复核确认状态。">
            <Lock className="h-4 w-4" />
            确认无误待接入
          </Button>
        </div>

        <div className="mt-3 grid gap-3">
          <div className="grid gap-3">
            <ReadonlyField label="AI 分数（暂作为统计分）" value={`${formatScore(correction.score)} / ${formatScore(correction.max_score)}`} />
            <ReadonlyField label="AI 评语（只读）" value={correction.comment?.trim() || "暂无评语。"} multiline />
          </div>
          <label className="grid gap-1 text-sm">
            <span className="font-medium">教师批注</span>
            <Textarea
              value={teacherComment}
              onChange={(event) => setTeacherComment(event.target.value)}
              placeholder="例如：确认 AI 判断无误；或记录需要后端接入后的分数/评语修正理由。"
              className="min-h-32 resize-y bg-card"
            />
            <span className="text-xs text-muted-foreground">
              这条批注会通过现有 API 保存；不会覆盖 AI 原始分数与评语。
            </span>
          </label>
        </div>

        <InlineNotice tone="neutral" title="正式分析与导出规则" className="mt-3">
          等教师完成复核确认后，再生成学情分析、导出报告和发布版标答；若之后再次修改复核结果，旧产物应标记为需重新生成。
        </InlineNotice>

        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setTeacherComment(savedTeacherComment)}
            disabled={!isDirty || commentMutation.isPending}
          >
            撤销修改
          </Button>
          <Button type="button" onClick={saveTeacherComment} disabled={!isDirty || commentMutation.isPending}>
            {commentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            保存教师批注
          </Button>
        </div>
      </div>
    </div>
  );
}

function ReviewTextBlock({ title, body, empty }: { title: string; body?: string | null; empty: string }) {
  const content = body?.trim() || empty;

  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <MarkdownMath className="mt-2">{content}</MarkdownMath>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-card px-2 py-1.5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate font-medium text-foreground" title={value}>
        {value}
      </p>
    </div>
  );
}

function ReadonlyField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <label className="grid gap-1 text-sm">
      <span className="font-medium">{label}</span>
      <div
        className={
          multiline
            ? "min-h-24 rounded-md border bg-muted/40 px-3 py-2 text-sm leading-6 text-muted-foreground"
            : "h-9 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        }
      >
        {multiline ? <MarkdownMath>{value}</MarkdownMath> : value}
      </div>
    </label>
  );
}

function StepScores({ steps }: { steps: Correction["steps"] }) {
  return (
    <div className="mt-3 grid gap-2">
      <HorizontalScrollHint />
      <div className="overflow-x-auto rounded-lg border bg-card">
        <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">步骤</th>
            <th className="px-3 py-2 font-medium">判断</th>
            <th className="px-3 py-2 font-medium">得分</th>
            <th className="px-3 py-2 font-medium">说明</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {steps.map((step) => (
            <tr key={step.step_no}>
              <td className="px-3 py-2">#{step.step_no}</td>
              <td className="px-3 py-2">
                <span className={step.is_correct ? "text-accent" : "text-warning"}>
                  {step.is_correct ? "正确" : "需看"}
                </span>
              </td>
              <td className="px-3 py-2">{formatScore(step.score)}</td>
              <td className="px-3 py-2 text-muted-foreground">{step.desc || "--"}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpertDetails({ correction }: { correction: Correction }) {
  return (
    <details className="mt-3 rounded-lg border bg-card p-3">
      <summary className="cursor-pointer text-sm font-medium">查看专家明细 ({correction.expert_results.length})</summary>
      <div className="mt-3 grid gap-3">
        {correction.expert_results.map((expert, index) => (
          <div key={`${expert.provider}-${index}`} className="rounded-md border bg-muted/20 p-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{expert.provider}</span>
              <span className="text-muted-foreground">
                {formatScore(expert.score)} / {formatScore(expert.max_score)}
              </span>
              <span className="text-muted-foreground">置信度 {formatConfidence(expert.confidence)}</span>
              {expert.error_kind ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs text-warning">
                  <AlertTriangle className="h-3 w-3" />
                  {expert.error_kind}
                </span>
              ) : null}
            </div>
            {expert.comment ? <MarkdownMath className="mt-2 text-sm text-muted-foreground">{expert.comment}</MarkdownMath> : null}
          </div>
        ))}
      </div>
    </details>
  );
}

function buildReviewSignals(correction: Correction) {
  const signals: string[] = [];
  if (correction.confidence < 0.65) {
    signals.push("置信度偏低");
  }
  for (const reason of correction.review_reasons ?? []) {
    signals.push(reviewReasonLabel(reason));
  }
  if (!signals.length && correction.requires_human_review) {
    signals.push("需要人工复核");
  }
  return Array.from(new Set(signals));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "请稍后重试。";
}
