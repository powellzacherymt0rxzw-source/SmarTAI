import { Circle, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { cn } from "@/lib/cn";
import type { ProblemInfo, StudentAnswerInfo, StudentSubmission } from "@/types";

export interface SubmissionMatrixStats {
  expectedCells: number;
  recognizedCells: number;
  missingCells: number;
  flaggedCells: number;
  emptyCells: number;
}

export function getSubmissionMatrixStats(problems: ProblemInfo[], students: StudentSubmission[]): SubmissionMatrixStats {
  const questionKeys = getQuestionKeys(problems, students);
  let recognizedCells = 0;
  let flaggedCells = 0;
  let emptyCells = 0;

  for (const student of students) {
    const answersByQuestion = new Map((student.stu_ans ?? []).map((answer) => [answer.q_id, answer]));
    for (const question of questionKeys) {
      const answer = answersByQuestion.get(question.id);
      if (!answer) {
        continue;
      }
      recognizedCells += 1;
      if (!answer.content?.trim()) {
        emptyCells += 1;
      }
      if (answer.flag?.length) {
        flaggedCells += 1;
      }
    }
  }

  const expectedCells = questionKeys.length * students.length;
  return {
    expectedCells,
    recognizedCells,
    missingCells: Math.max(expectedCells - recognizedCells, 0),
    flaggedCells,
    emptyCells,
  };
}

export function SubmissionReviewMatrix({
  problems,
  students,
  selectedStudentId,
  filterText,
  onFilterTextChange,
  onSelectStudent,
}: {
  problems: ProblemInfo[];
  students: StudentSubmission[];
  selectedStudentId: string | null;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  onSelectStudent: (studentId: string) => void;
}) {
  const questions = getQuestionKeys(problems, students);
  const normalizedFilter = filterText.trim().toLowerCase();
  const rows = students.filter((student) => matchesStudentFilter(student, normalizedFilter));

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-full pl-9"
            value={filterText}
            placeholder="筛选学生，例如：姓名、学号、缺失、需复核"
            onChange={(event) => onFilterTextChange(event.target.value)}
          />
        </label>
        <span className="text-sm text-muted-foreground">
          {rows.length}/{students.length} 名学生 · {questions.length} 道题
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="min-w-[760px] w-full border-collapse text-left text-sm">
          <thead className="bg-muted/50 text-xs font-medium text-muted-foreground">
            <tr>
              <th className="sticky left-0 z-10 min-w-44 bg-muted/50 px-3 py-2">学生</th>
              {questions.map((question) => (
                <th key={question.id} className="px-3 py-2">
                  {question.label}
                </th>
              ))}
              <th className="px-3 py-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((student) => {
              const active = student.stu_id === selectedStudentId;
              const answersByQuestion = new Map((student.stu_ans ?? []).map((answer) => [answer.q_id, answer]));
              return (
                <tr key={student.stu_id} className={cn("align-top hover:bg-muted/30", active ? "bg-primary/5" : "")}>
                  <td className="sticky left-0 z-10 bg-card px-3 py-3">
                    <button type="button" className="text-left" onClick={() => onSelectStudent(student.stu_id)}>
                      <span className="block font-medium">{studentName(student)}</span>
                      <span className="mt-1 block text-xs text-muted-foreground">{student.stu_id}</span>
                    </button>
                  </td>
                  {questions.map((question) => (
                    <td key={question.id} className="px-3 py-3">
                      <AnswerCell answer={answersByQuestion.get(question.id)} />
                    </td>
                  ))}
                  <td className="px-3 py-3 text-right">
                    <Button type="button" variant="secondary" className="h-8" onClick={() => onSelectStudent(student.stu_id)}>
                      查看
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="border-t p-6 text-center text-sm text-muted-foreground">
            没有匹配的学生。可以换成学号、姓名、“缺失”或“需复核”。
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AnswerCell({ answer }: { answer?: StudentAnswerInfo }) {
  if (!answer) {
    return <CellStatus label="缺失" tone="warning" />;
  }
  if (answer.flag?.length) {
    return <CellStatus label="需复核" tone="warning" detail={answer.flag.slice(0, 2).join("、")} />;
  }
  if (!answer.content?.trim()) {
    return <CellStatus label="空答案" tone="warning" />;
  }
  return <CellStatus label="已识别" tone="success" />;
}

function CellStatus({
  label,
  tone,
  detail,
}: {
  label: string;
  tone: "success" | "warning" | "neutral";
  detail?: string;
}) {
  return (
    <span className="inline-flex min-h-8 flex-col justify-center gap-1 text-xs">
      <span className="inline-flex items-center gap-2">
        <Circle
          className={cn(
            "h-2.5 w-2.5 fill-current",
            tone === "success" ? "text-accent" : tone === "warning" ? "text-warning" : "text-muted-foreground",
          )}
        />
        <span className="text-muted-foreground">{label}</span>
      </span>
      {detail ? <span className="max-w-32 truncate text-muted-foreground/80">{detail}</span> : null}
    </span>
  );
}

function getQuestionKeys(problems: ProblemInfo[], students: StudentSubmission[]) {
  const problemKeys = problems.map((problem) => ({
    id: problem.q_id,
    label: problem.number || problem.q_id,
  }));
  const seen = new Set(problemKeys.map((problem) => problem.id));
  const answerKeys = students.flatMap((student) => student.stu_ans ?? []).flatMap((answer) => {
    if (seen.has(answer.q_id)) {
      return [];
    }
    seen.add(answer.q_id);
    return [{ id: answer.q_id, label: answer.number || answer.q_id }];
  });
  return [...problemKeys, ...answerKeys].sort((a, b) => naturalCompare(a.label, b.label));
}

function matchesStudentFilter(student: StudentSubmission, normalizedFilter: string) {
  if (!normalizedFilter) {
    return true;
  }
  const hasReviewFlag = (student.stu_ans ?? []).some((answer) => answer.flag?.length || !answer.content?.trim());
  const haystack = `${student.stu_id} ${student.stu_name}`.toLowerCase();
  if (["缺失", "需复核", "低置信", "异常"].some((token) => normalizedFilter.includes(token))) {
    return hasReviewFlag;
  }
  return haystack.includes(normalizedFilter);
}

function studentName(student: StudentSubmission) {
  return student.stu_name || student.stu_id;
}

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
