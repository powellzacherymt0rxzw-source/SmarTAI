import { describe, expect, it } from "vitest";
import { APIError } from "@/api/client";
import {
  classifyRecoverableError,
  isCurrentResultArtifactReady,
  isWorkflowRevisionConflictCode,
} from "./taskActionGuards";

describe("task contract compatibility", () => {
  it.each(["stale_revision", "task_workflow_changed", "version_conflict"])(
    "treats %s as a workflow revision conflict",
    (code) => {
      expect(isWorkflowRevisionConflictCode(code)).toBe(true);
    },
  );

  it("does not expose current downloads while the formal result is dirty", () => {
    expect(isCurrentResultArtifactReady({
      finalResultDirty: true,
      status: "ready",
      fileCount: 5,
    })).toBe(false);
  });

  it("exposes ready artifacts only for a clean version with files", () => {
    expect(isCurrentResultArtifactReady({
      finalResultDirty: false,
      status: "ready",
      fileCount: 5,
    })).toBe(true);
    expect(isCurrentResultArtifactReady({
      finalResultDirty: false,
      status: "ready",
      fileCount: 0,
    })).toBe(false);
  });
});

describe("question source recovery guidance", () => {
  it("routes a missing vision provider to BYOK before a job starts", () => {
    const info = classifyRecoverableError(
      new APIError(422, "vision_provider_required", {
        detail: { code: "vision_provider_required" },
      }),
      { locale: "zh-CN", returnTo: "/tasks/task-1/upload/problems" },
    );

    expect(info.actionKind).toBe("byok");
    expect(info.actionHref).toContain("/settings/byok");
    expect(info.description).toContain("BYOK");
  });

  it("routes role or MIME rejection back to file selection", () => {
    const info = classifyRecoverableError(
      new APIError(415, "source_type_not_allowed", {
        detail: { code: "source_type_not_allowed" },
      }),
      { locale: "zh-CN" },
    );

    expect(info.actionKind).toBe("reupload");
    expect(info.actionLabel).toBe("重新选择文件");
  });
});
