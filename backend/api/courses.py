"""Courses API router — CRUD + enroll + list students."""
from __future__ import annotations

import uuid
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from backend.auth import get_current_user, require_teacher
from backend.models import Course, User
from backend.state import (
    create_or_get_course,
    get_course_store,
    get_user_store,
    list_courses_for_teacher,
)
from backend.tools.catalog_matching import (
    CatalogMatch,
    match_catalog_items,
    normalize_catalog_text,
)

router = APIRouter(prefix="/courses", tags=["courses"])


class CreateCourseRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    code: str = ""
    description: str = ""
    force_create: bool = False


class EnrollRequest(BaseModel):
    student_ids: List[str] = []
    invite_code: Optional[str] = None


@router.post("/")
def create_course(req: CreateCourseRequest, current: User = Depends(require_teacher)):
    name, normalized_name = normalize_catalog_text(req.name)
    code, normalized_code = normalize_catalog_text(req.code)
    if not name:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Course name cannot be blank",
        )

    owner_courses = list_courses_for_teacher(current.id)
    exact = next((
        course for course in owner_courses
        if normalize_catalog_text(course.name)[1] == normalized_name
        or (
            normalized_code
            and normalize_catalog_text(course.code)[1] == normalized_code
        )
    ), None)
    if exact is not None:
        current.course_ids = list(dict.fromkeys([*current.course_ids, exact.id]))
        return {**_serialize(exact), "created": False}

    candidates = _merge_course_matches(name, code, owner_courses)
    related = [match for match in candidates if match.match_kind == "related"][:5]
    if related and not req.force_create:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "similar_items",
                "resource": "course",
                "candidates": [_serialize_match(match) for match in related],
            },
        )

    proposed = Course(
        id=f"c_{uuid.uuid4().hex[:10]}",
        name=name,
        code=code,
        description=req.description,
        teacher_id=current.id,
    )
    course, created = create_or_get_course(
        proposed,
        normalized_name=normalized_name,
        normalized_code=normalized_code,
    )
    current.course_ids = list(dict.fromkeys([*current.course_ids, course.id]))
    return {**_serialize(course), "created": created}


@router.get("/")
def list_courses(current: User = Depends(get_current_user)):
    store = get_course_store()
    if current.role == "admin":
        items = list(store.values())
    elif current.role == "teacher":
        items = [c for c in store.values() if c.teacher_id == current.id]
    else:
        items = [c for c in store.values() if current.id in c.student_ids]
    return [_serialize(c) for c in items]


@router.get("/search")
def search_courses(
    q: str = Query(min_length=1, max_length=120),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    current: User = Depends(require_teacher),
):
    matches = match_catalog_items(
        q,
        list_courses_for_teacher(current.id),
        fields_for_item=_course_fields,
    )
    start = (page - 1) * page_size
    return {
        "items": [
            _serialize_match(match)
            for match in matches[start:start + page_size]
        ],
        "total": len(matches),
        "page": page,
        "page_size": page_size,
    }


@router.get("/{course_id}")
def get_course(course_id: str, current: User = Depends(get_current_user)):
    course = get_course_store().get(course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Course not found")
    _check_course_access(course, current)
    return _serialize(course)


@router.get("/{course_id}/students")
def get_course_students(course_id: str, current: User = Depends(require_teacher)):
    course = get_course_store().get(course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Course not found")
    _check_course_access(course, current)
    user_store = get_user_store()
    students = [user_store[sid].public() for sid in course.student_ids if sid in user_store]
    return students


@router.post("/{course_id}/enroll")
def enroll_students(course_id: str, req: EnrollRequest, current: User = Depends(require_teacher)):
    course = get_course_store().get(course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Course not found")
    _check_course_access(course, current)
    user_store = get_user_store()
    added: list[str] = []
    for sid in req.student_ids:
        if sid not in user_store:
            continue
        if sid not in course.student_ids:
            course.student_ids.append(sid)
            user = user_store[sid]
            user.course_ids = list(set([*user.course_ids, course_id]))
            added.append(sid)
    return {"status": "success", "added": added, "total": len(course.student_ids)}


@router.delete("/{course_id}")
def delete_course(course_id: str, current: User = Depends(require_teacher)):
    store = get_course_store()
    course = store.get(course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Course not found")
    _check_course_access(course, current)
    store.pop(course_id, None)
    # Detach from users
    user_store = get_user_store()
    for sid in [course.teacher_id, *course.student_ids]:
        u = user_store.get(sid)
        if u and course_id in u.course_ids:
            u.course_ids = [c for c in u.course_ids if c != course_id]
    return {"status": "success"}


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _check_course_access(course: Course, user: User) -> None:
    if user.role == "admin":
        return
    if user.role == "teacher" and course.teacher_id == user.id:
        return
    if user.role == "student" and user.id in course.student_ids:
        return
    raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not enrolled in this course")


def _serialize(c: Course) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "code": c.code,
        "description": c.description,
        "teacher_id": c.teacher_id,
        "student_count": len(c.student_ids),
        "created_at": c.created_at,
    }


def _course_fields(course: Course) -> dict[str, str]:
    return {"name": course.name, "code": course.code}


def _serialize_match(match: CatalogMatch[Course]) -> dict:
    return {
        "item": _serialize(match.item),
        "match_kind": match.match_kind,
        "score": match.score,
        "reason": match.reason,
    }


def _merge_course_matches(
    name: str,
    code: str,
    courses: list[Course],
) -> list[CatalogMatch[Course]]:
    by_id: dict[str, CatalogMatch[Course]] = {}
    for query in (name, code):
        if not query:
            continue
        for match in match_catalog_items(
            query, courses, fields_for_item=_course_fields,
        ):
            current = by_id.get(match.item.id)
            if current is None or match.score > current.score:
                by_id[match.item.id] = match
    return sorted(by_id.values(), key=lambda match: (
        0 if match.match_kind == "exact" else 1,
        -match.score,
        normalize_catalog_text(match.item.name)[1],
        match.item.id,
    ))
