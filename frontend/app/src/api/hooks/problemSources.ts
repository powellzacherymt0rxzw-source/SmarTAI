import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as problemSourcesApi from "@/api/problemSources";
import type { ProblemSourceScope } from "@/types";
import { problemSourceKeys, taskKeys } from "./keys";

export function useProblemSourceLibrary(
  taskId: string | undefined,
  scope: ProblemSourceScope,
  query: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: problemSourceKeys.library(taskId ?? "", scope, query),
    queryFn: () => problemSourcesApi.listProblemSourceLibrary(taskId as string, { scope, query }),
    enabled: Boolean(taskId) && enabled,
  });
}

export function useProblemSourcePreflight() {
  return useMutation({ mutationFn: problemSourcesApi.preflightProblemSource });
}

export function useStartProblemExtraction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: problemSourcesApi.startProblemExtraction,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: taskKeys.detail(variables.taskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.state(variables.taskId) });
    },
  });
}
