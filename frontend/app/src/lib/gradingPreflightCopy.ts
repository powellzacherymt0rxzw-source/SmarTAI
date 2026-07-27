import type { Locale } from "@/i18n/messages";

const copy = {
  title: ["批改前确认", "Pre-Grading Confirmation"],
  taskSummary: ["任务摘要", "Task Summary"],
  problems: ["道题", "problems"],
  students: ["名学生", "students"],
  criteria: ["评分标准", "Rubrics"],
  answers: ["标答", "Reference answers"],
  tests: ["测试样例", "Test cases"],
  notApplicable: ["不适用", "Not required"],
  expertCombination: ["专家组合", "Expert Combination"],
  aggregation: ["综合方法", "Synthesis"],
  expertNote: ["本次批改使用已保存的任务级模型；若模型被停用，开始前会明确阻止并提示调整。", "This run uses the saved task-level models. If one is disabled, grading is blocked with a clear setup action."],
  scoringStrategy: ["评分策略", "Scoring Strategy"],
  strictness: ["严格度", "Strictness"],
  partialAllowed: ["允许部分分", "Partial credit allowed"],
  partialDisabled: ["不允许部分分", "No partial credit"],
  confidence: ["低置信阈值", "Low-confidence threshold"],
  feedback: ["评语", "Feedback"],
  short: ["简短", "Short"],
  medium: ["中等长度", "Medium"],
  long: ["详细", "Detailed"],
  riskLabel: ["风险提醒", "Risk reminder"],
  readyMessage: ["已完成必要检查，可以开始批改。", "Required checks are complete. Grading can start."],
  knowledgeEmpty: ["评分设置选择了任务资料，但当前任务尚无资料文件。", "Task materials are enabled in the setup, but this task has no material files."],
  criteriaMissing: ["道题缺少评分标准", "problem(s) are missing rubrics"],
  answersMissing: ["道题缺少标答", "problem(s) are missing reference answers"],
  testsMissing: ["道编程题缺少测试样例", "programming problem(s) are missing test cases"],
  answersFlagged: ["个作答仍有识别标记", "answer(s) still have recognition flags"],
  identitiesFlagged: ["名学生身份待确认", "student identity record(s) need confirmation"],
  editQuestions: ["校对题目资料", "Review problem materials"],
  editSubmissions: ["校对学生作答", "Review submissions"],
  editSetup: ["修改批改设置", "Edit grading setup"],
  configureModels: ["配置模型与 BYOK", "Configure models and BYOK"],
  start: ["开始批改", "Start Grading"],
  starting: ["正在启动…", "Starting…"],
  loading: ["正在读取批改前确认信息…", "Loading pre-grading confirmation…"],
  loadError: ["无法读取批改前确认信息", "Pre-grading confirmation could not be loaded"],
  retry: ["重新加载", "Reload"],
  missingTask: ["缺少任务信息，请从工作台或历史任务重新进入。", "Task information is missing. Reopen it from the workspace or history."],
  setupRequired: ["请先保存本任务的批改设置。", "Save the grading setup for this task first."],
  unavailable: ["当前任务还不能开始批改，请先完成题目与作答校对。", "This task cannot start grading yet. Finish reviewing problems and submissions first."],
  startError: ["暂时无法开始批改，请检查任务状态后重试。", "Grading could not be started. Check the task state and try again."],
  exactTaskSetup: ["已保存的任务级设置", "Saved task-level setup"],
} as const;

export type GradingPreflightCopyKey = keyof typeof copy;

export function gradingPreflightText(locale: Locale, key: GradingPreflightCopyKey): string {
  return copy[key][locale === "en-US" ? 1 : 0];
}
