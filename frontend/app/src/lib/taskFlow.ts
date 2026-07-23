import type { TaskLite, TaskStatus } from "@/types";
import type { MessageKey } from "@/i18n/messages";

export type TaskDisplayStatus = TaskStatus | "completed" | "not_found" | "review_confirmed" | "generating_analysis" | "finalized";

export type TaskStatusTone = "neutral" | "primary" | "accent" | "warning" | "danger";
export type TaskWorkflowStepKey = "setup" | "problems" | "submissions" | "grading" | "results";

export interface TaskStatusMeta {
  label: string;
  shortLabel: string;
  description: string;
  tone: TaskStatusTone;
  isProcessing: boolean;
}

const DEFAULT_STATUS_META: TaskStatusMeta = {
  label: "未知阶段",
  shortLabel: "未知",
  description: "当前阶段暂时无法识别，请刷新任务状态或从历史任务重新进入。",
  tone: "neutral",
  isProcessing: false,
};

export const TASK_STATUS_META: Record<TaskDisplayStatus, TaskStatusMeta> = {
  draft: {
    label: "草稿",
    shortLabel: "草稿",
    description: "任务已创建，下一步添加题目文件。",
    tone: "neutral",
    isProcessing: false,
  },
  extracting_problems: {
    label: "题目识别中",
    shortLabel: "识别题目",
    description: "系统正在拆分题目、题号与基础评分信息。",
    tone: "primary",
    isProcessing: true,
  },
  problems_ready: {
    label: "题目待校对",
    shortLabel: "题目校对",
    description: "题目已识别，可以校对题干、评分标准、标答与测试样例。",
    tone: "accent",
    isProcessing: false,
  },
  parsing_submissions: {
    label: "作答识别中",
    shortLabel: "识别作答",
    description: "系统正在按学生和题目解析作答内容。",
    tone: "primary",
    isProcessing: true,
  },
  submissions_ready: {
    label: "作答待校对",
    shortLabel: "作答校对",
    description: "学生作答已识别，可以复核后进入批改前确认。",
    tone: "accent",
    isProcessing: false,
  },
  grading: {
    label: "批改中",
    shortLabel: "批改中",
    description: "系统正在根据题目、作答、资料与评分策略生成批改结果。",
    tone: "warning",
    isProcessing: true,
  },
  graded: {
    label: "批改完成，待复核",
    shortLabel: "待复核",
    description: "批改已完成，建议先复核低置信题次，再生成分析与导出。",
    tone: "accent",
    isProcessing: false,
  },
  completed: {
    label: "批改完成，待复核",
    shortLabel: "待复核",
    description: "批改结果可查看，但正式分析和导出应在教师复核后生成。",
    tone: "accent",
    isProcessing: false,
  },
  review_confirmed: {
    label: "复核已确认",
    shortLabel: "已复核",
    description: "教师已确认批改结果，可以生成分析与导出。",
    tone: "accent",
    isProcessing: false,
  },
  generating_analysis: {
    label: "分析生成中",
    shortLabel: "生成分析",
    description: "系统正在生成学情分析、统计图和导出文件。",
    tone: "primary",
    isProcessing: true,
  },
  finalized: {
    label: "正式完成",
    shortLabel: "完成",
    description: "复核、分析与导出均已完成。",
    tone: "accent",
    isProcessing: false,
  },
  error: {
    label: "需要处理",
    shortLabel: "异常",
    description: "当前任务遇到错误，需要查看原因后重试或重新上传。",
    tone: "danger",
    isProcessing: false,
  },
  not_found: {
    label: "结果不可用",
    shortLabel: "不可用",
    description: "未找到对应结果记录，请返回任务流程检查当前阶段。",
    tone: "danger",
    isProcessing: false,
  },
};

