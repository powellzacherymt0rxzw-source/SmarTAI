"""Assignment and question state machine + optimistic locking orchestration.

The service wraps assignment_repository so the API layer deals only with DTOs
and DomainError codes. Transition rules (publish requires questions, published
question sets are frozen) live here and in the repository; the service makes
the intent readable and keeps the API thin.
"""
from __future__ import annotations

from backend.db import assignment_repository
from backend.domain import education
from backend.domain.errors import Forbidden, NotFound, ValidationError


def create_assignment(*, teacher_id: str, course_id: str, name: str,
                      description: str = "", due_at: float | None = None) -> education.AssignmentDTO:
    if not name.strip():
        raise ValidationError("Assignment name is required")
    return assignment_repository.create_assignment(
        teacher_id=teacher_id, course_id=course_id, name=name.strip(),
        description=description, due_at=due_at,
    )


def get_assignment(*, assignment_id: str, actor_id: str, role: str) -> education.AssignmentDTO:
    if role == "teacher":
        return assignment_repository.get_assignment(assignment_id=assignment_id, actor_id=actor_id)
    if role == "student":
        # Students see only published assignments in courses they are enrolled in.
        published = assignment_repository.list_assignments_for_student(student_id=actor_id)
        for a in published:
            if a.id == assignment_id:
                return a
        raise NotFound("assignment")
    if role == "admin":
        return assignment_repository.get_assignment_unscoped(assignment_id)
    raise Forbidden("invalid_role")


def list_assignments(*, course_id: str | None, actor_id: str, role: str) -> list[education.AssignmentDTO]:
    if role == "teacher":
        if not course_id:
            raise ValidationError("course_id is required for teacher assignment lists")
        return assignment_repository.list_assignments(course_id=course_id, actor_id=actor_id)
    if role == "student":
        return assignment_repository.list_assignments_for_student(student_id=actor_id)
    if role == "admin":
        if not course_id:
            raise ValidationError("course_id is required for admin assignment lists")
        return assignment_repository.list_assignments_unscoped(course_id=course_id)
    raise Forbidden("invalid_role")


def add_question(*, assignment_id: str, teacher_id: str, q_id: str, order_index: int,
                 type: str, stem: str = "", number: str = "", criterion: str = "",
                 max_score: float = 10.0, reference_answer: str | None = None,
                 test_cases: list | None = None, source: dict | None = None) -> education.QuestionDTO:
    if not q_id.strip():
        raise ValidationError("Question id is required")
    if not type.strip():
        raise ValidationError("Question type is required")
    return assignment_repository.add_question(
        assignment_id=assignment_id, teacher_id=teacher_id, q_id=q_id.strip(),
        order_index=order_index, type=type.strip(), stem=stem, number=number,
        criterion=criterion, max_score=max_score, reference_answer=reference_answer,
        test_cases=test_cases, source=source,
    )


def reorder_questions(*, assignment_id: str, teacher_id: str,
                      ordered_q_ids: list[str]) -> list[education.QuestionDTO]:
    """Apply a new display order to a draft/ready assignment's questions."""
    return assignment_repository.set_question_order(
        assignment_id=assignment_id, teacher_id=teacher_id, ordered_q_ids=ordered_q_ids
    )


def list_questions(*, assignment_id: str, actor_id: str, role: str) -> list[education.QuestionDTO]:
    if role in ("teacher", "admin"):
        return assignment_repository.list_questions(assignment_id=assignment_id, teacher_id=actor_id)
    if role == "student":
        # Students see questions only for published assignments they can access.
        get_assignment(assignment_id=assignment_id, actor_id=actor_id, role="student")
        return assignment_repository.get_questions_by_assignment(assignment_id=assignment_id)
    raise Forbidden("invalid_role")


def publish(*, assignment_id: str, teacher_id: str, expected_version: int) -> education.AssignmentDTO:
    return assignment_repository.publish(
        assignment_id=assignment_id, teacher_id=teacher_id, expected_version=expected_version
    )


def close(*, assignment_id: str, teacher_id: str, expected_version: int) -> education.AssignmentDTO:
    return assignment_repository.close(
        assignment_id=assignment_id, teacher_id=teacher_id, expected_version=expected_version
    )
