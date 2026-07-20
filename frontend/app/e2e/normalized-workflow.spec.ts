import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

const backend = "http://127.0.0.1:8000";

async function loginAs(page: Page, role: "teacher" | "student" | "admin", name: string) {
  const token = `demo-${role}-${name}`;
  await page.addInitScript((t) => window.localStorage.setItem("smartai_token", t), token);
  await page.goto("/");
}

async function api(
  request: APIRequestContext,
  token: string,
  path: string,
  method = "GET",
  data?: unknown,
) {
  const response = await request.fetch(`${backend}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    data,
  });
  const body = await response.text();
  expect(response.ok(), `${method} ${path}: ${body}`).toBeTruthy();
  return body ? JSON.parse(body) : null;
}

test("role demo login lands on each role workspace", async ({ page }) => {
  await loginAs(page, "teacher", "e2e-teacher");
  await expect(page).toHaveURL(/\/teacher/);
  await expect(page.getByRole("heading", { name: /教师/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("link", { name: "课程", exact: true })).toBeVisible();

  await loginAs(page, "student", "e2e-student");
  await expect(page).toHaveURL(/\/student/);
  await expect(page.getByRole("heading", { name: /学生/ })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("link", { name: "我的成绩" })).toBeVisible();

  await loginAs(page, "admin", "e2e-admin");
  await expect(page).toHaveURL(/\/admin/);
  await expect(page.getByRole("heading", { name: /总览|Dashboard/ })).toBeVisible({ timeout: 15000 });
});

test("three-role normalized workflow persists released result", async ({ page, request }) => {
  const teacherToken = "demo-teacher-e2e-flow-teacher";
  const studentToken = "demo-student-e2e-flow-student";
  const studentId = "demo_e2e-flow-student";

  // Touch the student identity before enrollment so the FK-backed user exists.
  await api(request, studentToken, "/courses");
  const course = await api(request, teacherToken, "/courses", "POST", { name: "E2E Algebra", code: "E2E" });
  await api(request, teacherToken, `/courses/${course.id}/enroll`, "POST", { student_ids: [studentId] });
  const assignment = await api(request, teacherToken, "/assignments", "POST", {
    course_id: course.id,
    name: "E2E Homework",
  });
  await api(request, teacherToken, `/assignments/${assignment.id}/questions`, "POST", {
    q_id: "q1",
    number: "1",
    type: "short",
    stem: "1 + 1 = ?",
    reference_answer: "2",
    max_score: 10,
  });
  await api(request, teacherToken, `/assignments/${assignment.id}/publish`, "POST", { expected_version: 1 });
  await api(request, studentToken, "/submissions/submit", "POST", {
    assignment_id: assignment.id,
    answers: [{ q_id: "q1", content: "2" }],
  });

  const run = await api(request, teacherToken, "/grading-runs", "POST", { assignment_id: assignment.id });
  let terminal = run;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const snapshot = await api(request, teacherToken, `/grading-runs/${run.id}`);
    terminal = snapshot.run;
    if (["completed", "partial_failed", "failed"].includes(terminal.status)) break;
  }
  expect(["completed", "partial_failed"]).toContain(terminal.status);

  const queue = await api(request, teacherToken, `/results/assignment/${assignment.id}/review-queue`);
  expect(queue).toHaveLength(1);
  await api(request, teacherToken, `/grading-runs/results/${queue[0].id}/review`, "POST", {
    new_score: 7,
    new_comment: "教师复核",
  });
  await api(request, teacherToken, `/grading-runs/${run.id}/release`, "POST");

  const result = await api(request, studentToken, `/results/assignment/${assignment.id}/me`);
  expect(result).toEqual([expect.objectContaining({ q_id: "q1", score: 7, comment: "教师复核" })]);
  // A second read proves the released state is durable and not held only in UI state.
  const reread = await api(request, studentToken, `/results/assignment/${assignment.id}/me`);
  expect(reread).toEqual(result);
  await loginAs(page, "student", "e2e-flow-student");
  await expect(page).toHaveURL(/\/student/);
});
