import { Loader2 } from "lucide-react";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { getTaskStatusMeta, isTaskProcessing } from "@/lib/taskFlow";
import type { JobProgress, TaskLite } from "@/types";

export function TaskProgressMini({ task }: { task: TaskLite }) {
  const isProcessing = isTaskProcessing(task.status);
  const progressQuery = useTaskProgress(task.task_id, { enabled: isProcessing });
  const progress = progressQuery.progress;
  const percent = isProcessing ? progressQuery.percent : getStaticPercent(task);
  const eta = isProcessing ? getMiniEta(progress, percent) : getStaticEta(task);

  return (
    <div className="min-w-32">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          {isProcessing ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" /> : null}
          <span className="truncate">{isProcessing ? "后台处理中" : getTaskStatusMeta(task.status).shortLabel}</span>
        </span>
        <span className="shrink-0 text-muted-foreground">{percent}%</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">预计：{eta}</p>
    </div>
  );
}

function getStaticPercent(task: TaskLite) {
  switch (task.status) {
    case "graded":
      return 100;
    case "submissions_ready":
      return 75;
    case "problems_ready":
      return 45;
    case "draft":
    case "error":
    default:
      return 0;
  }
}

function getStaticEta(task: TaskLite) {
  switch (task.status) {
    case "graded":
      return "已完成";
    case "submissions_ready":
      return "待启动批改";
    case "problems_ready":
      return "待上传作答";
    case "draft":
      return "待添加题目";
    case "error":
      return "需处理异常";
    default:
      return "—";
  }
}

function getMiniEta(progress: JobProgress | null, percent: number) {
  if (!progress) {
    return "读取中";
  }
  if (percent >= 100 || progress.phase === "done") {
    return "即将完成";
  }

  const totalUnits = getTotalUnits(progress);
  const completedUnits = progress.completed_units ?? 0;
  if (totalUnits <= 0 || completedUnits <= 0) {
    return "估算中";
  }

  const firstTs = normalizeTimestamp(progress.messages[0]?.ts);
  if (!firstTs) {
    return "估算中";
  }

  const elapsedSeconds = Math.max(1, (Date.now() - firstTs) / 1000);
  const unitsPerSecond = completedUnits / elapsedSeconds;
  if (!Number.isFinite(unitsPerSecond) || unitsPerSecond <= 0) {
    return "估算中";
  }

  return formatDuration(Math.round((totalUnits - completedUnits) / unitsPerSecond));
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
  return minutes < 60 ? `约 ${minutes} 分钟` : `约 ${Math.ceil(minutes / 60)} 小时`;
}
