import { useEffect, useMemo } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, FileText, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useTask, useTaskResult } from "@/api/hooks/tasks";
import { CorrectionReviewPanel } from "@/components/tasks/CorrectionReviewPanel";
import {
  buildResultsModel,
  clampPercent,
  formatConfidence,
  formatPercent,
  formatScore,
  hasReviewSignal,
  ResultsLayout,
  type StudentSummary,
} from "@/components/tasks/ResultsLayout";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import type { Correction } from "@/types";

export function TaskStudentDetailPage() {
  const { taskId, studentId } = useParams();
  const taskQuery = useTask(taskId);
  const resultQuery = useTaskResult(taskId);
  const model = useMemo(() => buildResultsModel(taskQuery.data, resultQuery.data), [taskQuery.data, resultQuery.data]);
  const studentIndex = model.students.findIndex((student) => student.id === studentId);
  const student = studentIndex >= 0 ? model.students[studentIndex] : null;
  const previousStudent = studentIndex > 0 ? model.students[studentIndex - 1] : null;
  const nextStudent = studentIndex >= 0 && studentIndex < model.students.length - 1 ? model.students[studentIndex + 1] : null;
  const firstQuestionId = student?.corrections[0]?.q_id ?? model.questions[0]?.id ?? null;

  if (!taskId) {
    return <EmptyState title="缺少任务 ID" description="请从任务总览或历史任务进入学生详情。" />;
  }

  return (
    <ResultsLayout
      context="student-detail"
      title={student ? `${student.name} 的批改详情` : `学生详情 ${studentId ?? ""}`}
      description="查看单个学生的逐题得分、AI 评语、低置信与复核原因。"
      task={taskQuery.data}
      detailTargets={{ studentId: student?.id ?? studentId ?? null, questionId: firstQuestionId }}
    >
      {taskQuery.isLoading || resultQuery.isLoading ? <LoadingCard /> : null}
      {taskQuery.isError || resultQuery.isError ? (
        <ErrorCard
          error={taskQuery.error ?? resultQuery.error}
          onRetry={() => {
            void taskQuery.refetch();
            void resultQuery.refetch();
          }}
        />
      ) : null}
      {!taskQuery.isLoading && !resultQuery.isLoading && !taskQuery.isError && !resultQuery.isError ? (
        <StudentContent
          taskId={taskId}
          studentId={studentId}
          student={student}
          students={model.students}
          previousStudent={previousStudent}
          nextStudent={nextStudent}
          resultStatus={resultQuery.data?.status}
        />
      ) : null}
    </ResultsLayout>
  );
}

