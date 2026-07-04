import { AlertCircle, CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { getTaskStatusMeta, type TaskDisplayStatus, type TaskStatusTone } from "@/lib/taskFlow";

const toneClasses: Record<TaskStatusTone, { dot: string; chip: string; text: string }> = {
  neutral: {
    dot: "bg-muted-foreground",
    chip: "border-border bg-muted/40 text-muted-foreground",
    text: "text-muted-foreground",
  },
  primary: {
    dot: "bg-primary",
    chip: "border-primary/30 bg-primary/10 text-primary",
    text: "text-primary",
  },
  accent: {
    dot: "bg-accent",
    chip: "border-accent/30 bg-accent/10 text-accent",
    text: "text-accent",
  },
  warning: {
    dot: "bg-warning",
    chip: "border-warning/30 bg-warning/10 text-warning",
    text: "text-warning",
  },
  danger: {
    dot: "bg-danger",
    chip: "border-danger/30 bg-danger/10 text-danger",
    text: "text-danger",
  },
};

export function TaskStatusIndicator({
  status,
  variant = "text",
  className,
  showDescription = false,
}: {
  status?: TaskDisplayStatus | string | null;
  variant?: "text" | "chip" | "compact";
  className?: string;
  showDescription?: boolean;
}) {
  const meta = getTaskStatusMeta(status);
  const tone = toneClasses[meta.tone];
  const label = variant === "compact" ? meta.shortLabel : meta.label;

  if (variant === "chip") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium", tone.chip, className)}>
        <StatusIcon tone={meta.tone} isProcessing={meta.isProcessing} />
        {label}
      </span>
    );
  }

  return (
    <span className={cn("inline-flex items-start gap-2 text-sm", tone.text, className)}>
      <span className="relative mt-2 flex h-2 w-2 shrink-0">
        {meta.isProcessing ? <span className={cn("absolute inline-flex h-full w-full animate-ping rounded-full opacity-60", tone.dot)} /> : null}
        <span className={cn("relative inline-flex h-2 w-2 rounded-full", tone.dot)} />
      </span>
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        {showDescription ? (
          <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{meta.description}</span>
        ) : null}
      </span>
    </span>
  );
}

function StatusIcon({ tone, isProcessing }: { tone: TaskStatusTone; isProcessing: boolean }) {
  if (isProcessing) {
    return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  }
  if (tone === "danger") {
    return <AlertCircle className="h-3.5 w-3.5" />;
  }
  if (tone === "accent") {
    return <CheckCircle2 className="h-3.5 w-3.5" />;
  }
  return <CircleDashed className="h-3.5 w-3.5" />;
}
