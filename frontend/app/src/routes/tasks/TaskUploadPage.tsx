import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileArchive,
  FileText,
  Images,
  ListChecks,
  Loader2,
  Search,
  PlayCircle,
  RefreshCw,
  Save,
  ArrowLeft,
  ArrowRight,
  UploadCloud,
  UserCheck,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { useExperts } from "@/api/hooks";
import {
  useExtractProblems,
  useParseSubmissions,
  useStartGrading,
  useTask,
  useUpdateProblem,
  useUpdateStudentAnswer,
} from "@/api/hooks/tasks";
import { PreGradingConfirmPanel } from "@/components/tasks/PreGradingConfirmPanel";
import { ProblemMaterialSlots, ProblemMaterialTools } from "@/components/tasks/ProblemMaterialPanels";
import { SubmissionReviewMatrix, getSubmissionMatrixStats } from "@/components/tasks/SubmissionReviewMatrix";
import { TaskProgressFocus } from "@/components/tasks/TaskProgressFocus";
import { TaskStageGate } from "@/components/tasks/TaskStageGate";
import { TaskStepper } from "@/components/tasks/TaskStepper";
import { Button } from "@/components/ui/Button";
import { Card, SectionHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { HelpTooltip } from "@/components/ui/HelpTooltip";
import { HorizontalScrollHint } from "@/components/ui/HorizontalScrollHint";
import { Input, Textarea } from "@/components/ui/Input";
import { InlineNotice } from "@/components/ui/InlineNotice";
import { MarkdownMath } from "@/components/ui/MarkdownMath";
import { WorkflowSection } from "@/components/ui/WorkflowSection";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { cn } from "@/lib/cn";
import {
  classifyRecoverableError,
  getGradingGuard,
  getModelReadiness,
  getUploadGuard,
  type ModelReadiness,
} from "@/lib/taskActionGuards";
import { isTaskProcessing } from "@/lib/taskFlow";
import type { ExpertConfig, JobProgress, ProblemInfo, StudentAnswerInfo, StudentSubmission, TaskStatus } from "@/types";

const ACTIVE_STATUS = new Set<TaskStatus>(["extracting_problems", "parsing_submissions", "grading"]);
const PROBLEMS_ACCEPT = ".pdf,.txt,.md";
const SUBMISSIONS_ACCEPT = ".zip,.rar,.7z,.tar,.tar.gz,.tgz,.tar.bz2,.tbz2,.txt";

export function TaskUploadPage() {
  const { taskId, kind } = useParams();
  const navigate = useNavigate();
  const isSubmissions = kind === "submissions";
  const isProblems = !isSubmissions;
  const safeTaskId = taskId ?? "";

  const taskQuery = useTask(taskId);
  const progressQuery = useTaskProgress(taskId);
  const extractProblems = useExtractProblems();
  const parseSubmissions = useParseSubmissions();
  const updateProblem = useUpdateProblem();
  const updateStudentAnswer = useUpdateStudentAnswer();
  const startGrading = useStartGrading();
  const expertsQuery = useExperts();

  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editingProblemId, setEditingProblemId] = useState<string | null>(null);
  const [problemDraft, setProblemDraft] = useState({ stem: "", criterion: "" });
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const [editingAnswerKey, setEditingAnswerKey] = useState<string | null>(null);
  const [answerDraft, setAnswerDraft] = useState("");
  const lastDetailRefetchKeyRef = useRef<string | null>(null);
  const lastProgressFocusStatusRef = useRef<TaskStatus | null>(null);

  const task = taskQuery.data;
  const currentStatus = (progressQuery.data?.status ?? task?.status ?? "draft") as TaskStatus;
  const isProcessing = progressQuery.isActive || isTaskProcessing(currentStatus);
  const isCurrentRecognitionActive =
    (isProblems && currentStatus === "extracting_problems") ||
    (isSubmissions && currentStatus === "parsing_submissions");
  const isCurrentRecognitionComplete =
    (isProblems && currentStatus === "problems_ready") ||
    (isSubmissions && currentStatus === "submissions_ready");
  const isUploading = extractProblems.isPending || parseSubmissions.isPending;
  const modelReadiness = getModelReadiness({
    experts: expertsQuery.data,
    isLoading: expertsQuery.isLoading,
    isError: expertsQuery.isError,
  });
  const enabledExperts = useMemo(() => (expertsQuery.data ?? []).filter((expert) => expert.enabled), [expertsQuery.data]);

  const problems = useMemo(
    () => Object.values(task?.problem_data ?? {}).sort(compareProblems),
    [task?.problem_data],
  );
  const students = useMemo(
    () => Object.values(task?.student_data ?? {}).sort(compareStudents),
    [task?.student_data],
  );
  const stateProblemCount = progressQuery.data?.problem_count ?? 0;
  const stateStudentCount = progressQuery.data?.student_count ?? 0;
  const expectedProblemCount = Math.max(problems.length, task?.problem_count ?? 0, stateProblemCount);
  const expectedStudentCount = Math.max(students.length, task?.student_count ?? 0, stateStudentCount);

  const selectedStudent = useMemo(
    () => students.find((student) => student.stu_id === selectedStudentId) ?? students[0] ?? null,
    [selectedStudentId, students],
  );
  const uploadGuard = getUploadGuard({
    kind: isProblems ? "problems" : "submissions",
    task,
    isUploading,
    isProcessing,
    modelReadiness,
  });

  useEffect(() => {
    const firstStudentId = students[0]?.stu_id ?? null;
    if (!firstStudentId) {
      setSelectedStudentId(null);
      return;
    }
    if (!selectedStudentId || !students.some((student) => student.stu_id === selectedStudentId)) {
      setSelectedStudentId(firstStudentId);
    }
  }, [selectedStudentId, students]);

  useEffect(() => {
    if (!isCurrentRecognitionActive) {
      lastProgressFocusStatusRef.current = null;
      return;
    }
    if (lastProgressFocusStatusRef.current === currentStatus) {
      return;
    }
    lastProgressFocusStatusRef.current = currentStatus;
    window.requestAnimationFrame(() => {
      document.getElementById("recognition-progress")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [currentStatus, isCurrentRecognitionActive]);

  useEffect(() => {
    if (ACTIVE_STATUS.has(currentStatus)) {
      lastDetailRefetchKeyRef.current = null;
      return;
    }

    const completedStatus =
      currentStatus === "problems_ready" ||
      currentStatus === "submissions_ready" ||
      currentStatus === "graded" ||
      currentStatus === "error";
    const detailCountMismatch = stateProblemCount > problems.length || stateStudentCount > students.length;

    if (!completedStatus && !detailCountMismatch) {
      return;
    }

    const refetchKey = [
      currentStatus,
      stateProblemCount,
      stateStudentCount,
      problems.length,
      students.length,
    ].join(":");

    if (lastDetailRefetchKeyRef.current === refetchKey) {
      return;
    }

    lastDetailRefetchKeyRef.current = refetchKey;
    void taskQuery.refetch();
  }, [currentStatus, problems.length, stateProblemCount, stateStudentCount, students.length, taskQuery.refetch]);

  const handleUpload = async (file: File) => {
    if (!taskId) {
      toast.error("缺少任务 ID，无法上传。");
      return;
    }

    if (uploadGuard.disabled) {
      toast.error(uploadGuard.reason ?? "当前无法上传。");
      return;
    }

    if (uploadGuard.confirmMessage) {
      const confirmed = window.confirm(uploadGuard.confirmMessage);
      if (!confirmed) {
        return;
      }
    }

    const label = isProblems ? "题目文件" : "学生作答";
    setUploadPercent(0);
    setUploadFileName(file.name);

    try {
      const response = await (isProblems ? extractProblems : parseSubmissions).mutateAsync({
        taskId,
        file,
        onProgress: (percent) => setUploadPercent(percent),
      });

      setUploadPercent(100);
      if (response.status === "already_running") {
        toast.info(`${label}正在处理中`, { description: "页面会继续轮询当前任务状态。" });
      } else if (response.status === "already_done") {
        toast.success(`${label}已解析过`, { description: "已恢复现有预览数据。" });
      } else {
        toast.success(`${label}已上传`, { description: "正在刷新识别状态与预览数据。" });
      }
      void progressQuery.refetch();
      void taskQuery.refetch();
    } catch (error) {
      const info = classifyRecoverableError(error);
      toast.error(`${label}上传失败`, { description: info.description });
    }
  };

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      void handleUpload(file);
    }
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      void handleUpload(file);
    }
  };

  const startProblemEdit = (problem: ProblemInfo) => {
    setEditingProblemId(problem.q_id);
    setProblemDraft({ stem: problem.stem ?? "", criterion: problem.criterion ?? "" });
  };

  const saveProblem = async (problem: ProblemInfo) => {
    if (!taskId) {
      toast.error("缺少任务 ID，无法保存题目。");
      return;
    }

    try {
      await updateProblem.mutateAsync({
        taskId,
        qId: problem.q_id,
        stem: problemDraft.stem,
        criterion: problemDraft.criterion,
      });
      toast.success(`已保存 ${problemLabel(problem)} 的题干与评分标准。`);
      setEditingProblemId(null);
      void taskQuery.refetch();
    } catch (error) {
      toast.error("保存题目失败", { description: getErrorMessage(error) });
    }
  };

  const startAnswerEdit = (student: StudentSubmission, answer: StudentAnswerInfo) => {
    setEditingAnswerKey(answerKey(student.stu_id, answer.q_id));
    setAnswerDraft(answer.content ?? "");
  };

  const saveAnswer = async (student: StudentSubmission, answer: StudentAnswerInfo) => {
    if (!taskId) {
      toast.error("缺少任务 ID，无法保存作答。");
      return;
    }

    try {
      await updateStudentAnswer.mutateAsync({
        taskId,
        studentId: student.stu_id,
        qId: answer.q_id,
        content: answerDraft,
      });
      toast.success(`已保存 ${studentName(student)} 的 ${answerLabel(answer)} 作答。`);
      setEditingAnswerKey(null);
      void taskQuery.refetch();
    } catch (error) {
      toast.error("保存作答失败", { description: getErrorMessage(error) });
    }
  };

  const handleStartGrading = async () => {
    if (!taskId) {
      toast.error("缺少任务 ID，无法启动批改。");
      return;
    }

    if (!students.length) {
      toast.error("请先上传并确认学生作答。");
      return;
    }

    try {
      const response = await startGrading.mutateAsync({ taskId });
      if (response.status === "already_done") {
        toast.success("该任务已完成批改，可进入结果复核。");
        navigate(`/tasks/${taskId}/results`);
      } else if (response.status === "already_running") {
        toast.info("批改已在进行中", { description: "已进入批改进度页继续跟进。" });
        navigate(`/tasks/${taskId}/results`);
      } else {
        toast.success("已启动批改", { description: "已进入批改进度页，完成后会显示结果复核。" });
        navigate(`/tasks/${taskId}/results`);
      }
      void progressQuery.refetch();
      void taskQuery.refetch();
    } catch (error) {
      const info = classifyRecoverableError(error);
      toast.error(info.title, { description: info.description });
    }
  };

  if (!taskId) {
    return (
      <EmptyState
        title="缺少任务 ID"
        description="请从任务总览或历史任务进入上传流程。"
        action={
          <Link to="/">
            <Button variant="secondary">返回任务总览</Button>
          </Link>
        }
      />
    );
  }

  const canContinueToSubmissions =
    problems.length > 0 ||
    currentStatus === "problems_ready" ||
    currentStatus === "parsing_submissions" ||
    currentStatus === "submissions_ready" ||
    currentStatus === "grading" ||
    currentStatus === "graded";
  const gradingGuard = getGradingGuard({
    status: currentStatus,
    problemCount: expectedProblemCount,
    studentCount: expectedStudentCount,
    isPending: startGrading.isPending,
    modelReadiness,
  });

  return (
    <div className="grid gap-5">
      <TaskStepper current={isProblems ? "problems" : "submissions"} task={task} />
      <SectionHeader
        title={
          isCurrentRecognitionActive
            ? isProblems
              ? "题目识别进度"
              : "作答识别进度"
            : isProblems && expectedProblemCount > 0
              ? "题目准备"
              : isProblems
                ? "上传题目"
                : "上传学生作答"
        }
        description={
          isCurrentRecognitionActive
            ? "系统正在后台处理文件；完成后页面会自动切回校对总览，无需手动刷新或重复点击。"
            : isProblems
              ? "上传题目文件；识别完成后在同一页校对题干，并补齐评分标准、标答与测试样例的资料配置。"
              : "上传学生作答文件，按学生检查识别结果；确认后即可启动批改。"
        }
        action={
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              lastDetailRefetchKeyRef.current = null;
              void taskQuery.refetch();
              void progressQuery.refetch();
            }}
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
        }
      />

      {taskQuery.isError ? (
        <InlineAlert message={getErrorMessage(taskQuery.error)} onRetry={() => void taskQuery.refetch()} />
      ) : null}
      {progressQuery.isError ? (
        <InlineAlert message={getErrorMessage(progressQuery.error)} onRetry={() => void progressQuery.refetch()} />
      ) : null}

      <TaskStageGate
        task={task}
        current={isProblems ? "problems" : "submissions"}
        isLoading={taskQuery.isLoading}
        isError={taskQuery.isError}
        errorMessage={taskQuery.error ? getErrorMessage(taskQuery.error) : null}
        onRetry={() => void taskQuery.refetch()}
      >
        {isCurrentRecognitionActive ? (
          <RecognitionProgressPanel
            kind={isProblems ? "problems" : "submissions"}
            status={currentStatus}
            progress={progressQuery.progress}
            isLoading={taskQuery.isLoading}
            isProcessing={isProcessing}
            percent={progressQuery.percent}
            problemCount={expectedProblemCount}
            studentCount={expectedStudentCount}
            error={progressQuery.progress?.error_detail ?? task?.error ?? null}
            onRefresh={() => {
              lastDetailRefetchKeyRef.current = null;
              void taskQuery.refetch();
              void progressQuery.refetch();
            }}
          />
        ) : (
          <Card className="grid gap-5">
            <WorkflowSection
              title={isProblems ? "添加题目文件" : "添加学生作答"}
              description={
                isProblems
                  ? "上传后会自动进入识别状态，完成后在下方校对题干和评分标准。"
                  : "上传后会按学生解析作答，完成后在下方逐个学生校对。"
              }
            >
              {uploadGuard.reason ? (
                <InlineNotice
                  tone={modelReadiness.disabledReason ? "warning" : "neutral"}
                  title={modelReadiness.disabledReason ? "需要先配置 BYOK 专家" : "当前暂不能上传"}
                  action={
                    modelReadiness.disabledReason ? (
                      <Link to="/experts">
                        <Button type="button" variant="secondary">
                          前往 BYOK
                        </Button>
                      </Link>
                    ) : null
                  }
                >
                  {uploadGuard.reason}
                </InlineNotice>
              ) : uploadGuard.confirmMessage ? (
                <InlineNotice
                  tone={uploadGuard.suggestNewTask ? "warning" : "info"}
                  title={uploadGuard.confirmTitle ?? "上传前确认"}
                  action={
                    uploadGuard.suggestNewTask ? (
                      <Link to="/tasks/new">
                        <Button type="button" variant="secondary">
                          新建任务
                        </Button>
                      </Link>
                    ) : null
                  }
                >
                  {uploadGuard.confirmMessage}
                </InlineNotice>
              ) : null}
              <UploadPreparationBrief
                enabledExperts={enabledExperts}
                isProblems={isProblems}
                modelReadiness={modelReadiness}
                taskDocCount={task?.kb_doc_count ?? 0}
              />
              <UploadCard
                accept={isProblems ? PROBLEMS_ACCEPT : SUBMISSIONS_ACCEPT}
                currentFileName={isProblems ? task?.problem_file_name : task?.submission_file_name}
                disabled={uploadGuard.disabled}
                disabledReason={uploadGuard.reason}
                isDragging={isDragging}
                isProblems={isProblems}
                isUploading={isUploading}
                uploadFileName={uploadFileName}
                uploadPercent={uploadPercent}
                onDragChange={setIsDragging}
                onDrop={handleDrop}
                onFileInput={handleFileInput}
              />
            </WorkflowSection>
            <WorkflowSection title="识别状态" description="上传、识别、同步详情都会在这里显示；离开页面后回来也会继续跟进当前任务。">
              <TaskProgressFocus
                status={currentStatus}
                progress={progressQuery.progress}
                isLoading={taskQuery.isLoading}
                isProcessing={isProcessing}
                percent={progressQuery.percent}
                problemCount={expectedProblemCount}
                error={progressQuery.progress?.error_detail ?? task?.error ?? null}
                studentCount={expectedStudentCount}
                onRefresh={() => {
                  lastDetailRefetchKeyRef.current = null;
                  void taskQuery.refetch();
                  void progressQuery.refetch();
                }}
              />
            </WorkflowSection>
          </Card>
        )}

        {isCurrentRecognitionComplete ? (
          <RecognitionCompleteNotice
            kind={isProblems ? "problems" : "submissions"}
            count={isProblems ? expectedProblemCount : expectedStudentCount}
          />
        ) : null}

        {!isCurrentRecognitionActive && isProblems ? (
          <ProblemsReview
            editingProblemId={editingProblemId}
            isSaving={updateProblem.isPending}
            problemDraft={problemDraft}
            problems={problems}
            taskId={safeTaskId}
            expectedCount={expectedProblemCount}
            onCancel={() => setEditingProblemId(null)}
            onDraftChange={setProblemDraft}
            onEdit={startProblemEdit}
            onSave={(problem) => void saveProblem(problem)}
            onUploadedMaterial={() => {
              void taskQuery.refetch();
              void progressQuery.refetch();
            }}
          />
        ) : null}

        {!isCurrentRecognitionActive && !isProblems ? (
          <SubmissionsReview
            answerDraft={answerDraft}
            editingAnswerKey={editingAnswerKey}
            isSaving={updateStudentAnswer.isPending}
            selectedStudent={selectedStudent}
            selectedStudentId={selectedStudent?.stu_id ?? null}
            problems={problems}
            students={students}
            expectedCount={expectedStudentCount}
            onAnswerDraftChange={setAnswerDraft}
            onCancel={() => setEditingAnswerKey(null)}
            onEdit={startAnswerEdit}
            onSave={(student, answer) => void saveAnswer(student, answer)}
            onSelectStudent={setSelectedStudentId}
          />
        ) : null}

        <div className="grid gap-4">
          {!isProblems && currentStatus !== "grading" && currentStatus !== "graded" ? (
            <WorkflowSection title="批改前确认" description="开始批改前集中检查模型来源、题目资料配置、学生作答覆盖率和风险提示。">
              <PreGradingConfirmPanel
                problems={problems}
                students={students}
                taskDocCount={task?.kb_doc_count ?? 0}
                modelReadiness={modelReadiness}
                gradingGuard={gradingGuard}
              />
            </WorkflowSection>
          ) : null}
          <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
            <Link to={isProblems ? `/tasks/${safeTaskId}/setup` : `/tasks/${safeTaskId}/upload/problems`} className="min-w-0">
              <Button type="button" variant="secondary" className="w-full sm:w-auto">
                {isProblems ? "返回资料配置" : "返回题目准备"}
              </Button>
            </Link>
            {isProblems ? (
              <Button
                type="button"
                className="w-full sm:w-auto"
                disabled={!canContinueToSubmissions}
                onClick={() => navigate(`/tasks/${safeTaskId}/upload/submissions`)}
              >
                继续上传作答
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : currentStatus === "grading" || currentStatus === "graded" ? (
              <Button type="button" className="w-full sm:w-auto" onClick={() => navigate(`/tasks/${safeTaskId}/results`)}>
                {currentStatus === "graded" ? "复核结果" : "查看批改进度"}
                <ChevronRight className="h-4 w-4" />
              </Button>
            ) : (
              <div className="grid justify-items-stretch gap-2 sm:justify-items-end">
                {gradingGuard.reason ? (
                  <p className="max-w-xl text-left text-xs leading-5 text-muted-foreground sm:text-right">{gradingGuard.reason}</p>
                ) : null}
                <Button type="button" className="w-full sm:w-auto" disabled={gradingGuard.disabled} onClick={() => void handleStartGrading()}>
                  {startGrading.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
                  开始批改
                </Button>
              </div>
            )}
          </div>
        </div>
      </TaskStageGate>
    </div>
  );
}