function StudentContent({
  taskId,
  studentId,
  student,
  students,
  previousStudent,
  nextStudent,
  resultStatus,
}: {
  taskId: string;
  studentId?: string;
  student: StudentSummary | null;
  students: StudentSummary[];
  previousStudent: StudentSummary | null;
  nextStudent: StudentSummary | null;
  resultStatus?: string;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    if (resultStatus !== "completed" || !student || !window.location.hash) {
      return;
    }
    const targetId = decodeURIComponent(window.location.hash.slice(1));
    window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }, [resultStatus, student]);

  if (resultStatus !== "completed") {
    return (
      <EmptyState
        title="结果尚未生成"
        description="批改完成后才能查看学生逐题详情。"
        action={
          <Link to={`/tasks/${taskId}/results`}>
            <Button type="button" variant="secondary">
              返回结果列表
            </Button>
          </Link>
        }
      />
    );
  }

  if (!student) {
    return (
      <EmptyState
        title="未找到该学生结果"
        description={studentId ? `当前结果中没有学生 ${studentId}。` : "当前链接缺少学生 ID。"}
        action={
          <Link to={`/tasks/${taskId}/results`}>
            <Button type="button" variant="secondary">
              返回结果列表
            </Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="grid gap-4">
      <Card className="grid gap-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-base font-semibold">{student.name}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{student.id}</p>
          </div>
          <div className="grid min-w-0 gap-2 sm:flex sm:flex-wrap xl:justify-end">
            <label className="grid min-w-0 gap-1 text-xs text-muted-foreground sm:min-w-52">
              切换学生
              <select
                value={student.id}
                onChange={(event) => navigate(`/tasks/${taskId}/results/${encodeURIComponent(event.target.value)}`)}
                className="h-9 w-full rounded-md border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                {students.map((item) => (
                  <option key={item.id} value={item.id}>
                    {studentNavLabel(item)}
                  </option>
                ))}
              </select>
            </label>
            {previousStudent ? (
              <Link to={`/tasks/${taskId}/results/${previousStudent.id}`} className="min-w-0">
                <Button type="button" variant="secondary" className="w-full justify-start text-left sm:w-auto">
                  <ArrowLeft className="h-4 w-4" />
                  <span className="min-w-0 truncate">上一位：{studentNavLabel(previousStudent)}</span>
                </Button>
              </Link>
            ) : (
              <Button type="button" variant="secondary" className="w-full justify-start sm:w-auto" disabled>
                <ArrowLeft className="h-4 w-4" />
                上一位
              </Button>
            )}
            {nextStudent ? (
              <Link to={`/tasks/${taskId}/results/${nextStudent.id}`} className="min-w-0">
                <Button type="button" variant="secondary" className="w-full justify-start text-left sm:w-auto">
                  <span className="min-w-0 truncate">下一位：{studentNavLabel(nextStudent)}</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <Button type="button" variant="secondary" className="w-full justify-start sm:w-auto" disabled>
                下一位
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            <Link to={`/tasks/${taskId}/results`} className="min-w-0">
              <Button type="button" variant="secondary" className="w-full sm:w-auto">
                返回结果列表
              </Button>
            </Link>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="总分" value={`${formatScore(student.totalScore)} / ${formatScore(student.totalMax)}`} />
          <Metric label="得分率" value={formatPercent(student.percent)} />
          <Metric label="平均置信度" value={formatConfidence(student.avgConfidence)} />
          <Metric label="复核信号" value={`低置信 ${student.lowConfidenceCount} · 需复核 ${student.reviewCount}`} tone="warning" />
        </div>
      </Card>

      <Card className="grid gap-3">
        <div>
          <h2 className="text-base font-semibold">题目复核导航</h2>
          <p className="mt-1 text-sm text-muted-foreground">选择题号会定位到该学生的对应作答；也可以从每题进入全班题目详情。</p>
        </div>
        <label className="grid max-w-md gap-1 text-sm">
          <span className="font-medium">跳转题目</span>
          <select
            defaultValue=""
            onChange={(event) => {
              const target = event.target.value;
              if (!target) {
                return;
              }
              document.getElementById(`question-${target}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className="h-9 rounded-md border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="" disabled>
              选择该学生的一道题
            </option>
            {student.corrections.map((correction) => {
              const answer = student.answerByQuestion.get(correction.q_id);
              return (
                <option key={correction.q_id} value={correction.q_id}>
                  {answer?.number ? `Q${answer.number}` : correction.q_id}
                </option>
              );
            })}
          </select>
        </label>
      </Card>

      <div className="grid gap-3">
        {student.corrections.map((correction) => (
          <StudentCorrectionCard key={correction.q_id} taskId={taskId} student={student} correction={correction} />
        ))}
      </div>
    </div>
  );
}

function StudentCorrectionCard({
  taskId,
  student,
  correction,
}: {
  taskId: string;
  student: StudentSummary;
  correction: Correction;
}) {
  const answer = student.answerByQuestion.get(correction.q_id);
  const percent = correction.max_score > 0 ? (correction.score / correction.max_score) * 100 : null;

  return (
    <Card id={`question-${correction.q_id}`} className="scroll-mt-24 grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{answer?.number ? `Q${answer.number}` : correction.q_id}</h3>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{correction.type}</span>
            {hasReviewSignal(correction) ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                <ShieldAlert className="h-3 w-3" />
                需要关注
              </span>
            ) : null}
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <Metric label="得分" value={`${formatScore(correction.score)} / ${formatScore(correction.max_score)}`} />
            <Metric label="得分率" value={formatPercent(percent)} />
            <Metric label="置信度" value={formatConfidence(correction.confidence)} />
          </div>
        </div>
        <Link to={`/tasks/${taskId}/results/questions/${correction.q_id}?studentId=${encodeURIComponent(student.id)}`}>
          <Button type="button" variant="secondary">
            <FileText className="h-4 w-4" />
            该题全班分析
          </Button>
        </Link>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>得分率</span>
          <span>{formatPercent(percent)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${clampPercent(percent)}%` }} />
        </div>
      </div>

      <CorrectionReviewPanel
        taskId={taskId}
        studentId={student.id}
        qId={correction.q_id}
        questionLabel={answer?.number ? `Q${answer.number}` : correction.q_id}
        answer={answer}
        correction={correction}
      />
    </Card>
  );
}

function Metric({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "warning" }) {
  return (
    <div className={tone === "warning" ? "rounded-lg border border-warning/30 bg-warning/5 p-3" : "rounded-lg border p-3"}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold">{value}</p>
    </div>
  );
}

function studentNavLabel(student: StudentSummary) {
  return `${student.name}（${student.id}）`;
}

function LoadingCard() {
  return (
    <Card className="flex items-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      正在读取学生结果...
    </Card>
  );
}

function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 text-danger" />
        <div>
          <p className="font-medium">学生结果读取失败</p>
          <p className="mt-1 text-sm text-muted-foreground">{error instanceof Error ? error.message : "请稍后重试。"}</p>
        </div>
      </div>
      <Button type="button" variant="secondary" onClick={onRetry}>
        <RefreshCw className="h-4 w-4" />
        重试
      </Button>
    </Card>
  );
}
