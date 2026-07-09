import { CheckCircle2, Clock3, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { InlineNotice } from "@/components/ui/InlineNotice";
import { TaskStatusIndicator } from "@/components/tasks/TaskStatusIndicator";
import { getTaskStatusMeta } from "@/lib/taskFlow";
import { cn } from "@/lib/cn";
import type { JobProgress, TaskStatus } from "@/types";

const phaseLabels: Record<string, string> = {
  pending: "等待开始",
  ingesting: "读取文件",
  extracting: "识别题目",
  parsing: "解析作答",
  classifying: "判断题型",
  grading: "批改中",
  reviewing: "复核信号",
  aggregating: "汇总结果",
  done: "处理完成",
  error: "出现错误",
};

export function TaskProgressFocus({
  status,
  progress,
  percent,
  isLoading,
  isProcessing,
  problemCount,
  studentCount,
  error,
  onRefresh,
}: {
  status: TaskStatus;
  progress: JobProgress | null;
  percent: number;
  isLoading?: boolean;
  isProcessing?: boolean;
  problemCount: number;
  studentCount: number;
  error?: string | null;
  onRefresh?: () => void;
}) {
  const meta = getTaskStatusMeta(status);
  const messages = [...(progress?.messages ?? [])].slice(-4).reverse();
  const activeUnits = progress?.active ?? [];
  const phaseLabel = progress?.phase ? phaseLabels[progress.phase] ?? progress.phase : meta.shortLabel;
  const etaLabel = getEstimatedRemaining(progress, isProcessing);
  const focusSteps = getFocusSteps(status);
  const latestMessage = progress?.messages.at(-1)?.message;

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-2">
          <TaskStatusIndicator status={status} variant="chip" />
          <div>
            <h2 className="text-base font-semibold">{isLoading ? "正在读取任务状态" : phaseLabel}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{meta.description}</p>
            {latestMessage ? <p className="mt-2 text-sm leading-6 text-muted-foreground">{latestMessage}</p> : null}
          </div>
        </div>
        {onRefresh ? (
          <Button type="button" variant="ghost" className="w-fit" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        ) : null}
      </div>

      {focusSteps.length ? (
        <div className="grid gap-2 sm:grid-cols-3">
          {focusSteps.map((step) => (
            <div
              key={step.label}
              className={cn(
                "flex items-start gap-2 rounded-lg border p-3 text-sm",
                step.state === "done"
                  ? "border-accent/30 bg-accent/5"
                  : step.state === "active"
                    ? "border-primary/30 bg-primary/5"
                    : "bg-background",
              )}
            >
              {step.state === "done" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              ) : step.state === "active" ? (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
              ) : (
                <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                <p className="font-medium">{step.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{step.description}</p>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div className="rounded-lg border bg-background p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="font-medium">{isProcessing ? "后台处理中" : "当前进度"}</span>
          <span className="text-muted-foreground">{percent}%</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <ProgressMetric label="题目" value={problemCount} />
          <ProgressMetric label="学生" value={studentCount} />
          <ProgressMetric label="预计剩余" value={etaLabel} />
        </div>
      </div>

      {isProcessing && activeUnits.length > 0 ? (
        <div className="grid gap-2 rounded-lg border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">正在处理</p>
          {activeUnits.slice(0, 4).map((unit, index) => (
            <div key={`${unit.student_id}:${unit.q_id}:${index}`} className="flex flex-wrap gap-2 text-sm">
              <span className="font-medium">{unit.student_id || "学生"}</span>
              <span className="text-muted-foreground">{unit.q_id || "题目"}</span>
              <span className="text-muted-foreground">{unit.step || unit.skill}</span>
            </div>
          ))}
        </div>
      ) : null}

      {messages.length > 0 ? (
        <div className="grid gap-2 rounded-lg border bg-background p-3">
          <p className="text-xs font-medium text-muted-foreground">最近消息</p>
          {messages.map((message) => (
            <div key={`${message.ts}:${message.message}`} className="flex items-start gap-2 text-sm leading-6">
              {message.level === "error" ? (
                <span className="mt-2 h-2 w-2 rounded-full bg-danger" />
              ) : message.level === "warn" ? (
                <span className="mt-2 h-2 w-2 rounded-full bg-warning" />
              ) : (
                <span className="mt-2 h-2 w-2 rounded-full bg-accent" />
              )}
              <span className="min-w-0 text-muted-foreground">{message.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      {isProcessing ? (
        <InlineNotice tone="info" title="可以离开页面">
          任务会在后台继续运行。稍后从任务总览或历史任务回来，会自动恢复到当前阶段。
        </InlineNotice>
      ) : status === "problems_ready" || status === "submissions_ready" || status === "graded" ? (
        <InlineNotice tone="success" title="当前阶段已完成">
          页面会自动显示下一步可校对或复核的内容；如果数量仍在同步，请点击刷新。
        </InlineNotice>
      ) : null}

      {error ? (
        <InlineNotice tone="danger" title="任务处理遇到问题">
          {error}
        </InlineNotice>
      ) : null}
    </div>
  );
}

function getEstimatedRemaining(progress: JobProgress | null, isProcessing?: boolean) {
  if (!isProcessing) {
    return "—";
  }
  if (!progress) {
    return "等待进度";
  }

  const totalUnits = getTotalUnits(progress);
  const completedUnits = progress.completed_units ?? 0;
  if (totalUnits <= 0) {
    return "识别中";
  }
  if (completedUnits <= 0) {
    return "等待首个子步骤";
  }
  if (completedUnits >= totalUnits) {
    return "即将完成";
  }

  const firstTs = progress.messages[0]?.ts;
  const firstTsMs = normalizeTimestamp(firstTs);
  if (!firstTsMs) {
    return "估算中";
  }

  const elapsedSeconds = Math.max(1, (Date.now() - firstTsMs) / 1000);
  const unitsPerSecond = completedUnits / elapsedSeconds;
  if (!Number.isFinite(unitsPerSecond) || unitsPerSecond <= 0) {
    return "估算中";
  }

  const remainingSeconds = Math.round((totalUnits - completedUnits) / unitsPerSecond);
  return formatDuration(remainingSeconds);
}

function getTotalUnits(progress: JobProgress) {
  if (progress.total_students > 0 && progress.total_questions > 0) {
    return progress.total_students * progress.total_questions;
  }
  if (progress.total_students > 0) {
    return progress.total_students;
  }
  if (progress.total_questions > 0) {
    return progress.total_questions;
  }
  return 0;
}

function normalizeTimestamp(ts: number | undefined) {
  if (!Number.isFinite(ts) || !ts) {
    return null;
  }
  return ts > 1_000_000_000_000 ? ts : ts * 1000;
}

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "估算中";
  }
  if (seconds < 60) {
    return `约 ${Math.max(5, Math.ceil(seconds / 5) * 5)} 秒`;
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return `约 ${minutes} 分钟`;
  }
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `约 ${hours} 小时 ${restMinutes} 分钟` : `约 ${hours} 小时`;
}

function getFocusSteps(status: TaskStatus) {
  if (status === "extracting_problems") {
    return [
      { label: "上传完成", description: "文件已进入后台处理队列。", state: "done" as const },
      { label: "识别题目", description: "拆分题号、题干与初始评分信息。", state: "active" as const },
      { label: "进入题目校对", description: "完成后自动显示题目准备总览。", state: "pending" as const },
    ];
  }
  if (status === "parsing_submissions") {
    return [
      { label: "上传完成", description: "作答文件已进入后台处理队列。", state: "done" as const },
      { label: "识别作答", description: "按学生和题号抽取作答内容。", state: "active" as const },
      { label: "进入作答校对", description: "完成后自动显示学生 x 题目矩阵。", state: "pending" as const },
    ];
  }
  if (status === "grading") {
    return [
      { label: "确认完成", description: "题目、作答和资料范围已进入批改。", state: "done" as const },
      { label: "批改中", description: "模型正在逐学生逐题生成结果。", state: "active" as const },
      { label: "结果复核", description: "完成后进入置信度热力图与复核队列。", state: "pending" as const },
    ];
  }
  return [];
}

function ProgressMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Clock3 className="h-3.5 w-3.5" />
      {label}: {value}
    </span>
  );
}

export function TaskProgressLoading() {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background p-3 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      正在同步任务进度...
    </div>
  );
}
