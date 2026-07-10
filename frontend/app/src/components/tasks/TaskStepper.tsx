import { Check, ChevronRight, CircleDot } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { HorizontalScrollHint } from "@/components/ui/HorizontalScrollHint";
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
  const currentStep = TASK_WORKFLOW_STEPS.find((step) => step.key === current) ?? TASK_WORKFLOW_STEPS[0];
  const currentStepNumber = Math.max(currentIndex + 1, 1);
  const currentStepAvailable = task ? isTaskStepAvailable(task.status, currentStep.key) : true;

  return (
    <div className="grid gap-2">
      <div className="rounded-lg border bg-card p-3 xl:hidden">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">当前阶段</p>
            <p className="mt-1 truncate text-sm font-semibold">{currentStep.label}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{currentStep.description}</p>
          </div>
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 py-1 text-xs font-medium",
              currentStepAvailable ? "border-primary/30 bg-primary/5 text-primary" : "border-warning/30 bg-warning/5 text-warning",
            )}
          >
            {currentStepNumber}/{TASK_WORKFLOW_STEPS.length}
          </span>
        </div>
      </div>
      <HorizontalScrollHint label="左右滑动查看全部流程步骤 / Swipe sideways to see all workflow steps." />
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
    </div>
  );
}
