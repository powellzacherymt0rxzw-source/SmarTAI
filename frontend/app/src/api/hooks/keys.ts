export const authKeys = {
  me: ["auth", "me"] as const,
};

export const personalKnowledgeKeys = {
  all: ["personal-knowledge"] as const,
  list: () => ["personal-knowledge", "list"] as const,
};

export const expertKeys = {
  all: ["experts"] as const,
  list: () => ["experts", "list"] as const,
};

export const healthKeys = {
  root: ["health", "root"] as const,
  status: ["health", "status"] as const,
};

// Normalized education workflow query keys. Keys include the resource ids
// (course/assignment/submission/run) so cache invalidation is scoped precisely.
export const courseKeys = {
  all: ["courses"] as const,
  list: () => ["courses", "list"] as const,
  detail: (courseId: string) => ["courses", "detail", courseId] as const,
};

export const assignmentKeys = {
  all: ["assignments"] as const,
  list: (courseId: string) => ["assignments", "list", courseId] as const,
  detail: (assignmentId: string) => ["assignments", "detail", assignmentId] as const,
  questions: (assignmentId: string) => ["assignments", assignmentId, "questions"] as const,
};

export const submissionKeys = {
  all: ["submissions"] as const,
  list: (assignmentId: string) => ["submissions", "list", assignmentId] as const,
  detail: (submissionId: string) => ["submissions", "detail", submissionId] as const,
};

export const gradingRunKeys = {
  all: ["grading-runs"] as const,
  list: (assignmentId: string) => ["grading-runs", "list", assignmentId] as const,
  detail: (runId: string) => ["grading-runs", "detail", runId] as const,
  reviewQueue: (assignmentId: string) => ["grading-runs", "review", assignmentId] as const,
};

export const resultKeys = {
  all: ["results"] as const,
  summary: (assignmentId: string) => ["results", "summary", assignmentId] as const,
  student: (assignmentId: string, studentId: string) => ["results", "student", assignmentId, studentId] as const,
  perQuestion: (assignmentId: string) => ["results", "per-question", assignmentId] as const,
  me: (assignmentId: string) => ["results", "me", assignmentId] as const,
};

export const adminKeys = {
  all: ["admin"] as const,
  users: (filter?: { role?: string; is_active?: boolean }) => ["admin", "users", filter ?? {}] as const,
  invites: () => ["admin", "invites"] as const,
};
