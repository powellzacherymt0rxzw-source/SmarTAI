import {
  ArrowLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FilePlus2,
  LoaderCircle,
  Search,
  Settings2,
  Trash2,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { normalizeAPIError } from "@/api/client";
import {
  useCourseMaterials,
  useDeleteKBDoc,
  useGradingSetup,
  useKBDocs,
  useSaveGradingSetup,
  useUploadKBDoc,
} from "@/api/hooks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import { UnsavedChangesDialog } from "@/components/ui/UnsavedChangesDialog";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/messages";
import { cn } from "@/lib/cn";
import { gradingSetupText, type GradingSetupCopyKey } from "@/lib/gradingSetupCopy";
import { getSafeTaskReturnTo, getTaskGradingSetupHref } from "@/lib/taskFlow";
import type {
  GradingAggregationMethod,
  GradingFeedbackLanguage,
  GradingFeedbackLength,
  GradingFeedbackTone,
  GradingKnowledgeScope,
  GradingSetup,
  GradingSetupExpert,
} from "@/types";

const SAMPLE_OPTIONS = [1, 2, 3, 4, 5] as const;
const MAX_NOTES_LENGTH = 500;
const NON_BLOCKING_SETUP_ISSUES = new Set(["grading_setup_required"]);

type GradingSetupPageProps = {
  embedded?: boolean;
  submitLabel?: string;
  onBack?: () => void;
  onSaved?: () => void | Promise<void>;
};

export function GradingSetupPage({
  embedded = false,
  submitLabel,
  onBack,
  onSaved,
}: GradingSetupPageProps = {}) {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { locale } = useI18n();
  const setupQuery = useGradingSetup(taskId);
  const saveSetup = useSaveGradingSetup();
  const appliedServerKeyRef = useRef<string | null>(null);
  const conflictServerKeyRef = useRef<string | null>(null);
  const initialSetupRef = useRef<string | null>(null);
  const allowLeaveRef = useRef(false);
  const preserveSyncNoticeRef = useRef(false);
  const [setup, setSetup] = useState<GradingSetup | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [syncNoticeKey, setSyncNoticeKey] = useState<GradingSetupCopyKey | null>(null);
  const [selectionNoticeKey, setSelectionNoticeKey] = useState<GradingSetupCopyKey | null>(null);

  const response = setupQuery.data;
  const returnTo = taskId && !embedded
    ? getSafeTaskReturnTo(taskId, searchParams.get("returnTo"))
    : null;
  const setupHref = taskId ? getTaskGradingSetupHref(taskId, returnTo ?? undefined) : null;
  const backHref = taskId ? returnTo ?? `/tasks/${taskId}/questions` : "/";
  const byokReturnHref = taskId && embedded
    ? `/tasks/${taskId}/submissions/upload?phase=settings`
    : setupHref;
  const serverSetup = response?.grading_setup ?? response?.suggested_setup ?? null;
  const serverKey = response
    ? `${response.workflow_revision}:${response.grading_setup_fingerprint ?? "suggested"}:${response.available_experts.map((expert) => `${expert.provider_id}:${expert.enabled}:${expert.is_shared}`).sort().join("|")}`
    : null;

  const serializedSetup = setup ? serializeSetup(setup) : null;
  const isDirty = serializedSetup !== null
    && initialSetupRef.current !== null
    && serializedSetup !== initialSetupRef.current;

  useEffect(() => {
    if (!response || !serverKey || appliedServerKeyRef.current === serverKey) return;

    if (appliedServerKeyRef.current !== null && isDirty) {
      if (conflictServerKeyRef.current !== serverKey) {
        conflictServerKeyRef.current = serverKey;
        setSyncNoticeKey((current) => current ?? "serverChangedWhileEditing");
      }
      return;
    }

    appliedServerKeyRef.current = serverKey;
    conflictServerKeyRef.current = null;
    const preserveSyncNotice = preserveSyncNoticeRef.current;
    preserveSyncNoticeRef.current = false;
    const nextSetup = serverSetup ? cloneSetup(serverSetup) : null;
    setSetup(nextSetup);
    initialSetupRef.current = nextSetup ? serializeSetup(nextSetup) : null;
    setActionError(null);
    if (!preserveSyncNotice) setSyncNoticeKey(null);
    setSelectionNoticeKey(null);
  }, [isDirty, response, serverKey, serverSetup]);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    isDirty
    && !allowLeaveRef.current
    && (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search)
  ));
  useBeforeUnload(useCallback((event) => {
    if (!isDirty || allowLeaveRef.current) return;
    event.preventDefault();
  }, [isDirty]));

  const expertsById = useMemo(
    () => new Map((response?.available_experts ?? []).map((expert) => [expert.provider_id, expert])),
    [response?.available_experts],
  );
  const selectedExperts = useMemo(
    () => (setup?.selected_provider_ids ?? []).flatMap((providerId) => {
      const expert = expertsById.get(providerId);
      return expert ? [expert] : [];
    }),
    [expertsById, setup?.selected_provider_ids],
  );
  const usesSharedPool = selectedExperts.some((expert) => expert.is_shared);
  const validationMessage = setup && response
    ? validateSetup(setup, response.available_experts, response.knowledge.scope_options, locale)
    : gradingSetupText(locale, "invalidForm");
  const blockingIssue = response?.readiness.blocking_issues.find(
    (issue) => !NON_BLOCKING_SETUP_ISSUES.has(issue),
  );
  const blockingMessage = blockingIssue
    ? readinessMessage(blockingIssue, locale)
    : null;
  const isReadOnly = blockingIssue === "workflow_busy"
    || blockingIssue === "grading_setup_locked"
    || blockingIssue === "invalid_state";
  const actionDisabled = !taskId
    || !setup
    || Boolean(validationMessage)
    || Boolean(blockingMessage)
    || saveSetup.isPending;

  function updateSetup(updater: (current: GradingSetup) => GradingSetup) {
    setActionError(null);
    setSetup((current) => current ? updater(current) : current);
  }

  function toggleProvider(expert: GradingSetupExpert, checked: boolean) {
    const selectedHasInvalidProvider = (setup?.selected_provider_ids ?? []).some((providerId) => {
      const selectedExpert = expertsById.get(providerId);
      return !selectedExpert?.enabled;
    });
    if (checked && selectedHasInvalidProvider) {
      setSelectionNoticeKey("invalidModelsRemoved");
    }

    updateSetup((current) => {
      const selected = current.selected_provider_ids;
      let nextIds: string[];
      if (!checked) {
        nextIds = selected.filter((providerId) => providerId !== expert.provider_id);
      } else if (expert.is_shared) {
        nextIds = [expert.provider_id];
      } else {
        nextIds = [
          ...selected.filter((providerId) => {
            const candidate = expertsById.get(providerId);
            return candidate?.enabled && !candidate.is_shared;
          }),
          expert.provider_id,
        ];
        nextIds = [...new Set(nextIds)];
      }
      return applyProviderSelection(current, nextIds, expertsById);
    });
  }

  function removeMissingProvider(providerId: string) {
    setSelectionNoticeKey("invalidModelRemoved");
    updateSetup((current) => applyProviderSelection(
      current,
      current.selected_provider_ids.filter((selectedId) => selectedId !== providerId),
      expertsById,
    ));
  }

  async function handleSubmit() {
    if (!taskId || !response || !setup || validationMessage || blockingMessage) {
      setActionError(validationMessage ?? blockingMessage ?? gradingSetupText(locale, "invalidForm"));
      return;
    }

    setActionError(null);
    try {
      await saveSetup.mutateAsync({
        taskId,
        expectedWorkflowRevision: response.workflow_revision,
        gradingSetup: setup,
      });
      initialSetupRef.current = serializeSetup(setup);
      allowLeaveRef.current = true;
      if (onSaved) {
        await onSaved();
        return;
      }
      navigate(returnTo ?? `/tasks/${taskId}/submissions/upload`);
    } catch (error) {
      const normalized = normalizeAPIError(error);
      const code = apiErrorCode(normalized);
      if (code === "stale_revision") {
        preserveSyncNoticeRef.current = true;
        setSyncNoticeKey("staleReloaded");
        await setupQuery.refetch();
        setActionError(null);
        setSyncNoticeKey("staleReloaded");
        return;
      }
      if (["provider_not_enabled", "primary_provider_not_selected", "invalid_provider_count"].includes(code)) {
        await setupQuery.refetch();
      }
      setActionError(localizeSaveError(normalized, locale));
    }
  }

  return (
    <div className={embedded ? "min-w-0 w-full" : "min-w-0 w-full max-w-[1300px]"}>
      {!embedded ? (
        <>
          <h1 className="min-h-9 break-words text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
            {gradingSetupText(locale, "title")}
          </h1>
          <NewTaskStepper currentStep={3} />
        </>
      ) : null}

      <section className={cn(
        "w-full rounded-[10px] border bg-card px-5 pb-4 pt-5 sm:px-8 sm:pb-5 sm:pt-5",
        embedded ? "mt-4" : "mx-auto mt-[35px] max-w-[980px] sm:min-h-[540px]",
      )}>
        {!taskId ? (
          <CenteredState
            title={gradingSetupText(locale, "taskMissingTitle")}
            description={gradingSetupText(locale, "taskMissingDescription")}
            action={<Link className="font-semibold text-primary hover:underline" to="/">{gradingSetupText(locale, "backToQuestions")}</Link>}
          />
        ) : setupQuery.isLoading ? (
          <div className="flex min-h-[450px] items-center justify-center" aria-busy="true" aria-label={gradingSetupText(locale, "loading")}>
            <LoaderCircle aria-hidden="true" className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : setupQuery.isError ? (
          <CenteredState
            title={gradingSetupText(locale, "loadErrorTitle")}
            description={gradingSetupText(locale, "loadErrorDescription")}
            action={<button type="button" onClick={() => void setupQuery.refetch()} className="h-9 rounded-[7px] border bg-card px-4 text-sm font-semibold hover:bg-muted">{gradingSetupText(locale, "retry")}</button>}
          />
        ) : response && !setup ? (
          <ModelRequiredState
            locale={locale}
            taskId={taskId}
            embedded={embedded}
            setupHref={setupHref ?? `/tasks/${taskId}/grading-setup`}
            backHref={backHref}
            hasReturnTo={Boolean(returnTo)}
          />
        ) : response && setup ? (
          <form className="flex h-full min-h-0 flex-col" onSubmit={(event) => { event.preventDefault(); void handleSubmit(); }}>
            <fieldset
              disabled={isReadOnly || saveSetup.isPending}
              className={cn("min-h-0 min-w-0 flex-1 border-0 p-0", isReadOnly && "opacity-70")}
            >
              <div className="min-h-0">
                <ModelSection
                  locale={locale}
                  experts={response.available_experts}
                  setup={setup}
                  onToggleProvider={toggleProvider}
                  onRemoveMissingProvider={removeMissingProvider}
                  onPrimaryChange={(providerId) => updateSetup((current) => ({ ...current, primary_provider_id: providerId }))}
                  onAggregationChange={(aggregationMethod) => updateSetup((current) => ({ ...current, aggregation_method: aggregationMethod, multi_sample_n: 1 }))}
                />

                <div className="my-2 h-px bg-border" />

                <KnowledgeSection
                  locale={locale}
                  taskId={taskId}
                  value={setup.knowledge_scope}
                  onChange={(knowledgeScope) => updateSetup((current) => ({ ...current, knowledge_scope: knowledgeScope }))}
                />

                <div className="my-2 h-px bg-border" />

                <StrategySection
                  locale={locale}
                  setup={setup}
                  advancedOpen={advancedOpen}
                  usesSharedPool={usesSharedPool}
                  onAdvancedToggle={() => setAdvancedOpen((current) => !current)}
                  onChange={updateSetup}
                />
              </div>
            </fieldset>

            <div className="shrink-0 space-y-1.5" aria-live="polite">
              {syncNoticeKey ? <p className="mt-2 rounded-[6px] bg-amber-50 px-3 py-1.5 text-[11px] leading-4 text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">{gradingSetupText(locale, syncNoticeKey)}</p> : null}
              {selectionNoticeKey ? <p className="mt-2 rounded-[6px] bg-blue-50 px-3 py-1.5 text-[11px] leading-4 text-primary dark:bg-blue-950/20">{gradingSetupText(locale, selectionNoticeKey)}</p> : null}
              {validationMessage ? <p role="alert" className="mt-2 text-[11px] leading-4 text-danger">{validationMessage}</p> : null}
              {blockingMessage && blockingMessage !== validationMessage ? (
                <div role="alert" className="mt-2 flex items-center justify-between gap-3 text-[11px] leading-4 text-danger">
                  <span>{blockingMessage}</span>
                  {blockingIssue === "provider_required" ? (
                    <Link to={`/settings/byok?returnTo=${encodeURIComponent(byokReturnHref ?? `/tasks/${taskId}/grading-setup`)}`} className="inline-flex h-7 shrink-0 items-center rounded-[6px] bg-primary px-2.5 font-semibold text-primary-foreground hover:opacity-90">
                      {gradingSetupText(locale, "configureModels")}
                    </Link>
                  ) : isReadOnly ? (
                    <button type="button" disabled={setupQuery.isFetching} onClick={() => void setupQuery.refetch()} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] border bg-card px-2.5 font-semibold text-foreground hover:bg-muted disabled:opacity-50">
                      {setupQuery.isFetching ? <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : null}
                      {gradingSetupText(locale, "refreshStatus")}
                    </button>
                  ) : null}
                </div>
              ) : null}
              {actionError && actionError !== validationMessage && actionError !== blockingMessage ? <p role="alert" className="mt-2 text-[11px] leading-4 text-danger">{actionError}</p> : null}
            </div>

            <footer className="mt-3 flex shrink-0 flex-col-reverse gap-3 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
              {onBack ? (
                <button
                  type="button"
                  onClick={() => {
                    if (!isDirty || window.confirm(gradingSetupText(locale, "leaveDescription"))) {
                      allowLeaveRef.current = true;
                      onBack();
                    }
                  }}
                  className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border bg-card px-4 text-sm font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:w-auto"
                >
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  {gradingSetupText(locale, "backToUpload")}
                </button>
              ) : (
                <Link to={backHref} className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border bg-card px-4 text-sm font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:w-auto">
                  <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                  {gradingSetupText(locale, returnTo ? "backToPrevious" : "backToQuestions")}
                </Link>
              )}
              <button type="submit" disabled={actionDisabled} className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-[270px]">
                {saveSetup.isPending ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                {saveSetup.isPending ? gradingSetupText(locale, "saving") : submitLabel ?? gradingSetupText(locale, "saveAndContinue")}
                {!saveSetup.isPending ? <ChevronRight aria-hidden="true" className="h-4 w-4" /> : null}
              </button>
            </footer>
          </form>
        ) : null}
      </section>

      {blocker.state === "blocked" ? (
        <UnsavedChangesDialog
          title={gradingSetupText(locale, "leaveTitle")}
          description={gradingSetupText(locale, "leaveDescription")}
          stayLabel={gradingSetupText(locale, "stay")}
          leaveLabel={gradingSetupText(locale, "leave")}
          onStay={() => blocker.reset()}
          onLeave={() => blocker.proceed()}
        />
      ) : null}
    </div>
  );
}

