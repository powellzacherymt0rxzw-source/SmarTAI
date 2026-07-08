import { useEffect, useMemo } from "react";
import { AlertTriangle, ArrowLeft, ArrowRight, Loader2, RefreshCw, UserRound } from "lucide-react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { usePerQuestionBreakdown } from "@/api/hooks/analytics";
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
  type QuestionEntry,
  type QuestionSummary,
} from "@/components/tasks/ResultsLayout";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { MarkdownMath } from "@/components/ui/MarkdownMath";

export function TaskQuestionDetailPage() {
  const { taskId, questionId } = useParams();
  const [searchParams] = useSearchParams();
  const taskQuery = useTask(taskId);
  const resultQuery = useTaskResult(taskId);
  const analyticsTaskId = resultQuery.data?.status === "completed" ? taskId : undefined;
  const breakdownQuery = usePerQuestionBreakdown(analyticsTaskId, questionId);
  const model = useMemo(() => buildResultsModel(taskQuery.data, resultQuery.data), [taskQuery.data, resultQuery.data]);
  const questionIndex = model.questions.findIndex((question) => question.id === questionId);
  const question = questionIndex >= 0 ? model.questions[questionIndex] : null;
  const previousQuestion = questionIndex > 0 ? model.questions[questionIndex - 1] : null;
  const nextQuestion = questionIndex >= 0 && questionIndex < model.questions.length - 1 ? model.questions[questionIndex + 1] : null;
  const firstStudentId = question?.entries[0]?.student.id ?? model.students[0]?.id ?? null;
  const focusedStudentId = searchParams.get("studentId");
  const commonMistakes = breakdownQuery.data?.common_mistakes_md?.trim() ?? "";

  if (!taskId) {
    return <EmptyState title="缺少任务 ID" description="请从任务总览或历史任务进入题目详情。" />;
  }

  return (
    <ResultsLayout
      context="question-detail"
      title={question ? `${question.label} 全班详情` : `题目详情 ${questionId ?? ""}`}
      description="查看单题题干、评分标准、全班得分统计与每位学生的答案/评语。"
      detailTargets={{ studentId: firstStudentId, questionId: question?.id ?? questionId ?? null }}
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
        <QuestionContent
          taskId={taskId}
          questionId={questionId}
          question={question}
          questions={model.questions}
          previousQuestion={previousQuestion}
          nextQuestion={nextQuestion}
          focusedStudentId={focusedStudentId}
          resultStatus={resultQuery.data?.status}
          commonMistakes={commonMistakes}
          isRefreshingAnalytics={breakdownQuery.isFetching && !commonMistakes}
        />
      ) : null}
    </ResultsLayout>
  );
}

