import { Check, ChevronRight, CircleDot } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { cn } from "@/lib/cn";
import {
  getTaskStepIndex,
  isTaskStepAvailable,
  TASK_WORKFLOW_STEPS,
  type TaskWorkflowStepKey,
} from "@/lib/taskFlow";
import type { TaskLite } from "@/types";

export function TaskStepper({ current, task }: { current: TaskWorkflowStepKey; task?: TaskLite }) {
  const { taskId = "draft" } = useParams();
  const currentIndex = getTaskStepIndex(current);

  return (
    <nav aria-label="批改任务流程" className="overflow-x-auto rounded-lg border bg-card p-2">
      <ol className="flex min-w-max items-stretch gap-1">
        {TASK_WORKFLOW_STEPS.map((step, index) => {
          const isActive = step.key === current;
          const isComplete = index < currentIndex;
          const isAvailable = task ? isTaskStepAvailable(task.status, step.key) : true;
          const Icon = isComplete ? Check : CircleDot;

          return (
            <li key={step.key} className="flex items-stretch">
              <Link
                to={step.href(taskId)}
                className={cn(
                  "flex min-w-44 items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left transition",
                  isActive
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : isAvailable
                      ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                      : "cursor-not-allowed text-muted-foreground/60",
                )}
                aria-current={isActive ? "step" : undefined}
                aria-disabled={!isAvailable}
                title={isAvailable ? undefined : "当前任务还未进入此阶段"}
              >
                <span
                  className={cn(
                    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                    isActive
                      ? "border-primary/60"
                      : isComplete
                        ? "border-accent text-accent"
                        : isAvailable
                          ? "border-border"
                          : "border-border text-muted-foreground/50",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>
                <span className="grid gap-0.5">
                  <span className="text-sm font-semibold">{step.label}</span>
                  <span
                    className={cn(
                      "text-xs leading-4",
                      isActive ? "text-primary/80" : "text-muted-foreground",
                    )}
                  >
                    {step.description}
                  </span>
                </span>
              </Link>
              {index < TASK_WORKFLOW_STEPS.length - 1 ? (
                <ChevronRight className="my-auto h-4 w-4 shrink-0 text-muted-foreground" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
