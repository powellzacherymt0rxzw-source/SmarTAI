"""Owner-scoped task tag API.

The store is intentionally in-memory, matching TaskStore/CourseStore.  Deleting
a tag never deletes a task: it only detaches the tag ID from the owner's tasks
and reports how many tasks were affected.
"""
from __future__ import annotations

import re
import unicodedata
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from backend.auth import require_teacher
from backend.models import Tag, TagColor, User
from backend.state import TagStore, TaskStore, get_tag_store, get_task_store


router = APIRouter(prefix="/tags", tags=["tags"])


class CreateTagRequest(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    color: TagColor = "slate"


class UpdateTagRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=40)
    color: Optional[TagColor] = None


def normalize_tag_name(name: str) -> tuple[str, str]:
    """Return display name + stable de-duplication key.

    NFKC folds full-width forms, whitespace is collapsed, and casefold makes
    owner-local duplicate checks Unicode-aware without changing the user's
    display casing.
    """

    display = re.sub(r"\s+", " ", unicodedata.normalize("NFKC", name)).strip()
    if not display:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Tag name cannot be blank",
        )
    return display, display.casefold()


def _owned_tag_or_404(tag_store: TagStore, tag_id: str, owner_id: str) -> Tag:
    tag = tag_store.get(tag_id)
    # Do not reveal another owner's tag existence.
    if tag is None or tag.owner_id != owner_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tag not found")
    return tag


@router.get("/")
def list_tags(
    current: User = Depends(require_teacher),
    tag_store: TagStore = Depends(get_tag_store),
    task_store: TaskStore = Depends(get_task_store),
):
    tags = tag_store.list_for_owner(current.id)
    tags.sort(key=lambda item: (item.normalized_name, item.created_at))
    usage_counts = {
        tag.id: sum(
            1 for task in task_store.list_for_owner(current.id)
            if tag.id in task.tag_ids
        )
        for tag in tags
    }
    return [
        {**tag.public(), "usage_count": usage_counts[tag.id]}
        for tag in tags
    ]


@router.post("/")
def create_tag(
    req: CreateTagRequest,
    current: User = Depends(require_teacher),
    tag_store: TagStore = Depends(get_tag_store),
    task_store: TaskStore = Depends(get_task_store),
):
    name, normalized_name = normalize_tag_name(req.name)
    tag, created = tag_store.create_or_get(Tag(
        id=f"tag_{uuid.uuid4().hex[:10]}",
        name=name,
        normalized_name=normalized_name,
        color=req.color,
        owner_id=current.id,
    ))
    usage_count = sum(
        1 for task in task_store.list_for_owner(current.id)
        if tag.id in task.tag_ids
    )
    return {
        **tag.public(), "created": created, "usage_count": usage_count,
    }


@router.put("/{tag_id}")
def update_tag(
    tag_id: str,
    req: UpdateTagRequest,
    current: User = Depends(require_teacher),
    tag_store: TagStore = Depends(get_tag_store),
    task_store: TaskStore = Depends(get_task_store),
):
    tag = _owned_tag_or_404(tag_store, tag_id, current.id)
    fields = {}
    if "name" in req.model_fields_set and req.name is not None:
        name, normalized_name = normalize_tag_name(req.name)
        renamed, duplicate = tag_store.rename_or_conflict(
            tag_id, current.id, name, normalized_name,
        )
        if renamed is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tag not found")
        if duplicate is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={"code": "tag_name_exists", "tag_id": duplicate.id},
            )
        tag = renamed
    if "color" in req.model_fields_set and req.color is not None:
        fields["color"] = req.color
    if fields:
        tag = tag_store.update(tag_id, **fields) or tag
    usage_count = sum(
        1 for task in task_store.list_for_owner(current.id)
        if tag.id in task.tag_ids
    )
    return {**tag.public(), "usage_count": usage_count}


@router.delete("/{tag_id}")
def delete_tag(
    tag_id: str,
    current: User = Depends(require_teacher),
    tag_store: TagStore = Depends(get_tag_store),
    task_store: TaskStore = Depends(get_task_store),
):
    _owned_tag_or_404(tag_store, tag_id, current.id)

    affected_tasks = 0
    for task in task_store.list_for_owner(current.id):
        if tag_id not in task.tag_ids:
            continue
        task_store.update(
            task.task_id,
            tag_ids=[item for item in task.tag_ids if item != tag_id],
        )
        affected_tasks += 1

    tag_store.delete(tag_id)
    return {
        "status": "success",
        "tag_id": tag_id,
        "affected_tasks": affected_tasks,
    }
