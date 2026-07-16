import { ArrowLeft, FileText, LoaderCircle, Search } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { normalizeAPIError } from "@/api/client";
import {
  useExperts,
  useProblemSourceLibrary,
  useProblemSourcePreflight,
  useStartProblemExtraction,
  useTask,
} from "@/api/hooks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";
import { cn } from "@/lib/cn";
import type {
  ProblemLibraryMaterial,
  ProblemSourceMode,
  ProblemSourcePreflightResponse,
  ProblemSourceScope,
  ProblemStructureMode,
} from "@/types";

const ACCEPTED_PROBLEM_EXTENSIONS = [".pdf", ".txt", ".md"] as const;

export function AddProblemsPage() {
  const { taskId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const restoredDraft = getProblemSourceDraft(location.state, taskId);
  const taskQuery = useTask(taskId);
  const expertsQuery = useExperts();
  const preflightMutation = useProblemSourcePreflight();
  const extractionMutation = useStartProblemExtraction();

  const [sourceMode, setSourceMode] = useState<ProblemSourceMode>(() => restoredDraft?.sourceMode ?? "upload");
  const [selectedFile, setSelectedFile] = useState<File | null>(() => restoredDraft?.selectedFile ?? null);
  const [isDragging, setIsDragging] = useState(false);
  const [libraryScope, setLibraryScope] = useState<ProblemSourceScope>(() => restoredDraft?.libraryScope ?? "course");
  const [librarySearch, setLibrarySearch] = useState(() => restoredDraft?.librarySearch ?? "");
  const debouncedLibrarySearch = useDebouncedValue(librarySearch, 220);
  const [selectedMaterial, setSelectedMaterial] = useState<ProblemLibraryMaterial | null>(() => restoredDraft?.selectedMaterial ?? null);
  const [structureMode, setStructureMode] = useState<ProblemStructureMode>(() => restoredDraft?.structureMode ?? "organized");
  const [extractionHint, setExtractionHint] = useState(() => restoredDraft?.extractionHint ?? "");
  const [saveToLibrary, setSaveToLibrary] = useState(() => restoredDraft?.saveToLibrary ?? false);
  const [formError, setFormError] = useState<string | null>(null);
  const [preflightResult, setPreflightResult] = useState<ProblemSourcePreflightResponse | null>(null);
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [candidateReviewConfirmed, setCandidateReviewConfirmed] = useState(false);

  const task = taskQuery.data;
  const hasTaskCourse = Boolean(task?.course_id);
  const libraryQuery = useProblemSourceLibrary(
    taskId,
    libraryScope,
    debouncedLibrarySearch,
    sourceMode === "library" && taskQuery.isSuccess,
  );
  const enabledExperts = (expertsQuery.data ?? []).filter((expert) => expert.enabled);
  const isBusy = preflightMutation.isPending || extractionMutation.isPending;
  const isRecognitionRunning = task?.status === "extracting_problems";
  const hasExistingProblems = Boolean(task?.problem_file_name || task?.problem_count);
  const hasSource = sourceMode === "upload" ? Boolean(selectedFile) : Boolean(selectedMaterial);
  const needsConfirmation = Boolean(preflightResult?.requires_confirmation);

  const sourceSummary = sourceMode === "upload"
    ? selectedFile
      ? `${selectedFile.name} · ${formatFileSize(selectedFile.size)}`
      : t("addProblemsNoSourceSelected")
    : selectedMaterial
      ? `${selectedMaterial.filename} · ${formatFileSize(selectedMaterial.size_bytes)}`
      : t("addProblemsNoSourceSelected");

  const modelSummary = expertsQuery.isLoading
    ? t("addProblemsModelsLoading")
    : expertsQuery.isError
      ? t("addProblemsModelsUnavailable")
      : enabledExperts.length
        ? `${t("addProblemsModelsPrefix")}${enabledExperts.length}${t("addProblemsModelsSuffix")}${enabledExperts
          .slice(0, 2)
          .map((expert) => expert.display_name || expert.model)
          .join(t("addProblemsModelSeparator"))}${enabledExperts.length > 2 ? t("addProblemsModelsMore") : ""}`
        : t("addProblemsModelsMissing");

  const disabledReason = isRecognitionRunning
    ? null
    : taskQuery.isLoading
      ? t("addProblemsTaskLoading")
      : taskQuery.isError || !task
        ? t("addProblemsTaskUnavailable")
        : expertsQuery.isLoading
          ? t("addProblemsModelsLoading")
          : expertsQuery.isError
            ? t("addProblemsModelsUnavailable")
            : enabledExperts.length === 0
              ? t("addProblemsModelsRequired")
              : !hasSource
                ? t("addProblemsSourceRequired")
                : null;
  const actionDisabledReason = disabledReason
    ?? (needsConfirmation && !candidateReviewConfirmed
      ? t("addProblemsCandidateSelectionRequired")
      : null);
  const sourceIsOnlyDisabledReason = actionDisabledReason === t("addProblemsSourceRequired");
  const visibleDisabledReason = sourceIsOnlyDisabledReason ? null : actionDisabledReason;
  const byokReturnTo = taskId ? `/tasks/${taskId}/upload/problems` : "/tasks/new";
  const byokRouteState: ProblemSourceRouteState = {
    problemSourceDraft: {
      taskId: taskId ?? "",
      sourceMode,
      selectedFile,
      libraryScope,
      librarySearch,
      selectedMaterial,
      structureMode,
      extractionHint,
      saveToLibrary,
    },
  };

  function resetPreflight() {
    setPreflightResult(null);
    setSelectedCandidateIds([]);
    setCandidateReviewConfirmed(false);
    setFormError(null);
  }

  function changeSourceMode(nextMode: ProblemSourceMode) {
    if (isBusy) return;
    if (nextMode === sourceMode) return;
    setSourceMode(nextMode);
    resetPreflight();
  }

  function selectFile(file: File | undefined) {
    if (isBusy) return;
    if (!file) return;
    if (!isAcceptedProblemSource(file.name)) {
      setFormError(t("addProblemsUnsupportedFile"));
      return;
    }
    setSelectedFile(file);
    setSourceMode("upload");
    resetPreflight();
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (isBusy) return;
    setIsDragging(false);
    selectFile(event.dataTransfer.files?.[0]);
  }

  function selectStructure(nextMode: ProblemStructureMode) {
    if (isBusy) return;
    setStructureMode(nextMode);
    resetPreflight();
  }

  async function beginExtraction(result: ProblemSourcePreflightResponse) {
    if (!taskId) return;
    const response = await extractionMutation.mutateAsync({
      taskId,
      sourceToken: result.source_token,
      confirmedCandidateIds: selectedCandidateIds,
      replaceConfirmed: hasExistingProblems,
    });

    if (["already_running", "already_done"].includes(response.status)) {
      toast.info(t("addProblemsRecognitionExists"));
    } else {
      toast.success(t("addProblemsRecognitionStarted"));
    }
    navigate(`/tasks/${taskId}/problems/progress`);
  }

  async function handlePrimaryAction() {
    setFormError(null);
    if (!taskId) {
      setFormError(t("addProblemsTaskUnavailable"));
      return;
    }
    if (isRecognitionRunning) {
      navigate(`/tasks/${taskId}/problems/progress`);
      return;
    }
    if (actionDisabledReason) {
      setFormError(actionDisabledReason);
      return;
    }
    try {
      if (needsConfirmation && preflightResult) {
        await beginExtraction(preflightResult);
        return;
      }

      const result = await preflightMutation.mutateAsync({
        taskId,
        mode: sourceMode,
        file: selectedFile,
        libraryMaterialId: selectedMaterial?.material_id,
        structureMode,
        extractionHint,
        saveToLibrary: sourceMode === "upload" && saveToLibrary,
      });
      setPreflightResult(result);
      setCandidateReviewConfirmed(false);

      if (result.requires_confirmation) {
        toast.info(t("addProblemsCandidatesReady"));
        return;
      }
      await beginExtraction(result);
    } catch (error) {
      setFormError(localizeProblemSourceError(error, t));
    }
  }

  return (
    <div className="w-full max-w-[1300px]">
      <div className="flex min-h-9 items-center justify-between gap-4">
        <h1 className="shrink-0 text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
          {t("addProblemsTitle")}
        </h1>
        {task && taskId ? (
          <Link
            to={`/tasks/${taskId}/setup`}
            className="inline-flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
            title={`${t("addProblemsBackToTask")}${task.name}`}
          >
            <ArrowLeft aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="max-w-[520px] truncate">{t("addProblemsBackToTask")}{task.name}</span>
          </Link>
        ) : null}
      </div>
      <NewTaskStepper currentStep={0} />

      <div className="mx-auto mt-[45px] w-full max-w-[900px]">
        {sourceMode === "upload" ? (
          <UploadSourceWorkspace
            disabled={isBusy}
            file={selectedFile}
            inputRef={fileInputRef}
            isDragging={isDragging}
            onChoose={() => fileInputRef.current?.click()}
            onDragChange={setIsDragging}
            onDrop={handleDrop}
            onFileInput={handleFileInput}
            t={t}
          />
        ) : (
          <LibrarySourceWorkspace
            disabled={isBusy}
            hasTaskCourse={hasTaskCourse}
            isError={libraryQuery.isError}
            isFetching={libraryQuery.isFetching}
            materials={libraryQuery.data?.items ?? []}
            query={librarySearch}
            scope={libraryScope}
            selected={selectedMaterial}
            onQueryChange={setLibrarySearch}
            onRetry={() => void libraryQuery.refetch()}
            onScopeChange={(scope) => {
              setLibraryScope(scope);
              setSelectedMaterial(null);
              resetPreflight();
            }}
            onSelect={(material) => {
              setSelectedMaterial(material);
              resetPreflight();
            }}
            t={t}
          />
        )}

        <section className="mt-10 min-h-[120px] rounded-[10px] border bg-card px-[29px] pb-6 pt-[28px] sm:h-[120px]">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-[17px] font-bold leading-[22px] text-foreground">{t("addProblemsSourceTitle")}</h2>
            <p className="min-w-0 truncate text-[13px] leading-5 text-muted-foreground" title={sourceSummary}>
              {t("addProblemsSelectedPrefix")}{sourceSummary}
            </p>
          </div>
          <div className="mt-[19px] flex flex-wrap items-center gap-3 sm:gap-5">
            <SourceModeButton active={sourceMode === "upload"} disabled={isBusy} onClick={() => changeSourceMode("upload")}>
              {t("addProblemsUploadNew")}
            </SourceModeButton>
            <SourceModeButton active={sourceMode === "library"} disabled={isBusy} wide onClick={() => changeSourceMode("library")}>
              {t("addProblemsChooseLibrary")}
            </SourceModeButton>
            {sourceMode === "upload" ? (
              <label className="ml-0 inline-flex min-w-0 items-center gap-2 text-[13px] leading-5 text-muted-foreground sm:ml-auto">
                <input
                  type="checkbox"
                  checked={saveToLibrary}
                  disabled={isBusy}
                  onChange={(event) => {
                    setSaveToLibrary(event.target.checked);
                    resetPreflight();
                  }}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <span>{t("addProblemsSaveToLibrary")}</span>
              </label>
            ) : null}
          </div>
        </section>

        <section className="mt-[25px] overflow-hidden rounded-[10px] border bg-card">
          <div className="grid min-h-[86px] gap-3 px-[29px] pb-[15px] pt-[21px] sm:grid-cols-[190px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)]">
            <h2 className="pt-[5px] text-[16px] font-bold leading-[22px] text-foreground">{t("addProblemsStructureTitle")}</h2>
            <div className="min-w-0">
              <div className="flex flex-wrap gap-5">
                <StructureModeButton active={structureMode === "organized"} disabled={isBusy} onClick={() => selectStructure("organized")}>
                  {t("addProblemsOrganized")}
                </StructureModeButton>
                <StructureModeButton active={structureMode === "extract_from_source"} disabled={isBusy} onClick={() => selectStructure("extract_from_source")}>
                  {t("addProblemsExtractSource")}
                </StructureModeButton>
              </div>
              <p className="mt-1.5 break-words text-[12px] leading-4 text-muted-foreground sm:truncate" title={`${modelSummary} · ${t("addProblemsOcrUnavailable")}`}>
                {modelSummary} · {t("addProblemsOcrUnavailable")}{" "}
                {enabledExperts.length === 0 || expertsQuery.isError ? (
                  <Link
                    className="font-semibold text-primary underline-offset-2 hover:underline"
                    to={`/settings/byok?returnTo=${encodeURIComponent(byokReturnTo)}`}
                    state={byokRouteState}
                  >
                    {t("addProblemsOpenByok")}
                  </Link>
                ) : null}
              </p>
            </div>
          </div>

          {structureMode === "extract_from_source" ? (
            <div className="border-t px-[29px] pb-6 pt-4">
              <label htmlFor="problem-extraction-hint" className="text-[14px] font-semibold leading-5 text-foreground">
                {t("addProblemsExtractionHintLabel")}
              </label>
              <textarea
                id="problem-extraction-hint"
                value={extractionHint}
                maxLength={2000}
                disabled={isBusy}
                onChange={(event) => {
                  setExtractionHint(event.target.value);
                  resetPreflight();
                }}
                placeholder={t("addProblemsExtractionHintPlaceholder")}
                className="mt-2 min-h-[72px] w-full resize-y rounded-[8px] border bg-card px-3 py-2 text-[14px] leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{t("addProblemsExtractionHintHelp")}</p>
            </div>
          ) : null}

          {needsConfirmation && preflightResult ? (
            <CandidateSummaryPanel
              result={preflightResult}
              selectedCandidateIds={selectedCandidateIds}
              reviewConfirmed={candidateReviewConfirmed}
              disabled={isBusy}
              onReviewConfirmedChange={setCandidateReviewConfirmed}
              onToggleCandidate={(candidateId) => {
                setSelectedCandidateIds((current) => current.includes(candidateId)
                  ? current.filter((id) => id !== candidateId)
                  : [...current, candidateId]);
                setCandidateReviewConfirmed(false);
                setFormError(null);
              }}
              t={t}
            />
          ) : null}
        </section>

        <div className="mt-[27px] flex min-h-10 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-[13px] leading-5">
            {formError ? (
              <p id="add-problems-action-message" role="alert" className="text-danger">{formError}</p>
            ) : visibleDisabledReason ? (
              <p id="add-problems-action-message" className="text-muted-foreground">{visibleDisabledReason}</p>
            ) : hasExistingProblems ? (
              <p id="add-problems-action-message" className="text-muted-foreground">
                {t("addProblemsOverwriteWarning")}{" "}
                <Link to="/tasks/new" className="font-semibold text-primary underline-offset-2 hover:underline">
                  {t("addProblemsCreateSeparateTask")}
                </Link>
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="inline-flex h-10 w-full shrink-0 items-center justify-center rounded-[8px] bg-primary px-4 text-[15px] font-semibold leading-[19px] text-primary-foreground outline-none transition hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-[180px]"
            disabled={!isRecognitionRunning && Boolean(actionDisabledReason || isBusy)}
            aria-describedby={actionDisabledReason || hasExistingProblems ? "add-problems-action-message" : undefined}
            onClick={() => void handlePrimaryAction()}
          >
            {isBusy ? (
              <><LoaderCircle aria-hidden="true" className="mr-2 h-4 w-4 animate-spin" />{t("addProblemsChecking")}</>
            ) : isRecognitionRunning ? t("addProblemsViewProgress")
              : hasExistingProblems ? t("addProblemsOverwriteAndStart")
                : needsConfirmation ? t("addProblemsConfirmAndStart")
                : t("addProblemsStart")}
          </button>
          {sourceIsOnlyDisabledReason ? (
            <span id="add-problems-action-message" className="sr-only">{actionDisabledReason}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

interface TranslationProps {
  t: (key: MessageKey) => string;
}

function UploadSourceWorkspace({
  disabled,
  file,
  inputRef,
  isDragging,
  onChoose,
  onDragChange,
  onDrop,
  onFileInput,
  t,
}: TranslationProps & {
  disabled: boolean;
  file: File | null;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isDragging: boolean;
  onChoose: () => void;
  onDragChange: (dragging: boolean) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onFileInput: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div
      className={cn(
        "flex h-[250px] w-full flex-col items-center rounded-[10px] border bg-card text-center outline-none transition-colors",
        isDragging ? "border-primary bg-blue-50/50 dark:bg-blue-950/20" : "border-primary",
      )}
      onDragEnter={(event) => {
        event.preventDefault();
        if (!disabled) onDragChange(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!disabled && !event.currentTarget.contains(event.relatedTarget as Node | null)) onDragChange(false);
      }}
      onDrop={onDrop}
      aria-disabled={disabled}
    >
      <span aria-hidden="true" className="mt-[27px] h-14 w-14 shrink-0 rounded-full bg-[#DBE8FF]" />
      <p className="mt-4 max-w-[760px] truncate px-5 text-[18px] font-bold leading-[22px] text-foreground" title={file?.name}>
        {file?.name ?? t("addProblemsDropTitle")}
      </p>
      <p className="mt-[9px] text-[14px] leading-5 text-muted-foreground">
        {file ? `${formatFileSize(file.size)} · ${t("addProblemsLocalOnly")}` : t("addProblemsFormats")}
      </p>
      <button
        type="button"
        className="mt-[41px] h-10 w-[130px] rounded-[8px] border bg-card text-[15px] font-semibold leading-[18px] text-foreground outline-none transition hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onChoose}
        disabled={disabled}
      >
        {file ? t("addProblemsReplaceFile") : t("addProblemsChooseFile")}
      </button>
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-label={t("addProblemsChooseFile")}
        tabIndex={-1}
        disabled={disabled}
        accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
        onChange={onFileInput}
      />
    </div>
  );
}

function LibrarySourceWorkspace({
  disabled,
  hasTaskCourse,
  isError,
  isFetching,
  materials,
  query,
  scope,
  selected,
  onQueryChange,
  onRetry,
  onScopeChange,
  onSelect,
  t,
}: TranslationProps & {
  disabled: boolean;
  hasTaskCourse: boolean;
  isError: boolean;
  isFetching: boolean;
  materials: ProblemLibraryMaterial[];
  query: string;
  scope: ProblemSourceScope;
  selected: ProblemLibraryMaterial | null;
  onQueryChange: (query: string) => void;
  onRetry: () => void;
  onScopeChange: (scope: ProblemSourceScope) => void;
  onSelect: (material: ProblemLibraryMaterial) => void;
}) {
  return (
    <div className="min-h-[250px] w-full rounded-[10px] border border-primary bg-card px-5 py-5 sm:h-[250px] sm:px-[29px]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex shrink-0 gap-2">
          <SourceModeButton active={scope === "course"} disabled={disabled} onClick={() => onScopeChange("course")}>
            {hasTaskCourse ? t("addProblemsCurrentCourse") : t("addProblemsUncategorized")}
          </SourceModeButton>
          <SourceModeButton active={scope === "all"} disabled={disabled} onClick={() => onScopeChange("all")}>
            {t("addProblemsAllMine")}
          </SourceModeButton>
        </div>
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{t("addProblemsLibrarySearchLabel")}</span>
          <Search aria-hidden="true" className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            disabled={disabled}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("addProblemsLibrarySearchPlaceholder")}
            className="h-10 w-full rounded-[8px] border bg-card pl-9 pr-3 text-[14px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
      </div>

      <div className="mt-4 h-[146px] overflow-y-auto rounded-[8px] border" aria-busy={isFetching}>
        {isError ? (
          <div className="flex h-full items-center justify-center gap-3 text-[13px] text-danger">
            {t("addProblemsLibraryError")}
            <button type="button" onClick={onRetry} className="font-semibold text-primary hover:underline">{t("retry")}</button>
          </div>
        ) : isFetching && materials.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-[13px] text-muted-foreground">
            <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" />{t("loading")}
          </div>
        ) : materials.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[13px] text-muted-foreground">{t("addProblemsLibraryEmpty")}</div>
        ) : (
          <ul className="divide-y">
            {materials.map((material) => {
              const supported = isAcceptedProblemSource(material.filename);
              const active = selected?.material_id === material.material_id;
              return (
                <li key={material.material_id}>
                  <button
                    type="button"
                    disabled={disabled || !supported}
                    aria-pressed={active}
                    onClick={() => onSelect(material)}
                    className={cn(
                      "flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left outline-none transition hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
                      active && "bg-blue-50 dark:bg-blue-950/30",
                    )}
                  >
                    <FileText aria-hidden="true" className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{material.filename}</span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      {supported ? formatFileSize(material.size_bytes) : t("addProblemsUnsupportedShort")}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function SourceModeButton({
  active,
  children,
  disabled = false,
  onClick,
  wide = false,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  wide?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-7 shrink-0 rounded-full px-4 text-[13px] font-semibold leading-4 outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        wide ? "min-w-[150px]" : "min-w-[110px]",
        active ? "bg-[#DBE8FF] text-primary" : "bg-[#F8FAFC] text-muted-foreground hover:text-foreground dark:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function StructureModeButton({ active, children, disabled = false, onClick }: { active: boolean; children: React.ReactNode; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-7 w-[130px] rounded-full text-[13px] font-semibold leading-4 outline-none transition focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        active ? "bg-[#DBE8FF] text-primary" : "bg-[#F8FAFC] text-muted-foreground hover:text-foreground dark:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

function CandidateSummaryPanel({
  result,
  selectedCandidateIds,
  reviewConfirmed,
  disabled,
  onReviewConfirmedChange,
  onToggleCandidate,
  t,
}: TranslationProps & {
  result: ProblemSourcePreflightResponse;
  selectedCandidateIds: string[];
  reviewConfirmed: boolean;
  disabled: boolean;
  onReviewConfirmedChange: (confirmed: boolean) => void;
  onToggleCandidate: (candidateId: string) => void;
}) {
  const summary = result.candidate_summary;
  const candidates = [...summary.matched, ...summary.possible_matches];
  return (
    <div className="border-t px-[29px] py-4">
      <p className="text-[14px] font-semibold leading-5 text-foreground">{t("addProblemsCandidateSummaryTitle")}</p>
      <p className="mt-1 text-[13px] leading-5 text-muted-foreground">
        {t("addProblemsMatched")}{summary.matched.length} · {t("addProblemsPossible")}{summary.possible_matches.length} · {t("addProblemsNotFound")}{summary.not_found.length}
      </p>
      {candidates.length ? (
        <ul className="mt-2 grid max-h-48 gap-2 overflow-y-auto pr-1 text-[13px] leading-5 text-foreground sm:grid-cols-2">
          {candidates.map((candidate) => (
            <li key={candidate.candidate_id}>
              <label className="flex min-w-0 cursor-pointer items-start gap-2 rounded-[8px] border px-3 py-2 hover:border-primary/50">
                <input
                  type="checkbox"
                  checked={selectedCandidateIds.includes(candidate.candidate_id)}
                  disabled={disabled}
                  onChange={() => onToggleCandidate(candidate.candidate_id)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
                />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {candidate.question_number || candidate.candidate_id}
                    <span className="ml-2 font-normal text-muted-foreground">
                      {candidate.match_kind === "matched" ? t("addProblemsCandidateMatched") : t("addProblemsCandidatePossible")}
                    </span>
                  </span>
                  <span className="block truncate text-muted-foreground">{candidate.preview || candidate.reason || t("addProblemsCandidateNoPreview")}</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {summary.not_found.length ? (
        <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
          {t("addProblemsNotFoundNumbers")}{summary.not_found.join(t("addProblemsModelSeparator"))}
        </p>
      ) : null}
      <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
        {summary.semantic_match_performed ? t("addProblemsSemanticPerformed") : t("addProblemsSemanticNotPerformed")}
      </p>
      <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-[8px] bg-muted/40 px-3 py-2 text-[13px] leading-5 text-foreground">
        <input
          type="checkbox"
          checked={reviewConfirmed}
          disabled={disabled}
          onChange={(event) => onReviewConfirmedChange(event.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-primary"
        />
        <span>{t("addProblemsCandidateReviewConfirmed")}</span>
      </label>
    </div>
  );
}

function isAcceptedProblemSource(filename: string) {
  const lower = filename.trim().toLowerCase();
  return ACCEPTED_PROBLEM_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function formatFileSize(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function useDebouncedValue(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timeout);
  }, [delay, value]);

  return debounced;
}

interface ProblemSourceDraft {
  taskId: string;
  sourceMode: ProblemSourceMode;
  selectedFile: File | null;
  libraryScope: ProblemSourceScope;
  librarySearch: string;
  selectedMaterial: ProblemLibraryMaterial | null;
  structureMode: ProblemStructureMode;
  extractionHint: string;
  saveToLibrary: boolean;
}

interface ProblemSourceRouteState {
  problemSourceDraft: ProblemSourceDraft;
}

function getProblemSourceDraft(state: unknown, taskId: string | undefined): ProblemSourceDraft | null {
  if (!state || typeof state !== "object" || !("problemSourceDraft" in state)) return null;
  const draft = (state as { problemSourceDraft?: ProblemSourceDraft }).problemSourceDraft;
  return draft?.taskId === taskId ? (draft ?? null) : null;
}

const PROBLEM_SOURCE_ERROR_KEYS: Record<string, MessageKey> = {
  problem_source_decode_failed: "addProblemsErrorInvalidSource",
  problem_source_character_limit_exceeded: "addProblemsErrorTextTooLong",
  problem_source_token_limit_exceeded: "addProblemsErrorTextTooLong",
  pdf_extraction_timeout: "addProblemsErrorPdfTimeout",
  pdf_extraction_busy: "addProblemsErrorPdfBusy",
  pdf_page_limit_exceeded: "addProblemsErrorPdfTooManyPages",
  pdf_character_limit_exceeded: "addProblemsErrorTextTooLong",
  pdf_extraction_failed: "addProblemsErrorInvalidSource",
  course_material_too_large: "addProblemsErrorSourceTooLarge",
  course_material_owner_count_limit: "addProblemsErrorStorageLimit",
  course_material_global_count_limit: "addProblemsErrorStorageLimit",
  course_material_owner_bytes_limit: "addProblemsErrorStorageLimit",
  course_material_global_bytes_limit: "addProblemsErrorStorageLimit",
  problem_source_draft_too_large: "addProblemsErrorSourceTooLarge",
  problem_source_draft_owner_count_limit: "addProblemsErrorDraftLimit",
  problem_source_draft_global_count_limit: "addProblemsErrorDraftLimit",
  problem_source_draft_owner_bytes_limit: "addProblemsErrorStorageLimit",
  problem_source_draft_global_bytes_limit: "addProblemsErrorStorageLimit",
  problem_source_material_changed: "addProblemsErrorSourceChanged",
  problem_source_text_unavailable: "addProblemsErrorSourceExpired",
  candidate_confirmation_required: "addProblemsCandidateSelectionRequired",
  unknown_candidate_ids: "addProblemsErrorCandidatesChanged",
  stale_problem_source: "addProblemsErrorStale",
  task_workflow_busy: "addProblemsErrorBusy",
  different_problem_source_running: "addProblemsErrorDifferentRunning",
  problem_replacement_confirmation_required: "addProblemsErrorReplacementRequired",
};

function localizeProblemSourceError(
  error: unknown,
  t: (key: MessageKey) => string,
): string {
  const normalized = normalizeAPIError(error);
  const code = getProblemSourceErrorCode(normalized.payload?.detail);
  const mappedKey = code ? PROBLEM_SOURCE_ERROR_KEYS[code] : undefined;
  if (mappedKey) return t(mappedKey);

  switch (normalized.status) {
    case 0:
      return t("addProblemsErrorNetwork");
    case 400:
      return t("addProblemsErrorInvalidSource");
    case 404:
      return t("addProblemsErrorSourceExpired");
    case 408:
      return t("addProblemsErrorPdfTimeout");
    case 409:
      return t("addProblemsErrorConflict");
    case 413:
      return t("addProblemsErrorSourceTooLarge");
    case 422:
      return t("addProblemsErrorCandidatesChanged");
    case 429:
      return t("addProblemsErrorStorageLimit");
    case 503:
      return t("addProblemsErrorModelUnavailable");
    default:
      return t("addProblemsErrorGeneric");
  }
}

function getProblemSourceErrorCode(detail: unknown): string | null {
  if (!detail || typeof detail !== "object" || !("code" in detail)) return null;
  const code = (detail as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}
