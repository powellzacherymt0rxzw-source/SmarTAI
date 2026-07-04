import { Check, ChevronRight, CircleDot } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { cn } from "@/lib/cn";

type StepKey = "setup" | "problems" | "submissions" | "grading" | "results";

const steps: Array<{
  key: StepKey;
  label: string;
  description: string;
  href: (taskId: string) => string;
}> = [
  {
    key: "setup",
    label: "资料配置",
    description: "专家与任务资料",
    href: (taskId) => `/tasks/${taskId}/setup`,
  },
  {
    key: "problems",
    label: "题目准备",
    description: "添加与校对题目",
    href: (taskId) => `/tasks/${taskId}/upload/problems`,
  },
  {
    key: "submissions",
    label: "作答校对",
    description: "添加与校对作答",
    href: (taskId) => `/tasks/${taskId}/upload/submissions`,
  },
  {
    key: "grading",
    label: "批改确认",
    description: "策略与进度",
    href: (taskId) => `/tasks/${taskId}/results`,
  },
  {
    key: "results",
    label: "复核分析",
    description: "复核后分析导出",
    href: (taskId) => `/tasks/${taskId}/results`,
  },
];

const order = steps.map((step) => step.key);

export function TaskStepper({ current }: { current: StepKey }) {
  const { taskId = "draft" } = useParams();
  const currentIndex = order.indexOf(current);

  return (
    <nav aria-label="批改任务流程" className="overflow-x-auto rounded-lg border bg-card p-2">
      <ol className="flex min-w-max items-stretch gap-1">
        {steps.map((step, index) => {
          const isActive = step.key === current;
          const isComplete = index < currentIndex;
          const Icon = isComplete ? Check : CircleDot;

          return (
            <li key={step.key} className="flex items-stretch">
              <Link
                to={step.href(taskId)}
                className={cn(
                  "flex min-w-44 items-center gap-3 rounded-md border border-transparent px-3 py-2 text-left transition",
                  isActive
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                aria-current={isActive ? "step" : undefined}
              >
                <span
                  className={cn(
                    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
                    isActive
                      ? "border-primary/60"
                      : isComplete
                        ? "border-accent text-accent"
                        : "border-border",
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
              {index < steps.length - 1 ? (
                <ChevronRight className="my-auto h-4 w-4 shrink-0 text-muted-foreground" />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
