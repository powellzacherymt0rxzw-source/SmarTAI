import { ArrowLeft, ChevronDown, ChevronRight, LoaderCircle, Settings2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useBeforeUnload, useBlocker, useNavigate, useParams } from "react-router-dom";
import { normalizeAPIError } from "@/api/client";
import { useGradingSetup, useSaveGradingSetup } from "@/api/hooks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import { useI18n } from "@/i18n/I18nProvider";
import type { Locale } from "@/i18n/messages";
import { cn } from "@/lib/cn";
import { gradingSetupText, type GradingSetupCopyKey } from "@/lib/gradingSetupCopy";
import type {
  GradingAggregationMethod,
  GradingFeedbackLanguage,
  GradingFeedbackLength,
  GradingFeedbackTone,
  GradingKnowledgeScope,
  GradingSetup,
  GradingSetupExpert,
  GradingSetupKnowledge,
} from "@/types";

const SAMPLE_OPTIONS = [1, 2, 3, 4, 5] as const;
const MAX_NOTES_LENGTH = 500;
const NON_BLOCKING_SETUP_ISSUES = new Set(["grading_setup_required"]);

export function GradingSetupPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
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
      allowLeaveRef.current = true;
      navigate(`/tasks/${taskId}/upload/submissions`);
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
    <div className="min-w-0 w-full max-w-[1300px]">
      <h1 className="min-h-9 break-words text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
        {gradingSetupText(locale, "title")}
      </h1>
      <NewTaskStepper currentStep={1} />

      <section className="mx-auto mt-[35px] w-full max-w-[900px] rounded-[10px] border bg-card px-5 pb-4 pt-5 sm:min-h-[540px] sm:px-10 sm:pb-5 sm:pt-5 lg:h-[620px] lg:overflow-hidden">
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
          <ModelRequiredState locale={locale} taskId={taskId} />
        ) : response && setup ? (
          <form className="flex h-full min-h-0 flex-col" onSubmit={(event) => { event.preventDefault(); void handleSubmit(); }}>
            <fieldset
              disabled={isReadOnly || saveSetup.isPending}
              className={cn("min-h-0 min-w-0 flex-1 border-0 p-0", isReadOnly && "opacity-70")}
            >
              <div className="h-full min-h-0 lg:overflow-y-auto lg:pr-2">
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
                  knowledge={response.knowledge}
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
                    <Link to={`/settings/byok?returnTo=${encodeURIComponent(`/tasks/${taskId}/grading-setup`)}`} className="inline-flex h-7 shrink-0 items-center rounded-[6px] bg-primary px-2.5 font-semibold text-primary-foreground hover:opacity-90">
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
              <Link to={`/tasks/${taskId}/questions`} className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] border bg-card px-4 text-sm font-semibold text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring sm:w-auto">
                <ArrowLeft aria-hidden="true" className="h-4 w-4" />
                {gradingSetupText(locale, "backToQuestions")}
              </Link>
              <button type="submit" disabled={actionDisabled} className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[8px] bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:w-[270px]">
                {saveSetup.isPending ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : null}
                {gradingSetupText(locale, saveSetup.isPending ? "saving" : "saveAndContinue")}
                {!saveSetup.isPending ? <ChevronRight aria-hidden="true" className="h-4 w-4" /> : null}
              </button>
            </footer>
          </form>
        ) : null}
      </section>

      {blocker.state === "blocked" ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4" role="presentation">
          <section role="alertdialog" aria-modal="true" aria-labelledby="leave-grading-setup-title" className="w-full max-w-md rounded-[10px] border bg-card p-5 shadow-2xl">
            <h2 id="leave-grading-setup-title" className="text-lg font-bold text-foreground">{gradingSetupText(locale, "leaveTitle")}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{gradingSetupText(locale, "leaveDescription")}</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="h-9 rounded-[7px] border bg-card px-4 text-sm font-semibold hover:bg-muted" onClick={() => blocker.reset()}>{gradingSetupText(locale, "stay")}</button>
              <button type="button" className="h-9 rounded-[7px] bg-danger px-4 text-sm font-semibold text-white hover:opacity-90" onClick={() => blocker.proceed()}>{gradingSetupText(locale, "leave")}</button>
            </div>
          </section>
        </div>
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
                selected && expert.enabled && "bg-blue-50/45 dark:bg-blue-950/10",
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
        <div className="mt-1.5 flex items-center justify-between rounded-[7px] bg-muted/45 px-3 py-1.5">
          <span className="text-[12px] font-semibold text-foreground">{gradingSetupText(locale, "singleMethod")}</span>
          <span className="text-[11px] text-muted-foreground">{gradingSetupText(locale, "singleMethodDescription")}</span>
        </div>
      )}
    </fieldset>
  );
}