function ModelSection({
  locale,
  experts,
  setup,
  onToggleProvider,
  onRemoveMissingProvider,
  onPrimaryChange,
  onAggregationChange,
}: {
  locale: Locale;
  experts: GradingSetupExpert[];
  setup: GradingSetup;
  onToggleProvider: (expert: GradingSetupExpert, checked: boolean) => void;
  onRemoveMissingProvider: (providerId: string) => void;
  onPrimaryChange: (providerId: string) => void;
  onAggregationChange: (method: GradingAggregationMethod) => void;
}) {
  const selectedSet = new Set(setup.selected_provider_ids);
  const knownProviderIds = new Set(experts.map((expert) => expert.provider_id));
  const missingProviderIds = setup.selected_provider_ids.filter((providerId) => !knownProviderIds.has(providerId));
  const hasMultiple = setup.selected_provider_ids.length > 1;

  return (
    <fieldset>
      <legend className="text-[17px] font-bold leading-6 text-foreground">{gradingSetupText(locale, "modelsTitle")}</legend>
      <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{gradingSetupText(locale, "modelsDescription")}</p>
      <div className="mt-2 max-h-[96px] overflow-y-auto overscroll-contain rounded-[8px] border">
        <ul className="divide-y">
          {experts.map((expert) => {
            const selected = selectedSet.has(expert.provider_id);
            const disabled = !expert.enabled && !selected;
            const label = expert.display_name?.trim() || expert.model;
            return (
              <li key={expert.provider_id} className={cn(
                "flex min-h-[46px] items-center gap-3 px-3 py-1.5",
                selected && !expert.enabled && "bg-red-50/70 dark:bg-red-950/15",
              )}>
                <input
                  id={`grading-expert-${expert.provider_id}`}
                  type="checkbox"
                  checked={selected}
                  disabled={disabled}
                  onChange={(event) => onToggleProvider(expert, event.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-border accent-primary disabled:opacity-45"
                />
                <label htmlFor={`grading-expert-${expert.provider_id}`} className={cn("min-w-0 flex-1 cursor-pointer", disabled && "cursor-not-allowed opacity-55")}>
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-foreground" title={label}>{label}</span>
                    {expert.is_shared ? <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-primary dark:bg-blue-950/30">{gradingSetupText(locale, "sharedModel")}</span> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{expert.provider_type} · {expert.model} · {gradingSetupText(locale, expert.enabled ? "enabledConfiguration" : "disabledConfiguration")}</span>
                </label>
                {hasMultiple && selected && expert.enabled ? (
                  <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                    <input type="radio" name="primary-grading-model" checked={setup.primary_provider_id === expert.provider_id} onChange={() => onPrimaryChange(expert.provider_id)} className="h-3.5 w-3.5 accent-primary" />
                    {gradingSetupText(locale, "primaryModel")}
                  </label>
                ) : null}
              </li>
            );
          })}
          {missingProviderIds.map((providerId, index) => (
            <li key={providerId} className="flex min-h-[46px] items-center gap-3 bg-red-50/70 px-3 py-1.5 dark:bg-red-950/15">
              <input
                id={`missing-grading-expert-${index}`}
                type="checkbox"
                checked
                onChange={() => onRemoveMissingProvider(providerId)}
                className="h-4 w-4 shrink-0 rounded border-border accent-primary"
              />
              <label htmlFor={`missing-grading-expert-${index}`} className="min-w-0 flex-1 cursor-pointer">
                <span className="block truncate text-[12px] font-semibold text-danger">{gradingSetupText(locale, "invalidModelTitle")}</span>
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={providerId}>{gradingSetupText(locale, "invalidModelDescription")} · {providerId}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{gradingSetupText(locale, "providerStatusNote")}</p>

      {hasMultiple ? (
        <div className="mt-2">
          <p className="text-[12px] font-semibold text-foreground">{gradingSetupText(locale, "aggregationTitle")}</p>
          <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
            <ChoiceButton
              active={setup.aggregation_method === "weighted_average"}
              title={gradingSetupText(locale, "weightedMethod")}
              description={gradingSetupText(locale, "weightedDescription")}
              onClick={() => onAggregationChange("weighted_average")}
            />
            <ChoiceButton
              active={setup.aggregation_method === "judge_agent"}
              title={gradingSetupText(locale, "judgeMethod")}
              description={gradingSetupText(locale, "judgeDescription")}
              badge={gradingSetupText(locale, "extraCall")}
              badgeTone="warning"
              onClick={() => onAggregationChange("judge_agent")}
            />
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex items-center justify-between rounded-[7px] border px-3 py-1.5">
          <span className="text-[12px] font-semibold text-foreground">{gradingSetupText(locale, "singleMethod")}</span>
          <span className="text-[11px] text-muted-foreground">{gradingSetupText(locale, "singleMethodDescription")}</span>
        </div>
      )}
    </fieldset>
  );
}

function KnowledgeSection({ locale, taskId, value, onChange }: {
  locale: Locale;
  taskId: string;
  value: GradingKnowledgeScope;
  onChange: (scope: GradingKnowledgeScope) => void;
}) {
  const docsQuery = useKBDocs(taskId);
  const uploadDocument = useUploadKBDoc();
  const deleteDocument = useDeleteKBDoc();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [libraryQueryText, setLibraryQueryText] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [saveToLibrary, setSaveToLibrary] = useState(false);
  const [knowledgeError, setKnowledgeError] = useState<string | null>(null);
  const libraryQuery = useCourseMaterials({
    q: libraryQueryText,
    page: 1,
    page_size: 8,
  });
  const docs = docsQuery.data?.docs ?? [];
  const attachedMaterialIds = new Set(
    docs.flatMap((doc) => doc.library_material_id ? [doc.library_material_id] : []),
  );
  const eligibleMaterials = (libraryQuery.data?.items ?? []).filter(
    (material) => material.category === "textbook"
      || material.category === "lecture"
      || material.category === "other",
  );
  const isBusy = uploadDocument.isPending || deleteDocument.isPending;
  const atLimit = docs.length >= 3;

  useEffect(() => {
    if (!docsQuery.isSuccess) return;
    const expectedScope: GradingKnowledgeScope = docs.length > 0 ? "all_task_docs" : "none";
    if (value !== expectedScope) onChange(expectedScope);
  }, [docs.length, docsQuery.isSuccess, value]);

  async function attachLibraryMaterial(materialId: string) {
    setKnowledgeError(null);
    try {
      await uploadDocument.mutateAsync({ taskId, libraryMaterialId: materialId });
      onChange("all_task_docs");
      setLibraryOpen(false);
      setLibraryQueryText("");
    } catch (error) {
      setKnowledgeError(normalizeAPIError(error).message);
    }
  }

  async function uploadLocalMaterial(file: File) {
    setKnowledgeError(null);
    try {
      await uploadDocument.mutateAsync({ taskId, file, saveToLibrary });
      onChange("all_task_docs");
    } catch (error) {
      setKnowledgeError(normalizeAPIError(error).message);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function removeDocument(docId: string) {
    setKnowledgeError(null);
    try {
      await deleteDocument.mutateAsync({ taskId, docId });
      if (docs.length <= 1) onChange("none");
    } catch (error) {
      setKnowledgeError(normalizeAPIError(error).message);
    }
  }

  return (
    <section aria-labelledby="grading-knowledge-title">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h2 id="grading-knowledge-title" className="text-[17px] font-bold leading-6 text-foreground">
            {locale === "zh-CN" ? "补充任务资料" : "Supplemental task materials"}
          </h2>
          <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
            {locale === "zh-CN"
              ? "可选教材、讲义或背景资料作为批改上下文；不会替代已审核的题目、标答和评分标准。"
              : "Optionally add textbooks, lecture notes, or context. These do not replace reviewed questions, answers, or rubrics."}
          </p>
        </div>
        <Link
          to="/knowledge-base"
          className="inline-flex shrink-0 items-center gap-1 self-start text-[12px] font-semibold text-primary outline-none hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
        >
          {locale === "zh-CN" ? "前往课程资料库" : "Open course library"}
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="relative mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <label className="relative min-w-0">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={libraryQueryText}
            onFocus={() => setLibraryOpen(true)}
            onBlur={() => window.setTimeout(() => setLibraryOpen(false), 150)}
            onChange={(event) => {
              setLibraryQueryText(event.target.value);
              setLibraryOpen(true);
            }}
            placeholder={locale === "zh-CN" ? "搜索资料库中的教材、讲义或背景资料" : "Search textbooks, lecture notes, or context"}
            className="h-10 w-full rounded-[8px] border bg-background pl-9 pr-3 text-[12px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>
        <button
          type="button"
          disabled={atLimit || isBusy}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[8px] border bg-card px-3 text-[12px] font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          title={atLimit ? (locale === "zh-CN" ? "本任务最多选择 3 份资料" : "Up to 3 task documents") : undefined}
        >
          <Upload aria-hidden="true" className="h-4 w-4" />
          {locale === "zh-CN" ? "上传资料" : "Upload"}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.txt,.md,.markdown,.rst"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadLocalMaterial(file);
          }}
        />

        {libraryOpen ? (
          <div className="absolute left-0 right-0 top-11 z-20 max-h-56 overflow-y-auto rounded-[8px] border bg-card p-1.5 shadow-lg sm:right-[104px]">
            {libraryQuery.isLoading ? (
              <div className="flex min-h-20 items-center justify-center"><LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin text-primary" /></div>
            ) : eligibleMaterials.length > 0 ? (
              <ul className="divide-y">
                {eligibleMaterials.map((material) => {
                  const attached = attachedMaterialIds.has(material.material_id);
                  return (
                    <li key={material.material_id} className="flex min-h-12 items-center gap-3 px-2 py-2">
                      <BookOpen aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-semibold text-foreground">{material.filename}</span>
                        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                          {material.course_name || (locale === "zh-CN" ? "未归属课程" : "No course")} · {material.category}
                        </span>
                      </span>
                      <button
                        type="button"
                        disabled={attached || atLimit || isBusy}
                        onClick={() => void attachLibraryMaterial(material.material_id)}
                        className="h-8 shrink-0 rounded-[7px] border bg-card px-3 text-[11px] font-semibold text-primary hover:bg-muted disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-60"
                      >
                        {attached ? (locale === "zh-CN" ? "已选择" : "Selected") : (locale === "zh-CN" ? "选择" : "Select")}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="flex min-h-20 flex-col items-center justify-center px-4 text-center">
                <p className="text-[12px] font-semibold text-foreground">{locale === "zh-CN" ? "没有匹配的资料" : "No matching materials"}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{locale === "zh-CN" ? "可换个关键词，或直接上传一份新资料。" : "Try another query or upload a new file."}</p>
              </div>
            )}
          </div>
        ) : null}
      </div>

      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <label className="inline-flex cursor-pointer items-center gap-2 text-[11px] font-medium text-foreground">
          <input type="checkbox" checked={saveToLibrary} onChange={(event) => setSaveToLibrary(event.target.checked)} className="h-4 w-4 rounded border-border accent-primary" />
          {locale === "zh-CN" ? "上传时同时加入课程资料库" : "Also add uploads to course library"}
        </label>
        <span className="text-[11px] text-muted-foreground">
          {locale === "zh-CN" ? `已选择 ${docs.length}/3 份` : `${docs.length}/3 selected`}
        </span>
      </div>

      <div className="mt-2 overflow-hidden rounded-[8px] border bg-card">
        {docsQuery.isLoading ? (
          <div className="flex min-h-14 items-center justify-center"><LoaderCircle aria-hidden="true" className="h-5 w-5 animate-spin text-primary" /></div>
        ) : docs.length > 0 ? (
          <ul className="divide-y">
            {docs.map((doc) => (
              <li key={doc.doc_id} className="flex min-h-14 items-center gap-3 px-3 py-2">
                <FilePlus2 aria-hidden="true" className="h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-foreground">{doc.filename}</span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">
                    {doc.source_kind === "library"
                      ? (locale === "zh-CN" ? "来自课程资料库" : "From course library")
                      : doc.saved_to_library
                        ? (locale === "zh-CN" ? "本任务使用 · 已加入资料库" : "Task upload · saved to library")
                        : (locale === "zh-CN" ? "仅用于本任务" : "This task only")}
                    {` · ${doc.chunk_count} ${locale === "zh-CN" ? "个片段" : "chunks"}`}
                  </span>
                </span>
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void removeDocument(doc.doc_id)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] text-muted-foreground outline-none hover:bg-muted hover:text-danger focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  aria-label={locale === "zh-CN" ? `移除 ${doc.filename}` : `Remove ${doc.filename}`}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex min-h-14 items-center gap-3 px-3 py-2 text-[12px] text-muted-foreground">
            <BookOpen aria-hidden="true" className="h-4 w-4 shrink-0" />
            {locale === "zh-CN" ? "暂未选择补充资料；系统将只使用题目、标答和评分标准。" : "No supplemental materials selected."}
          </div>
        )}
      </div>
      {knowledgeError ? <p role="alert" className="mt-2 text-[11px] leading-4 text-danger">{knowledgeError}</p> : null}
    </section>
  );
}

function StrategySection({
  locale,
  setup,
  advancedOpen,
  usesSharedPool,
  onAdvancedToggle,
  onChange,
}: {
  locale: Locale;
  setup: GradingSetup;
  advancedOpen: boolean;
  usesSharedPool: boolean;
  onAdvancedToggle: () => void;
  onChange: (updater: (current: GradingSetup) => GradingSetup) => void;
}) {
  const multipleModels = setup.selected_provider_ids.length > 1;
  const strictnessLabel: "lenient" | "standard" | "strict" = setup.strictness < 35
    ? "lenient"
    : setup.strictness > 65
      ? "strict"
      : "standard";

  return (
    <section aria-labelledby="grading-strategy-title">
      <h2 id="grading-strategy-title" className="text-[17px] font-bold leading-6 text-foreground">{gradingSetupText(locale, "strategyTitle")}</h2>
      <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">{gradingSetupText(locale, "strategyDescription")}</p>

      <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_260px] sm:items-end">
        <label>
          <span className="flex items-center justify-between text-[12px] font-semibold text-foreground">
            <span>{gradingSetupText(locale, "strictness")}</span>
            <span className="text-primary">{gradingSetupText(locale, strictnessLabel)} · {setup.strictness}</span>
          </span>
          <input type="range" min={0} max={100} step={5} value={setup.strictness} onChange={(event) => onChange((current) => ({ ...current, strictness: Number(event.target.value) }))} className="mt-2 h-2 w-full cursor-pointer accent-primary" />
          <span className="mt-1 flex justify-between text-[11px] text-muted-foreground"><span>{gradingSetupText(locale, "lenient")}</span><span>{gradingSetupText(locale, "standard")}</span><span>{gradingSetupText(locale, "strict")}</span></span>
        </label>
        <label className="flex min-h-[54px] cursor-pointer items-center gap-3 rounded-[8px] border px-3 py-2">
          <input type="checkbox" checked={setup.allow_partial_credit} onChange={(event) => onChange((current) => ({ ...current, allow_partial_credit: event.target.checked }))} className="h-4 w-4 rounded border-border accent-primary" />
          <span className="min-w-0">
            <span className="block text-[12px] font-semibold text-foreground">{gradingSetupText(locale, "allowPartialCredit")}</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{gradingSetupText(locale, "allowPartialCreditDescription")}</span>
          </span>
        </label>
      </div>

      <button type="button" aria-expanded={advancedOpen} aria-controls="grading-advanced-settings" onClick={onAdvancedToggle} className="mt-1.5 flex min-h-9 w-full items-center justify-between gap-3 rounded-[8px] bg-muted/45 px-3 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <span className="min-w-0">
          <span className="block text-[12px] font-semibold text-foreground">{gradingSetupText(locale, advancedOpen ? "hideAdvanced" : "showAdvanced")}</span>
          {!advancedOpen ? <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{gradingSetupText(locale, "advancedSummaryThreshold")} {setup.low_confidence_threshold.toFixed(2)} · {setup.multi_sample_n} {gradingSetupText(locale, "advancedSummarySample")}</span> : null}
        </span>
        <ChevronDown aria-hidden="true" className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", advancedOpen && "rotate-180")} />
      </button>

      {advancedOpen ? (
        <div id="grading-advanced-settings" className="mt-3 grid gap-3 border-l-2 border-primary/20 pl-4 sm:grid-cols-2">
          <SelectField label={gradingSetupText(locale, "feedbackTone")} value={setup.feedback_tone} onChange={(value) => onChange((current) => ({ ...current, feedback_tone: value as GradingFeedbackTone }))}>
            <option value="encouraging">{gradingSetupText(locale, "toneEncouraging")}</option>
            <option value="neutral">{gradingSetupText(locale, "toneNeutral")}</option>
            <option value="strict">{gradingSetupText(locale, "toneStrict")}</option>
          </SelectField>
          <SelectField label={gradingSetupText(locale, "feedbackLength")} value={setup.feedback_length} onChange={(value) => onChange((current) => ({ ...current, feedback_length: value as GradingFeedbackLength }))}>
            <option value="short">{gradingSetupText(locale, "lengthShort")}</option>
            <option value="medium">{gradingSetupText(locale, "lengthMedium")}</option>
            <option value="long">{gradingSetupText(locale, "lengthLong")}</option>
          </SelectField>
          <SelectField label={gradingSetupText(locale, "feedbackLanguage")} value={setup.feedback_language} onChange={(value) => onChange((current) => ({ ...current, feedback_language: value as GradingFeedbackLanguage }))}>
            <option value="zh">{gradingSetupText(locale, "languageChinese")}</option>
            <option value="en">{gradingSetupText(locale, "languageEnglish")}</option>
          </SelectField>
          <SelectField
            label={gradingSetupText(locale, "multiSample")}
            value={String(setup.multi_sample_n)}
            disabled={usesSharedPool || multipleModels}
            description={gradingSetupText(locale, usesSharedPool ? "multiSampleSharedDescription" : multipleModels ? "multiSampleMultipleDescription" : "multiSampleDescription")}
            onChange={(value) => onChange((current) => ({ ...current, multi_sample_n: Number(value) }))}
          >
            {SAMPLE_OPTIONS.map((count) => <option key={count} value={count}>{count}{gradingSetupText(locale, "multiSampleSuffix")}</option>)}
          </SelectField>
          <label className="sm:col-span-2">
            <span className="flex items-center justify-between text-[11px] font-semibold text-foreground"><span>{gradingSetupText(locale, "lowConfidenceThreshold")}</span><span className="text-primary">{setup.low_confidence_threshold.toFixed(2)}</span></span>
            <input type="range" min={0.3} max={0.8} step={0.05} value={setup.low_confidence_threshold} onChange={(event) => onChange((current) => ({ ...current, low_confidence_threshold: Number(event.target.value) }))} className="mt-2 h-2 w-full cursor-pointer accent-primary" />
            <span className="mt-1 block text-[11px] text-muted-foreground">{gradingSetupText(locale, "lowConfidenceDescription")}</span>
          </label>
          <label className="flex cursor-pointer items-start gap-2 text-[11px] font-medium text-foreground sm:col-span-2">
            <input type="checkbox" checked={setup.suggest_corrections} onChange={(event) => onChange((current) => ({ ...current, suggest_corrections: event.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-border accent-primary" />
            {gradingSetupText(locale, "suggestCorrections")}
          </label>
          <label className="sm:col-span-2">
            <span className="flex items-center justify-between text-[11px] font-semibold text-foreground"><span>{gradingSetupText(locale, "teacherNotes")}</span><span className="font-normal text-muted-foreground">{setup.teacher_notes.length}/{MAX_NOTES_LENGTH}{gradingSetupText(locale, "charactersSuffix")}</span></span>
            <textarea maxLength={MAX_NOTES_LENGTH} value={setup.teacher_notes} onChange={(event) => onChange((current) => ({ ...current, teacher_notes: event.target.value }))} placeholder={gradingSetupText(locale, "teacherNotesPlaceholder")} className="mt-1.5 min-h-[70px] w-full resize-y rounded-[8px] border bg-background px-3 py-2 text-[12px] leading-5 text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" />
          </label>
        </div>
      ) : null}
    </section>
  );
}

function ChoiceButton({ active, title, description, badge, badgeTone = "primary", onClick }: {
  active: boolean;
  title: string;
  description: string;
  badge?: string;
  badgeTone?: "primary" | "warning";
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn("min-h-[52px] rounded-[8px] border bg-card px-3 py-1.5 text-left outline-none transition focus-visible:ring-2 focus-visible:ring-ring", active ? "border-primary ring-1 ring-primary" : "hover:border-slate-300")}>
      <span className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-foreground">{title}</span>
        {badge ? <span className={cn("shrink-0 text-[11px] font-semibold", badgeTone === "warning" ? "text-warning" : "text-primary")}>{badge}</span> : null}
      </span>
      <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{description}</span>
    </button>
  );
}

function SelectField({ label, value, disabled = false, description, onChange, children }: {
  label: string;
  value: string;
  disabled?: boolean;
  description?: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <label className="min-w-0">
      <span className="block text-[11px] font-semibold text-foreground">{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-1.5 h-9 w-full min-w-0 rounded-[7px] border bg-background px-3 text-[12px] text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground">
        {children}
      </select>
      {description ? <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{description}</span> : null}
    </label>
  );
}

function ModelRequiredState({ locale, taskId, embedded, setupHref, backHref, hasReturnTo }: {
  locale: Locale;
  taskId: string;
  embedded: boolean;
  setupHref: string;
  backHref: string;
  hasReturnTo: boolean;
}) {
  const byokReturnTo = embedded
    ? `/tasks/${taskId}/submissions/upload?phase=settings`
    : setupHref;
  return (
    <div className="flex min-h-[450px] flex-col justify-center">
      <div className="rounded-[10px] border border-amber-200 bg-amber-50/70 px-5 py-5 dark:border-amber-900 dark:bg-amber-950/20 sm:flex sm:items-center sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><Settings2 aria-hidden="true" className="h-5 w-5 text-warning" /><h2 className="text-[17px] font-bold text-foreground">{gradingSetupText(locale, "noModelsTitle")}</h2></div>
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{gradingSetupText(locale, "noModelsDescription")}</p>
        </div>
        <Link to={`/settings/byok?returnTo=${encodeURIComponent(byokReturnTo)}`} className="mt-4 inline-flex h-10 shrink-0 items-center justify-center rounded-[8px] bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring sm:mt-0">
          {gradingSetupText(locale, "configureModels")}
        </Link>
      </div>
      <Link to={backHref} className="mt-5 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />{gradingSetupText(locale, hasReturnTo ? "backToPrevious" : "backToQuestions")}
      </Link>
    </div>
  );
}

function CenteredState({ title, description, action }: { title: string; description: string; action: ReactNode }) {
  return (
    <div className="flex min-h-[450px] flex-col items-center justify-center px-3 text-center">
      <h2 className="text-base font-bold text-foreground">{title}</h2>
      <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">{description}</p>
      <div className="mt-5">{action}</div>
    </div>
  );
}

function cloneSetup(setup: GradingSetup): GradingSetup {
  return { ...setup, selected_provider_ids: [...setup.selected_provider_ids] };
}

function serializeSetup(setup: GradingSetup): string {
  return JSON.stringify(setup);
}

function applyProviderSelection(
  current: GradingSetup,
  providerIds: string[],
  expertsById: ReadonlyMap<string, GradingSetupExpert>,
): GradingSetup {
  const nextIds = [...new Set(providerIds)];
  const primaryProviderId = nextIds.includes(current.primary_provider_id)
    ? current.primary_provider_id
    : nextIds[0] ?? "";
  const aggregationMethod = nextIds.length <= 1
    ? "single"
    : current.aggregation_method === "single"
      ? "weighted_average"
      : current.aggregation_method;
  const usesSharedPool = nextIds.some((providerId) => expertsById.get(providerId)?.is_shared);

  return {
    ...current,
    selected_provider_ids: nextIds,
    primary_provider_id: primaryProviderId,
    aggregation_method: aggregationMethod,
    multi_sample_n: nextIds.length === 1 && !usesSharedPool ? current.multi_sample_n : 1,
  };
}

function validateSetup(
  setup: GradingSetup,
  experts: GradingSetupExpert[],
  scopeOptions: GradingKnowledgeScope[],
  locale: Locale,
): string | null {
  if (setup.selected_provider_ids.length === 0) return gradingSetupText(locale, "providerSelectionRequired");
  const selected = setup.selected_provider_ids.map((providerId) => experts.find((expert) => expert.provider_id === providerId));
  if (selected.some((expert) => !expert?.enabled)) return gradingSetupText(locale, "providerChanged");
  if (!setup.selected_provider_ids.includes(setup.primary_provider_id)) return gradingSetupText(locale, "providerChanged");
  if (selected.some((expert) => expert?.is_shared) && (selected.length > 1 || setup.multi_sample_n !== 1)) return gradingSetupText(locale, "sharedPoolRestriction");
  if (selected.length === 1 && setup.aggregation_method !== "single") return gradingSetupText(locale, "invalidForm");
  if (selected.length > 1 && setup.aggregation_method === "single") return gradingSetupText(locale, "invalidForm");
  if (selected.length > 1 && setup.multi_sample_n !== 1) return gradingSetupText(locale, "invalidForm");
  if (!scopeOptions.includes(setup.knowledge_scope)) return gradingSetupText(locale, "invalidForm");
  if (setup.strictness < 0 || setup.strictness > 100) return gradingSetupText(locale, "invalidForm");
  if (setup.low_confidence_threshold < 0.3 || setup.low_confidence_threshold > 0.8) return gradingSetupText(locale, "invalidForm");
  if (setup.multi_sample_n < 1 || setup.multi_sample_n > 5) return gradingSetupText(locale, "invalidForm");
  if (setup.teacher_notes.length > MAX_NOTES_LENGTH) return gradingSetupText(locale, "invalidForm");
  return null;
}

function readinessMessage(code: string, locale: Locale): string {
  const keys = {
    provider_required: "noModelsDescription",
    invalid_state: "workflowNotReady",
    workflow_busy: "workflowBusy",
    grading_setup_locked: "setupLocked",
  } as const;
  return gradingSetupText(locale, keys[code as keyof typeof keys] ?? "workflowNotReady");
}

function localizeSaveError(error: unknown, locale: Locale): string {
  const normalized = normalizeAPIError(error);
  const code = apiErrorCode(normalized);
  if (["workflow_busy"].includes(code)) return gradingSetupText(locale, "workflowBusy");
  if (["invalid_state"].includes(code)) return gradingSetupText(locale, "workflowNotReady");
  if (["grading_setup_locked"].includes(code)) return gradingSetupText(locale, "setupLocked");
  if (["provider_not_enabled", "primary_provider_not_selected", "invalid_provider_count", "duplicate_provider_ids"].includes(code)) return gradingSetupText(locale, "providerChanged");
  if (["shared_pool_single_expert_required", "multi_sample_not_applicable"].includes(code)) return gradingSetupText(locale, "sharedPoolRestriction");
  if (code === "stale_revision") return gradingSetupText(locale, "staleReloaded");
  return gradingSetupText(locale, "saveErrorGeneric");
}

function apiErrorCode(error: ReturnType<typeof normalizeAPIError>): string {
  const detail = error.payload?.detail;
  return detail && typeof detail === "object" && "code" in detail
    ? String((detail as { code?: unknown }).code ?? "")
    : "";
}
