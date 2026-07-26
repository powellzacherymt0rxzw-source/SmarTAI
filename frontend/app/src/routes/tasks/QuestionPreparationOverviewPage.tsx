import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, ChevronRight, Filter, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router-dom";
import { useTask } from "@/api/hooks/tasks";
import { NewTaskStepper } from "@/components/new-task/NewTaskStepper";
import { useI18n } from "@/i18n/I18nProvider";
import { cn } from "@/lib/cn";
import type { PreparationIssue, ProblemInfo } from "@/types";

type RiskRow = {
  problem: ProblemInfo;
  issue: PreparationIssue;
};

type RiskSortKey = "number" | "type" | "field" | "reason" | "severity";
type RiskSortDirection = "asc" | "desc";

export function QuestionPreparationOverviewPage() {
  const { taskId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { locale } = useI18n();
  const taskQuery = useTask(taskId);
  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);
  const composingRef = useRef(false);
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<RiskSortKey>("number");
  const [sortDirection, setSortDirection] = useState<RiskSortDirection>("asc");
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (!composingRef.current) setQuery(urlQuery);
  }, [urlQuery]);

  const problems = useMemo(
    () => sortProblems(Object.values(taskQuery.data?.problem_data ?? {}), locale),
    [locale, taskQuery.data?.problem_data],
  );
  const allRisks = useMemo(() => collectRiskRows(problems), [problems]);
  const availableTypes = useMemo(
    () => [...new Set(allRisks.map((row) => row.problem.type || tx(locale, "未分类", "Uncategorized")))].sort((a, b) => a.localeCompare(b, locale)),
    [allRisks, locale],
  );
  const risks = useMemo(() => {
    const textFiltered = filterRisks(allRisks, deferredQuery);
    const typeFiltered = selectedTypes.size
      ? textFiltered.filter((row) => selectedTypes.has(row.problem.type || tx(locale, "未分类", "Uncategorized")))
      : textFiltered;
    return sortRiskRows(typeFiltered, sortKey, sortDirection, locale);
  }, [allRisks, deferredQuery, locale, selectedTypes, sortDirection, sortKey]);
  const metrics = useMemo(() => ({
    questions: new Set(allRisks.map((row) => row.problem.q_id)).size,
    lowConfidence: allRisks.filter((row) => row.issue.code === "low_confidence").length,
    conflicts: allRisks.filter((row) => ["source_conflict", "ai_source_conflict", "rubric_step_reference_conflict"].includes(row.issue.code)).length,
    anomalies: allRisks.filter((row) => ["parse_anomaly", "generation_failed", "invalid_test_case", "reference_solution_failed_case"].includes(row.issue.code)).length,
  }), [allRisks]);

  if (taskQuery.isSuccess && taskQuery.data.status === "draft") {
    return <Navigate replace to={`/tasks/${taskId}/upload/problems`} />;
  }
  if (taskQuery.isSuccess && taskQuery.data.status === "extracting_problems") {
    return <Navigate replace to={`/tasks/${taskId}/problems/progress`} />;
  }

  function updateQuery(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set("q", value);
    else next.delete("q");
    setSearchParams(next, { replace: true });
  }

  function toggleSort(key: RiskSortKey) {
    if (sortKey === key) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortKey(key);
    setSortDirection("asc");
  }

  function toggleType(type: string) {
    setSelectedTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }

  const firstQuestionId = problems[0]?.q_id;
  return (
    <div className="w-full max-w-[1300px]">
      <h1 className="text-[30px] font-bold leading-9 tracking-[-0.02em] text-foreground">
        {tx(locale, "题目资料风险总览", "Question Material Risk Overview")}
      </h1>
      <NewTaskStepper currentStep={2} />

      <section className="mt-[22px]" aria-labelledby="risk-matrix-title">
        <h2 id="risk-matrix-title" className="sr-only">{tx(locale, "需要教师关注的题目资料", "Question material risks")}</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <RiskMetric label={tx(locale, "待关注题目", "Questions to Review")} value={metrics.questions} tone="primary" />
          <RiskMetric label={tx(locale, "低置信项", "Low Confidence")} value={metrics.lowConfidence} tone="warning" />
          <RiskMetric label={tx(locale, "来源冲突", "Source Conflicts")} value={metrics.conflicts} tone="danger" />
          <RiskMetric label={tx(locale, "解析异常", "Parse Anomalies")} value={metrics.anomalies} tone="accent" />
        </dl>

        <label className="relative mt-4 block">
          <span className="sr-only">{tx(locale, "筛选风险", "Filter risks")}</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              setQuery(event.currentTarget.value);
              updateQuery(event.currentTarget.value);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              if (!composingRef.current) updateQuery(event.target.value);
            }}
            placeholder={tx(locale, "搜索题号、题型、风险字段或原因", "Search question, type, field, or risk")}
            className="h-12 w-full rounded-[10px] border bg-card pl-11 pr-4 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
          />
        </label>

        <div className="mt-4 overflow-hidden rounded-[10px] border bg-card">
          {taskQuery.isLoading ? (
            <div className="min-h-[300px] animate-pulse bg-muted/20" aria-busy="true" />
          ) : taskQuery.isError ? (
            <div className="flex min-h-[300px] flex-col items-center justify-center px-5 text-center">
              <p className="text-sm font-semibold text-foreground">{tx(locale, "无法读取题目资料状态", "Question material status could not be loaded")}</p>
              <button type="button" onClick={() => void taskQuery.refetch()} className="mt-3 h-9 rounded-[7px] border px-4 text-sm font-semibold hover:bg-muted">{tx(locale, "重新加载", "Reload")}</button>
            </div>
          ) : risks.length ? (
            <RiskTable
              rows={risks}
              taskId={taskId ?? ""}
              locale={locale}
              sortKey={sortKey}
              sortDirection={sortDirection}
              availableTypes={availableTypes}
              selectedTypes={selectedTypes}
              onSort={toggleSort}
              onToggleType={toggleType}
              onClearTypes={() => setSelectedTypes(new Set())}
            />
          ) : (
            <div className="flex min-h-[270px] flex-col items-center justify-center px-5 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40"><AlertTriangle aria-hidden="true" className="h-5 w-5" /></span>
              <p className="mt-4 text-sm font-semibold text-foreground">{query || selectedTypes.size ? tx(locale, "没有匹配的风险项", "No matching risks") : tx(locale, "没有需要额外处理的风险", "No additional risks need attention")}</p>
              <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">{tx(locale, "正常识别、AI 生成和非编程题不再显示为“缺失”。你仍可进入完整审核，连续浏览所有题目资料。", "Normal recognition, AI generation, and non-programming questions are not shown as missing. You can still review every question continuously.")}</p>
            </div>
          )}
          <footer className="flex min-h-[58px] flex-col gap-2 border-t px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between xl:px-5">
            <p className="text-xs text-muted-foreground">{tx(locale, `显示 ${risks.length} / ${allRisks.length} 个开放风险`, `Showing ${risks.length} / ${allRisks.length} open risks`)}</p>
            {taskId && firstQuestionId ? (
              <Link to={`/tasks/${taskId}/questions/${encodeURIComponent(firstQuestionId)}/content`} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[7px] bg-primary px-4 text-sm font-semibold text-primary-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring">
                {tx(locale, "进入完整审核", "Open Full Review")}
                <ChevronRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            ) : null}
          </footer>
        </div>
      </section>
    </div>
  );
}

