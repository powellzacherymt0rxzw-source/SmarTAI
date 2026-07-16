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

export const kbKeys = {
  all: ["kb"] as const,
  list: (taskId: string) => ["kb", "list", taskId] as const,
};

export const problemSourceKeys = {
  all: ["problem-sources"] as const,
  library: (taskId: string, scope: string, query: string) =>
    ["problem-sources", "library", taskId, scope, query] as const,
};

export const expertKeys = {
  all: ["experts"] as const,
  list: () => ["experts", "list"] as const,
};

export const analyticsKeys = {
  all: ["analytics"] as const,
  perQuestion: (taskId: string, qId: string) => ["analytics", "perQuestion", taskId, qId] as const,
};

export const healthKeys = {
  root: ["health", "root"] as const,
  status: ["health", "status"] as const,
};
