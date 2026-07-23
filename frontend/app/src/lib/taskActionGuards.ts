import { APIError, normalizeAPIError } from "@/api/client";
import type { ExpertConfig, Task, TaskLite, TaskStatus } from "@/types";

export interface ModelReadiness {
  isLoading: boolean;
  isError: boolean;
  enabledCount: number;
  hasEnabledExpert: boolean;
  disabledReason: string | null;
}

export function getModelReadiness({
  experts,
  isLoading,
  isError,
}: {
  experts: ExpertConfig[] | undefined;
  isLoading: boolean;
  isError: boolean;
}): ModelReadiness {
  const enabledCount = (experts ?? []).filter((expert) => expert.enabled).length;
  const loaded = !isLoading && !isError;

  return {
    isLoading,
    isError,
    enabledCount,
    hasEnabledExpert: enabledCount > 0,
    disabledReason: loaded && enabledCount === 0 ? "需要先启用至少一个 BYOK 专家。" : null,
  };
}

export type UploadKind = "problems" | "submissions";

const RESULT_STATUSES = new Set<TaskStatus>([
  "graded", "review_confirmed", "generating_analysis", "finalized",
]);

export interface UploadGuard {
  disabled: boolean;
  reason: string | null;
  confirmTitle: string | null;
  confirmMessage: string | null;
  suggestNewTask: boolean;
}

export function getUploadGuard({
  kind,
  task,
  isUploading,
  isProcessing,
  modelReadiness,
}: {
  kind: UploadKind;
  task?: Task | TaskLite;
  isUploading: boolean;
  isProcessing: boolean;
  modelReadiness: ModelReadiness;
}): UploadGuard {
  if (isUploading) {
    return disabled("正在上传文件，请稍候。");
  }
  if (isProcessing) {
    return disabled("当前任务正在后台处理中，请等当前阶段完成后再重新上传。");
  }
  if (modelReadiness.isError) {
    return disabled("暂时无法确认 BYOK 专家状态，请刷新后再试。");
  }
  if (modelReadiness.disabledReason) {
    return disabled(modelReadiness.disabledReason);
  }

  if (!task) {
    return {
      disabled: false,
      reason: null,
      confirmTitle: null,
      confirmMessage: null,
      suggestNewTask: false,
    };
  }

  if (kind === "problems" && (task.problem_file_name || task.problem_count > 0)) {
    const hasDownstreamData = task.student_count > 0 || RESULT_STATUSES.has(task.status) || task.status === "grading";
    return {
      disabled: false,
      reason: null,
      confirmTitle: "确认替换题目文件？",
      confirmMessage: hasDownstreamData
        ? "替换题目会覆盖已识别的题目，并可能让已有学生作答、批改结果和分析不再匹配。若只是想批改另一份作业，建议新建任务。"
        : "替换题目会覆盖当前已识别的题目内容。确认继续上传新文件吗？",
      suggestNewTask: hasDownstreamData,
    };
  }

  if (kind === "submissions" && (task.submission_file_name || task.student_count > 0)) {
    return {
      disabled: task.status === "grading" || task.status === "generating_analysis",
      reason: task.status === "grading"
        ? "批改正在进行中，不能替换学生作答。"
        : task.status === "generating_analysis"
          ? "分析正在生成中，不能替换学生作答。"
          : null,
      confirmTitle: "确认替换学生作答？",
      confirmMessage:
        RESULT_STATUSES.has(task.status)
          ? "替换学生作答会覆盖已识别的作答，并使已有批改结果需要重新生成。若只是想批改另一批学生，建议新建任务。"
          : "替换学生作答会覆盖当前已识别的作答内容。确认继续上传新文件吗？",
      suggestNewTask: RESULT_STATUSES.has(task.status),
    };
  }

  return {
    disabled: false,
    reason: null,
    confirmTitle: null,
    confirmMessage: null,
    suggestNewTask: false,
  };
}

export interface GradingGuard {
  disabled: boolean;
  reason: string | null;
}

export function getGradingGuard({
  status,
  problemCount,
  studentCount,
  isPending,
  modelReadiness,
}: {
  status: TaskStatus;
  problemCount: number;
  studentCount: number;
  isPending: boolean;
  modelReadiness: ModelReadiness;
}): GradingGuard {
  if (isPending) {
    return { disabled: true, reason: "正在启动批改。" };
  }
  if (modelReadiness.isError) {
    return { disabled: true, reason: "暂时无法确认 BYOK 专家状态，请刷新后再试。" };
  }
  if (modelReadiness.disabledReason) {
    return { disabled: true, reason: modelReadiness.disabledReason };
  }
  if (problemCount <= 0) {
    return { disabled: true, reason: "请先上传并校对题目。" };
  }
  if (studentCount <= 0) {
    return { disabled: true, reason: "请先上传并校对学生作答。" };
  }
  if (status !== "submissions_ready") {
    if (status === "grading") {
      return { disabled: true, reason: "批改已经在进行中。" };
    }
    if (RESULT_STATUSES.has(status)) {
      return { disabled: true, reason: "批改已完成，请进入结果复核。" };
    }
    return { disabled: true, reason: "请先完成题目和作答校对，再开始批改。" };
  }
  return { disabled: false, reason: null };
}

export interface RecoverableErrorInfo {
  title: string;
  description: string;
  actionLabel: string;
  actionHref?: string;
}

export function classifyRecoverableError(error: unknown): RecoverableErrorInfo {
  const apiError = normalizeAPIError(error);
  const message = apiError.message || "请求失败，请稍后重试。";
  const normalized = message.toLowerCase();

  if (apiError.status === 0) {
    return {
      title: "网络或后端暂时不可用",
      description: message.includes("waking up") ? "后端可能正在唤醒。稍等片刻后重试即可。" : message,
      actionLabel: "重试",
    };
  }

  if (apiError.status === 409) {
    return {
      title: "当前阶段暂时不能执行此操作",
      description: message,
      actionLabel: "刷新状态",
    };
  }

  if (apiError.status === 429) {
    return {
      title: "请求过于频繁或额度暂时不可用",
      description: "请稍后再试。如果是模型 API 限额，系统会在下一轮窗口恢复后继续可用。",
      actionLabel: "稍后重试",
    };
  }

  if (apiError.status === 503 || normalized.includes("provider") || normalized.includes("api key") || normalized.includes("byok")) {
    return {
      title: "需要配置 BYOK 专家",
      description: "当前没有可用模型来源。请先到 BYOK 专家页添加并启用至少一个专家。",
      actionLabel: "前往 BYOK",
      actionHref: "/experts",
    };
  }

  if (apiError.status === 400 || apiError.status === 413) {
    return {
      title: "文件无法处理",
      description: message,
      actionLabel: "重新选择文件",
    };
  }

  return {
    title: apiError instanceof APIError && apiError.status >= 500 ? "后端处理失败" : "操作失败",
    description: message,
    actionLabel: "重试",
  };
}

function disabled(reason: string): UploadGuard {
  return {
    disabled: true,
    reason,
    confirmTitle: null,
    confirmMessage: null,
    suggestNewTask: false,
  };
}
