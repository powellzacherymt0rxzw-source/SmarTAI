import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Loader2,
  RefreshCw,
} from "lucide-react";
import type { ReactNode } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useTask } from "@/api/hooks/tasks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import { Button } from "@/components/ui/Button";
import { useTaskProgress } from "@/hooks/useTaskProgress";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";
import { cn } from "@/lib/cn";
import type { JobProgress, ProgressEvent, TaskStatus } from "@/types";

const QUESTION_WORKSPACE_STATUSES = new Set<TaskStatus>([
  "problems_ready",
  "parsing_submissions",
  "submissions_ready",
  "grading",
  "graded",
]);

type RecognitionStepState = "done" | "active" | "pending";

interface RecognitionStep {
  key: MessageKey;
  state: RecognitionStepState;
}

/** Figma 05 focused progress screen for the problem-recognition job. */
export function ProblemRecognitionProgressPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const taskQuery = useTask(taskId);
  const progressQuery = useTaskProgress(taskId);
  const status = (progressQuery.data?.status ?? taskQuery.data?.status) as TaskStatus | undefined;

  if (taskId && status === "draft") {
    return <Navigate to={`/tasks/${taskId}/upload/problems`} replace />;
  }

  if (taskId && status && QUESTION_WORKSPACE_STATUSES.has(status)) {
    return <Navigate to={`/tasks/${taskId}/questions`} replace />;
  }

  const refresh = () => {
    void Promise.all([taskQuery.refetch(), progressQuery.refetch()]);
  };

  if (!taskId) {
    return (
      <ProgressPageFrame title={t("problemProgressTitle")}>
        <RecoveryState
          title={t("problemProgressTaskMissing")}
          description={t("problemProgressTaskMissingDescription")}
          primaryLabel={t("problemProgressViewTasks")}
          onPrimary={() => navigate("/history")}
        />
      </ProgressPageFrame>
    );
  }

  if (status === "error") {
    return (
      <ProgressPageFrame title={t("problemProgressTitle")}>
        <RecoveryState
          title={t("problemProgressFailedTitle")}
          description={t("problemProgressFailedDescription")}
          primaryLabel={t("problemProgressChooseAgain")}
          onPrimary={() => navigate(`/tasks/${taskId}/upload/problems`)}
          secondaryLabel={t("problemProgressRefresh")}
          onSecondary={refresh}
          busy={taskQuery.isFetching || progressQuery.isFetching}
        />
      </ProgressPageFrame>
    );
  }

  const hasReadableState = Boolean(status || taskQuery.data || progressQuery.data);
  if (!hasReadableState && (taskQuery.isError || progressQuery.isError)) {
    return (
      <ProgressPageFrame title={t("problemProgressTitle")}>
        <RecoveryState
          title={t("problemProgressReadFailedTitle")}
          description={t("problemProgressReadFailedDescription")}
          primaryLabel={t("problemProgressRefresh")}
          onPrimary={refresh}
          secondaryLabel={t("problemProgressViewTasks")}
          onSecondary={() => navigate("/history")}
          busy={taskQuery.isFetching || progressQuery.isFetching}
        />
      </ProgressPageFrame>
    );
  }

  if (status !== "extracting_problems") {
    return (
      <ProgressPageFrame title={t("problemProgressTitle")}>
        <LoadingState label={t("problemProgressReading")} />
      </ProgressPageFrame>
    );
  }

  const progress = progressQuery.progress;
  const steps = getRecognitionSteps(progress);
  const recentEvents = [...(progress?.messages ?? [])].slice(-3).reverse();
  const hasDeterminateProgress = Boolean(
    progress &&
      typeof progress.total_steps === "number" &&
      progress.total_steps > 0 &&
      typeof progress.completed_steps === "number",
  );
  const percent = hasDeterminateProgress ? progressQuery.percent : null;

  return (
    <ProgressPageFrame title={t("problemProgressTitle")}>
      <section
        className="flex min-h-[430px] w-full flex-col rounded-[10px] border bg-card px-5 py-7 sm:px-10 sm:py-10"
        aria-live="polite"
        aria-busy="true"
      >
        <div>
          <h2 className="text-[22px] font-bold leading-8 tracking-[-0.01em] text-foreground sm:text-2xl">
            {t("problemProgressRecognizingStructure")}
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {t("problemProgressBackgroundDescription")}
          </p>
        </div>

        <div className="mt-6 flex items-center gap-3">
          <div
            className="relative h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
            role="progressbar"
            aria-label={t("problemProgressProgressLabel")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent ?? undefined}
            aria-valuetext={percent === null ? t("problemProgressProcessing") : undefined}
          >
            {percent === null ? (
              <span className="absolute inset-y-0 left-0 w-1/3 animate-pulse rounded-full bg-primary" />
            ) : (
              <span
                className="block h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            )}
          </div>
          <span className="w-14 shrink-0 text-right text-sm font-semibold text-primary sm:text-lg">
            {percent === null ? t("problemProgressProcessing") : `${percent}%`}
          </span>
        </div>

        <div className="mt-8 grid min-h-0 flex-1 gap-6 md:grid-cols-[210px_minmax(0,1fr)] md:gap-16">
          <ol className="grid content-start gap-3" aria-label={t("problemProgressStepsLabel")}>
            {steps.map((step) => (
              <RecognitionStepItem key={step.key} step={step} label={t(step.key)} />
            ))}
          </ol>

          <div className="min-w-0 rounded-lg border bg-slate-50 px-5 py-4 dark:bg-slate-900/30">
            <h3 className="text-sm font-semibold text-foreground">
              {t("problemProgressLatestEvents")}
            </h3>
            {recentEvents.length > 0 ? (
              <ol className="mt-3 grid gap-1.5">
                {recentEvents.map((event, index) => (
                  <li
                    key={`${event.ts}:${event.message}:${index}`}
                    className="grid min-w-0 grid-cols-[42px_minmax(0,1fr)] gap-2 text-xs leading-5 text-muted-foreground sm:text-sm"
                  >
                    <time dateTime={toDateTime(event.ts)}>{formatEventTime(event.ts, locale)}</time>
                    <span className="min-w-0 break-words">{localizeEvent(event, t)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin text-primary" />
                <span>{t("problemProgressWaitingForEvents")}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="mt-[30px] flex flex-col justify-end gap-3 sm:flex-row">
        <Button
          type="button"
          variant="secondary"
          className="h-10 w-full px-6 sm:w-auto sm:min-w-[130px]"
          onClick={() => navigate("/")}
        >
          {t("problemProgressRunInBackground")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          className="h-10 w-full px-6 sm:w-auto sm:min-w-[150px]"
          onClick={() => navigate("/history")}
        >
          {t("problemProgressViewTasks")}
        </Button>
      </div>
    </ProgressPageFrame>
  );
}

function ProgressPageFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="w-full max-w-[1300px]">
      <h1 className="text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
        {title}
      </h1>
      <NewTaskStepper currentStep={0} />
      <div className="mx-auto mt-[45px] w-full max-w-[800px]">{children}</div>
    </div>
  );
}

function RecognitionStepItem({
  step,
  label,
}: {
  step: RecognitionStep;
  label: string;
}) {
  return (
    <li
      className={cn(
        "flex min-h-7 items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold sm:text-sm",
        step.state === "done"
          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-200"
          : step.state === "active"
            ? "bg-blue-100 text-primary dark:bg-blue-950/70 dark:text-blue-200"
            : "bg-slate-100 text-muted-foreground dark:bg-slate-800",
      )}
    >
      {step.state === "done" ? (
        <CheckCircle2 aria-hidden="true" className="h-4 w-4 shrink-0" />
      ) : step.state === "active" ? (
        <Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />
      ) : (
        <Clock3 aria-hidden="true" className="h-4 w-4 shrink-0" />
      )}
      <span className="min-w-0 break-words">{label}</span>
    </li>
  );
}

function LoadingState({ label }: { label: string }) {
  return (
    <section className="flex min-h-[430px] items-center justify-center rounded-[10px] border bg-card px-6 text-center">
      <div>
        <Loader2 aria-hidden="true" className="mx-auto h-7 w-7 animate-spin text-primary" />
        <p className="mt-4 text-sm font-medium text-muted-foreground">{label}</p>
      </div>
    </section>
  );
}

function RecoveryState({
  title,
  description,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
  busy = false,
}: {
  title: string;
  description: string;
  primaryLabel: string;
  onPrimary: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  busy?: boolean;
}) {
  return (
    <section className="flex min-h-[430px] items-center justify-center rounded-[10px] border bg-card px-6 py-10 text-center">
      <div className="max-w-md">
        <span className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-danger dark:bg-red-950/40">
          <AlertCircle aria-hidden="true" className="h-5 w-5" />
        </span>
        <h2 className="mt-4 text-xl font-bold text-foreground">{title}</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Button type="button" className="h-10 px-5" onClick={onPrimary} disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
            {primaryLabel}
          </Button>
          {secondaryLabel && onSecondary ? (
            <Button
              type="button"
              variant="secondary"
              className="h-10 px-5"
              onClick={onSecondary}
              disabled={busy}
            >
              {secondaryLabel === primaryLabel && busy ? (
                <RefreshCw aria-hidden="true" className="h-4 w-4 animate-spin" />
              ) : null}
              {secondaryLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function getRecognitionSteps(progress: JobProgress | null): RecognitionStep[] {
  const currentStep = progress?.current_step;
  if (currentStep) {
    const stageIndex: Record<string, number> = {
      source_prepared: 1,
      calling_recognition: 2,
      organizing_structure: 3,
      completed: 5,
    };
    const activeIndex = stageIndex[currentStep] ?? 1;
    const keys: MessageKey[] = [
      "problemProgressStepSourceReceived",
      "problemProgressStepPrepareSource",
      "problemProgressStepModelRecognition",
      "problemProgressStepParseStructure",
      "problemProgressStepSaveResults",
    ];
    return keys.map((key, index) => ({
      key,
      state: activeIndex >= keys.length || index < activeIndex
        ? "done"
        : index === activeIndex
          ? "active"
          : "pending",
    }));
  }

  const messages = (progress?.messages ?? []).map((event) => event.message.toLowerCase());
  const hasModelCall = messages.some((message) => message.startsWith("calling "));
  const hasStructuredResult = messages.some((message) => message.includes("parsing json"));
  const hasFinishedRecognition = progress?.phase === "done";

  return [
    { key: "problemProgressStepSourceReceived", state: "done" },
    {
      key: "problemProgressStepPrepareSource",
      state: hasModelCall || hasStructuredResult || hasFinishedRecognition
        ? "done"
        : "active",
    },
    {
      key: "problemProgressStepModelRecognition",
      state: hasStructuredResult || hasFinishedRecognition
        ? "done"
        : hasModelCall
          ? "active"
          : "pending",
    },
    {
      key: "problemProgressStepParseStructure",
      state: hasFinishedRecognition
        ? "done"
        : hasStructuredResult
          ? "active"
          : "pending",
    },
    {
      key: "problemProgressStepSaveResults",
      state: hasFinishedRecognition ? "active" : "pending",
    },
  ];
}

function localizeEvent(
  event: ProgressEvent,
  t: (key: MessageKey) => string,
): string {
  const message = event.message.toLowerCase();
  if (message === "phase: extracting") return t("problemProgressEventExtracting");
  if (message === "phase: done") return t("problemProgressEventDone");
  if (message === "problem source prepared.") return t("problemProgressEventSourcePrepared");
  if (message === "problem recognition started.") return t("problemProgressEventModelStarted");
  if (message === "organizing recognized problem structure.") return t("problemProgressEventParsing");
  if (message === "problem recognition completed.") return t("problemProgressEventDone");
  if (message.includes("applying source mode")) return t("problemProgressEventSourcePrepared");
  if (message.startsWith("calling ")) return t("problemProgressEventModelStarted");
  if (message.includes("parsing json")) return t("problemProgressEventParsing");
  return event.message;
}

function formatEventTime(timestamp: number, locale: string): string {
  const date = normalizeTimestamp(timestamp);
  if (!date) return "—";
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function toDateTime(timestamp: number): string | undefined {
  return normalizeTimestamp(timestamp)?.toISOString();
}

function normalizeTimestamp(timestamp: number): Date | null {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  return new Date(timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1_000);
}