function KnowledgeSection({ locale, taskId, knowledge, value, onChange }: {
  locale: Locale;
  taskId: string;
  knowledge: GradingSetupKnowledge;
  value: GradingKnowledgeScope;
  onChange: (scope: GradingKnowledgeScope) => void;
}) {
  return (
    <fieldset>
      <legend className="text-[17px] font-bold leading-6 text-foreground">{gradingSetupText(locale, "knowledgeTitle")}</legend>
      <div className="mt-0.5 flex flex-col gap-1.5 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <p className="text-[12px] leading-4 text-muted-foreground">{gradingSetupText(locale, "knowledgeDescription")}</p>
        <Link
          to={`/tasks/${taskId}/materials`}
          className="inline-flex shrink-0 items-center gap-0.5 self-start text-[12px] font-semibold text-primary outline-none hover:underline focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring"
        >
          {locale === "zh-CN" ? "管理任务资料" : "Manage task documents"}
          <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <RadioCard
          name="grading-knowledge-scope"
          checked={value === "none"}
          title={gradingSetupText(locale, "knowledgeNone")}
          description={gradingSetupText(locale, "knowledgeNoneDescription")}
          onChange={() => onChange("none")}
        />
        <RadioCard
          name="grading-knowledge-scope"
          checked={value === "all_task_docs"}
          disabled={!knowledge.scope_options.includes("all_task_docs")}
          title={gradingSetupText(locale, "knowledgeAll")}
          description={`${gradingSetupText(locale, "knowledgeAllPrefix")}${knowledge.task_doc_count}${gradingSetupText(locale, "knowledgeAllSuffix")}`}
          onChange={() => onChange("all_task_docs")}
        />
      </div>
      {value === "all_task_docs" && knowledge.task_doc_count === 0 ? (
        <p className="mt-2 rounded-[7px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-4 text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          {gradingSetupText(locale, "knowledgeEmptyWarning")}
        </p>
      ) : null}
    </fieldset>
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

      <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_210px_170px] sm:items-end">
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
        <SelectField label={gradingSetupText(locale, "feedbackTone")} value={setup.feedback_tone} onChange={(value) => onChange((current) => ({ ...current, feedback_tone: value as GradingFeedbackTone }))}>
          <option value="encouraging">{gradingSetupText(locale, "toneEncouraging")}</option>
          <option value="neutral">{gradingSetupText(locale, "toneNeutral")}</option>
          <option value="strict">{gradingSetupText(locale, "toneStrict")}</option>
        </SelectField>
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

function RadioCard({ name, checked, disabled = false, title, description, onChange }: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  title: string;
  description: string;
  onChange: () => void;
}) {
  return (
    <label className={cn("flex min-h-[58px] cursor-pointer items-start gap-3 rounded-[8px] border bg-card px-3 py-2.5 transition", checked ? "border-primary ring-1 ring-primary" : "hover:border-slate-300", disabled && "cursor-not-allowed opacity-50")}>
      <input type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} className="mt-0.5 h-4 w-4 shrink-0 accent-primary" />
      <span className="min-w-0"><span className="block text-[12px] font-semibold text-foreground">{title}</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">{description}</span></span>
    </label>
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

function ModelRequiredState({ locale, taskId }: { locale: Locale; taskId: string }) {
  const returnTo = `/tasks/${taskId}/grading-setup`;
  return (
    <div className="flex min-h-[450px] flex-col justify-center">
      <div className="rounded-[10px] border border-amber-200 bg-amber-50/70 px-5 py-5 dark:border-amber-900 dark:bg-amber-950/20 sm:flex sm:items-center sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2"><Settings2 aria-hidden="true" className="h-5 w-5 text-warning" /><h2 className="text-[17px] font-bold text-foreground">{gradingSetupText(locale, "noModelsTitle")}</h2></div>
          <p className="mt-2 text-[12px] leading-5 text-muted-foreground">{gradingSetupText(locale, "noModelsDescription")}</p>
        </div>
        <Link to={`/settings/byok?returnTo=${encodeURIComponent(returnTo)}`} className="mt-4 inline-flex h-10 shrink-0 items-center justify-center rounded-[8px] bg-primary px-5 text-sm font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring sm:mt-0">
          {gradingSetupText(locale, "configureModels")}
        </Link>
      </div>
      <Link to={`/tasks/${taskId}/questions`} className="mt-5 inline-flex w-fit items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden="true" className="h-4 w-4" />{gradingSetupText(locale, "backToQuestions")}
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