function UploadPreparationBrief({
  enabledExperts,
  isProblems,
  modelReadiness,
  taskDocCount,
}: {
  enabledExperts: ExpertConfig[];
  isProblems: boolean;
  modelReadiness: ModelReadiness;
  taskDocCount: number;
}) {
  const expertSummary =
    enabledExperts.length > 0
      ? enabledExperts.slice(0, 2).map(formatExpertLabel).join("、") +
        (enabledExperts.length > 2 ? ` 等 ${enabledExperts.length} 个` : "")
      : "还没有启用专家";
  const expertStatus = modelReadiness.isError
    ? "状态未知"
    : modelReadiness.disabledReason
      ? "需要配置"
      : modelReadiness.isLoading
        ? "读取中"
        : `${modelReadiness.enabledCount} 个可用`;
  const expertTone = modelReadiness.isError || modelReadiness.disabledReason ? "warning" : "success";

  return (
    <div className="grid gap-3 rounded-lg bg-muted/30 p-4">
      <div>
        <p className="text-sm font-semibold">上传前检查</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          保留最少必要设置，避免老师上传前被大配置页打断；更细的评分标准、标答、测试样例会在识别后逐题补齐。
        </p>
      </div>

      <BriefRow
        icon={ListChecks}
        label="BYOK 专家"
        status={expertStatus}
        tone={expertTone}
        action={
          modelReadiness.disabledReason ? (
            <Link to="/experts">
              <Button type="button" variant="secondary" className="h-8">
                去配置
              </Button>
            </Link>
          ) : null
        }
      >
        {expertSummary}。当前阶段沿用已启用专家池；逐阶段选择单专家/多专家组合需要后端继续接入任务级配置。
      </BriefRow>

      <BriefRow icon={FileText} label="资料配置" status={taskDocCount > 0 ? `${taskDocCount} 份已有` : "识别后补齐"} tone="neutral">
        {isProblems
          ? "题目识别完成后，在题目准备总览里补评分标准、标答和测试样例；知识库文件、分组或全库选择仍需要后端数据模型支持。"
          : "作答识别只处理学生答案本身；正式批改前会集中确认专家组合、资料范围与评分策略。"}
      </BriefRow>

      <BriefRow icon={Images} label="识别能力" status="当前能力" tone="info">
        {isProblems
          ? "当前支持可复制文本的 PDF、TXT、Markdown；DOCX、图片题面、手写 OCR 和识别增强是后端待接能力。"
          : "当前支持 TXT 或可读取文本的压缩包；PDF、DOCX、表格、图片作答、学生名单匹配和 OCR 是后端待接能力。"}
      </BriefRow>

      {!isProblems ? (
        <>
          <BriefRow
            icon={Users}
            label="学生名单"
            status="先自动识别"
            tone="neutral"
          >
            当前会从作答正文和文件名提取学号、姓名；CSV/XLSX 名单导入、按名单自动匹配和批量改身份需要后端字段支持。
          </BriefRow>
          <BriefRow icon={UserCheck} label="识别设置继承" status="沿用当前任务" tone="info">
            作答识别沿用已启用 BYOK 专家池与当前文本解析能力；逐阶段选择专家、手写识别增强和 OCR 开关仍是后端待接配置。
          </BriefRow>
        </>
      ) : null}
    </div>
  );
}

