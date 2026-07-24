"""Courses API router — resource-oriented endpoints over the course service.

All authorization and transition logic lives in the service/repository; this
router only validates request shape, calls the service, and maps DomainError
to the stable ``{"error": {"code": ..., "message": ...}}`` envelope.
"""
from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel

from backend.auth import get_current_user, require_teacher
from backend.domain.errors import DomainError
from backend.api.errors import domain_error_response
from backend.models import User
from backend.services import courses as course_service

router = APIRouter(prefix="/courses", tags=["courses"])


class CreateCourseRequest(BaseModel):
    name: str
    code: str = ""
    description: str = ""


class EnrollRequest(BaseModel):
    student_ids: List[str] = []


@router.post("")
def create_course(req: CreateCourseRequest, current: User = Depends(require_teacher)):
    try:
        course = course_service.create_course(
            teacher_id=current.id, name=req.name, code=req.code, description=req.description
        )
    except DomainError as exc:
        return domain_error_response(exc)
    return _serialize(course)


@router.get("")
def list_courses(current: User = Depends(get_current_user)):
    try:
        items = course_service.list_courses_for(actor_id=current.id, role=current.role)
    except DomainError as exc:
        return domain_error_response(exc)
    return [_serialize(c) for c in items]


@router.get("/{course_id}")
def get_course(course_id: str, current: User = Depends(get_current_user)):
    try:
        course = course_service.get_course(course_id=course_id, actor_id=current.id, role=current.role)
    except DomainError as exc:
        return domain_error_response(exc)
    return _serialize(course)


@router.get("/{course_id}/students")
def get_course_students(course_id: str, current: User = Depends(require_teacher)):
    try:
        course = course_service.get_course(course_id=course_id, actor_id=current.id, role=current.role)
    except DomainError as exc:
        return domain_error_response(exc)
    return [{"id": sid} for sid in course.student_ids]


@router.post("/{course_id}/enroll")
def enroll_students(course_id: str, req: EnrollRequest, current: User = Depends(require_teacher)):
    try:
        course = course_service.enroll_students(
            course_id=course_id, teacher_id=current.id, student_ids=req.student_ids
        )
    except DomainError as exc:
        return domain_error_response(exc)
    return {"status": "success", "student_ids": course.student_ids, "student_count": len(course.student_ids)}


@router.delete("/{course_id}")
def delete_course(course_id: str, current: User = Depends(require_teacher)):
    try:
        course_service.delete_course(course_id=course_id, teacher_id=current.id)
    except DomainError as exc:
        return domain_error_response(exc)
    return {"status": "success"}


def _serialize(c) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "code": c.code,
        "description": c.description,
        "teacher_id": c.teacher_id,
        "student_ids": list(c.student_ids),
        "student_count": len(c.student_ids),
        "created_at": c.created_at,
        "updated_at": c.updated_at,
    }
