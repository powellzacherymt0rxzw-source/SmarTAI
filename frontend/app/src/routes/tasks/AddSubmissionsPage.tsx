import { FileCheck2, FileUp, LoaderCircle, SlidersHorizontal } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { normalizeAPIError } from "@/api/client";
import { useParseSubmissions, useTask } from "@/api/hooks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";
import { cn } from "@/lib/cn";
import type { SubmissionIdentityMode } from "@/types";
import { GradingSetupPage } from "./GradingSetupPage";

const SUBMISSION_SUFFIXES = [
  ".zip", ".rar", ".7z", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2",
  ".txt", ".md", ".rst", ".csv", ".pdf",
] as const;
const ROSTER_SUFFIXES = [".csv", ".tsv", ".txt"] as const;

const IDENTITY_OPTIONS: Array<{ mode: SubmissionIdentityMode; label: MessageKey }> = [
  { mode: "filename", label: "submissionUploadIdentityFilename" },
  { mode: "roster", label: "submissionUploadIdentityRoster" },
  { mode: "manual_review", label: "submissionUploadIdentityManual" },
];

type SubmissionDraft = {
  selectedFile: File | null;
  rosterFile: File | null;
  identityMode: SubmissionIdentityMode;
};

const submissionDrafts = new Map<string, SubmissionDraft>();

