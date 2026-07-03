import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/cn";

const markdownMathComponents: Components = {
  p: ({ children }) => <p className="mb-2 whitespace-pre-wrap last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  code: ({ children }) => <code className="rounded bg-muted px-1 py-0.5 text-xs">{children}</code>,
};

export function MarkdownMath({ children, className }: { children?: string | null; className?: string }) {
  const content = children?.trim();
  if (!content) {
    return null;
  }

  return (
    <div
      className={cn(
        "min-w-0 break-words text-sm leading-6 [&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden",
        className,
      )}
    >
      <ReactMarkdown
        components={markdownMathComponents}
        remarkPlugins={[remarkMath]}
        rehypePlugins={[[rehypeKatex, { strict: false, throwOnError: false }]]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
