import { useEffect, useId, useRef } from "react";

interface UnsavedChangesDialogProps {
  title: string;
  description: string;
  stayLabel: string;
  leaveLabel: string;
  onStay: () => void;
  onLeave: () => void;
}

export function UnsavedChangesDialog({
  title,
  description,
  stayLabel,
  leaveLabel,
  onStay,
  onLeave,
}: UnsavedChangesDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const stayButtonRef = useRef<HTMLButtonElement>(null);
  const onStayRef = useRef(onStay);
  const onLeaveRef = useRef(onLeave);
  const titleId = useId();
  const descriptionId = useId();

  onStayRef.current = onStay;
  onLeaveRef.current = onLeave;

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const frame = window.requestAnimationFrame(() => stayButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onStayRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/40 p-4" role="presentation">
      <section
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-full max-w-md rounded-[10px] border bg-card p-5 shadow-2xl"
      >
        <h2 id={titleId} className="text-lg font-bold text-foreground">{title}</h2>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-muted-foreground">{description}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={stayButtonRef}
            type="button"
            className="h-9 rounded-[7px] border bg-card px-4 text-sm font-semibold outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => onStayRef.current()}
          >
            {stayLabel}
          </button>
          <button
            type="button"
            className="h-9 rounded-[7px] bg-danger px-4 text-sm font-semibold text-white outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={() => onLeaveRef.current()}
          >
            {leaveLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
