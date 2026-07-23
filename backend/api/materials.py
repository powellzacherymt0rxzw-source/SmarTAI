"""Teacher-owned course-library materials and folder-like groups.

This Stage-1 repository is intentionally in-memory. Upload bytes are parsed by
the same strict PDF/TXT/MD path used by Q-01, then discarded; only extracted
text and safe metadata remain. Nothing here claims OCR or durable storage.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field

from backend.api.tasks import _read_problem_source_upload
from backend.auth import require_teacher
from backend.models import CourseMaterial, CourseMaterialGroup, User
from backend.state import (
    CourseMaterialStore,
    ResourceQuotaError,
    get_course_material_store,
    get_course_store,
)
from backend.tools.catalog_matching import match_catalog_items, normalize_catalog_text


router = APIRouter(prefix="/course-materials", tags=["course-materials"])

MaterialCategory = Literal["textbook", "answer", "lecture", "rubric", "other"]


class CreateMaterialGroupRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    course_id: Optional[str] = None
    force_create: bool = False


class UpdateMaterialGroupRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    course_id: Optional[str] = None


class UpdateCourseMaterialRequest(BaseModel):
    filename: Optional[str] = Field(default=None, min_length=1, max_length=240)
    course_id: Optional[str] = None
    group_id: Optional[str] = None
    category: Optional[MaterialCategory] = None
    labels: Optional[list[str]] = Field(default=None, max_length=20)


def _owned_course_or_404(course_id: str, owner_id: str):
    course = get_course_store().get(course_id)
    if course is None or course.teacher_id != owner_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course


def _owned_group_or_404(
    store: CourseMaterialStore,
    group_id: str,
    owner_id: str,
) -> CourseMaterialGroup:
    group = store.get_group_for_owner(group_id, owner_id)
    if group is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Material group not found")
    return group


def _owned_material_or_404(
    store: CourseMaterialStore,
    material_id: str,
    owner_id: str,
) -> CourseMaterial:
    material = store.get_for_owner(material_id, owner_id)
    if material is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Course material not found")
    return material


def _normalize_labels(values: list[str]) -> list[str]:
    labels: list[str] = []
    seen: set[str] = set()
    for value in values:
        display, key = normalize_catalog_text(str(value))
        if not display:
            continue
        if len(display) > 60:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "material_label_too_long", "max_length": 60},
            )
        if key in seen:
            continue
        labels.append(display)
        seen.add(key)
    if len(labels) > 20:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "too_many_material_labels", "max_items": 20},
        )
    return labels


def _parse_labels(raw: str) -> list[str]:
    value = raw.strip()
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        parsed = [item for item in value.split(",")]
    if not isinstance(parsed, list) or not all(isinstance(item, str) for item in parsed):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_material_labels"},
        )
    return _normalize_labels(parsed)


def _material_fields(material: CourseMaterial, group_name: str) -> dict[str, str]:
    return {
        "filename": material.filename,
        "category": material.category,
        "labels": " ".join(material.labels),
        "group": group_name,
    }


def _serialize_material(
    material: CourseMaterial,
    *,
    groups: dict[str, CourseMaterialGroup],
    match_kind: Optional[str] = None,
    match_score: Optional[float] = None,
    match_reason: Optional[str] = None,
) -> dict:
    group = groups.get(material.group_id or "")
    course = get_course_store().get(material.course_id or "")
    return {
        **material.public(),
        "group_name": group.name if group else None,
        "course_name": course.name if course else None,
        "course_code": course.code if course else None,
        "match_kind": match_kind,
        "match_score": match_score,
        "match_reason": match_reason,
    }


def _serialize_group(group: CourseMaterialGroup, store: CourseMaterialStore) -> dict:
    count = sum(
        1 for item in store.list_for_owner(group.owner_id)
        if item.group_id == group.group_id
    )
    course = get_course_store().get(group.course_id or "")
    return {
        **group.public(material_count=count),
        "course_name": course.name if course else None,
        "course_code": course.code if course else None,
    }


@router.get("/")
def list_course_materials(
    q: str = Query(default="", max_length=200),
    course_id: Optional[str] = Query(default=None),
    group_id: Optional[str] = Query(default=None),
    category: Optional[MaterialCategory] = Query(default=None),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=30, ge=1, le=100),
    current: User = Depends(require_teacher),
    store: CourseMaterialStore = Depends(get_course_material_store),
):
    if course_id is not None:
        _owned_course_or_404(course_id, current.id)
    if group_id not in (None, "ungrouped"):
        _owned_group_or_404(store, group_id, current.id)

    rows = store.list_for_owner(current.id)
    if course_id is not None:
        rows = [item for item in rows if item.course_id == course_id]
    if group_id == "ungrouped":
        rows = [item for item in rows if item.group_id is None]
    elif group_id is not None:
        rows = [item for item in rows if item.group_id == group_id]
    if category is not None:
        rows = [item for item in rows if item.category == category]

    groups = {item.group_id: item for item in store.list_groups_for_owner(current.id)}
    query = q.strip()
    if query:
        matches = match_catalog_items(
            query,
            rows,
            fields_for_item=lambda item: _material_fields(
                item,
                groups[item.group_id].name
                if item.group_id is not None and item.group_id in groups
                else "",
            ),
        )
        result_rows = [
            _serialize_material(
                match.item,
                groups=groups,
                match_kind=match.match_kind,
                match_score=match.score,
                match_reason=match.reason,
            )
            for match in matches
        ]
    else:
        result_rows = [_serialize_material(item, groups=groups) for item in rows]

    total = len(result_rows)
    start = (page - 1) * page_size
    owner_all = store.list_for_owner(current.id)
    return {
        "items": result_rows[start:start + page_size],
        "total": total,
        "page": page,
        "page_size": page_size,
        "summary": {
            "materials": len(owner_all),
            "groups": len(groups),
            "referenced": sum(1 for item in owner_all if item.task_ids),
            "parsed": len(owner_all),
        },
        "storage": "memory",
        "capabilities": {
            "durable": False,
            "ocr": False,
            "accepted_types": ["pdf", "txt", "md"],
        },
    }


@router.post("/")
async def upload_course_material(
    file: UploadFile = File(...),
    course_id: Optional[str] = Form(default=None),
    group_id: Optional[str] = Form(default=None),
    category: MaterialCategory = Form(default="other"),
    labels: str = Form(default="[]"),
    current: User = Depends(require_teacher),
    store: CourseMaterialStore = Depends(get_course_material_store),
):
    group = None
    if course_id is not None:
        _owned_course_or_404(course_id, current.id)
    if group_id is not None:
        group = _owned_group_or_404(store, group_id, current.id)
        if course_id is None:
            course_id = group.course_id
        elif group.course_id is not None and group.course_id != course_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "material_group_course_mismatch"},
            )

    filename, content_type, body, text, sha256 = await _read_problem_source_upload(file)
    proposed = CourseMaterial(
        material_id=f"material_{uuid.uuid4().hex[:12]}",
        owner_id=current.id,
        course_id=course_id,
        group_id=group_id,
        filename=filename,
        category=category,
        labels=_parse_labels(labels),
        content_type=content_type,
        size_bytes=len(body),
        sha256=sha256,
        text=text,
        resident_bytes=len(text.encode("utf-8")),
    )
    try:
        material, created = store.create_or_get(proposed)
    except ResourceQuotaError as exc:
        raise HTTPException(exc.status_code, detail={"code": exc.code}) from exc
    groups = {item.group_id: item for item in store.list_groups_for_owner(current.id)}
    return {**_serialize_material(material, groups=groups), "created": created}


@router.get("/groups")
def list_material_groups(
    q: str = Query(default="", max_length=80),
    current: User = Depends(require_teacher),
    store: CourseMaterialStore = Depends(get_course_material_store),
):
    groups = store.list_groups_for_owner(current.id)
    query = q.strip()
    if not query:
        return {"items": [_serialize_group(item, store) for item in groups], "total": len(groups)}
    matches = match_catalog_items(
        query,
        groups,
        fields_for_item=lambda item: {"name": item.name},
    )
    return {
        "items": [
            {
                **_serialize_group(match.item, store),
                "match_kind": match.match_kind,
                "match_score": match.score,
                "match_reason": match.reason,
            }
            for match in matches
        ],
        "total": len(matches),
    }


@router.post("/groups")
def create_material_group(
    req: CreateMaterialGroupRequest,
    current: User = Depends(require_teacher),
    store: CourseMaterialStore = Depends(get_course_material_store),
):
    name, normalized_name = normalize_catalog_text(req.name)
    if not name:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Group name cannot be blank")
    if req.course_id is not None:
        _owned_course_or_404(req.course_id, current.id)
    owner_groups = store.list_groups_for_owner(current.id)
    exact = next((
        item for item in owner_groups
        if normalize_catalog_text(item.name)[1] == normalized_name
    ), None)
    if exact is not None:
        return {**_serialize_group(exact, store), "created": False}
    related = [
        match for match in match_catalog_items(
            name,
            owner_groups,
            fields_for_item=lambda item: {"name": item.name},
        )
        if match.match_kind == "related"
    ][:5]
    if related and not req.force_create:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "similar_items",
                "resource": "course_material_group",
                "candidates": [
                    {
                        **_serialize_group(match.item, store),
                        "match_kind": match.match_kind,
                        "score": match.score,
                        "reason": match.reason,
                    }
                    for match in related
                ],
            },
        )
    try:
        group = store.create_group(CourseMaterialGroup(
            group_id=f"cmg_{uuid.uuid4().hex[:10]}",
            owner_id=current.id,
            name=name,
            course_id=req.course_id,
        ))
    except ResourceQuotaError as exc:
        raise HTTPException(exc.status_code, detail={"code": exc.code}) from exc
    return {**_serialize_group(group, store), "created": True}


@router.put("/groups/{group_id}")
def update_material_group(
    group_id: str,
    req: UpdateMaterialGroupRequest,
    current: User = Depends(require_teacher),
    store: CourseMaterialStore = Depends(get_course_material_store),
):
    group = _owned_group_or_404(store, group_id, current.id)
    fields: dict = {}
    if "name" in req.model_fields_set and req.name is not None:
        name, normalized_name = normalize_catalog_text(req.name)
        if not name:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Group name cannot be blank")
        duplicate = next((
            item for item in store.list_groups_for_owner(current.id)
            if item.group_id != group_id
            and normalize_catalog_text(item.name)[1] == normalized_name
        ), None)
        if duplicate is not None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={"code": "material_group_name_exists", "group_id": duplicate.group_id},
            )
        fields["name"] = name
    if "course_id" in req.model_fields_set:
        if req.course_id is not None:
            _owned_course_or_404(req.course_id, current.id)
        fields["course_id"] = req.course_id
    if fields:
        group = store.update_group_for_owner(group_id, current.id, **fields) or group
    return _serialize_group(group, store)


@router.delete("/groups/{group_id}")
def delete_material_group(
    group_id: str,
    current: User = Depends(require_teacher),
    store: CourseMaterialStore = Depends(get_course_material_store),
):
    _owned_group_or_404(store, group_id, current.id)
    affected = store.delete_group_for_owner(group_id, current.id)
    return {"status": "success", "group_id": group_id, "moved_to_ungrouped": affected or 0}


@router.put("/{material_id}")
def update_course_material(
    material_id: str,
    req: UpdateCourseMaterialRequest,
    current: User = Depends(require_teacher),
    store: CourseMaterialStore = Depends(get_course_material_store),
):
    material = _owned_material_or_404(store, material_id, current.id)
    fields: dict = {}
    effective_course_id = req.course_id if "course_id" in req.model_fields_set else material.course_id
    effective_group_id = req.group_id if "group_id" in req.model_fields_set else material.group_id
    group = None
    if effective_course_id is not None:
        _owned_course_or_404(effective_course_id, current.id)
    if effective_group_id is not None:
        group = _owned_group_or_404(store, effective_group_id, current.id)
        if effective_course_id is None:
            effective_course_id = group.course_id
        elif group.course_id is not None and group.course_id != effective_course_id:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"code": "material_group_course_mismatch"},
            )
    if "filename" in req.model_fields_set and req.filename is not None:
        filename = Path(req.filename).name.strip()
        if not filename:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Filename cannot be blank")
        fields["filename"] = filename
    if "course_id" in req.model_fields_set or (
        "group_id" in req.model_fields_set and req.group_id is not None and material.course_id is None
    ):
        fields["course_id"] = effective_course_id
    if "group_id" in req.model_fields_set:
        fields["group_id"] = req.group_id
    if "category" in req.model_fields_set and req.category is not None:
        fields["category"] = req.category
    if "labels" in req.model_fields_set and req.labels is not None:
        fields["labels"] = _normalize_labels(req.labels)
    if fields:
        material = store.update_for_owner(material_id, current.id, **fields) or material
    groups = {item.group_id: item for item in store.list_groups_for_owner(current.id)}
    return _serialize_material(material, groups=groups)


@router.delete("/{material_id}")
def delete_course_material(
    material_id: str,
    confirm_referenced: bool = Query(default=False),
    current: User = Depends(require_teacher),
    store: CourseMaterialStore = Depends(get_course_material_store),
):
    material = _owned_material_or_404(store, material_id, current.id)
    if material.task_ids and not confirm_referenced:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "course_material_is_referenced",
                "task_reference_count": len(material.task_ids),
            },
        )
    store.delete_for_owner(material_id, current.id)
    return {
        "status": "success",
        "material_id": material_id,
        "detached_task_references": len(material.task_ids),
    }