function QuestionContent({
  taskId,
  questionId,
  question,
  questions,
  previousQuestion,
  nextQuestion,
  focusedStudentId,
  resultStatus,
  commonMistakes,
  isRefreshingAnalytics,
}: {
  taskId: string;
  questionId?: string;
  question: QuestionSummary | null;
  questions: QuestionSummary[];
  previousQuestion: QuestionSummary | null;
  nextQuestion: QuestionSummary | null;
  focusedStudentId?: string | null;
  resultStatus?: string;
  commonMistakes: string;
  isRefreshingAnalytics: boolean;
}) {
  const navigate = useNavigate();

  useEffect(() => {
    if (resultStatus !== "completed" || !question || !focusedStudentId) {
      return;
    }
    document.getElementById(`student-${focusedStudentId}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusedStudentId, question, resultStatus]);

  if (resultStatus !== "completed") {
    return (
      <EmptyState
        title="结果尚未生成"
        description="批改完成后才能查看单题全班详情。"
        action={
          <Link to={`/tasks/${taskId}/results?view=questions`}>
            <Button type="button" variant="secondary">
              返回按题列表
            </Button>
          </Link>
        }
      />
    );
  }

  if (!question) {
    return (
      <EmptyState
        title="未找到该题结果"
        description={questionId ? `当前结果中没有题目 ${questionId}。` : "当前链接缺少题目 ID。"}
        action={
          <Link to={`/tasks/${taskId}/results?view=questions`}>
            <Button type="button" variant="secondary">
              返回按题列表
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
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">{question.label}</h2>
              {question.type ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{question.type}</span> : null}
            </div>
            {question.stem ? (
              <div className="mt-3 rounded-lg border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">题干</p>
                <MarkdownMath className="mt-2">{question.stem}</MarkdownMath>
              </div>
            ) : null}
            {question.criterion ? (
              <div className="mt-3 rounded-lg border bg-muted/30 p-3">
                <p className="text-xs font-medium text-muted-foreground">评分标准</p>
                <MarkdownMath className="mt-2">{question.criterion}</MarkdownMath>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <label className="grid min-w-44 gap-1 text-xs text-muted-foreground">
              切换题目
              <select
                value={question.id}
                onChange={(event) => navigate(`/tasks/${taskId}/questions/${encodeURIComponent(event.target.value)}`)}
                className="h-9 rounded-md border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
              >
                {questions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {previousQuestion ? (
              <Link to={`/tasks/${taskId}/questions/${previousQuestion.id}`}>
                <Button type="button" variant="secondary" className="h-auto min-h-9 max-w-full justify-start whitespace-normal py-2 text-left">
                  <ArrowLeft className="h-4 w-4" />
                  上一题：{previousQuestion.label}
                </Button>
              </Link>
            ) : (
              <Button type="button" variant="secondary" disabled>
                <ArrowLeft className="h-4 w-4" />
                上一题
              </Button>
            )}
            {nextQuestion ? (
              <Link to={`/tasks/${taskId}/questions/${nextQuestion.id}`}>
                <Button type="button" variant="secondary" className="h-auto min-h-9 max-w-full justify-start whitespace-normal py-2 text-left">
                  下一题：{nextQuestion.label}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            ) : (
              <Button type="button" variant="secondary" disabled>
                下一题
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
            <Link to={`/tasks/${taskId}/results?view=questions`}>
              <Button type="button" variant="secondary">
                返回按题列表
              </Button>
            </Link>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <Metric label="作答人数" value={String(question.count)} />
          <Metric label="平均分" value={`${formatScore(question.avgScore)} / ${formatScore(question.maxScore)}`} />
          <Metric label="平均得分率" value={formatPercent(question.avgPercent)} />
          <Metric label="分数范围" value={`${formatScore(question.minScore)} - ${formatScore(question.maxObservedScore)}`} />
          <Metric label="复核信号" value={`低置信 ${question.lowConfidenceCount} · 需复核 ${question.reviewCount}`} tone="warning" />
        </div>

        <QuestionScoreBar question={question} />
      </Card>

      {commonMistakes ? (
        <Card className="grid gap-2">
          <h2 className="text-base font-semibold">全班易错点</h2>
          <MarkdownMath className="text-muted-foreground">{commonMistakes}</MarkdownMath>
        </Card>
      ) : null}

      {isRefreshingAnalytics ? (
        <Card className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在刷新单题分析摘要...
        </Card>
      ) : null}

      <Card className="grid gap-4">
        <div>
          <h2 className="text-base font-semibold">学生作答与评语</h2>
          <p className="mt-1 text-sm text-muted-foreground">按当前题目列出每位学生的得分、答案、AI 评语与复核原因。</p>
        </div>
        <label className="grid max-w-md gap-1 text-sm">
          <span className="font-medium">按学生查看该题</span>
          <select
            defaultValue=""
            onChange={(event) => {
              const target = event.target.value;
              if (!target) {
                return;
              }
              navigate(`/tasks/${taskId}/results/${encodeURIComponent(target)}#question-${question.id}`);
            }}
            className="h-9 rounded-md border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          >
            <option value="" disabled>
              选择学生
            </option>
            {question.entries.map((entry) => (
              <option key={entry.student.id} value={entry.student.id}>
                {entry.student.name}（{entry.student.id}）
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-3">
          {question.entries.map((entry) => (
            <StudentAnswerRow
              key={entry.student.id}
              taskId={taskId}
              question={question}
              entry={entry}
              focused={entry.student.id === focusedStudentId}
            />
          ))}
        </div>
      </Card>
    </div>
  );
}

function StudentAnswerRow({
  taskId,
  question,
  entry,
  focused,
}: {
  taskId: string;
  question: QuestionSummary;
  entry: QuestionEntry;
  focused: boolean;
}) {
  const percent =
    entry.correction.max_score > 0 ? (entry.correction.score / entry.correction.max_score) * 100 : null;

  return (
    <div
      id={`student-${entry.student.id}`}
      className={
        focused
          ? "scroll-mt-24 rounded-lg border border-primary/30 bg-primary/5 p-3"
          : "scroll-mt-24 rounded-lg border p-3"
      }
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold">{entry.student.name}</h3>
            <span className="text-xs text-muted-foreground">{entry.student.id}</span>
            {hasReviewSignal(entry.correction) ? (
              <span className="rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">需要关注</span>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-3 text-sm text-muted-foreground">
            <span>
              得分 {formatScore(entry.correction.score)} / {formatScore(entry.correction.max_score)}
            </span>
            <span>得分率 {formatPercent(percent)}</span>
            <span>置信度 {formatConfidence(entry.correction.confidence)}</span>
          </div>
        </div>
        <Link to={`/tasks/${taskId}/results/${entry.student.id}#question-${entry.correction.q_id}`}>
          <Button type="button" variant="secondary">
            <UserRound className="h-4 w-4" />
            学生详情
          </Button>
        </Link>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>得分率</span>
          <span>{formatPercent(percent)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${clampPercent(percent)}%` }} />
        </div>
      </div>
      <div className="mt-3">
        <CorrectionReviewPanel
          taskId={taskId}
          studentId={entry.student.id}
          qId={entry.correction.q_id}
          questionLabel={question.label}
          answer={entry.answer}
          correction={entry.correction}
        />
      </div>
    </div>
  );
}

function QuestionScoreBar({ question }: { question: QuestionSummary }) {
  if (question.avgPercent === null) {
    return null;
  }

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
        <span>平均得分率</span>
        <span>{formatPercent(question.avgPercent)}</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-accent" style={{ width: `${clampPercent(question.avgPercent)}%` }} />
      </div>
    </div>
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

function LoadingCard() {
  return (
    <Card className="flex items-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      正在读取题目结果...
    </Card>
  );
}

function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 text-danger" />
        <div>
          <p className="font-medium">题目结果读取失败</p>
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
