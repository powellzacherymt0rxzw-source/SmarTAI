import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddProblemsPage } from "./AddProblemsPage";

const preflightMutateAsync = vi.hoisted(() => vi.fn());
const startMutateAsync = vi.hoisted(() => vi.fn());

vi.mock("@/api/hooks", () => ({
  useExperts: () => ({
    data: [{ provider_id: "mock:test", enabled: true }],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useProblemSourceLibrary: () => ({
    data: { items: [] },
    isFetching: false,
  }),
  useProblemSourcePreflight: () => ({
    isPending: false,
    mutateAsync: preflightMutateAsync,
  }),
  useQuestionPreparationCapabilities: () => ({
    data: {
      source_roles: {
        problem: { accepted_extensions: [".pdf", ".jpg", ".png", ".webp"] },
        reference_answer: { accepted_extensions: [".pdf", ".jpg", ".png", ".webp"] },
        rubric: { accepted_extensions: [".pdf", ".jpg", ".png", ".webp"] },
        programming_tests: { accepted_extensions: [".pdf", ".json"] },
      },
      reader: { ocr: true },
      score_policy: {
        maximum_max_score: 10_000,
        per_question_text_max_characters: 12_000,
      },
    },
  }),
  useStartQuestionPreparation: () => ({
    isPending: false,
    mutateAsync: startMutateAsync,
  }),
  useTask: () => ({
    isSuccess: true,
    data: {
      task_id: "task-1",
      name: "Assignment",
      status: "draft",
      workflow_revision: 0,
      problem_count: 0,
      problem_file_name: null,
      course_id: "course-1",
    },
    refetch: vi.fn(),
  }),
}));

vi.mock("@/components/new-task/NewTaskStepper", () => ({
  NewTaskStepper: () => null,
}));

vi.mock("@/i18n/I18nProvider", () => ({
  useI18n: () => ({ locale: "zh-CN" }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function renderPage() {
  const router = createMemoryRouter([
    { path: "/tasks/:taskId/upload/problems", element: <AddProblemsPage /> },
    { path: "/tasks/:taskId/problems/progress", element: <div>Preparation started</div> },
  ], { initialEntries: ["/tasks/task-1/upload/problems"] });
  render(<RouterProvider router={router} />);
  return router;
}

async function uploadProblemFile(user: ReturnType<typeof userEvent.setup>) {
  const file = new File(["1. Explain dependency injection"], "questions.pdf", {
    type: "application/pdf",
  });
  await user.upload(screen.getByLabelText("选择文件"), file);
}

beforeEach(() => {
  preflightMutateAsync.mockReset();
  startMutateAsync.mockReset();
  preflightMutateAsync.mockResolvedValue({ source_token: "source-1" });
  startMutateAsync.mockResolvedValue({ status: "started", job_id: "job-1" });
});

describe("AddProblemsPage score configuration", () => {
  it("sends an explicitly edited uniform maximum score", async () => {
    const user = userEvent.setup();
    renderPage();
    await uploadProblemFile(user);

    await user.click(screen.getByRole("button", { name: /3\. 评分标准/ }));
    const scoreInput = screen.getByRole("spinbutton", { name: "每题满分" });
    expect(scoreInput).toHaveValue(10);
    await user.clear(scoreInput);
    await user.type(scoreInput, "5");
    await user.click(screen.getByRole("button", { name: "识别并准备题目资料" }));

    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      scorePolicy: { mode: "uniform", uniformMaxScore: 5 },
    })));
    expect(await screen.findByText("Preparation started")).toBeInTheDocument();
  });

  it("sends per-question natural-language score instructions", async () => {
    const user = userEvent.setup();
    renderPage();
    await uploadProblemFile(user);

    await user.click(screen.getByRole("button", { name: /3\. 评分标准/ }));
    await user.click(screen.getByRole("checkbox", { name: "每题满分不同" }));
    await user.type(
      screen.getByRole("textbox", { name: "每题满分说明" }),
      "第 1 题 5 分，第 2 题 15 分",
    );
    await user.click(screen.getByRole("button", { name: "识别并准备题目资料" }));

    await waitFor(() => expect(startMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      scorePolicy: {
        mode: "per_question",
        perQuestionText: "第 1 题 5 分，第 2 题 15 分",
      },
    })));
  });
});
