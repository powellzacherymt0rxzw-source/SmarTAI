import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, ListChecks, Plus, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { normalizeAPIError } from "@/api/client";
import { useTasks } from "@/api/hooks";
import { TaskStatusIndicator } from "@/components/tasks/TaskStatusIndicator";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { HorizontalScrollHint } from "@/components/ui/HorizontalScrollHint";
import { StatTile } from "@/components/ui/StatTile";
import {
  formatTaskTime,
  getTaskActionLabel,
  getTaskDestination,
  getTaskNextStep,
  isTaskProcessing,
} from "@/lib/taskFlow";
import type { TaskLite, TaskStatus } from "@/types";

const needsActionStatuses = new Set<TaskStatus>(["draft", "problems_ready", "submissions_ready", "error"]);

export function DashboardPage() {
  const tasksQuery = useTasks();
  const tasks = useMemo(() => toSortedTasks(tasksQuery.data), [tasksQuery.data]);
  const recentTasks = tasks.slice(0, 8);
  const processingCount = tasks.filter((task) => isTaskProcessing(task.status)).length;
  const needsActionCount = tasks.filter((task) => needsActionStatuses.has(task.status)).length;
  const reviewCount = tasks.filter((task) => task.status === "graded").length;
  const errorMessage = tasksQuery.error ? normalizeAPIError(tasksQuery.error).message : null;

  return (
    <div className="grid gap-5">
      <SectionHeader
        title="任务总览"
        description="像任务队列一样查看每个批改任务当前走到哪一步、下一步该做什么，以及是否需要复核。"
        action={
          <Link to="/tasks/new">
            <Button>
              <Plus className="h-4 w-4" />
              新建任务
            </Button>
          </Link>
        }
      />
      <div className="grid gap-3 md:grid-cols-4">
        <StatTile icon={CircleDashed} label="后台处理中" value={tasksQuery.isLoading ? "—" : processingCount} tone="primary" />
        <StatTile icon={ListChecks} label="需要继续" value={tasksQuery.isLoading ? "—" : needsActionCount} tone="warning" />
        <StatTile icon={CheckCircle2} label="待复核" value={tasksQuery.isLoading ? "—" : reviewCount} tone="accent" />
        <StatTile icon={ListChecks} label="全部任务" value={tasksQuery.isLoading ? "—" : tasks.length} />
      </div>
      <Card className="grid gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">近期任务队列</h2>
            <p className="mt-1 text-sm text-muted-foreground">优先处理异常、待校对和批改完成待复核的任务。</p>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="w-fit"
            disabled={tasksQuery.isFetching}
            onClick={() => void tasksQuery.refetch()}
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        </div>

        {tasksQuery.isLoading ? <TaskQueueLoading /> : null}
        {!tasksQuery.isLoading && errorMessage ? (
          <EmptyState
            title="无法加载任务"
            description={errorMessage}
            action={
              <Button type="button" variant="secondary" onClick={() => void tasksQuery.refetch()}>
                <RefreshCw className="h-4 w-4" />
                重试
              </Button>
            }
          />
        ) : null}
        {!tasksQuery.isLoading && !errorMessage && recentTasks.length === 0 ? (
          <EmptyState
            title="还没有批改任务"
            description="创建一个任务后，这里会显示它的当前阶段、下一步和进度入口。"
            action={
              <Link to="/tasks/new">
                <Button variant="secondary">创建第一个任务</Button>
              </Link>
            }
          />
        ) : null}
        {!tasksQuery.isLoading && !errorMessage && recentTasks.length > 0 ? <TaskQueueTable tasks={recentTasks} /> : null}
      </Card>
    </div>
  );
}

function TaskQueueTable({ tasks }: { tasks: TaskLite[] }) {
  return (
    <div className="grid gap-2">
      <HorizontalScrollHint />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th className="border-b px-3 py-2 font-medium">任务</th>
            <th className="border-b px-3 py-2 font-medium">当前阶段</th>
            <th className="border-b px-3 py-2 font-medium">内容</th>
            <th className="border-b px-3 py-2 font-medium">下一步</th>
            <th className="border-b px-3 py-2 font-medium">更新时间</th>
            <th className="border-b px-3 py-2 text-right font-medium">操作</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => {
            const nextStep = getTaskNextStep(task, task.task_id);
            return (
              <tr key={task.task_id} className="align-top transition hover:bg-muted/30">
                <td className="border-b px-3 py-3">
                  <div className="max-w-[220px] truncate font-medium">{task.name}</div>
                  <code className="mt-1 block text-xs text-muted-foreground">{task.task_id}</code>
                  {task.status === "error" && task.error ? (
                    <p className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-danger">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span className="min-w-0 break-words">{task.error}</span>
                    </p>
                  ) : null}
                </td>
                <td className="border-b px-3 py-3">
                  <TaskStatusIndicator status={task.status} showDescription />
                </td>
                <td className="border-b px-3 py-3 text-muted-foreground">
                  <div>题目 {task.problem_count}</div>
                  <div>学生 {task.student_count}</div>
                  <div>资料 {task.kb_doc_count}</div>
                </td>
                <td className="border-b px-3 py-3">
                  <div className="font-medium">{nextStep.title}</div>
                  <p className="mt-1 max-w-[260px] text-xs leading-5 text-muted-foreground">{nextStep.description}</p>
                </td>
                <td className="border-b px-3 py-3 text-muted-foreground">{formatTaskTime(task.updated_at)}</td>
                <td className="border-b px-3 py-3">
                  <div className="flex justify-end">
                    <Link to={getTaskDestination(task)}>
                      <Button type="button" variant="secondary" className="h-8">
                        {getTaskActionLabel(task.status)}
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
    </div>
  );
}

function TaskQueueLoading() {
  return (
    <div className="grid gap-2">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="grid gap-2 rounded-md border p-3">
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="h-3 w-2/3 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function toSortedTasks(data: Record<string, TaskLite> | undefined): TaskLite[] {
  return Object.values(data ?? {}).sort((a, b) => b.updated_at - a.updated_at);
}
