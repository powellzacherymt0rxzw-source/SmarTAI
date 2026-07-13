import { Loader2 } from "lucide-react";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { getTaskStatusMeta, isTaskProcessing } from "@/lib/taskFlow";
import type { TaskLite } from "@/types";

export function TaskProgressMini({ task }: { task: TaskLite }) {
  const isProcessing = isTaskProcessing(task.status);
  const progressQuery = useTaskProgress(task.task_id, { enabled: isProcessing });
  const progress = progressQuery.progress;
  const percent = isProcessing
    ? progress ? progressQuery.percent : null
    : task.status === "graded" ? 100 : null;
  const eta = isProcessing
    ? progress?.phase === "done" ? "即将完成" : "估算中"
    : task.status === "graded" ? "结果已生成" : "—";

  return (
    <div className="min-w-32">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 font-medium">
          {isProcessing ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" /> : null}
          <span className="truncate">{isProcessing ? "后台处理中" : getTaskStatusMeta(task.status).shortLabel}</span>
        </span>
        <span className="shrink-0 text-muted-foreground">
          {percent === null ? "—" : `${percent}%`}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">预计：{eta}</p>
    </div>
  );
}
