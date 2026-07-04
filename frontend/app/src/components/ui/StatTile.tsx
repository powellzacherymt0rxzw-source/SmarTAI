import type { ComponentType } from "react";
import { cn } from "@/lib/cn";

export function StatTile({
  icon: Icon,
  label,
  value,
  tone = "primary",
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  tone?: "primary" | "accent" | "warning" | "danger";
}) {
  const toneClass = {
    primary: "border border-primary/30 bg-primary/10 text-primary",
    accent: "border border-accent/30 bg-accent/10 text-accent",
    warning: "border border-warning/30 bg-warning/10 text-warning",
    danger: "border border-danger/30 bg-danger/10 text-danger",
  }[tone];

  return (
    <div className="flex items-center gap-3 rounded-lg border bg-card p-4">
      <div className={cn("flex h-10 w-10 items-center justify-center rounded-md", toneClass)}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="text-xl font-semibold">{value}</div>
      </div>
    </div>
  );
}
