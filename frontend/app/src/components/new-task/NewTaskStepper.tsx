import { Check } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
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

export function NewTaskStepper({ currentStep = 0 }: { currentStep?: number }) {
  const { t } = useI18n();
  const navRef = useRef<HTMLElement>(null);
  const currentStepRef = useRef<HTMLLIElement>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const current = currentStepRef.current;
    if (!nav || !current || nav.scrollWidth <= nav.clientWidth) return;
    const centeredLeft = current.offsetLeft + current.offsetWidth / 2 - nav.clientWidth / 2;
    nav.scrollLeft = Math.max(0, centeredLeft);
  }, [currentStep]);

  return (
    <nav ref={navRef} aria-label={t("newTaskWorkflow")} className="mt-[14px] overflow-x-auto pb-1">
      <ol className="flex min-w-[1130px] items-center">
        {STEP_KEYS.map((key, index) => (
          <li
            ref={index === currentStep ? currentStepRef : undefined}
            key={key}
            className={`relative flex shrink-0 items-center ${index < STEP_KEYS.length - 1 ? "w-[176px]" : "w-auto"}`}
          >
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`inline-flex h-[26px] w-[26px] items-center justify-center rounded-full text-xs font-semibold ${
                  index < currentStep
                    ? "bg-accent text-white"
                    : index === currentStep
                      ? "bg-primary text-primary-foreground"
                      : "bg-slate-200 text-white dark:bg-slate-600"
                }`}
                aria-current={index === currentStep ? "step" : undefined}
              >
                {index < currentStep ? <Check aria-hidden="true" size={15} strokeWidth={3} /> : index + 1}
              </span>
              <span className={`whitespace-nowrap text-[13px] font-medium ${index === currentStep ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{t(key)}</span>
            </div>
            {index < STEP_KEYS.length - 1 ? (
              <span aria-hidden="true" className={`absolute left-[104px] top-[13px] h-px w-14 ${index < currentStep ? "bg-accent" : "bg-border"}`} />
            ) : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
