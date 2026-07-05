import type { ReactNode } from "react";
import { ArrowRight, Loader2, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { TaskStatusIndicator } from "@/components/tasks/TaskStatusIndicator";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { InlineNotice } from "@/components/ui/InlineNotice";
import { getTaskStepGate, type TaskWorkflowStepKey } from "@/lib/taskFlow";
import type { TaskLite } from "@/types";

export function TaskStageGate({
  task,
  current,
  isLoading,
  isError,
  errorMessage,
  onRetry,
  children,
}: {
  task?: TaskLite;
  current: TaskWorkflowStepKey;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (isLoading) {
    return (
      <Card className="flex items-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在读取任务阶段...
      </Card>
    );
  }

  if (isError) {
    return (
      <InlineNotice
        tone="danger"
        title="无法确认任务阶段"
        action={
          onRetry ? (
            <Button type="button" variant="secondary" onClick={onRetry}>
              <RefreshCw className="h-4 w-4" />
              重试
            </Button>
          ) : null
        }
      >
        {errorMessage || "请稍后重试，或从历史任务重新进入。"}
      </InlineNotice>
    );
  }

  const gate = getTaskStepGate(task, current);

  if (gate.available) {
    return children;
  }

  return (
    <Card className="grid gap-4">
      <div className="grid gap-2">
        <TaskStatusIndicator status={task?.status} variant="chip" />
        <h2 className="text-lg font-semibold">{gate.title}</h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{gate.description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link to={gate.currentStepHref}>
          <Button type="button">
            {gate.actionLabel}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Link to="/history">
          <Button type="button" variant="secondary">
            查看历史任务
          </Button>
        </Link>
      </div>
    </Card>
  );
}
