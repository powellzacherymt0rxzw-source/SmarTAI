import { describe, expect, it } from "vitest";
import type { Correction } from "@/types";
import {
  buildResultsModel,
  correctionReviewDraftScore,
  correctionReviewReasonIds,
  displayableCorrectionScore,
} from "./resultsModel";

function correction(patch: Partial<Correction> = {}): Correction {
  return {
    q_id: "q1",
    type: "short_answer",
    score: null,
    provisional_score: 7,
    max_score: 10,
    confidence: 0.4,
    comment: "The result needs review.",
    steps: [],
    expert_results: [],
    requires_human_review: true,
    review_reasons: ["low_confidence,high_indecisiveness"],
    review_status: "pending",
    ...patch,
  };
}

describe("review score presentation", () => {
  it("does not present a provisional or legacy pending score as a formal grade", () => {
    const pending = correction();

    expect(displayableCorrectionScore(pending)).toBeNull();
    expect(correctionReviewDraftScore(pending)).toBe("");
    expect(displayableCorrectionScore(correction({ score: 7 }))).toBeNull();
  });

  it("shows a teacher-entered zero and a confirmed AI score", () => {
    expect(displayableCorrectionScore(correction({ teacher_score: 0, review_status: "edited" }))).toBe(0);
    expect(displayableCorrectionScore(correction({ score: 7, requires_human_review: false, review_status: "confirmed" }))).toBe(7);
  });

  it("normalizes comma-joined backend review reasons", () => {
    expect(correctionReviewReasonIds(correction())).toEqual(["low_confidence", "high_indecisiveness"]);
  });
});

describe("formal result statistics", () => {
  it("preserves a confirmed zero and excludes unresolved scores from all score aggregates", () => {
    const model = buildResultsModel(undefined, {
      status: "completed",
      task_id: "task-1",
      problem_data: {
        q1: {
          q_id: "q1",
          number: "1",
          type: "short_answer",
          stem: "Question 1",
          criterion: "Rubric 1",
          max_score: 10,
        },
        q2: {
          q_id: "q2",
          number: "2",
          type: "short_answer",
          stem: "Question 2",
          criterion: "Rubric 2",
          max_score: 20,
        },
      },
      results: [
        {
          student_id: "S1",
          student_name: "Zero Student",
          corrections: [
            correction({
              q_id: "q1",
              score: 0,
              confidence: 0.9,
              requires_human_review: false,
              review_reasons: [],
              review_status: "confirmed",
            }),
            correction({ q_id: "q2", max_score: 20 }),
          ],
        },
        {
          student_id: "S2",
          student_name: "Five Student",
          corrections: [
            correction({
              q_id: "q1",
              score: 5,
              confidence: 0.9,
              requires_human_review: false,
              review_reasons: [],
              review_status: "confirmed",
            }),
            correction({ q_id: "q2", max_score: 20, provisional_score: null }),
          ],
        },
      ],
    });

    expect(model.students[0]).toMatchObject({ totalScore: 5, totalMax: 10, percent: 50 });
    expect(model.students[1]).toMatchObject({ totalScore: 0, totalMax: 10, percent: 0 });
    expect(model.classAverageScore).toBe(2.5);
    expect(model.classAverageMax).toBe(10);
    expect(model.classAveragePercent).toBe(25);
    expect(model.questions[0]).toMatchObject({ avgScore: 2.5, minScore: 0, maxObservedScore: 5 });
    expect(model.questions[1]).toMatchObject({ avgScore: null, avgPercent: null, minScore: null, maxObservedScore: null });
  });

  it("returns null class averages when every score is unresolved", () => {
    const model = buildResultsModel(undefined, {
      status: "completed",
      task_id: "task-1",
      results: [{
        student_id: "S1",
        corrections: [correction()],
      }],
    });

    expect(model.students[0]).toMatchObject({ totalScore: 0, totalMax: 0, percent: null });
    expect(model.classAverageScore).toBeNull();
    expect(model.classAverageMax).toBeNull();
    expect(model.classAveragePercent).toBeNull();
  });
});
