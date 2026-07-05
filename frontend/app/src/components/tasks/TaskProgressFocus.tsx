import { Clock3, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { InlineNotice } from "@/components/ui/InlineNotice";
import { TaskStatusIndicator } from "@/components/tasks/TaskStatusIndicator";
import { getTaskStatusMeta } from "@/lib/taskFlow";
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

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="grid gap-2">
          <TaskStatusIndicator status={status} variant="chip" />
          <div>
            <h2 className="text-base font-semibold">{isLoading ? "正在读取任务状态" : phaseLabel}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{meta.description}</p>
          </div>
        </div>
        {onRefresh ? (
          <Button type="button" variant="ghost" className="w-fit" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        ) : null}
      </div>

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
          <ProgressMetric label="预计剩余" value={isProcessing ? "估算中" : "—"} />
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
      ) : null}

      {error ? (
        <InlineNotice tone="danger" title="任务处理遇到问题">
          {error}
        </InlineNotice>
      ) : null}
    </div>
  );
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
