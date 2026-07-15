import { deleteJSON, getJSON, postJSON, putJSON } from "./client";
import type { CreateTagResponse, TagColor, TaskTag } from "@/types";

export function listTags(): Promise<TaskTag[]> {
  return getJSON<TaskTag[]>("/tags/");
}

export function createTag(body: { name: string; color?: TagColor }): Promise<CreateTagResponse> {
  return postJSON<CreateTagResponse, { name: string; color?: TagColor }>("/tags/", body);
}

export function updateTag(tagId: string, patch: { name?: string; color?: TagColor }): Promise<TaskTag> {
  return putJSON<TaskTag, { name?: string; color?: TagColor }>(`/tags/${tagId}`, patch);
}

export function deleteTag(tagId: string): Promise<{ status: "success"; tag_id: string; affected_tasks: number }> {
  return deleteJSON(`/tags/${tagId}`);
}
