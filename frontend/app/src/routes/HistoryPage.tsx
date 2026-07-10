import { ArrowRight, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { normalizeAPIError } from "@/api/client";
import { useDeleteTask, useTasks } from "@/api/hooks";
import { TaskProgressMini } from "@/components/tasks/TaskProgressMini";
import { TaskStatusIndicator } from "@/components/tasks/TaskStatusIndicator";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Input } from "@/components/ui/Input";
import { formatTaskTime, getTaskActionLabel, getTaskDestination, getTaskNextStep, isTaskProcessing } from "@/lib/taskFlow";
import type { TaskLite, TaskStatus } from "@/types";

type HistoryFilter = "all" | "processing" | "action" | "review" | "error" | "finished";
type HistorySort = "updated-desc" | "created-desc" | "name-asc" | "stage";

const needsActionStatuses = new Set<TaskStatus>(["draft", "problems_ready", "submissions_ready"]);

export function HistoryPage() {
  const tasksQuery = useTasks();
  const deleteTask = useDeleteTask();
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [queryText, setQueryText] = useState("");
  const [filter, setFilter] = useState<HistoryFilter>("all");
  const [sortBy, setSortBy] = useState<HistorySort>("updated-desc");
  const allTasks = useMemo(() => Object.values(tasksQuery.data ?? {}), [tasksQuery.data]);
  const tasks = useMemo(
    () => filterAndSortTasks(allTasks, queryText, filter, sortBy),
    [allTasks, filter, queryText, sortBy],
  );
  const errorMessage = tasksQuery.error ? normalizeAPIError(tasksQuery.error).message : null;

  async function handleDelete(task: TaskLite) {
    const confirmed = window.confirm(`确定删除“${task.name}”吗？此操作会删除该任务及相关批改结果。`);
    if (!confirmed) {
      return;
    }

    setDeletingTaskId(task.task_id);
    try {
      await deleteTask.mutateAsync(task.task_id);
      toast.success("任务已删除。");
    } catch (error) {
      toast.error(normalizeAPIError(error).message);
    } finally {
      setDeletingTaskId(null);
    }
  }

  return (
    <div className="grid gap-5">
      <SectionHeader
        title="历史任务"
        description="查看每个任务当前阶段、最近更新时间和下一步入口；进行中的任务可以并行返回继续。"
        action={
          <Link to="/tasks/new">
            <Button>
              <Plus className="h-4 w-4" />
              新建任务
            </Button>
          </Link>
        }
      />
      <Card className="grid gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold">全部任务</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {tasksQuery.isLoading ? "正在加载任务..." : `显示 ${tasks.length} / ${allTasks.length} 个任务`}
            </p>
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

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
          <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
            搜索任务
            <span className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="w-full pl-9"
                value={queryText}
                placeholder="任务名、任务 ID、错误信息"
                onChange={(event) => setQueryText(event.target.value)}
              />
            </span>
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            阶段筛选
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value as HistoryFilter)}
              className="h-9 min-w-36 rounded-md border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="all">全部任务</option>
              <option value="processing">后台处理中</option>
              <option value="action">需要继续</option>
              <option value="review">待复核</option>
              <option value="error">异常任务</option>
              <option value="finished">已完成</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium text-muted-foreground">
            排序
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as HistorySort)}
              className="h-9 min-w-36 rounded-md border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              <option value="updated-desc">最近更新</option>
              <option value="created-desc">最近创建</option>
              <option value="name-asc">任务名称</option>
              <option value="stage">当前阶段</option>
            </select>
          </label>
        </div>

        {tasksQuery.isLoading ? <HistoryLoading /> : null}
        {!tasksQuery.isLoading && errorMessage ? (
          <EmptyState
            title="无法加载历史任务"
            description={errorMessage}
            action={
              <Button type="button" variant="secondary" onClick={() => void tasksQuery.refetch()}>
                <RefreshCw className="h-4 w-4" />
                重试
              </Button>
            }
          />
        ) : null}
        {!tasksQuery.isLoading && !errorMessage && tasks.length === 0 ? (
          <EmptyState
            title={allTasks.length ? "没有符合条件的任务" : "暂无历史任务"}
            description={allTasks.length ? "可以换一个关键词或筛选条件。" : "创建一个批改任务后，这里会保留草稿、进行中任务和结果入口。"}
            action={
              allTasks.length ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    setQueryText("");
                    setFilter("all");
                  }}
                >
                  清除筛选
                </Button>
              ) : (
                <Link to="/tasks/new">
                  <Button variant="secondary">创建任务</Button>
                </Link>
              )
            }
          />
        ) : null}
        {!tasksQuery.isLoading && !errorMessage && tasks.length > 0 ? (
          <div className="grid gap-2">
            <div className="grid gap-3 xl:hidden">
              {tasks.map((task) => (
                <HistoryTaskCard
                  key={task.task_id}
                  task={task}
                  isDeleting={deleteTask.isPending && deletingTaskId === task.task_id}
                  isDeletePending={deleteTask.isPending}
                  onDelete={() => void handleDelete(task)}
                />
              ))}
            </div>
            <div className="hidden overflow-x-auto xl:block">
              <table className="w-full min-w-[1020px] border-separate border-spacing-0 text-left text-sm">
              <thead>
                <tr className="text-xs text-muted-foreground">
                  <th className="border-b px-3 py-2 font-medium">任务</th>
                  <th className="border-b px-3 py-2 font-medium">当前阶段</th>
                  <th className="border-b px-3 py-2 font-medium">进度</th>
                  <th className="border-b px-3 py-2 font-medium">题目/学生/资料</th>
                  <th className="border-b px-3 py-2 font-medium">下一步</th>
                  <th className="border-b px-3 py-2 font-medium">更新时间</th>
                  <th className="border-b px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => {
                  const nextStep = getTaskNextStep(task, task.task_id);
                  const isDeleting = deleteTask.isPending && deletingTaskId === task.task_id;

                  return (
                    <tr key={task.task_id} className="align-top transition hover:bg-muted/30">
                      <td className="border-b px-3 py-3">
                        <div className="max-w-[240px] truncate font-medium">{task.name}</div>
                        <code className="mt-1 block text-xs text-muted-foreground">{task.task_id}</code>
                        {task.status === "error" && task.error ? (
                          <p className="mt-2 text-xs leading-5 text-danger">{task.error}</p>
                        ) : null}
                      </td>
                      <td className="border-b px-3 py-3">
                        <TaskStatusIndicator status={task.status} showDescription />
                      </td>
                      <td className="border-b px-3 py-3">
                        <TaskProgressMini task={task} />
                      </td>
                      <td className="border-b px-3 py-3 text-muted-foreground">
                        {task.problem_count} / {task.student_count} / {task.kb_doc_count}
                      </td>
                      <td className="border-b px-3 py-3">
                        <div className="font-medium">{nextStep.title}</div>
                        <p className="mt-1 max-w-[260px] text-xs leading-5 text-muted-foreground">{nextStep.description}</p>
                      </td>
                      <td className="border-b px-3 py-3 text-muted-foreground">{formatTaskTime(task.updated_at, true)}</td>
                      <td className="border-b px-3 py-3">
                        <div className="flex justify-end gap-2">
                          <Link to={getTaskDestination(task)}>
                            <Button type="button" variant="secondary" className="h-8">
                              {getTaskActionLabel(task.status)}
                              <ArrowRight className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            type="button"
                            variant="danger"
                            className="h-8"
                            disabled={deleteTask.isPending}
                            onClick={() => void handleDelete(task)}
                          >
                            <Trash2 className="h-4 w-4" />
                            {isDeleting ? "删除中..." : "删除"}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

function HistoryTaskCard({
  isDeletePending,
  isDeleting,
  onDelete,
  task,
}: {
  isDeletePending: boolean;
  isDeleting: boolean;
  onDelete: () => void;
  task: TaskLite;
}) {
  const nextStep = getTaskNextStep(task, task.task_id);
  return (
    <section className="grid gap-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{task.name}</h3>
          <code className="mt-1 block truncate text-xs text-muted-foreground">{task.task_id}</code>
        </div>
        <TaskStatusIndicator status={task.status} />
      </div>
      {task.status === "error" && task.error ? <p className="text-xs leading-5 text-danger">{task.error}</p> : null}
      <TaskProgressMini task={task} />
      <div className="grid gap-1 rounded-md bg-muted/30 p-3 text-xs text-muted-foreground">
        <p>题目 {task.problem_count} · 学生 {task.student_count} · 资料 {task.kb_doc_count}</p>
        <p>更新 {formatTaskTime(task.updated_at, true)}</p>
      </div>
      <div>
        <p className="text-sm font-medium">{nextStep.title}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{nextStep.description}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Link to={getTaskDestination(task)} className="min-w-0">
          <Button type="button" variant="secondary" className="w-full">
            {getTaskActionLabel(task.status)}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
        <Button type="button" variant="danger" disabled={isDeletePending} onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          {isDeleting ? "删除中..." : "删除"}
        </Button>
      </div>
    </section>
  );
}

function HistoryLoading() {
  return (
    <div className="grid gap-2">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="grid gap-2 rounded-md border p-3">
          <div className="h-4 w-1/3 rounded bg-muted" />
          <div className="h-3 w-1/4 rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function filterAndSortTasks(tasks: TaskLite[], queryText: string, filter: HistoryFilter, sortBy: HistorySort): TaskLite[] {
  const query = queryText.trim().toLowerCase();
  return tasks
    .filter((task) => matchesFilter(task, filter))
    .filter((task) => {
      if (!query) {
        return true;
      }
      return [task.name, task.task_id, task.error ?? ""].some((value) => value.toLowerCase().includes(query));
    })
    .sort((a, b) => compareTasks(a, b, sortBy));
}

function matchesFilter(task: TaskLite, filter: HistoryFilter) {
  switch (filter) {
    case "processing":
      return isTaskProcessing(task.status);
    case "action":
      return needsActionStatuses.has(task.status);
    case "review":
      return task.status === "graded";
    case "error":
      return task.status === "error";
    case "finished":
      return task.status === "graded";
    case "all":
    default:
      return true;
  }
}

function compareTasks(a: TaskLite, b: TaskLite, sortBy: HistorySort) {
  switch (sortBy) {
    case "created-desc":
      return b.created_at - a.created_at;
    case "name-asc":
      return a.name.localeCompare(b.name, "zh-CN", { numeric: true }) || b.updated_at - a.updated_at;
    case "stage":
      return a.status.localeCompare(b.status, "zh-CN") || b.updated_at - a.updated_at;
    case "updated-desc":
    default:
      return b.updated_at - a.updated_at;
  }
}