export const TASK_WORKFLOW_STEPS: Array<{
  key: TaskWorkflowStepKey;
  label: string;
  description: string;
  href: (taskId: string) => string;
}> = [
  {
    key: "setup",
    label: "资料配置",
    description: "专家与任务资料",
    href: (taskId) => `/tasks/${taskId}`,
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
    href: (taskId) => `/tasks/${taskId}/submissions/upload`,
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

const STEP_ORDER = TASK_WORKFLOW_STEPS.map((step) => step.key);

export function getTaskStatusMeta(status?: string | null): TaskStatusMeta {
  if (!status) {
    return DEFAULT_STATUS_META;
  }
  return TASK_STATUS_META[status as TaskDisplayStatus] ?? DEFAULT_STATUS_META;
}

export function isTaskProcessing(status?: string | null): boolean {
  return getTaskStatusMeta(status).isProcessing;
}

export function getTaskCurrentStep(status?: string | null): TaskWorkflowStepKey {
  switch (status) {
    case "draft":
      return "setup";
    case "extracting_problems":
    case "problems_ready":
      return "problems";
    case "parsing_submissions":
    case "submissions_ready":
      return "submissions";
    case "grading":
      return "grading";
    case "graded":
    case "completed":
    case "review_confirmed":
    case "generating_analysis":
    case "finalized":
      return "results";
    case "error":
    default:
      return "setup";
  }
}

export function getTaskStepIndex(step: TaskWorkflowStepKey): number {
  return STEP_ORDER.indexOf(step);
}

export function getTaskStepHref(step: TaskWorkflowStepKey, taskId: string): string {
  return TASK_WORKFLOW_STEPS.find((item) => item.key === step)?.href(taskId) ?? `/tasks/${taskId}`;
}

export function isTaskStepAvailable(
  status: TaskStatus | string | undefined,
  step: TaskWorkflowStepKey,
  gradingSetupConfigured?: boolean,
): boolean {
  if (!status || status === "error") {
    return step === "setup";
  }

  switch (step) {
    case "setup":
      return true;
    case "problems":
      return true;
    case "submissions":
      if (gradingSetupConfigured !== true) {
        return false;
      }
      return [
        "problems_ready",
        "parsing_submissions",
        "submissions_ready",
        "grading",
        "graded",
        "completed",
        "review_confirmed",
        "generating_analysis",
        "finalized",
      ].includes(status);
    case "grading":
      return ["submissions_ready", "grading", "graded", "completed", "review_confirmed", "generating_analysis", "finalized"].includes(status);
    case "results":
      return ["grading", "graded", "completed", "review_confirmed", "generating_analysis", "finalized"].includes(status);
  }
}

export function isTaskStepComplete(status: TaskStatus | string | undefined, step: TaskWorkflowStepKey): boolean {
  if (!status) {
    return false;
  }

  const currentStep = getTaskCurrentStep(status);
  return getTaskStepIndex(step) < getTaskStepIndex(currentStep);
}

export interface TaskStepGateResult {
  available: boolean;
  currentStep: TaskWorkflowStepKey;
  currentStepLabel: string;
  currentStepHref: string;
  requestedStepLabel: string;
  title: string;
  description: string;
  actionLabel: string;
}

export function getTaskStepGate(
  task: TaskLite | undefined,
  requestedStep: TaskWorkflowStepKey,
  translate?: (key: MessageKey) => string,
): TaskStepGateResult {
  const taskId = task?.task_id ?? "";
  const status = task?.status;
  const recoveryHref = task && status === "error" ? getTaskDestination(task) : null;
  const currentStep = recoveryHref
    ? getRecoveryStep(recoveryHref)
    : getTaskCurrentStep(status);
  const currentStepConfig = TASK_WORKFLOW_STEPS.find((step) => step.key === currentStep) ?? TASK_WORKFLOW_STEPS[0];
  const requestedStepConfig = TASK_WORKFLOW_STEPS.find((step) => step.key === requestedStep) ?? TASK_WORKFLOW_STEPS[0];
  const available = Boolean(task && (
    recoveryHref
      ? requestedStep === currentStep
      : isTaskStepAvailable(status, requestedStep, task.grading_setup_configured)
  ));
  const needsGradingSetup = Boolean(
    task &&
    requestedStep === "submissions" &&
    ["problems_ready", "parsing_submissions", "submissions_ready"].includes(status ?? "") &&
    task.grading_setup_configured !== true,
  );

  return {
    available,
    currentStep,
    currentStepLabel: currentStepConfig.label,
    currentStepHref: needsGradingSetup
      ? `/tasks/${taskId}/grading-setup`
      : recoveryHref
        ? recoveryHref
        : task
          ? getTaskDestination(task)
          : "/history",
    requestedStepLabel: requestedStepConfig.label,
    title: needsGradingSetup
      ? translate?.("taskGateGradingSetupTitle") ?? "请先完成批改设置"
      : `还不能进入${requestedStepConfig.label}`,
    description: needsGradingSetup
      ? translate?.("taskGateGradingSetupDescription") ?? "保存本任务的模型、资料范围与评分方式后，才能添加学生作答。"
      : task
        ? `当前任务处于「${getTaskStatusMeta(status).label}」，请先完成「${currentStepConfig.label}」后再继续。`
        : "任务信息尚未读取完成，请稍后刷新或从历史任务重新进入。",
    actionLabel: needsGradingSetup
      ? translate?.("taskGateGradingSetupAction") ?? "前往批改设置"
      : `回到${currentStepConfig.label}`,
  };
}

function getRecoveryStep(destination: string): TaskWorkflowStepKey {
  if (destination.endsWith("/results")) {
    return "results";
  }
  if (destination.endsWith("/upload/submissions")) {
    return "submissions";
  }
  if (destination.endsWith("/submissions/upload")) {
    return "submissions";
  }
  if (destination.endsWith("/submissions/progress")) {
    return "submissions";
  }
  return "problems";
}

type TaskDestinationInput = Pick<TaskLite, "task_id" | "status" | "grading_setup_configured"> & Partial<Pick<
  TaskLite,
  | "last_failed_job_id"
  | "extract_job_id"
  | "parse_job_id"
  | "grading_job_id"
  | "problem_file_name"
  | "submission_file_name"
  | "problem_count"
  | "student_count"
>>;

export function getTaskDestination(task: TaskDestinationInput): string {
  const taskRoot = `/tasks/${task.task_id}`;

  switch (task.status) {
    case "extracting_problems":
      return `${taskRoot}/problems/progress`;
    case "problems_ready":
      return task.grading_setup_configured
        ? `${taskRoot}/submissions/upload`
        : `${taskRoot}/questions`;
    case "parsing_submissions":
      return `${taskRoot}/submissions/progress`;
    case "submissions_ready":
      return `${taskRoot}/upload/submissions`;
    case "grading":
    case "graded":
      return `${taskRoot}/results`;
    case "draft":
      return `${taskRoot}/upload/problems`;
    case "error": {
      const failedJobId = task.last_failed_job_id;

      if (failedJobId && failedJobId === task.grading_job_id) {
        return `${taskRoot}/results`;
      }
      if (failedJobId && failedJobId === task.parse_job_id) {
        return `${taskRoot}/submissions/progress`;
      }
      if (failedJobId && failedJobId === task.extract_job_id) {
        return `${taskRoot}/problems/progress`;
      }

      // Older task snapshots may not expose last_failed_job_id. Recover to
      // the furthest stage supported by persisted job/file/count evidence.
      if (task.grading_job_id) {
        return `${taskRoot}/results`;
      }
      if (task.parse_job_id) {
        return `${taskRoot}/submissions/progress`;
      }
      if (task.submission_file_name || (task.student_count ?? 0) > 0) {
        return `${taskRoot}/submissions/upload`;
      }
      if ((task.problem_count ?? 0) > 0) {
        return `${taskRoot}/questions`;
      }
      if (task.extract_job_id || task.problem_file_name) {
        return `${taskRoot}/problems/progress`;
      }
      return `${taskRoot}/upload/problems`;
    }
    default:
      return `${taskRoot}/upload/problems`;
  }
}

export function getTaskActionLabel(status: TaskDisplayStatus | TaskStatus | string): string {
  switch (status) {
    case "extracting_problems":
      return "查看识别进度";
    case "problems_ready":
      return "校对题目";
    case "parsing_submissions":
      return "查看识别进度";
    case "submissions_ready":
      return "校对作答";
    case "grading":
      return "查看批改进度";
    case "graded":
    case "completed":
      return "复核结果";
    case "review_confirmed":
      return "生成分析";
    case "generating_analysis":
      return "查看分析进度";
    case "finalized":
      return "查看归档结果";
    case "error":
      return "处理异常";
    case "draft":
    default:
      return "继续任务";
  }
}

export interface TaskNextStep {
  title: string;
  description: string;
  buttonLabel: string;
  to: string;
}

export function getTaskNextStep(
  task: TaskLite | undefined,
  taskId: string,
  translate?: (key: MessageKey) => string,
): TaskNextStep {
  if (!task || !taskId) {
    return {
      title: "读取任务后继续",
      description: "任务信息读取完成后，会根据当前阶段跳到对应环节。",
      buttonLabel: "前往历史任务",
      to: "/history",
    };
  }

  const problemUpload = `/tasks/${taskId}/upload/problems`;
  const problemProgress = `/tasks/${taskId}/problems/progress`;
  const submissionUpload = `/tasks/${taskId}/submissions/upload`;
  const submissionProgress = `/tasks/${taskId}/submissions/progress`;
  const submissionWorkspace = `/tasks/${taskId}/upload/submissions`;
  const results = `/tasks/${taskId}/results`;

  switch (task.status) {
    case "draft":
      return {
        title: "添加题目文件",
        description: "先上传题目并完成识别，之后进入题目校对与资料配置。",
        buttonLabel: "添加题目",
        to: problemUpload,
      };
    case "extracting_problems":
      return {
        title: "等待题目识别完成",
        description: "可以留在进度页观察子步骤，也可以稍后从任务总览回来。",
        buttonLabel: "查看进度",
        to: problemProgress,
      };
    case "problems_ready":
      if (task.grading_setup_configured) {
        return {
          title: translate?.("taskNextProblemsConfiguredTitle") ?? "添加学生作答",
          description: translate?.("taskNextProblemsConfiguredDescription") ?? "批改设置已保存，可以上传并识别本次任务的学生作答。",
          buttonLabel: translate?.("taskNextProblemsConfiguredAction") ?? "添加学生作答",
          to: submissionUpload,
        };
      }
      return {
        title: translate?.("taskNextProblemsSetupTitle") ?? "校对题目并补充资料",
        description: translate?.("taskNextProblemsSetupDescription") ?? "确认题干、评分标准、标答和测试样例，再完成批改设置。",
        buttonLabel: translate?.("taskNextProblemsSetupAction") ?? "校对题目",
        to: `/tasks/${taskId}/questions`,
      };
    case "parsing_submissions":
      return {
        title: "等待作答识别完成",
        description: "学生作答正在解析，完成后进入作答校对。",
        buttonLabel: "查看进度",
        to: submissionProgress,
      };
    case "submissions_ready":
      return {
        title: "批改前确认",
        description: "题目和作答已就绪，下一步确认专家组合、资料范围与评分策略。",
        buttonLabel: "进入确认",
        to: submissionWorkspace,
      };
    case "grading":
      return {
        title: "查看批改进度",
        description: "批改正在进行，完成后进入结果复核。",
        buttonLabel: "查看进度",
        to: results,
      };
    case "graded":
      return {
        title: "复核批改结果",
        description: "优先处理低置信题次；复核确认后再生成分析和导出。",
        buttonLabel: "复核结果",
        to: results,
      };
    case "error":
      return {
        title: "处理任务异常",
        description: "查看错误原因，可重试、重新上传，或回到最近阶段继续。",
        buttonLabel: "处理异常",
        to: getTaskDestination(task),
      };
  }
}

export function formatTaskTime(
  timestamp: number | undefined,
  includeYear = false,
  locale = "zh-CN",
): string {
  if (!Number.isFinite(timestamp) || !timestamp || timestamp <= 0) {
    return "—";
  }

  return new Intl.DateTimeFormat(locale, {
    ...(includeYear ? { year: "numeric" as const } : {}),
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp * 1000));
}