function RiskTable({ rows, taskId, locale, sortKey, sortDirection, availableTypes, selectedTypes, onSort, onToggleType, onClearTypes }: {
  rows: RiskRow[];
  taskId: string;
  locale: string;
  sortKey: RiskSortKey;
  sortDirection: RiskSortDirection;
  availableTypes: string[];
  selectedTypes: Set<string>;
  onSort: (key: RiskSortKey) => void;
  onToggleType: (type: string) => void;
  onClearTypes: () => void;
}) {
  return (
    <div className="max-h-[calc(100vh-520px)] min-h-[280px] overflow-auto overscroll-contain">
      <table className="w-full min-w-[880px] border-collapse text-left text-[13px]">
        <thead className="sticky top-0 z-10 bg-muted/95 text-[12px] font-semibold text-muted-foreground backdrop-blur-sm">
          <tr className="border-b">
            <SortableHeading className="w-[100px] px-5" label={tx(locale, "题号", "No.")} sortKey="number" activeKey={sortKey} direction={sortDirection} locale={locale} onSort={onSort} />
            <th className="relative w-[170px] px-3 py-3" aria-sort={sortKey === "type" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
              <div className="flex items-center gap-1">
                <SortButton label={tx(locale, "题型", "Type")} sortKey="type" activeKey={sortKey} direction={sortDirection} locale={locale} onSort={onSort} />
                <details className="relative">
                  <summary aria-label={tx(locale, "筛选题型", "Filter types")} className={cn("flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-[5px] hover:bg-slate-200 dark:hover:bg-slate-700", selectedTypes.size && "bg-blue-100 text-primary dark:bg-blue-950/40")}><Filter aria-hidden="true" className="h-3.5 w-3.5" /></summary>
                  <div className="absolute left-0 top-8 z-30 w-56 rounded-[8px] border bg-card p-2 shadow-xl">
                    <div className="mb-1 flex items-center justify-between px-2 py-1">
                      <span className="text-xs font-semibold text-foreground">{tx(locale, "选择一个或多个题型", "Select one or more types")}</span>
                      {selectedTypes.size ? <button type="button" onClick={onClearTypes} className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted" aria-label={tx(locale, "清空题型筛选", "Clear type filter")}><X aria-hidden="true" className="h-3.5 w-3.5" /></button> : null}
                    </div>
                    {availableTypes.map((type) => <label key={type} className="flex cursor-pointer items-center gap-2 rounded-[6px] px-2 py-2 text-xs font-medium text-foreground hover:bg-muted"><input type="checkbox" checked={selectedTypes.has(type)} onChange={() => onToggleType(type)} className="h-4 w-4 accent-primary" />{type}</label>)}
                  </div>
                </details>
              </div>
            </th>
            <SortableHeading className="w-[160px] px-3" label={tx(locale, "风险字段", "Field")} sortKey="field" activeKey={sortKey} direction={sortDirection} locale={locale} onSort={onSort} />
            <SortableHeading className="px-3" label={tx(locale, "需要关注的原因", "Reason")} sortKey="reason" activeKey={sortKey} direction={sortDirection} locale={locale} onSort={onSort} />
            <SortableHeading className="w-[130px] px-3" label={tx(locale, "严重度", "Severity")} sortKey="severity" activeKey={sortKey} direction={sortDirection} locale={locale} onSort={onSort} />
            <th className="w-[100px] px-5 py-3 text-right">{tx(locale, "操作", "Action")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map(({ problem, issue }) => (
            <tr key={issue.issue_id} className="h-[58px] hover:bg-muted/30">
              <td className="px-5 py-3 font-semibold text-foreground">{problem.number || problem.q_id}</td>
              <td className="px-3 py-3 text-muted-foreground">{problem.type || tx(locale, "未分类", "Uncategorized")}</td>
              <td className="px-3 py-3"><span className="inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{issueFieldLabel(issue.field, locale)}</span></td>
              <td className="px-3 py-3 text-foreground">{issueCodeLabel(issue.code, locale)}</td>
              <td className="px-3 py-3"><SeverityBadge severity={issue.severity} locale={locale} /></td>
              <td className="px-5 py-3 text-right"><Link to={`/tasks/${taskId}/questions/${encodeURIComponent(problem.q_id)}/content#question-${encodeURIComponent(problem.q_id)}`} className="text-xs font-semibold text-primary hover:underline">{tx(locale, "查看", "Review")}</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeading({ className, label, sortKey, activeKey, direction, locale, onSort }: { className: string; label: string; sortKey: RiskSortKey; activeKey: RiskSortKey; direction: RiskSortDirection; locale: string; onSort: (key: RiskSortKey) => void }) {
  return <th className={cn("py-3", className)} aria-sort={activeKey === sortKey ? direction === "asc" ? "ascending" : "descending" : "none"}><SortButton label={label} sortKey={sortKey} activeKey={activeKey} direction={direction} locale={locale} onSort={onSort} /></th>;
}

function SortButton({ label, sortKey, activeKey, direction, locale, onSort }: { label: string; sortKey: RiskSortKey; activeKey: RiskSortKey; direction: RiskSortDirection; locale: string; onSort: (key: RiskSortKey) => void }) {
  const active = activeKey === sortKey;
  const Icon = active ? direction === "asc" ? ArrowUp : ArrowDown : ArrowUpDown;
  return <button type="button" onClick={() => onSort(sortKey)} className="inline-flex h-7 items-center gap-1 rounded-[5px] text-left font-semibold hover:text-foreground" aria-label={tx(locale, `按${label}排序`, `Sort by ${label}`)}>{label}<Icon aria-hidden="true" className={cn("h-3.5 w-3.5", active ? "text-primary" : "text-slate-400")} /></button>;
}

function RiskMetric({ label, value, tone }: { label: string; value: number; tone: "primary" | "warning" | "danger" | "accent" }) {
  return (
    <div className="flex min-h-[112px] flex-col justify-center rounded-[10px] border bg-card px-5 py-4 sm:px-6">
      <dt className="order-2 mt-2 text-sm font-medium text-muted-foreground">{label}</dt>
      <dd className={cn("order-1 text-[30px] font-bold leading-9 tracking-[-0.02em]", tone === "primary" && "text-primary", tone === "warning" && "text-amber-600", tone === "danger" && "text-red-600", tone === "accent" && "text-teal-600")}>{value}</dd>
    </div>
  );
}

function SeverityBadge({ severity, locale }: { severity: PreparationIssue["severity"]; locale: string }) {
  const label = severity === "blocking" ? tx(locale, "阻断", "Blocking") : severity === "warning" ? tx(locale, "需核对", "Review") : tx(locale, "提示", "Info");
  return <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-semibold", severity === "blocking" ? "bg-red-100 text-red-700" : severity === "warning" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700")}>{label}</span>;
}

function collectRiskRows(problems: ProblemInfo[]): RiskRow[] {
  return problems.flatMap((problem) => (problem.preparation_issues ?? [])
    .filter((issue) => issue.status === "open")
    .map((issue) => ({ problem, issue })));
}

function filterRisks(rows: RiskRow[], rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase();
  if (!query) return rows;
  const tokens = query.split(/[\s,，;；]+/).filter(Boolean);
  return rows.filter(({ problem, issue }) => tokens.every((token) => [
    problem.number,
    problem.q_id,
    problem.type,
    issue.field,
    issue.code,
    ...(issue.source_ids ?? []),
  ].join(" ").toLocaleLowerCase().includes(token)));
}

function sortRiskRows(rows: RiskRow[], key: RiskSortKey, direction: RiskSortDirection, locale: string) {
  const severityRank: Record<PreparationIssue["severity"], number> = { blocking: 0, warning: 1, info: 2 };
  const value = (row: RiskRow) => {
    if (key === "number") return row.problem.number || row.problem.q_id;
    if (key === "type") return row.problem.type || "";
    if (key === "field") return issueFieldLabel(row.issue.field, locale);
    if (key === "reason") return issueCodeLabel(row.issue.code, locale);
    return severityRank[row.issue.severity];
  };
  return [...rows].sort((left, right) => {
    const a = value(left);
    const b = value(right);
    const compared = typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), locale, { numeric: true });
    return direction === "asc" ? compared : -compared;
  });
}

function sortProblems(problems: ProblemInfo[], locale: string) {
  return [...problems].sort((a, b) => (a.number || a.q_id).localeCompare(b.number || b.q_id, locale, { numeric: true }));
}

function issueFieldLabel(field: PreparationIssue["field"], locale: string) {
  const labels = {
    stem: ["题目", "Problem"],
    answer: ["标答", "Answer"],
    rubric: ["评分标准", "Rubric"],
    programming_tests: ["测试样例", "Tests"],
    source: ["资料来源", "Source"],
  } as const;
  return locale === "zh-CN" ? labels[field][0] : labels[field][1];
}

function issueCodeLabel(code: PreparationIssue["code"], locale: string) {
  const labels: Record<PreparationIssue["code"], [string, string]> = {
    low_confidence: ["匹配置信度较低，请与原文件核对", "Low-confidence match; compare with the source"],
    source_conflict: ["多份教师资料内容不一致", "Teacher sources disagree"],
    ai_source_conflict: ["AI 结果与原文件存在冲突", "AI output conflicts with the source"],
    ambiguous_question_match: ["无法唯一匹配到题号", "Question match is ambiguous"],
    unmapped_source_content: ["原文件中有内容尚未匹配", "Some source content is unmatched"],
    parse_anomaly: ["文件解析结果异常", "File parsing anomaly"],
    generation_failed: ["所需内容生成失败", "Required content generation failed"],
    rubric_step_reference_conflict: ["评分步骤与标答步骤未正确对应", "Rubric steps do not align with answer steps"],
    invalid_test_case: ["测试样例结构无效", "Invalid test case structure"],
    reference_solution_failed_case: ["参考解未通过测试样例", "Reference solution failed a test"],
  };
  return locale === "zh-CN" ? labels[code][0] : labels[code][1];
}

function tx(locale: string, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}