export function AddSubmissionsPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useI18n();
  const taskQuery = useTask(taskId);
  const parseSubmissions = useParseSubmissions();
  const submissionInputRef = useRef<HTMLInputElement>(null);
  const rosterInputRef = useRef<HTMLInputElement>(null);

  const savedDraft = taskId ? submissionDrafts.get(taskId) : undefined;
  const [selectedFile, setSelectedFile] = useState<File | null>(savedDraft?.selectedFile ?? null);
  const [rosterFile, setRosterFile] = useState<File | null>(savedDraft?.rosterFile ?? null);
  const [identityMode, setIdentityMode] = useState<SubmissionIdentityMode>(savedDraft?.identityMode ?? "filename");
  const [phase, setPhase] = useState<"upload" | "settings">(
    searchParams.get("phase") === "settings" && savedDraft?.selectedFile ? "settings" : "upload",
  );
  const [isDragging, setIsDragging] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);

  const task = taskQuery.data;
  const hasExistingSubmissions = Boolean(task?.submission_file_name || task?.student_count);
  const isRecognitionRunning = task?.status === "parsing_submissions";
  const isWorkflowBusy = task?.status === "extracting_problems" || task?.status === "grading";

  useEffect(() => {
    if (!taskId) return;
    submissionDrafts.set(taskId, { selectedFile, rosterFile, identityMode });
  }, [identityMode, rosterFile, selectedFile, taskId]);

  const uploadDisabledReason = isRecognitionRunning
    ? null
    : taskQuery.isLoading
      ? t("submissionUploadTaskLoading")
      : taskQuery.isError || !task
        ? t("submissionUploadTaskUnavailable")
        : isWorkflowBusy
          ? task.status === "grading"
            ? t("submissionUploadGradingLocked")
            : t("submissionUploadBusy")
          : !selectedFile
            ? t("submissionUploadFileRequired")
            : identityMode === "roster" && !rosterFile
              ? t("submissionUploadRosterRequired")
              : null;

  function selectSubmission(file: File | undefined) {
    if (!file || parseSubmissions.isPending) return;
    if (!hasSuffix(file.name, SUBMISSION_SUFFIXES)) {
      setFormError(t("submissionUploadUnsupported"));
      return;
    }
    setSelectedFile(file);
    setUploadPercent(0);
    setFormError(null);
  }

  function selectRoster(file: File | undefined) {
    if (!file || parseSubmissions.isPending) return;
    if (!hasSuffix(file.name, ROSTER_SUFFIXES)) {
      setFormError(t("submissionUploadErrorRoster"));
      return;
    }
    setRosterFile(file);
    setFormError(null);
  }

  function handleSubmissionInput(event: ChangeEvent<HTMLInputElement>) {
    selectSubmission(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleRosterInput(event: ChangeEvent<HTMLInputElement>) {
    selectRoster(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    selectSubmission(event.dataTransfer.files?.[0]);
  }

  function showSettings() {
    setFormError(null);
    if (isRecognitionRunning) {
      if (taskId) navigate(`/tasks/${taskId}/submissions/progress`);
      return;
    }
    if (uploadDisabledReason) {
      setFormError(uploadDisabledReason);
      return;
    }
    setPhase("settings");
    setSearchParams({ phase: "settings" }, { replace: true });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  function showUpload() {
    setPhase("upload");
    setSearchParams({}, { replace: true });
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }

  async function handleStart() {
    setFormError(null);
    if (!taskId) {
      setFormError(t("submissionUploadTaskUnavailable"));
      return;
    }
    if (isRecognitionRunning) {
      navigate(`/tasks/${taskId}/submissions/progress`);
      return;
    }
    if (uploadDisabledReason) {
      setFormError(uploadDisabledReason);
      return;
    }
    const replaceConfirmed = hasExistingSubmissions
      ? window.confirm(t("submissionUploadReplaceConfirm"))
      : false;
    if (hasExistingSubmissions && !replaceConfirmed) return;

    try {
      const response = await parseSubmissions.mutateAsync({
        taskId,
        file: selectedFile as File,
        identityMode,
        rosterFile: identityMode === "roster" ? rosterFile : null,
        replaceConfirmed,
        onProgress: setUploadPercent,
      });
      if (response.status === "already_done") {
        submissionDrafts.delete(taskId);
        toast.info(t("submissionUploadViewProgress"));
        navigate(`/tasks/${taskId}/submissions`);
      } else {
        submissionDrafts.delete(taskId);
        toast.success(t("submissionUploadStarted"));
        navigate(`/tasks/${taskId}/submissions/progress`);
      }
    } catch (error) {
      setFormError(localizeSubmissionError(error, t));
    }
  }

  const identityHelp = identityMode === "roster"
    ? t("submissionUploadRosterHelp")
    : identityMode === "manual_review"
      ? t("submissionUploadManualHelp")
      : t("submissionUploadFilenameHelp");

  if (phase === "settings" && selectedFile) {
    return (
      <div className="w-full max-w-[1300px]">
        <h1 className="text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
          {t("submissionUploadSetupTitle")}
        </h1>
        <NewTaskStepper currentStep={3} />
        <p className="mt-5 max-w-3xl text-[13px] leading-5 text-muted-foreground">
          {t("submissionUploadSetupDescription")}
        </p>
        <div className="mt-4 flex min-h-[72px] flex-col gap-3 rounded-[10px] border bg-card px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[9px] bg-primary/10 text-primary">
              <FileCheck2 aria-hidden="true" className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-muted-foreground">{t("submissionUploadSetupFileLabel")}</p>
              <p className="mt-1 truncate text-sm font-semibold text-foreground" title={selectedFile.name}>{selectedFile.name}</p>
            </div>
          </div>
          <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-xs font-semibold text-primary">
            <SlidersHorizontal aria-hidden="true" className="h-3.5 w-3.5" />
            {t("submissionUploadIdentityTitle")}
          </span>
        </div>
        {formError ? (
          <p className="mt-3 rounded-[8px] border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-medium text-red-700 dark:border-red-900 dark:bg-red-950/20 dark:text-red-200" role="alert">
            {formError}
          </p>
        ) : null}
        <GradingSetupPage
          embedded
          submitLabel={t("submissionUploadSaveAndStart")}
          onBack={showUpload}
          onSaved={handleStart}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1300px]">
      <h1 className="text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">{t("submissionUploadTitle")}</h1>

      <NewTaskStepper currentStep={3} />

      <div className="mx-auto mt-[45px] w-full max-w-[900px]">
        <div
          className={cn(
            "flex h-[230px] cursor-pointer flex-col items-center justify-center rounded-[12px] border bg-card px-6 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            isDragging ? "border-primary bg-primary/[0.03]" : "border-primary",
            parseSubmissions.isPending && "cursor-wait opacity-70",
          )}
          role="button"
          tabIndex={0}
          aria-label={t("submissionUploadChoose")}
          onClick={() => submissionInputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              submissionInputRef.current?.click();
            }
          }}
          onDragEnter={(event) => {
            event.preventDefault();
            setIsDragging(true);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <input
            ref={submissionInputRef}
            type="file"
            className="hidden"
            accept={SUBMISSION_SUFFIXES.join(",")}
            disabled={parseSubmissions.isPending}
            onChange={handleSubmissionInput}
          />
          <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-primary/[0.14] text-primary">
            <FileUp aria-hidden="true" className="h-6 w-6" />
          </span>
          <p className="mt-[14px] text-[18px] font-semibold leading-[22px] text-foreground">
            {selectedFile ? selectedFile.name : t("submissionUploadDropTitle")}
          </p>
          <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
            {selectedFile
              ? `${formatFileSize(selectedFile.size)} · ${t("submissionUploadOcrLimit")}`
              : t("submissionUploadFormats")}
          </p>
          <span className="mt-[17px] inline-flex h-10 min-w-[130px] items-center justify-center rounded-[8px] border bg-card px-4 text-[14px] font-semibold text-foreground">
            {selectedFile ? t("submissionUploadReplace") : t("submissionUploadChoose")}
          </span>
          {parseSubmissions.isPending ? (
            <div className="mt-3 h-1 w-[min(300px,70%)] overflow-hidden rounded-full bg-muted" aria-label={`${uploadPercent}%`}>
              <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${uploadPercent}%` }} />
            </div>
          ) : null}
        </div>

        <section className="mt-10 flex min-h-[145px] flex-col rounded-[10px] border bg-card px-[29px] pb-5 pt-[27px] sm:h-[145px]">
          <h2 className="text-[18px] font-bold leading-[22px] text-foreground">
            {t("submissionUploadIdentityTitle")}
          </h2>
          <div className="mt-[18px] flex flex-wrap gap-3 sm:gap-5" role="radiogroup" aria-label={t("submissionUploadIdentityTitle")}>
            {IDENTITY_OPTIONS.map((option) => (
              <button
                key={option.mode}
                type="button"
                role="radio"
                aria-checked={identityMode === option.mode}
                disabled={parseSubmissions.isPending}
                onClick={() => {
                  setIdentityMode(option.mode);
                  setFormError(null);
                }}
                className={cn(
                  "inline-flex h-7 items-center justify-center rounded-full px-3 text-[12px] font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  option.mode === "filename" ? "min-w-[150px]" : "min-w-[100px]",
                  identityMode === option.mode
                    ? "bg-primary/[0.14] text-primary"
                    : "bg-muted/60 text-muted-foreground hover:text-foreground",
                )}
              >
                {t(option.label)}
              </button>
            ))}
          </div>
          <div className="mt-auto flex min-w-0 flex-col gap-1.5 pt-3 text-[13px] leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:pt-2">
            <p className="min-w-0 truncate" title={identityHelp}>
              {identityMode === "filename" && selectedFile
                ? `${t("submissionUploadPreviewPrefix")}${isSubmissionArchive(selectedFile.name)
                  ? t("submissionUploadArchivePreview")
                  : filenameIdentityPreview(selectedFile.name)}`
                : identityHelp}
            </p>
            {identityMode === "roster" ? (
              <div className="flex shrink-0 items-center gap-2">
                <span className="max-w-[180px] truncate text-[12px]" title={rosterFile?.name}>
                  {rosterFile?.name ?? t("submissionUploadRosterFormats")}
                </span>
                <input
                  ref={rosterInputRef}
                  type="file"
                  className="hidden"
                  accept={ROSTER_SUFFIXES.join(",")}
                  disabled={parseSubmissions.isPending}
                  onChange={handleRosterInput}
                />
                <button
                  type="button"
                  className="inline-flex h-7 items-center rounded-[6px] border bg-card px-2.5 text-[12px] font-semibold text-foreground hover:bg-muted"
                  onClick={() => rosterInputRef.current?.click()}
                >
                  {rosterFile ? t("submissionUploadRosterReplace") : t("submissionUploadRosterChoose")}
                </button>
              </div>
            ) : null}
          </div>
        </section>

        <div className="mt-[31px] flex min-h-10 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-[13px] leading-5">
            {formError ? (
              <p id="submission-upload-action-message" role="alert" className="text-danger">{formError}</p>
            ) : hasExistingSubmissions ? (
              <p id="submission-upload-action-message" className="text-muted-foreground">
                {t("submissionUploadExisting")} {" "}
                <Link to="/tasks/new" className="font-semibold text-primary underline-offset-2 hover:underline">
                  {t("submissionUploadCreateSeparateTask")}
                </Link>
              </p>
            ) : uploadDisabledReason && uploadDisabledReason !== t("submissionUploadFileRequired") ? (
              <p id="submission-upload-action-message" className="text-muted-foreground">
                {uploadDisabledReason}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="inline-flex h-10 w-full shrink-0 items-center justify-center rounded-[8px] bg-primary px-4 text-[14px] font-semibold leading-[18px] text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-[180px]"
            disabled={parseSubmissions.isPending || isWorkflowBusy}
            title={uploadDisabledReason ?? undefined}
            aria-describedby={formError || hasExistingSubmissions || uploadDisabledReason ? "submission-upload-action-message" : undefined}
            onClick={showSettings}
          >
            {parseSubmissions.isPending ? (
              <><LoaderCircle aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />{t("submissionUploadStarting")}</>
            ) : isRecognitionRunning
              ? t("submissionUploadViewProgress")
              : t("submissionUploadContinueSetup")}
          </button>
        </div>
      </div>
    </div>
  );
}

function hasSuffix(filename: string, suffixes: readonly string[]) {
  const normalized = filename.toLowerCase();
  return suffixes.some((suffix) => normalized.endsWith(suffix));
}

function filenameIdentityPreview(filename: string) {
  const normalized = filename.replace(/\.(?:tar\.gz|tar\.bz2|[^.]+)$/i, "");
  if (/\.(?:zip|rar|7z|tar|tgz|tbz2)$/i.test(filename)) {
    return normalized;
  }
  const tokens = normalized.split(/[_\-\s]+/).map((token) => token.trim()).filter(Boolean);
  const studentId = tokens.find((token) => /\d{4,}/.test(token));
  const studentName = tokens.find((token) => token !== studentId && /[A-Za-z\u3400-\u9fff]{2,}/.test(token));
  return studentId
    ? `${filename} → ${studentId}${studentName ? ` / ${studentName}` : ""}`
    : `${filename} → ${normalized}`;
}

function isSubmissionArchive(filename: string) {
  return /\.(?:zip|rar|7z|tar|tar\.gz|tgz|tar\.bz2|tbz2)$/i.test(filename);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function localizeSubmissionError(error: unknown, t: (key: MessageKey) => string) {
  const normalized = normalizeAPIError(error);
  const detail = normalized.payload?.detail;
  const code = typeof detail === "object" && detail && "code" in detail
    ? String((detail as { code?: unknown }).code ?? "")
    : "";
  if (["submission_source_unsupported", "submission_source_empty", "submission_archive_empty", "submission_archive_invalid"].includes(code)) {
    return t("submissionUploadErrorInvalid");
  }
  if (["submission_source_too_large", "pdf_page_limit_exceeded", "pdf_character_limit_exceeded"].includes(code)) {
    return t("submissionUploadErrorTooLarge");
  }
  if (code.startsWith("submission_roster_")) return t("submissionUploadErrorRoster");
  if (code === "recognition_provider_not_enabled") return t("submissionUploadErrorProvider");
  if (code === "grading_setup_required") return t("submissionUploadSetupRequired");
  if (["workflow_busy", "different_submission_running"].includes(code)) return t("submissionUploadBusy");
  if (["invalid_state", "stale_revision", "replacement_confirmation_required"].includes(code)) {
    return t("submissionUploadErrorConflict");
  }
  return t("submissionUploadErrorGeneric");
}