function BriefRow({
  action,
  children,
  icon: Icon,
  label,
  status,
  tone,
}: {
  action?: ReactNode;
  children: ReactNode;
  icon: LucideIcon;
  label: string;
  status: string;
  tone: "success" | "warning" | "info" | "neutral";
}) {
  return (
    <div className="flex flex-col gap-2 rounded-md bg-background/70 p-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 gap-3">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{label}</p>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                tone === "success"
                  ? "bg-accent/10 text-accent"
                  : tone === "warning"
                    ? "bg-warning/10 text-warning"
                    : tone === "info"
                      ? "bg-primary/10 text-primary"
                      : "bg-muted text-muted-foreground",
              )}
            >
              {status}
            </span>
          </div>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{children}</p>
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function formatExpertLabel(expert: ExpertConfig) {
  return expert.display_name || `${expert.provider_type} ${expert.model}`;
}

function UploadCard({
  accept,
  currentFileName,
  disabled,
  disabledReason,
  isDragging,
  isProblems,
  isUploading,
  uploadFileName,
  uploadPercent,
  onDragChange,
  onDrop,
  onFileInput,
}: {
  accept: string;
  currentFileName?: string | null;
  disabled?: boolean;
  disabledReason?: string | null;
  isDragging: boolean;
  isProblems: boolean;
  isUploading: boolean;
  uploadFileName: string | null;
  uploadPercent: number;
  onDragChange: (isDragging: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="grid gap-4">
      <div
        className={cn(
          "rounded-lg border border-dashed bg-muted/40 p-8 text-center transition",
          isDragging ? "border-primary bg-primary/10" : "border-border",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          onDragChange(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          onDragChange(false);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          if (disabled) {
            event.preventDefault();
            onDragChange(false);
            return;
          }
          onDrop(event);
        }}
      >
        <UploadCloud className="mx-auto h-10 w-10 text-muted-foreground" />
        <h2 className="mt-3 text-base font-semibold">{isProblems ? "拖入题目文件" : "拖入作答文件或压缩包"}</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
          {isProblems
            ? "支持上传可复制文本的 PDF、TXT 或 Markdown 题目文件；DOCX、图片题面与 OCR 识别仍是后续接入项。"
            : "支持上传 TXT 作答文件，或包含可读取文本作答的 ZIP/RAR/7Z/TAR 压缩包；PDF、DOCX、表格、图片与手写 OCR 仍是后续接入项。"}
        </p>
        <input ref={fileInputRef} type="file" accept={accept} className="hidden" onChange={onFileInput} />
        <Button type="button" className="mt-5" disabled={isUploading || disabled} onClick={() => fileInputRef.current?.click()}>
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          选择文件
        </Button>
        {disabledReason ? <p className="mt-3 text-xs leading-5 text-muted-foreground">{disabledReason}</p> : null}
        {uploadFileName ? (
          <div className="mx-auto mt-4 max-w-md text-left">
            <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="truncate">{uploadFileName}</span>
              <span>{uploadPercent}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${uploadPercent}%` }} />
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3">
        {(isProblems
          ? [
              { icon: FileText, title: "题干识别", text: "拆分题目与小问" },
              { icon: ListChecks, title: "题目准备", text: "总览待复核项" },
              { icon: Images, title: "图片题面", text: "OCR 后续接入" },
            ]
          : [
              { icon: FileArchive, title: "批量上传", text: "解析学生文件包" },
              { icon: ListChecks, title: "识别校对", text: "逐题确认作答" },
              { icon: FileText, title: "缺失提示", text: "标记未提交与异常" },
            ]
        ).map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.title} className="flex items-start gap-2">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
              <div>
                <p className="font-medium text-foreground">{item.title}</p>
                <p className="mt-0.5 text-xs leading-5">{item.text}</p>
              </div>
            </div>
          );
        })}
      </div>

      {currentFileName ? (
        <div className="flex items-start gap-2 rounded-md bg-muted/50 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
          <div>
            <p className="font-medium">当前文件</p>
            <p className="mt-1 break-all text-muted-foreground">{currentFileName}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RecognitionProgressPanel({
  kind,
  status,
  progress,
  isLoading,
  isProcessing,
  percent,
  problemCount,
  studentCount,
  error,
  onRefresh,
}: {
  kind: "problems" | "submissions";
  status: TaskStatus;
  progress: JobProgress | null;
  isLoading?: boolean;
  isProcessing?: boolean;
  percent: number;
  problemCount: number;
  studentCount: number;
  error?: string | null;
  onRefresh: () => void;
}) {
  const isProblems = kind === "problems";

  return (
    <Card id="recognition-progress" className="scroll-mt-24 grid gap-5">
      <WorkflowSection
        title={isProblems ? "正在识别题目" : "正在识别学生作答"}
        description={
          isProblems
            ? "系统正在拆分题号、题干和初始评分信息。完成后会自动显示题目准备总览。"
            : "系统正在按学生与题号解析作答内容。完成后会自动显示学生 x 题目校对矩阵。"
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={onRefresh}>
              <RefreshCw className="h-4 w-4" />
              刷新状态
            </Button>
            <Link to="/">
              <Button type="button" variant="secondary">
                返回任务总览
              </Button>
            </Link>
            <Link to="/history">
              <Button type="button" variant="secondary">
                去历史任务
              </Button>
            </Link>
          </div>
        }
      >
        <TaskProgressFocus
          status={status}
          progress={progress}
          isLoading={isLoading}
          isProcessing={isProcessing}
          percent={percent}
          problemCount={problemCount}
          studentCount={studentCount}
          error={error}
          onRefresh={onRefresh}
        />
        <InlineNotice tone="neutral" title="自动跟进，不需要重复点击">
          如果文件较大或模型响应较慢，进度会继续轮询；重复上传同一文件会由后端幂等逻辑拦截，避免重复消耗模型调用。
        </InlineNotice>
      </WorkflowSection>
    </Card>
  );
}

function RecognitionCompleteNotice({ kind, count }: { kind: "problems" | "submissions"; count: number }) {
  const isProblems = kind === "problems";
  const targetId = isProblems ? "problems-review" : "submissions-review";

  return (
    <InlineNotice
      tone="success"
      title={isProblems ? "题目识别完成" : "作答识别完成"}
      action={
        <Button
          type="button"
          variant="secondary"
          onClick={() => document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          {isProblems ? "开始校对题目" : "查看作答矩阵"}
        </Button>
      }
    >
      {isProblems
        ? `已识别 ${count} 道题。请从总览表检查题干、评分标准、标答和测试样例。`
        : `已解析 ${count} 名学生。请从矩阵检查缺失、异常和需要人工复核的作答。`}
    </InlineNotice>
  );
}

function ProblemsReview({
  editingProblemId,
  expectedCount,
  isSaving,
  onUploadedMaterial,
  problemDraft,
  problems,
  taskId,
  onCancel,
  onDraftChange,
  onEdit,
  onSave,
}: {
  editingProblemId: string | null;
  expectedCount: number;
  isSaving: boolean;
  onUploadedMaterial: () => void;
  problemDraft: { stem: string; criterion: string };
  problems: ProblemInfo[];
  taskId: string;
  onCancel: () => void;
  onDraftChange: (draft: { stem: string; criterion: string }) => void;
  onEdit: (problem: ProblemInfo) => void;
  onSave: (problem: ProblemInfo) => void;
}) {
  const [filterText, setFilterText] = useState("");
  const [selectedProblemId, setSelectedProblemId] = useState<string | null>(null);
  const rows = useMemo(() => problems.map(buildProblemPreparationRow), [problems]);
  const filteredRows = useMemo(() => filterProblemRows(rows, filterText), [filterText, rows]);
  const summary = useMemo(() => buildProblemPreparationSummary(rows), [rows]);
  const missingSlots = summary.missingCriteria + summary.missingAnswers + summary.missingTests;
  const selectedIndex = filteredRows.findIndex((row) => row.problem.q_id === selectedProblemId);
  const effectiveSelectedIndex = selectedIndex >= 0 ? selectedIndex : filteredRows.length > 0 ? 0 : -1;
  const selectedRow = effectiveSelectedIndex >= 0 ? filteredRows[effectiveSelectedIndex] : null;
  const previousRow = effectiveSelectedIndex > 0 ? filteredRows[effectiveSelectedIndex - 1] : null;
  const nextRow =
    effectiveSelectedIndex >= 0 && effectiveSelectedIndex < filteredRows.length - 1
      ? filteredRows[effectiveSelectedIndex + 1]
      : null;

  useEffect(() => {
    const firstProblemId = filteredRows[0]?.problem.q_id ?? null;
    if (!firstProblemId) {
      if (selectedProblemId) {
        setSelectedProblemId(null);
      }
      return;
    }
    if (!selectedProblemId || !filteredRows.some((row) => row.problem.q_id === selectedProblemId)) {
      setSelectedProblemId(firstProblemId);
    }
  }, [filteredRows, selectedProblemId]);

  function selectProblem(problem: ProblemInfo) {
    setSelectedProblemId(problem.q_id);
  }

  function editProblem(problem: ProblemInfo) {
    selectProblem(problem);
    onEdit(problem);
  }

  return (
    <Card id="problems-review" className="scroll-mt-24 grid gap-5">
      {problems.length === 0 ? (
        expectedCount > 0 ? (
          <DetailSyncState
            title="正在同步题目详情"
            description={`已识别 ${expectedCount} 道题，题干与评分标准正在载入。`}
          />
        ) : (
          <EmptyState title="暂无题目预览" description="上传题目文件后，识别结果会显示在这里。" />
        )
      ) : (
        <>
          <WorkflowSection
            title="题目准备总览"
            description="先从表格确认每道题的题干、评分标准、标答和测试样例是否准备好，再进入单题详情修改。"
            action={<span className="text-sm text-muted-foreground">{expectedCount} 道题</span>}
          >
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
              <PreparationMetric
                label="题目复核"
                value={`${summary.reviewReady}/${summary.total}`}
                detail={summary.needsReview ? `${summary.needsReview} 题需人工处理` : "均可进入校对"}
              />
              <PreparationMetric
                label="评分标准"
                value={`${summary.criteriaReady}/${summary.total}`}
                detail={summary.missingCriteria ? `${summary.missingCriteria} 题缺失` : "已全部填写"}
              />
              <PreparationMetric
                label="标答"
                value={`${summary.answersReady}/${summary.total}`}
                detail={summary.missingAnswers ? `${summary.missingAnswers} 题缺失` : "已全部填写"}
              />
              <PreparationMetric
                label="测试样例"
                value={summary.programmingTotal ? `${summary.testsReady}/${summary.programmingTotal}` : "无编程题"}
                detail={summary.programmingTotal ? `${summary.missingTests} 道编程题待补` : "不适用"}
              />
              <PreparationMetric
                label="待处理"
                value={String(summary.needsReview + missingSlots)}
                detail="按现有字段前端推断"
                tone={summary.needsReview + missingSlots > 0 ? "warning" : "success"}
              />
            </div>

            <InlineNotice tone="neutral" title="资料配置状态说明">
              当前表格只根据已返回的题干、评分标准、参考答案和测试样例字段推断覆盖情况；资料来源、AI 生成待确认、从原文提取置信度和教师确认状态需要后端新增字段后接入。
            </InlineNotice>

            <ProblemMaterialTools taskId={taskId} problems={problems} onUploaded={onUploadedMaterial} />

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <label className="relative block min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="w-full pl-9"
                  value={filterText}
                  placeholder="筛选题目，例如：缺少标答、没有评分标准、编程题、证明题"
                  onChange={(event) => setFilterText(event.target.value)}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" disabled title="需后端返回题目置信度与复核字段">
                  一键 AI 复核
                </Button>
              </div>
            </div>

            <div className="grid gap-2">
              <HorizontalScrollHint />
              <div className="overflow-x-auto rounded-lg border">
                <table className="min-w-[880px] w-full border-collapse text-left text-sm">
                <thead className="bg-muted/50 text-xs font-medium text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">题号</th>
                    <th className="px-3 py-2">题型</th>
                    <th className="px-3 py-2">复核状态</th>
                    <th className="px-3 py-2">评分标准</th>
                    <th className="px-3 py-2">标答</th>
                    <th className="px-3 py-2">测试样例</th>
                    <th className="px-3 py-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filteredRows.map((row) => (
                    <tr key={row.problem.q_id} className="align-top hover:bg-muted/30">
                      <td className="px-3 py-3 font-medium">{row.label}</td>
                      <td className="px-3 py-3 text-muted-foreground">{row.type || "未识别"}</td>
                      <td className="px-3 py-3">
                        <PreparationStatus status={row.reviewStatus} onClick={() => selectProblem(row.problem)} />
                      </td>
                      <td className="px-3 py-3">
                        <PreparationStatus status={row.criterionStatus} onClick={() => editProblem(row.problem)} />
                      </td>
                      <td className="px-3 py-3">
                        <PreparationStatus status={row.answerStatus} />
                      </td>
                      <td className="px-3 py-3">
                        <PreparationStatus status={row.testStatus} />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Button type="button" variant="secondary" className="h-8" onClick={() => selectProblem(row.problem)}>
                          查看
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                </table>
                {filteredRows.length === 0 ? (
                  <div className="border-t p-6 text-center text-sm text-muted-foreground">
                    当前筛选没有匹配题目。可以换成“缺少标答”“编程题”“没有评分标准”等关键词。
                  </div>
                ) : null}
              </div>
            </div>
          </WorkflowSection>

          <WorkflowSection
            title="题目详情校对"
            description="当前可保存题干与评分标准；标答、测试样例、测试脚本的编辑和来源状态需要后端字段继续补齐。"
          >
            {selectedRow ? (
              <div className="grid gap-3">
                <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">当前题目：{selectedRow.label}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {filteredRows.length} 道筛选结果中的第 {effectiveSelectedIndex + 1} 道
                    </p>
                  </div>
                  <div className="grid min-w-0 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full justify-start sm:w-auto"
                      disabled={!previousRow}
                      onClick={() => previousRow && selectProblem(previousRow.problem)}
                    >
                      <ArrowLeft className="h-4 w-4" />
                      <span className="min-w-0 truncate">{previousRow ? `上一题：${previousRow.label}` : "上一题"}</span>
                    </Button>
                    <select
                      className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-auto"
                      value={selectedRow.problem.q_id}
                      onChange={(event) => {
                        const next = filteredRows.find((row) => row.problem.q_id === event.target.value);
                        if (next) {
                          selectProblem(next.problem);
                        }
                      }}
                    >
                      {filteredRows.map((row) => (
                        <option key={row.problem.q_id} value={row.problem.q_id}>
                          {row.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="secondary"
                      className="w-full justify-start sm:w-auto"
                      disabled={!nextRow}
                      onClick={() => nextRow && selectProblem(nextRow.problem)}
                    >
                      <span className="min-w-0 truncate">{nextRow ? `下一题：${nextRow.label}` : "下一题"}</span>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                {(() => {
                  const problem = selectedRow.problem;
                  const isEditing = editingProblemId === problem.q_id;
                  return (
                    <article key={problem.q_id} className="rounded-lg border p-4">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold">{problemLabel(problem)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{problem.type || "未识别题型"}</p>
                        </div>
                        {isEditing ? null : (
                          <Button type="button" variant="secondary" onClick={() => onEdit(problem)}>
                            编辑题干/评分标准
                          </Button>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="mt-4 grid gap-3">
                          <Field label="题干">
                            <Textarea
                              value={problemDraft.stem}
                              onChange={(event) => onDraftChange({ ...problemDraft, stem: event.target.value })}
                            />
                          </Field>
                          <Field label="评分标准">
                            <Textarea
                              value={problemDraft.criterion}
                              onChange={(event) => onDraftChange({ ...problemDraft, criterion: event.target.value })}
                            />
                          </Field>
                          <div className="flex flex-wrap justify-end gap-2">
                            <Button type="button" variant="ghost" disabled={isSaving} onClick={onCancel}>
                              <X className="h-4 w-4" />
                              取消
                            </Button>
                            <Button type="button" disabled={isSaving} onClick={() => onSave(problem)}>
                              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                              保存
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="mt-4 grid gap-3 text-sm">
                          <PreviewBlock label="题干" value={problem.stem} emptyText="题干为空，请编辑补充。" />
                          <ProblemMaterialSlots problem={problem} />
                        </div>
                      )}
                    </article>
                  );
                })()}
              </div>
            ) : (
              <EmptyState title="没有可校对题目" description="当前筛选没有匹配题目，可以清空筛选后继续。" />
            )}
          </WorkflowSection>
        </>
      )}
    </Card>
  );
}

type PreparationTone = "success" | "warning" | "neutral";

interface PreparationStatusMeta {
  label: string;
  tone: PreparationTone;
  help?: string;
}

interface ProblemPreparationRow {
  problem: ProblemInfo;
  label: string;
  type: string;
  isProgramming: boolean;
  reviewStatus: PreparationStatusMeta;
  criterionStatus: PreparationStatusMeta;
  answerStatus: PreparationStatusMeta;
  testStatus: PreparationStatusMeta;
}

function PreparationMetric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: PreparationTone;
}) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-semibold",
          tone === "success" ? "text-accent" : tone === "warning" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</div>
    </div>
  );
}

function PreparationStatus({
  status,
  onClick,
}: {
  status: PreparationStatusMeta;
  onClick?: () => void;
}) {
  const content = (
    <>
      <Circle
        className={cn(
          "h-2.5 w-2.5 fill-current",
          status.tone === "success" ? "text-accent" : status.tone === "warning" ? "text-warning" : "text-muted-foreground",
        )}
      />
      <span>{status.label}</span>
      {status.help && !onClick ? <HelpTooltip label={status.help} /> : null}
      {status.help && onClick ? (
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-xs text-muted-foreground"
          aria-label={status.help}
          title={status.help}
        >
          ?
        </span>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className="inline-flex min-h-8 items-center gap-2 rounded-md px-2 text-left text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
        title={status.help}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }

  return <span className="inline-flex min-h-8 items-center gap-2 text-xs text-muted-foreground">{content}</span>;
}

function buildProblemPreparationRow(problem: ProblemInfo): ProblemPreparationRow {
  const hasStem = hasText(problem.stem);
  const hasCriterion = hasText(problem.criterion);
  const hasAnswer = hasText(problem.reference_answer);
  const isProgramming = isProgrammingProblem(problem);
  const testCount = problem.test_cases?.length ?? 0;

  return {
    problem,
    label: problemLabel(problem),
    type: problem.type || "未识别题型",
    isProgramming,
    reviewStatus: hasStem
      ? {
          label: "待确认",
          tone: "neutral",
          help: "当前后端尚未提供教师确认字段，这里表示题干已可进入人工校对。",
        }
      : {
          label: "待人工复核",
          tone: "warning",
          help: "题干为空或识别异常，建议先人工修正。",
        },
    criterionStatus: hasCriterion
      ? { label: "已填写", tone: "success" }
      : { label: "缺失", tone: "warning", help: "可以先手动填写；批量导入和 AI 补全需后端接入。" },
    answerStatus: hasAnswer
      ? { label: "已填写", tone: "success" }
      : { label: "缺失", tone: "warning", help: "标答导入、从原文提取和来源置信度需后端接入。" },
    testStatus: !isProgramming
      ? { label: "不适用", tone: "neutral" }
      : testCount > 0
        ? { label: `${testCount} 个样例`, tone: "success" }
        : { label: "缺失", tone: "warning", help: "测试样例、沙盒超时和测试脚本需后端接入。" },
  };
}

function buildProblemPreparationSummary(rows: ProblemPreparationRow[]) {
  const programmingRows = rows.filter((row) => row.isProgramming);
  return {
    total: rows.length,
    reviewReady: rows.filter((row) => row.reviewStatus.tone !== "warning").length,
    needsReview: rows.filter((row) => row.reviewStatus.tone === "warning").length,
    criteriaReady: rows.filter((row) => row.criterionStatus.tone === "success").length,
    missingCriteria: rows.filter((row) => row.criterionStatus.tone === "warning").length,
    answersReady: rows.filter((row) => row.answerStatus.tone === "success").length,
    missingAnswers: rows.filter((row) => row.answerStatus.tone === "warning").length,
    programmingTotal: programmingRows.length,
    testsReady: programmingRows.filter((row) => row.testStatus.tone === "success").length,
    missingTests: programmingRows.filter((row) => row.testStatus.tone === "warning").length,
  };
}

function filterProblemRows(rows: ProblemPreparationRow[], filterText: string) {
  const query = filterText.trim().toLowerCase();
  if (!query) {
    return rows;
  }

  if (containsAny(query, ["缺少标答", "没有标答", "无标答", "标答缺失"])) {
    return rows.filter((row) => row.answerStatus.tone === "warning");
  }
  if (containsAny(query, ["没有评分标准", "缺少评分标准", "无评分标准", "评分标准缺失"])) {
    return rows.filter((row) => row.criterionStatus.tone === "warning");
  }
  if (containsAny(query, ["没有测试", "缺少测试", "测试样例缺失", "无测试"])) {
    return rows.filter((row) => row.testStatus.tone === "warning");
  }
  if (containsAny(query, ["编程", "程序", "代码", "coding", "program"])) {
    return rows.filter((row) => row.isProgramming);
  }
  if (containsAny(query, ["低置信", "复核", "人工"])) {
    return rows.filter((row) => row.reviewStatus.tone === "warning");
  }

  return rows.filter((row) => {
    const haystack = [
      row.label,
      row.type,
      row.problem.stem,
      row.problem.criterion,
      row.problem.reference_answer,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  });
}

function containsAny(value: string, tokens: string[]) {
  return tokens.some((token) => value.includes(token));
}

function isProgrammingProblem(problem: ProblemInfo) {
  const text = `${problem.type ?? ""} ${problem.stem ?? ""}`.toLowerCase();
  return containsAny(text, ["编程", "程序", "代码", "python", "java", "c++", "javascript", "program", "coding", "algorithm"]);
}

function hasText(value?: string | null) {
  return Boolean(value?.trim());
}

function SubmissionsReview({
  answerDraft,
  editingAnswerKey,
  expectedCount,
  isSaving,
  selectedStudent,
  selectedStudentId,
  problems,
  students,
  onAnswerDraftChange,
  onCancel,
  onEdit,
  onSave,
  onSelectStudent,
}: {
  answerDraft: string;
  editingAnswerKey: string | null;
  expectedCount: number;
  isSaving: boolean;
  selectedStudent: StudentSubmission | null;
  selectedStudentId: string | null;
  problems: ProblemInfo[];
  students: StudentSubmission[];
  onAnswerDraftChange: (value: string) => void;
  onCancel: () => void;
  onEdit: (student: StudentSubmission, answer: StudentAnswerInfo) => void;
  onSave: (student: StudentSubmission, answer: StudentAnswerInfo) => void;
  onSelectStudent: (studentId: string) => void;
}) {
  const [filterText, setFilterText] = useState("");
  const answers = [...(selectedStudent?.stu_ans ?? [])].sort(compareAnswers);
  const matrixStats = useMemo(() => getSubmissionMatrixStats(problems, students), [problems, students]);
  const identitySummary = useMemo(() => buildStudentIdentitySummary(students), [students]);

  return (
    <Card id="submissions-review" className="scroll-mt-24 grid gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">学生作答预览与校对</h2>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            按学生检查识别结果；可以逐题修正作答内容后再启动批改。
          </p>
        </div>
        <span className="text-sm text-muted-foreground">{expectedCount} 名学生</span>
      </div>

      {students.length === 0 ? (
        expectedCount > 0 ? (
          <DetailSyncState
            title="正在同步作答详情"
            description={`已解析 ${expectedCount} 名学生，逐题作答正在载入。`}
          />
        ) : (
          <EmptyState title="暂无学生作答" description="上传学生作答文件后，学生列表与逐题答案会显示在这里。" />
        )
      ) : (
        <div className="grid gap-5">
          <WorkflowSection
            title="作答校对总览"
            description="先按学生和题目查看识别覆盖情况，再选择某个学生进入详细作答。"
          >
            <StudentIdentityReviewPanel summary={identitySummary} students={students} />
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <PreparationMetric
                label="学生"
                value={`${students.length}`}
                detail={`预计 ${expectedCount} 名`}
              />
              <PreparationMetric
                label="识别覆盖"
                value={`${matrixStats.recognizedCells}/${matrixStats.expectedCells}`}
                detail={matrixStats.missingCells ? `${matrixStats.missingCells} 格缺失` : "已覆盖全部格"}
                tone={matrixStats.missingCells ? "warning" : "success"}
              />
              <PreparationMetric
                label="需复核"
                value={`${matrixStats.flaggedCells + matrixStats.emptyCells}`}
                detail="按 flag 与空答案前端推断"
                tone={matrixStats.flaggedCells + matrixStats.emptyCells > 0 ? "warning" : "success"}
              />
              <PreparationMetric
                label="当前学生"
                value={selectedStudent ? studentName(selectedStudent) : "未选择"}
                detail={selectedStudent?.stu_id ?? "从下方表格选择"}
              />
            </div>
            <SubmissionReviewMatrix
              problems={problems}
              students={students}
              selectedStudentId={selectedStudentId}
              filterText={filterText}
              onFilterTextChange={setFilterText}
              onSelectStudent={onSelectStudent}
            />
          </WorkflowSection>

          <WorkflowSection
            title="单个学生作答详情"
            description="修改会直接更新当前任务中的识别作答，后续批改使用保存后的内容。"
          >
          <div className="grid content-start gap-3">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-sm font-semibold">{selectedStudent ? studentName(selectedStudent) : "未选择学生"}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedStudent?.stu_id ?? "--"} · {answers.length} 份识别答案
              </p>
            </div>

            {answers.length === 0 ? (
              <EmptyState title="该学生暂无答案" description="可以检查上传包命名或重新上传作答文件。" />
            ) : (
              answers.map((answer) => {
                if (!selectedStudent) {
                  return null;
                }
                const editKey = answerKey(selectedStudent.stu_id, answer.q_id);
                const isEditing = editingAnswerKey === editKey;
                return (
                  <article key={editKey} className="rounded-lg border p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-semibold">{answerLabel(answer)}</p>
                        <p className="mt-1 text-xs text-muted-foreground">{answer.type || "未识别题型"}</p>
                      </div>
                      {isEditing ? null : (
                        <Button type="button" variant="secondary" onClick={() => onEdit(selectedStudent, answer)}>
                          编辑答案
                        </Button>
                      )}
                    </div>

                    {isEditing ? (
                      <div className="mt-4 grid gap-3">
                        <Field label="作答内容">
                          <Textarea value={answerDraft} onChange={(event) => onAnswerDraftChange(event.target.value)} />
                        </Field>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button type="button" variant="ghost" disabled={isSaving} onClick={onCancel}>
                            <X className="h-4 w-4" />
                            取消
                          </Button>
                          <Button type="button" disabled={isSaving} onClick={() => onSave(selectedStudent, answer)}>
                            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            保存
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-4 grid gap-3">
                        <PreviewBlock label="识别答案" value={answer.content} emptyText="答案为空，请编辑补充。" />
                        {answer.flag?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {answer.flag.map((flag) => (
                              <span key={flag} className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
                                {flag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>
          </WorkflowSection>
        </div>
      )}
    </Card>
  );
}

interface StudentIdentitySummary {
  total: number;
  ready: number;
  missingName: number;
  unknownIdentity: number;
  duplicateNameCount: number;
  suspiciousStudents: StudentSubmission[];
}

function StudentIdentityReviewPanel({
  summary,
  students,
}: {
  summary: StudentIdentitySummary;
  students: StudentSubmission[];
}) {
  const hasIssues = summary.missingName > 0 || summary.unknownIdentity > 0 || summary.duplicateNameCount > 0;

  return (
    <div className="grid gap-3 rounded-lg bg-muted/30 p-4">
      <div>
        <p className="text-sm font-semibold">学生身份匹配检查</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">
          先用系统识别出的学号和姓名做前端检查；名单导入、自动匹配、批量改身份属于后端待接能力。
        </p>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          名单导入与批量修正待后端接入；当前可先按缺失、需复核或学生姓名筛选，并逐个学生检查作答。
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <IdentityStat
          label="身份可用"
          value={`${summary.ready}/${summary.total}`}
          detail="有学号且姓名不是未知"
          tone={summary.ready === summary.total ? "success" : "warning"}
        />
        <IdentityStat
          label="姓名缺失"
          value={`${summary.missingName}`}
          detail="需要人工确认或名单匹配"
          tone={summary.missingName ? "warning" : "success"}
        />
        <IdentityStat
          label="可能重复"
          value={`${summary.duplicateNameCount}`}
          detail="同名或未知姓名需留意"
          tone={summary.duplicateNameCount ? "warning" : "success"}
        />
      </div>

      {students.length === 0 ? (
        <p className="text-sm leading-6 text-muted-foreground">
          学生作答识别完成后，这里会显示身份匹配质量、缺失姓名和可能重复项。
        </p>
      ) : hasIssues ? (
        <div className="flex items-start gap-2 text-sm leading-6 text-warning">
          <Circle className="mt-2 h-2.5 w-2.5 shrink-0 fill-current" />
          <p>
            {summary.suspiciousStudents.slice(0, 4).map(studentName).join("、")}
            {summary.suspiciousStudents.length > 4 ? ` 等 ${summary.suspiciousStudents.length} 名` : ""} 需要确认。当前可先在下方筛选学生逐个检查作答。
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-2 text-sm leading-6 text-muted-foreground">
          <Circle className="mt-2 h-2.5 w-2.5 shrink-0 fill-current text-accent" />
          <p>已识别的学生都有学号和姓名；仍建议在正式批改前抽查名单是否与课程学生名单一致。</p>
        </div>
      )}
    </div>
  );
}

function IdentityStat({
  detail,
  label,
  tone,
  value,
}: {
  detail: string;
  label: string;
  tone: PreparationTone;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2 text-sm">
      <Circle
        className={cn(
          "mt-1.5 h-2.5 w-2.5 shrink-0 fill-current",
          tone === "success" ? "text-accent" : tone === "warning" ? "text-warning" : "text-muted-foreground",
        )}
      />
      <div className="min-w-0">
        <p className="font-medium">
          {label} <span className="text-muted-foreground">{value}</span>
        </p>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p>
      </div>
    </div>
  );
}

function buildStudentIdentitySummary(students: StudentSubmission[]): StudentIdentitySummary {
  const nameCounts = new Map<string, number>();
  for (const student of students) {
    const normalizedName = normalizeIdentityText(student.stu_name);
    if (normalizedName && !isUnknownIdentity(normalizedName)) {
      nameCounts.set(normalizedName, (nameCounts.get(normalizedName) ?? 0) + 1);
    }
  }

  let ready = 0;
  let missingName = 0;
  let unknownIdentity = 0;
  let duplicateNameCount = 0;
  const suspiciousStudents: StudentSubmission[] = [];

  for (const student of students) {
    const id = normalizeIdentityText(student.stu_id);
    const name = normalizeIdentityText(student.stu_name);
    const nameMissing = !name || isUnknownIdentity(name);
    const idMissing = !id || isUnknownIdentity(id);
    const duplicateName = Boolean(name && (nameCounts.get(name) ?? 0) > 1);

    if (!idMissing && !nameMissing) {
      ready += 1;
    }
    if (nameMissing) {
      missingName += 1;
    }
    if (idMissing || nameMissing) {
      unknownIdentity += 1;
    }
    if (duplicateName) {
      duplicateNameCount += 1;
    }
    if (nameMissing || idMissing || duplicateName) {
      suspiciousStudents.push(student);
    }
  }

  return {
    total: students.length,
    ready,
    missingName,
    unknownIdentity,
    duplicateNameCount,
    suspiciousStudents,
  };
}

function normalizeIdentityText(value?: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function isUnknownIdentity(value: string) {
  return ["unknown", "[unknown student]", "未知", "未识别", "none", "null", "--"].includes(value);
}

function DetailSyncState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-4">
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function PreviewBlock({ label, value, emptyText }: { label: string; value?: string | null; emptyText: string }) {
  const content = value?.trim() ? value : emptyText;

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-1 rounded-md bg-muted/50 p-3">
        <MarkdownMath>{content}</MarkdownMath>
      </div>
    </div>
  );
}

function InlineAlert({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-2">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="leading-5">{message}</span>
      </div>
      {onRetry ? (
        <Button type="button" variant="secondary" className="w-fit shrink-0" onClick={onRetry}>
          <RefreshCw className="h-4 w-4" />
          重试
        </Button>
      ) : null}
    </div>
  );
}

function problemLabel(problem: ProblemInfo) {
  return problem.number || problem.q_id;
}

function answerLabel(answer: StudentAnswerInfo) {
  return answer.number || answer.q_id;
}

function studentName(student: StudentSubmission) {
  return student.stu_name || student.stu_id;
}

function answerKey(studentId: string, qId: string) {
  return `${studentId}:${qId}`;
}

function compareProblems(a: ProblemInfo, b: ProblemInfo) {
  return naturalCompare(problemLabel(a), problemLabel(b));
}

function compareAnswers(a: StudentAnswerInfo, b: StudentAnswerInfo) {
  return naturalCompare(answerLabel(a), answerLabel(b));
}

function compareStudents(a: StudentSubmission, b: StudentSubmission) {
  return naturalCompare(studentName(a), studentName(b));
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "请求失败，请稍后重试。";
}
