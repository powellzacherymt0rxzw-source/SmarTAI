"""Grading-run lifecycle: creation, lease/heartbeat, result persistence,
teacher review, release, and recovery.

This service orchestrates ``grading_repository`` and ``grading_adapter``. The
adapter runs the unchanged LLM algorithm; this service owns the run state
machine and the durable lease. A worker claims a queued run, heartbeats its
lease while grading, and writes terminal state only while it still owns the
lease. Expired leases can be reclaimed; a late worker whose lease lapsed is
rejected by predicate.

AI-original result columns are immutable once written; teacher review is a
separate row. Release is blocked while failed/needs_review results remain.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Optional

from sqlalchemy import select

from backend.config import settings
from backend.db import (
    assignment_repository,
    grading_repository,
    submission_repository,
)
from backend.db.models import GradingRunRecord, UserRecord
from backend.db.session import session_scope
from backend.domain import education
from backend.domain.errors import DomainError, NotFound, VersionConflict
from backend.llm.registry import _build_scoped_registry, get_expert_registry
from backend.models import User
from backend.services import grading_adapter

logger = logging.getLogger(__name__)


def _registry_for(teacher_id: str):
    """Build a BYOK-scoped registry for the run's teacher, falling back to the
    global registry if no provider encryption key is configured (dev). The
    grading algorithm only consumes the registry; this never changes prompts."""
    with session_scope() as session:
        record = session.get(UserRecord, teacher_id)
        if record is None:
            return get_expert_registry()
        user = User(id=record.id, username=record.username, email=record.email or "",
                    role=record.role, password_hash=record.password_hash,
                    created_at=record.created_at, is_active=record.is_active)
    try:
        return _build_scoped_registry(user)
    except Exception:
        # A misconfigured encryption key or empty BYOK should not crash the
        # worker; fall back to the global registry so grading can still run.
        return get_expert_registry()


def poll_queued_runs() -> list[str]:
    """Return queued runs and running runs whose lease expired.

    Including expired running rows is what lets another worker reclaim a run
    after a process crash; the claim predicate remains the concurrency gate.
    """
    with session_scope() as session:
        rows = session.scalars(
            select(GradingRunRecord.id)
            .where(
                (GradingRunRecord.status == education.GradingRunStatus.QUEUED.value)
                | (
                    (GradingRunRecord.status == education.GradingRunStatus.RUNNING.value)
                    & (GradingRunRecord.lease_expiry < time.time())
                )
            )
            .order_by(GradingRunRecord.created_at)
        ).all()
        return list(rows)


async def worker_loop(*, worker_id: str, poll_seconds: int | None = None,
                      registry=None) -> None:
    """Claim and grade queued runs until cancelled. One loop per process; DB
    lease predicates keep multiple processes safe. Shutdown cancels the loop,
    which stops claiming new work and releases no unexpired lease."""
    interval = poll_seconds if poll_seconds is not None else settings.grading_poll_seconds
    while True:
        try:
            for run_id in poll_queued_runs():
                run = grading_repository.get_run(run_id=run_id)
                registry = registry or _registry_for(run.teacher_id)
                await process_run(run_id=run_id, worker_id=worker_id, registry=registry)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("grading worker tick failed")
        await asyncio.sleep(interval)


def start_run(*, assignment_id: str, teacher_id: str) -> education.GradingRunDTO:
    """Create a run and freeze the current revisions to grade.

    Freezing at creation means a regrade of a later revision cannot retroactively
    change what a prior run graded. One active run per assignment is enforced by
    the partial unique index; a second start raises DuplicateActiveRun.
    """
    assignment = assignment_repository.get_assignment(
        assignment_id=assignment_id, actor_id=teacher_id
    )
    if assignment.status not in (education.AssignmentStatus.PUBLISHED.value,
                                 education.AssignmentStatus.CLOSED.value):
        from backend.domain.errors import InvalidTransition
        raise InvalidTransition("assignment_not_gradable")
    questions = assignment_repository.get_questions_by_assignment(assignment_id=assignment_id)
    if not questions:
        from backend.domain.errors import ValidationError
        raise ValidationError("Assignment has no questions")
    # Collect each enrolled student's current revision to freeze.
    submissions = submission_repository.list_submissions(
        assignment_id=assignment_id, actor_id=teacher_id
    )
    frozen_revision_ids: list[str] = []
    for sub in submissions:
        if sub.current_revision_id is None:
            continue
        frozen_revision_ids.append(sub.current_revision_id)
    run = grading_repository.create_run(
        assignment_id=assignment_id, teacher_id=teacher_id,
        total_submissions=len(frozen_revision_ids),
    )
    if frozen_revision_ids:
        grading_repository.add_frozen_submissions(run_id=run.id, revision_ids=frozen_revision_ids)
    grading_repository.record_event(
        run_id=run.id, level="info", message="run_created",
        payload={"frozen_revisions": len(frozen_revision_ids), "questions": len(questions)},
    )
    return run


def get_run(*, run_id: str, actor_id: str, role: str) -> dict:
    run = grading_repository.get_run(run_id=run_id) if role == "admin" else grading_repository.get_run(run_id=run_id, actor_id=actor_id)
    events = grading_repository.list_events(run_id=run_id, actor_id=None if role == "admin" else actor_id)
    return {"run": _serialize_run(run), "events": events}


def list_runs(*, assignment_id: str, actor_id: str, role: str) -> list[dict]:
    runs = grading_repository.list_runs_for_assignment(assignment_id=assignment_id, actor_id=actor_id)
    return [_serialize_run(r) for r in runs]


async def process_run(*, run_id: str, worker_id: str, registry, language: str = "en") -> None:
    """Claim and grade one queued run. Idempotent: if the lease cannot be claimed
    (already taken by another worker, or terminal), this is a no-op.

    Raises on a batch-level failure so the caller can mark the run failed; per-
    question failures land as ``needs_review`` results via the adapter.
    """
    try:
        grading_repository.claim_lease(run_id=run_id, worker_id=worker_id, lease_seconds=settings.grading_lease_seconds)
    except DomainError:
        return  # someone else owns it or it is terminal
    run = grading_repository.get_run(run_id=run_id)
    heartbeat_task: Optional[asyncio.Task] = None

    async def _heartbeat():
        while True:
            await asyncio.sleep(settings.grading_heartbeat_seconds)
            try:
                grading_repository.heartbeat(
                    run_id=run_id, worker_id=worker_id,
                    lease_seconds=settings.grading_lease_seconds,
                )
            except DomainError:
                return  # lease lost; stop heartbeating

    try:
        heartbeat_task = asyncio.create_task(_heartbeat())
        questions = assignment_repository.get_questions_by_assignment(assignment_id=run.assignment_id)
        frozen_rows = grading_repository.list_frozen_submissions(run_id=run_id)
        frozen_revisions: list[tuple[education.SubmissionRevisionDTO, str]] = []
        for fr in frozen_rows:
            revision = submission_repository.get_revision(revision_id=fr.id, actor_id=run.teacher_id)
            if revision is not None:
                frozen_revisions.append((revision, fr.student_id))
        grading_repository.record_event(
            run_id=run_id, level="info", message="grading_started",
            payload={"students": len(frozen_revisions), "questions": len(questions)},
        )
        outcomes = await grading_adapter.run_grading(
            run_id=run_id, assignment_id=run.assignment_id, teacher_id=run.teacher_id,
            questions=questions, frozen_revisions=frozen_revisions,
            registry=registry, language=language,
        )
        completed = 0
        failed = 0
        for outcome in outcomes:
            persisted = 0
            student_failed = False
            for res in outcome.results:
                try:
                    grading_repository.upsert_result(
                        run_id=run_id, worker_id=worker_id, grade_result=res
                    )
                    persisted += 1
                    if res.result_status in education.NON_GRADED_RESULT_STATUSES:
                        student_failed = True
                except VersionConflict:
                    pass
            if persisted:
                completed += 1
                if student_failed:
                    failed += 1
        grading_repository.mark_completed(
            run_id=run_id, worker_id=worker_id, completed=completed, failed=failed
        )
        grading_repository.record_event(
            run_id=run_id, level="info", message="run_completed",
            payload={"completed": completed, "needs_review": failed},
        )
    except Exception as exc:
        logger.exception("Grading run %s failed", run_id)
        try:
            grading_repository.mark_failed(run_id=run_id, worker_id=worker_id, error_message=str(exc))
            grading_repository.record_event(
                run_id=run_id, level="error", message="run_failed",
                payload={"error": str(exc)},
            )
        except DomainError:
            pass  # lease already lost; another worker will reclaim
        raise
    finally:
        if heartbeat_task is not None:
            heartbeat_task.cancel()
            try:
                await heartbeat_task
            except (asyncio.CancelledError, Exception):
                pass


def list_review_queue(*, assignment_id: str, teacher_id: str) -> list[education.GradeResultDTO]:
    # Ownership is implied: the teacher queries their own assignment's review queue.
    assignment_repository.get_assignment(assignment_id=assignment_id, actor_id=teacher_id)
    return grading_repository.list_results_for_review(assignment_id=assignment_id)


def add_teacher_review(*, grade_result_id: str, teacher_id: str, new_score: float,
                       new_comment: str = "") -> education.TeacherReviewDTO:
    return grading_repository.add_teacher_review(
        grade_result_id=grade_result_id, teacher_id=teacher_id,
        new_score=new_score, new_comment=new_comment,
    )


def release_run(*, run_id: str, teacher_id: str) -> education.GradingRunDTO:
    return grading_repository.release(run_id=run_id, teacher_id=teacher_id)


# Compatibility aliases used by tests/direct callers. Keep one implementation
# per use case so worker and read contracts cannot drift.
def create_run(*, teacher_id: str, assignment_id: str) -> education.GradingRunDTO:
    return start_run(assignment_id=assignment_id, teacher_id=teacher_id)


def release(*, teacher_id: str, run_id: str) -> education.GradingRunDTO:
    return grading_repository.release(run_id=run_id, teacher_id=teacher_id)


def persist_results(*, run_id: str, worker_id: str,
                    results: list[education.GradeResultDTO]) -> int:
    """Persist a batch of GradeResult DTOs for a run. Returns the count written.

    Already-written (run, revision, question) triples raise VersionConflict
    inside the repository; we skip those so a retry is idempotent.
    """
    # Direct deterministic callers may hand us a queued run; claim it before
    # writing. Running runs are never re-claimed, so another worker remains
    # protected by the repository predicate.
    current = grading_repository.get_run(run_id=run_id)
    if current.status == education.GradingRunStatus.QUEUED.value:
        grading_repository.claim_lease(
            run_id=run_id, worker_id=worker_id,
            lease_seconds=settings.grading_lease_seconds,
        )
    written = 0
    for res in results:
        try:
            grading_repository.upsert_result(
                run_id=run_id, worker_id=worker_id, grade_result=res
            )
            written += 1
        except VersionConflict:
            continue
    return written


def resolve_review(*, grade_result_id: str, teacher_id: str) -> education.GradeResultDTO:
    """Compatibility read after ``add_teacher_review`` resolved the result."""
    from backend.db.models import GradeResultRecord, GradingRunRecord
    from backend.db.session import session_scope

    with session_scope() as session:
        result = session.get(GradeResultRecord, grade_result_id)
        if result is None:
            raise NotFound("grade_result")
        run = session.get(GradingRunRecord, result.grading_run_id)
        if run is None or run.teacher_id != teacher_id:
            raise NotFound("grade_result")
        review = grading_repository._latest_reviews_by_result(session, [result.id]).get(result.id)
        return grading_repository._result_to_dto(result, review)


def _serialize_run(run: education.GradingRunDTO) -> dict:
    return {
        "id": run.id,
        "assignment_id": run.assignment_id,
        "teacher_id": run.teacher_id,
        "status": run.status,
        "lease_owner": run.lease_owner,
        "lease_expiry": run.lease_expiry,
        "last_heartbeat_at": run.last_heartbeat_at,
        "total_submissions": run.total_submissions,
        "completed_submissions": run.completed_submissions,
        "failed_submissions": run.failed_submissions,
        "error_message": run.error_message,
        "created_at": run.created_at,
        "started_at": run.started_at,
        "completed_at": run.completed_at,
        "released_at": run.released_at,
    }


# ─── Compatibility wrappers (named to match the lifecycle test contract) ──────


def student_results(*, student_id: str, assignment_id: str) -> list[education.GradeResultDTO]:
    """Released, student-visible results for one (assignment, student).

    Only results from a *released* run are returned, so draft grades and
    provider traces never reach students. Non-graded rows are filtered out by
    the caller's display layer; this returns the raw graded rows for the
    student's current revision across released runs."""
    from sqlalchemy import select as _select
    from backend.db.models import GradeResultRecord, GradingRunRecord, SubmissionRecord
    from backend.db.session import session_scope

    sub = submission_repository.get_submission_for_student(
        assignment_id=assignment_id, student_id=student_id
    )
    if sub is None or sub.current_revision_id is None:
        return []
    with session_scope() as session:
        latest_run_id = session.scalar(
            _select(GradingRunRecord.id)
            .where(
                GradingRunRecord.assignment_id == assignment_id,
                GradingRunRecord.released_at.is_not(None),
            )
            .order_by(GradingRunRecord.released_at.desc())
            .limit(1)
        )
        if latest_run_id is None:
            return []
        rows = session.scalars(
            _select(GradeResultRecord)
            .where(GradeResultRecord.student_id == student_id,
                   GradeResultRecord.submission_revision_id == sub.current_revision_id,
                   GradeResultRecord.grading_run_id == latest_run_id,
                   GradeResultRecord.result_status == education.GradeResultStatus.GRADED.value)
            .order_by(GradeResultRecord.q_id)
        ).all()
        reviews = grading_repository._latest_reviews_by_result(session, [r.id for r in rows])
        return [grading_repository._result_to_dto(r, reviews.get(r.id)) for r in rows]
