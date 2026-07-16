import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as tasksApi from "@/api/tasks";
import type { UploadOptions } from "@/api/client";
import type { TaskHistoryQuery, TaskMetadataPatch, TaskStatus } from "@/types";
import { tagKeys, taskKeys } from "./keys";

const ACTIVE_TASK_STATUSES = new Set<TaskStatus>([
  "extracting_problems",
  "parsing_submissions",
  "grading",
]);

export function useTasks() {
  return useQuery({
    queryKey: taskKeys.list(),
    queryFn: tasksApi.listTasks,
    refetchInterval: (query) => {
      const tasks = query.state.data;
      if (!tasks) {
        return false;
      }
      return Object.values(tasks).some((task) => ACTIVE_TASK_STATUSES.has(task.status))
        ? 3_000
        : false;
    },
  });
}

export function useTaskHistory(query: TaskHistoryQuery) {
  const queryKey = historyQueryKey(query);
  return useQuery({
    queryKey: taskKeys.history(queryKey),
    queryFn: () => tasksApi.listTaskHistory(query),
    placeholderData: (previous) => previous,
    refetchInterval: (historyQuery) => {
      const data = historyQuery.state.data;
      return data?.items?.some((task) => ACTIVE_TASK_STATUSES.has(task.status)) ? 3_000 : false;
    },
  });
}

export function useTask(taskId?: string) {
  return useQuery({
    queryKey: taskKeys.detail(taskId ?? ""),
    queryFn: () => tasksApi.getTask(taskId as string),
    enabled: Boolean(taskId),
  });
}

export function useTaskState(taskId?: string, options: { refetchInterval?: number | false; enabled?: boolean } = {}) {
  return useQuery({
    queryKey: taskKeys.state(taskId ?? ""),
    queryFn: () => tasksApi.getTaskState(taskId as string),
    enabled: Boolean(taskId) && (options.enabled ?? true),
    refetchInterval: options.refetchInterval,
  });
}

export function useTaskResult(taskId?: string) {
  return useQuery({
    queryKey: taskKeys.result(taskId ?? ""),
    queryFn: () => tasksApi.getTaskResult(taskId as string),
    enabled: Boolean(taskId),
  });
}

export function useTeacherComments(taskId?: string) {
  return useQuery({
    queryKey: taskKeys.comments(taskId ?? ""),
    queryFn: () => tasksApi.listTeacherComments(taskId as string),
    enabled: Boolean(taskId),
  });
}

export function useCreateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: tasksApi.createTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, patch, name }: { taskId: string; patch?: TaskMetadataPatch; name?: string | null }) =>
      tasksApi.updateTask(taskId, patch ?? { name }),
    onSuccess: (task) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
      queryClient.invalidateQueries({ queryKey: tagKeys.all });
      queryClient.setQueryData(taskKeys.detail(task.task_id), task);
    },
  });
}

export function useInterpretTaskHistoryQuery() {
  return useMutation({
    mutationFn: tasksApi.interpretTaskHistoryQuery,
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: tasksApi.deleteTask,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}

export function useExtractProblems() {
  return useTaskUploadMutation((taskId, file, options) => tasksApi.extractProblems(taskId, file, options));
}

export function useParseSubmissions() {
  return useTaskUploadMutation((taskId, file, options) => tasksApi.parseSubmissions(taskId, file, options));
}

export function useUploadReference() {
  return useTaskUploadMutation((taskId, file, options) => tasksApi.uploadReference(taskId, file, options));
}

export function useUploadTestCases() {
  return useTaskUploadMutation((taskId, file, options) => tasksApi.uploadTestCases(taskId, file, options));
}

export function useStartGrading() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, multiSampleN }: { taskId: string; multiSampleN?: number | null }) =>
      tasksApi.startGrading(taskId, { multiSampleN }),
    onSuccess: (_data, variables) => {
      invalidateTask(queryClient, variables.taskId);
    },
  });
}

export function useUpdateProblem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      qId,
      stem,
      criterion,
      review_status,
      reference_answer,
      test_cases,
    }: {
      taskId: string;
      qId: string;
      stem?: string;
      criterion?: string;
      review_status?: "needs_review" | "edited" | "confirmed";
      reference_answer?: string | null;
      test_cases?: import("@/types").TestCase[] | null;
    }) => tasksApi.updateProblem(taskId, qId, {
      stem,
      criterion,
      review_status,
      reference_answer,
      test_cases,
    }),
    onSuccess: (_data, variables) => {
      invalidateTask(queryClient, variables.taskId);
    },
  });
}

export function useUpdateStudentAnswer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      studentId,
      qId,
      content,
      flag,
    }: {
      taskId: string;
      studentId: string;
      qId: string;
      content?: string;
      flag?: string[];
    }) => tasksApi.updateStudentAnswer(taskId, studentId, qId, { content, flag }),
    onSuccess: (_data, variables) => {
      invalidateTask(queryClient, variables.taskId);
    },
  });
}

export function useSetTeacherComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      taskId,
      studentId,
      qId,
      comment,
    }: {
      taskId: string;
      studentId: string;
      qId: string;
      comment: string;
    }) => tasksApi.setTeacherComment(taskId, studentId, qId, comment),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: taskKeys.comments(variables.taskId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.result(variables.taskId) });
    },
  });
}

function useTaskUploadMutation(
  uploadFn: (taskId: string, file: File, options?: UploadOptions) => ReturnType<typeof tasksApi.extractProblems>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, file, onProgress }: { taskId: string; file: File; onProgress?: UploadOptions["onProgress"] }) =>
      uploadFn(taskId, file, { onProgress }),
    onSuccess: (_data, variables) => {
      invalidateTask(queryClient, variables.taskId);
    },
  });
}

function invalidateTask(queryClient: ReturnType<typeof useQueryClient>, taskId: string) {
  queryClient.invalidateQueries({ queryKey: taskKeys.all });
  queryClient.invalidateQueries({ queryKey: taskKeys.detail(taskId) });
  queryClient.invalidateQueries({ queryKey: taskKeys.state(taskId) });
  queryClient.invalidateQueries({ queryKey: taskKeys.result(taskId) });
}

function historyQueryKey(query: TaskHistoryQuery): string {
  return JSON.stringify({
    page: query.page,
    page_size: query.page_size,
    q: query.q ?? "",
    semester_id: query.semester_id ?? "",
    course_id: query.course_id ?? "",
    tag_ids: [...(query.tag_ids ?? [])].sort(),
    statuses: [...(query.statuses ?? [])].sort(),
    unfinished: Boolean(query.unfinished),
    needs_attention: Boolean(query.needs_attention),
    sort: query.sort,
  });
}
