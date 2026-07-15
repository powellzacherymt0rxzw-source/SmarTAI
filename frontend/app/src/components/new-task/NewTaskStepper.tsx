import { useI18n } from "@/i18n/I18nProvider";
import type { MessageKey } from "@/i18n/messages";

const STEP_KEYS: MessageKey[] = [
  "newTaskStepProblems",
  "newTaskStepMaterials",
  "newTaskStepAnswers",
  "newTaskStepConfirm",
  "newTaskStepGrade",
  "newTaskStepReview",
  "newTaskStepComplete",
];

export function NewTaskStepper() {
  const { t } = useI18n();

  return (
    <nav aria-label={t("newTaskWorkflow")} className="mt-[14px] overflow-x-auto pb-1">
      <ol className="flex min-w-[1130px] items-center">
        {STEP_KEYS.map((key, index) => (
          <li key={key} className={`relative flex shrink-0 items-center ${index < STEP_KEYS.length - 1 ? "w-[176px]" : "w-auto"}`}>
            <div className="flex shrink-0 items-center gap-2">
              <span className={`inline-flex h-[26px] w-[26px] items-center justify-center rounded-full text-xs font-semibold ${index === 0 ? "bg-primary text-primary-foreground" : "bg-slate-200 text-white dark:bg-slate-600"}`} aria-current={index === 0 ? "step" : undefined}>
                {index + 1}
              </span>
              <span className={`whitespace-nowrap text-[13px] font-medium ${index === 0 ? "text-foreground" : "text-muted-foreground"}`}>{t(key)}</span>
            </div>
            {index < STEP_KEYS.length - 1 ? <span aria-hidden="true" className="absolute left-[104px] top-[13px] h-px w-14 bg-border" /> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
