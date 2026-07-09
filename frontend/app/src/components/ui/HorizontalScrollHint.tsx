import { ArrowLeftRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function HorizontalScrollHint({
  className,
  label = "左右滑动查看完整表格 / Swipe sideways to see all columns.",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <p className={cn("flex items-center gap-1.5 text-xs leading-5 text-muted-foreground xl:hidden", className)}>
      <ArrowLeftRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0">{label}</span>
    </p>
  );
}
