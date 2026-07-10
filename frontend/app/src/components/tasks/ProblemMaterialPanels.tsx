import { useRef, type ChangeEvent } from "react";
import { BookOpenCheck, Circle, FileCode2, FileText, FlaskConical, Loader2, ListChecks, Sparkles, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { normalizeAPIError } from "@/api/client";
import { useUploadReference, useUploadTestCases } from "@/api/hooks/tasks";
import { Button } from "@/components/ui/Button";
import { InlineNotice } from "@/components/ui/InlineNotice";
import { MarkdownMath } from "@/components/ui/MarkdownMath";
import { WorkflowSection } from "@/components/ui/WorkflowSection";
import { cn } from "@/lib/cn";
import type { ProblemInfo, TestCase } from "@/types";

export function ProblemMaterialTools({
  onUploaded,
  problems,
  taskId,
}: {
  onUploaded?: () => void;
  problems: ProblemInfo[];
  taskId: string;
}) {
  const summary = getMaterialSummary(problems);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const testCasesInputRef = useRef<HTMLInputElement>(null);
  const uploadReference = useUploadReference();
  const uploadTestCases = useUploadTestCases();
  const isUploading = uploadReference.isPending || uploadTestCases.isPending;

  async function handleUpload(kind: "reference" | "test-cases", event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    try {
      if (kind === "reference") {
        await uploadReference.mutateAsync({ taskId, file });
        toast.success("标答文件已上传", { description: "后端会把它作为任务级标答资料保存；逐题匹配能力继续待接。" });
      } else {
        await uploadTestCases.mutateAsync({ taskId, file });
        toast.success("测试样例已上传", { description: "后端会把它作为编程题测试样例资料保存。" });
      }
      onUploaded?.();
    } catch (error) {
      toast.error(kind === "reference" ? "标答上传失败" : "测试样例上传失败", {
        description: normalizeAPIError(error).message,
      });
    } finally {
      event.target.value = "";
    }
  }

  return (
    <div className="grid gap-4">
      <WorkflowSection
        title="批量导入资料"
        description="适合从教材答案、评分细则、讲义或测试样例文件中批量匹配到本次作业题目。"
      >
        <div className="grid gap-3 lg:grid-cols-3">
          <ToolColumn
            title="导入内容"
            items={["评分标准", "标答", "编程题测试样例"]}
          />
          <ToolColumn
            title="资料来源"
            items={["课程资料库文件", "课程资料库分组", "上传新资料并加入知识库"]}
          />
          <ToolColumn
            title="文件结构"
            items={["已按题整理", "从原文提取"]}
          />
        </div>
        <InlineNotice tone="neutral" title="任务级上传已可用">
          标答文件和编程题测试样例可以先作为本任务资料上传；题号匹配、长文档检索、OCR、匹配置信度和逐题回填仍需要新增后端任务。
        </InlineNotice>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-md border bg-background p-3">
            <p className="text-sm font-semibold">上传标答文件</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              适合已按题整理的标答，或先上传整份标答原文；从原文提取到逐题标答仍待后端接入。
            </p>
            <input
              ref={referenceInputRef}
              type="file"
              className="hidden"
              accept=".pdf,.md,.txt,.json"
              onChange={(event) => void handleUpload("reference", event)}
            />
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              disabled={isUploading}
              onClick={() => referenceInputRef.current?.click()}
            >
              {uploadReference.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
              选择标答文件
            </Button>
          </div>
          <div className="rounded-md border bg-background p-3">
            <p className="text-sm font-semibold">上传测试样例</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              仅编程题消费此项；支持 JSON、Markdown、TXT 或自然语言描述的输入输出样例。
            </p>
            <input
              ref={testCasesInputRef}
              type="file"
              className="hidden"
              accept=".json,.md,.txt,.py,.js,.java,.cpp,.c"
              onChange={(event) => void handleUpload("test-cases", event)}
            />
            <Button
              type="button"
              variant="secondary"
              className="mt-3"
              disabled={isUploading}
              onClick={() => testCasesInputRef.current?.click()}
            >
              {uploadTestCases.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <FlaskConical className="h-4 w-4" />}
              选择测试样例
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled>
            <UploadCloud className="h-4 w-4" />
            开始导入并匹配
          </Button>
        </div>
      </WorkflowSection>

      <WorkflowSection
        title="AI 补全缺失资料"
        description="点击前先让老师看到将生成什么，避免 AI 在后台悄悄改动逐题资料。"
      >
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryMetric label="评分标准" value={`${summary.missingCriteria}`} detail="将生成并标记待确认" />
          <SummaryMetric label="标答" value={`${summary.missingAnswers}`} detail="题目准备阶段批改辅助" />
          <SummaryMetric label="示例代码" value={`${summary.programmingMissingAnswers}`} detail="仅编程题需要" />
          <SummaryMetric label="测试样例" value={`${summary.missingTests}`} detail="含预期输出与测试脚本" />
        </div>
        <div className="grid gap-3 rounded-md border bg-muted/30 p-3 text-sm">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">AI 生成测试样例数量</span>
              <div className="flex items-center gap-3">
                <input className="w-full accent-primary" type="range" min={1} max={12} value={6} disabled readOnly />
                <input className="h-9 w-20 rounded-md border bg-background px-2 text-sm" value="6" disabled readOnly />
              </div>
            </label>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">沙盒超时</span>
              <div className="flex items-center gap-3">
                <input className="w-full accent-primary" type="range" min={3} max={30} value={10} disabled readOnly />
                <input className="h-9 w-20 rounded-md border bg-background px-2 text-sm" value="10 秒" disabled readOnly />
              </div>
            </label>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            默认值先显示出来，后端保存评分策略和测试生成任务后再开放编辑。
          </p>
        </div>
        <InlineNotice tone="warning" title="不会自动覆盖教师内容">
          AI 生成内容应回填为“AI 生成，待确认”，老师逐题确认或修改后才进入批改。
        </InlineNotice>
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" disabled>
            <Sparkles className="h-4 w-4" />
            生成缺失资料
          </Button>
        </div>
      </WorkflowSection>
    </div>
  );
}

export function ProblemMaterialSlots({ problem }: { problem: ProblemInfo }) {
  const isProgramming = isProgrammingProblem(problem);
  const testCases = problem.test_cases ?? [];
  const slots = [
    {
      key: "criterion",
      title: "评分标准资料槽位",
      icon: ListChecks,
      status: hasText(problem.criterion) ? "已填写" : "缺失",
      tone: hasText(problem.criterion) ? "success" : "warning",
      source: hasText(problem.criterion) ? "来自题目识别或教师编辑" : "可手动填写 / 批量导入 / AI 补全",
      content: problem.criterion,
      emptyText: "暂无评分标准。可以点击“编辑题干/评分标准”先手动补充。",
      action: "当前可编辑",
      disabled: false,
    },
    {
      key: "reference",
      title: "标答资料槽位",
      icon: BookOpenCheck,
      status: hasText(problem.reference_answer) ? "已填写" : "缺失",
      tone: hasText(problem.reference_answer) ? "success" : "warning",
      source: hasText(problem.reference_answer) ? "来自标答文件解析" : "可从资料导入或由 AI 补全",
      content: problem.reference_answer,
      emptyText: "暂无标答。后端需要继续支持逐题标答保存、来源和匹配置信度。",
      action: "编辑待接入",
      disabled: true,
    },
    {
      key: "example-code",
      title: "编程题示例正确代码",
      icon: FileCode2,
      status: isProgramming ? (hasText(problem.reference_answer) ? "可作为示例" : "缺失") : "不适用",
      tone: isProgramming && !hasText(problem.reference_answer) ? "warning" : "neutral",
      source: isProgramming ? "后续可由 AI 生成或教师上传" : "非编程题不需要",
      content: isProgramming ? problem.reference_answer : null,
      emptyText: isProgramming ? "暂无示例正确代码。" : "非编程题不需要示例代码。",
      action: "生成待接入",
      disabled: true,
    },
    {
      key: "test-cases",
      title: "测试样例资料槽位",
      icon: FlaskConical,
      status: !isProgramming ? "不适用" : testCases.length > 0 ? `${testCases.length} 个样例` : "缺失",
      tone: isProgramming && testCases.length === 0 ? "warning" : testCases.length > 0 ? "success" : "neutral",
      source: testCases.length > 0 ? "来自测试样例文件解析" : isProgramming ? "可上传、导入或 AI 生成" : "非编程题不需要",
      content: formatTestCases(testCases),
      emptyText: isProgramming ? "暂无测试样例。" : "非编程题不需要测试样例。",
      action: "展开待接入",
      disabled: true,
    },
    {
      key: "test-script",
      title: "测试脚本资料槽位",
      icon: FileText,
      status: !isProgramming ? "不适用" : testCases.length > 0 ? "待生成脚本" : "缺失",
      tone: isProgramming ? "warning" : "neutral",
      source: isProgramming ? "后端需基于样例生成可下载脚本" : "非编程题不需要",
      content: null,
      emptyText: isProgramming ? "测试脚本下载需要后端新增脚本生成与存储。" : "非编程题不需要测试脚本。",
      action: "下载待接入",
      disabled: true,
    },
  ] as const;

  return (
    <div className="grid gap-3">
      {slots.map((slot) => {
        const Icon = slot.icon;
        return (
          <section key={slot.key} className="rounded-lg border bg-background p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="rounded-md bg-muted p-2 text-muted-foreground">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{slot.title}</h3>
                    <SlotStatus label={slot.status} tone={slot.tone} />
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{slot.source}</p>
                </div>
              </div>
              <Button type="button" variant="secondary" className="h-8 w-fit" disabled={slot.disabled}>
                {slot.action}
              </Button>
            </div>
            <div className="mt-3 rounded-md bg-muted/40 p-3 text-sm">
              <MarkdownMath>{slot.content?.trim() ? slot.content : slot.emptyText}</MarkdownMath>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ToolColumn({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <div className="mt-3 grid gap-2">
        {items.map((item, index) => (
          <label key={item} className="flex items-center gap-2 text-sm">
            <input type={title === "导入内容" ? "checkbox" : "radio"} checked={index === 0} disabled readOnly />
            <span>{item}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

function SummaryMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-md border bg-background p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="mt-1 text-xs leading-5 text-muted-foreground">{detail}</div>
    </div>
  );
}

function SlotStatus({ label, tone }: { label: string; tone: "success" | "warning" | "neutral" }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Circle
        className={cn(
          "h-2.5 w-2.5 fill-current",
          tone === "success" ? "text-accent" : tone === "warning" ? "text-warning" : "text-muted-foreground",
        )}
      />
      {label}
    </span>
  );
}

function getMaterialSummary(problems: ProblemInfo[]) {
  const programming = problems.filter(isProgrammingProblem);
  return {
    missingCriteria: problems.filter((problem) => !hasText(problem.criterion)).length,
    missingAnswers: problems.filter((problem) => !hasText(problem.reference_answer)).length,
    programmingMissingAnswers: programming.filter((problem) => !hasText(problem.reference_answer)).length,
    missingTests: programming.filter((problem) => (problem.test_cases?.length ?? 0) === 0).length,
  };
}

function formatTestCases(testCases: TestCase[]) {
  if (testCases.length === 0) {
    return null;
  }
  const shown = testCases.slice(0, 3).map(formatTestCase).join("\n\n");
  return testCases.length > 3 ? `${shown}\n\n还有 ${testCases.length - 3} 个样例，后续可展开或跳转查看。` : shown;
}

function formatTestCase(testCase: TestCase, index: number) {
  const source = testCase.source === "llm_generated" ? "AI 生成" : "教师提供";
  const description = testCase.description?.trim() ? `\n说明：${testCase.description}` : "";
  return `样例 ${index + 1}（${source}）${description}\n输入：${testCase.input || "-"}\n期望输出：${testCase.expected_output || "-"}`;
}

function isProgrammingProblem(problem: ProblemInfo) {
  const text = `${problem.type ?? ""} ${problem.stem ?? ""}`.toLowerCase();
  return ["编程", "程序", "代码", "python", "java", "c++", "javascript", "program", "coding", "algorithm"].some((token) =>
    text.includes(token),
  );
}

function hasText(value?: string | null) {
  return Boolean(value?.trim());
}
