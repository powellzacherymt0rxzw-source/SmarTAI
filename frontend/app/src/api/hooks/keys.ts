export const authKeys = {
  me: ["auth", "me"] as const,
};

export const taskKeys = {
  all: ["tasks"] as const,
  list: () => ["tasks", "list"] as const,
  history: (queryKey: string) => ["tasks", "history", queryKey] as const,
  detail: (taskId: string) => ["tasks", "detail", taskId] as const,
  state: (taskId: string) => ["tasks", "state", taskId] as const,
  result: (taskId: string) => ["tasks", "result", taskId] as const,
  finalization: (taskId: string) => ["tasks", "finalization", taskId] as const,
  artifacts: (taskId: string) => ["tasks", "artifacts", taskId] as const,
  comments: (taskId: string) => ["tasks", "comments", taskId] as const,
};

export const tagKeys = {
  all: ["tags"] as const,
  list: () => ["tags", "list"] as const,
  search: (query: string) => ["tags", "search", query] as const,
};

export const courseKeys = {
  all: ["courses"] as const,
  list: () => ["courses", "list"] as const,
  search: (query: string) => ["courses", "search", query] as const,
};

export const courseMaterialKeys = {
  all: ["course-materials"] as const,
  list: (queryKey: string) => ["course-materials", "list", queryKey] as const,
  groups: (query: string) => ["course-materials", "groups", query] as const,
};

export const kbKeys = {
  all: ["kb"] as const,
  list: (taskId: string) => ["kb", "list", taskId] as const,
};

export const problemSourceKeys = {
  all: ["problem-sources"] as const,
  library: (taskId: string, scope: string, query: string) =>
    ["problem-sources", "library", taskId, scope, query] as const,
};

export const materialImportKeys = {
  all: ["material-imports"] as const,
  detail: (taskId: string, jobId: string) => ["material-imports", taskId, jobId] as const,
};

export const aiCompletionKeys = {
  all: ["ai-completions"] as const,
  preflight: (taskId: string) => ["ai-completions", taskId, "preflight"] as const,
  detail: (taskId: string, jobId: string) => ["ai-completions", taskId, jobId] as const,
};

export const gradingSetupKeys = {
  all: ["grading-setup"] as const,
  detail: (taskId: string) => ["grading-setup", taskId] as const,
};

export const expertKeys = {
  all: ["experts"] as const,
  list: () => ["experts", "list"] as const,
  catalog: () => ["experts", "catalog"] as const,
};

export const analyticsKeys = {
  all: ["analytics"] as const,
  perQuestion: (taskId: string, qId: string) => ["analytics", "perQuestion", taskId, qId] as const,
};

export const healthKeys = {
  root: ["health", "root"] as const,
  status: ["health", "status"] as const,
};
