"""
In-memory state stores for problems, students, and jobs.

Replaces the globals in backend/dependencies.py. Interface is dict-like to
preserve compatibility with existing routers; swap to Redis/Postgres later
without changing callers.
"""
from __future__ import annotations

import logging
import time
from collections import OrderedDict
from typing import Any, Dict, List, Optional
from threading import RLock

from backend.models import GradingJob, Tag, Task

logger = logging.getLogger(__name__)


# ─── Problem store ────────────────────────────────────────────────────────────

_problem_data: Dict[str, Dict[str, Any]] = {}


def get_problem_store() -> Dict[str, Dict[str, Any]]:
    """FastAPI dependency: returns the problem data dict."""
    return _problem_data


# ─── Student store ────────────────────────────────────────────────────────────

_student_data: Dict[str, Dict[str, Any]] = {}


def get_student_store() -> Dict[str, Dict[str, Any]]:
    """FastAPI dependency: returns the student data dict."""
    return _student_data


# ─── Job store ────────────────────────────────────────────────────────────────

class JobStore:
    """Thread-safe storage for grading jobs + history."""

    MAX_ACTIVE = 1000
    MAX_HISTORY = 1000
    DEFAULT_TTL = 24 * 60 * 60  # 24 hours
    HISTORY_TTL = 30 * 24 * 60 * 60  # 30 days

    def __init__(self) -> None:
        self._active: OrderedDict[str, GradingJob] = OrderedDict()
        self._history: OrderedDict[str, GradingJob] = OrderedDict()
        self._lock = RLock()

    def create(self, job: GradingJob) -> None:
        with self._lock:
            self._active[job.job_id] = job
            self._prune_if_needed()

    def get(self, job_id: str) -> Optional[GradingJob]:
        with self._lock:
            return self._active.get(job_id) or self._history.get(job_id)

    def update(self, job_id: str, **fields: Any) -> None:
        with self._lock:
            job = self._active.get(job_id) or self._history.get(job_id)
            if job:
                for k, v in fields.items():
                    setattr(job, k, v)

    def complete(self, job_id: str, results: Optional[Dict[str, Any]] = None) -> None:
        with self._lock:
            job = self._active.pop(job_id, None)
            if job is None:
                return
            job.status = "completed"
            job.completed_at = time.time()
            job.results = results
            self._history[job_id] = job
            self._prune_if_needed()

    def fail(self, job_id: str, error: str) -> None:
        with self._lock:
            job = self._active.pop(job_id, None)
            if job is None:
                return
            job.status = "error"
            job.error = error
            job.completed_at = time.time()
            job.results = {"status": "error", "message": error}
            self._history[job_id] = job
            self._prune_if_needed()

    def list_active_ids(self) -> List[str]:
        with self._lock:
            return list(self._active.keys())

    def list_metadata(self) -> List[Dict[str, Any]]:
        with self._lock:
            return [
                {
                    "job_id": j.job_id,
                    "job_name": j.job_name,
                    "job_type": j.job_type,
                    "status": j.status,
                    "student_id": j.student_id,
                    "created_at": j.created_at,
                    "completed_at": j.completed_at,
                }
                for j in list(self._active.values()) + list(self._history.values())
            ]

    def discard(self, job_id: str) -> bool:
        with self._lock:
            if job_id in self._active:
                self._active.pop(job_id)
                return True
            if job_id in self._history:
                self._history.pop(job_id)
                return True
            return False

    def reset_active(self) -> None:
        with self._lock:
            self._active.clear()

    def active_count(self) -> int:
        with self._lock:
            return sum(1 for j in self._active.values() if j.status in ("pending", "running"))

    def _prune_if_needed(self) -> None:
        now = time.time()
        for k in list(self._active.keys()):
            job = self._active[k]
            if job.status not in ("pending", "running") and job.completed_at and now - job.completed_at > self.DEFAULT_TTL:
                self._active.pop(k)
        while len(self._active) > self.MAX_ACTIVE:
            self._active.popitem(last=False)
        for k in list(self._history.keys()):
            job = self._history[k]
            if job.completed_at and now - job.completed_at > self.HISTORY_TTL:
                self._history.pop(k)
        while len(self._history) > self.MAX_HISTORY:
            self._history.popitem(last=False)


_job_store = JobStore()


def get_job_store() -> JobStore:
    return _job_store


# ─── Task store (task-centric workflow) ───────────────────────────────────────

class TaskStore:
    """Thread-safe in-memory store for `Task` (problems + submissions + grading).

    Owner-scoped: list_for_owner(owner_id) filters by `task.owner_id`. The demo
    auth token (`demo-teacher-foo`) maps to `User.id = "demo_foo"`, so every
    user (real or demo) gets isolated tasks.
    """

    MAX_TASKS = 500
    DEFAULT_TTL = 7 * 24 * 60 * 60  # 7 days

    def __init__(self) -> None:
        self._tasks: OrderedDict[str, Task] = OrderedDict()
        self._idempotency: Dict[tuple[str, str], tuple[str, str]] = {}
        self._lock = RLock()

    def create(self, task: Task) -> None:
        with self._lock:
            self._tasks[task.task_id] = task
            self._prune_if_needed()

    def create_idempotent(
        self,
        task: Task,
        *,
        idempotency_key: str,
        payload_hash: str,
    ) -> tuple[Optional[Task], bool, bool]:
        """Atomically create or replay a task for an owner-scoped key.

        Returns ``(task, created, conflict)``.  A stale record whose task was
        pruned or cleared is discarded so test resets and TTL cleanup cannot
        permanently consume a key.
        """

        record_key = (task.owner_id, idempotency_key)
        with self._lock:
            record = self._idempotency.get(record_key)
            if record is not None:
                recorded_hash, task_id = record
                existing = self._tasks.get(task_id)
                if existing is None:
                    self._idempotency.pop(record_key, None)
                elif recorded_hash == payload_hash:
                    return existing, False, False
                else:
                    return existing, False, True
            self._tasks[task.task_id] = task
            self._idempotency[record_key] = (payload_hash, task.task_id)
            self._prune_if_needed()
            return task, True, False

    def lookup_idempotent(
        self,
        *,
        owner_id: str,
        idempotency_key: str,
        payload_hash: str,
    ) -> tuple[Optional[Task], bool]:
        """Return an existing replay before re-validating mutable references.

        The boolean is true when the key exists with a different payload.
        Creation still goes through :meth:`create_idempotent` so a concurrent
        first request cannot race this read into a duplicate task.
        """

        record_key = (owner_id, idempotency_key)
        with self._lock:
            record = self._idempotency.get(record_key)
            if record is None:
                return None, False
            recorded_hash, task_id = record
            existing = self._tasks.get(task_id)
            if existing is None:
                self._idempotency.pop(record_key, None)
                return None, False
            return existing, recorded_hash != payload_hash

    def get(self, task_id: str) -> Optional[Task]:
        with self._lock:
            return self._tasks.get(task_id)

    def update(self, task_id: str, **fields: Any) -> Optional[Task]:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return None
            for k, v in fields.items():
                setattr(task, k, v)
            task.updated_at = time.time()
            return task

    def delete(self, task_id: str) -> bool:
        with self._lock:
            deleted = self._tasks.pop(task_id, None) is not None
            if deleted:
                self._remove_idempotency_for_task(task_id)
            return deleted

    def list_for_owner(self, owner_id: str) -> List[Task]:
        with self._lock:
            return [t for t in self._tasks.values() if t.owner_id == owner_id]

    def list_all(self) -> List[Task]:
        with self._lock:
            return list(self._tasks.values())

    def _prune_if_needed(self) -> None:
        now = time.time()
        for k in list(self._tasks.keys()):
            t = self._tasks[k]
            if now - t.updated_at > self.DEFAULT_TTL and t.status in ("graded", "error", "draft"):
                self._tasks.pop(k)
                self._remove_idempotency_for_task(k)
        while len(self._tasks) > self.MAX_TASKS:
            task_id, _ = self._tasks.popitem(last=False)
            self._remove_idempotency_for_task(task_id)

    def _remove_idempotency_for_task(self, task_id: str) -> None:
        for key, (_, recorded_task_id) in list(self._idempotency.items()):
            if recorded_task_id == task_id:
                self._idempotency.pop(key, None)


_task_store = TaskStore()


def get_task_store() -> TaskStore:
    return _task_store


# ─── Tag store (owner-scoped task labels) ────────────────────────────────────

class TagStore:
    """Thread-safe, owner-scoped in-memory tag registry.

    Normalised-name uniqueness is enforced per owner.  This is deliberately a
    repository-shaped abstraction even though it is in-memory today, so a
    future PostgreSQL implementation can preserve the API contract.
    """

    def __init__(self) -> None:
        self._tags: OrderedDict[str, Tag] = OrderedDict()
        self._lock = RLock()

    def create_or_get(self, tag: Tag) -> tuple[Tag, bool]:
        with self._lock:
            existing = self.find_by_normalized_name(
                tag.owner_id, tag.normalized_name,
            )
            if existing is not None:
                return existing, False
            self._tags[tag.id] = tag
            return tag, True

    def get(self, tag_id: str) -> Optional[Tag]:
        with self._lock:
            return self._tags.get(tag_id)

    def find_by_normalized_name(
        self, owner_id: str, normalized_name: str,
    ) -> Optional[Tag]:
        with self._lock:
            return next(
                (
                    tag for tag in self._tags.values()
                    if tag.owner_id == owner_id
                    and tag.normalized_name == normalized_name
                ),
                None,
            )

    def list_for_owner(self, owner_id: str) -> List[Tag]:
        with self._lock:
            return [tag for tag in self._tags.values() if tag.owner_id == owner_id]

    def update(self, tag_id: str, **fields: Any) -> Optional[Tag]:
        with self._lock:
            tag = self._tags.get(tag_id)
            if tag is None:
                return None
            for key, value in fields.items():
                setattr(tag, key, value)
            tag.updated_at = time.time()
            return tag

    def rename_or_conflict(
        self,
        tag_id: str,
        owner_id: str,
        name: str,
        normalized_name: str,
    ) -> tuple[Optional[Tag], Optional[Tag]]:
        """Atomically rename a tag while preserving owner-local uniqueness.

        Returns ``(updated_tag, None)`` on success, ``(current_tag,
        conflicting_tag)`` on a duplicate, and ``(None, None)`` when the
        target does not exist for that owner.  The duplicate lookup and write
        deliberately share one lock interval so concurrent renames cannot
        create two tags with the same normalized name.
        """

        with self._lock:
            tag = self._tags.get(tag_id)
            if tag is None or tag.owner_id != owner_id:
                return None, None
            duplicate = next(
                (
                    item for item in self._tags.values()
                    if item.owner_id == owner_id
                    and item.normalized_name == normalized_name
                    and item.id != tag_id
                ),
                None,
            )
            if duplicate is not None:
                return tag, duplicate
            tag.name = name
            tag.normalized_name = normalized_name
            tag.updated_at = time.time()
            return tag, None

    def delete(self, tag_id: str) -> bool:
        with self._lock:
            return self._tags.pop(tag_id, None) is not None

    def clear(self) -> None:
        """Test/support hook matching the other in-memory stores."""
        with self._lock:
            self._tags.clear()


_tag_store = TagStore()


def get_tag_store() -> TagStore:
    return _tag_store


# ─── User / Course / Assignment / Submission stores ───────────────────────────
# (P0 — face full product. In-memory for now; swap to PostgreSQL in Phase 1.)

from backend.models import User, Course, Assignment, Submission

_user_store: Dict[str, User] = {}
_user_by_username: Dict[str, str] = {}  # username → user_id

_course_store: Dict[str, Course] = {}
_course_store_lock = RLock()

_assignment_store: Dict[str, Assignment] = {}

_submission_store: Dict[str, Submission] = {}
# Index for quick "get my submission for assignment X"
_submissions_by_assignment_student: Dict[str, str] = {}  # f"{aid}:{sid}" → submission_id

_invite_codes: Dict[str, Dict[str, Any]] = {}  # code → {role, course_id, email, expires_at}


def get_user_store() -> Dict[str, User]:
    return _user_store


def find_user_by_username(username: str) -> Optional[User]:
    uid = _user_by_username.get(username)
    return _user_store.get(uid) if uid else None


def register_user(user: User) -> None:
    _user_store[user.id] = user
    _user_by_username[user.username] = user.id


def remove_user(user_id: str) -> bool:
    user = _user_store.pop(user_id, None)
    if user is None:
        return False
    _user_by_username.pop(user.username, None)
    return True


def get_course_store() -> Dict[str, Course]:
    return _course_store


def list_courses_for_teacher(teacher_id: str) -> List[Course]:
    """Return an owner-scoped snapshot safe against endpoint writes."""

    with _course_store_lock:
        return [
            course for course in _course_store.values()
            if course.teacher_id == teacher_id
        ]


def create_or_get_course(
    course: Course,
    *,
    normalized_name: str,
    normalized_code: str,
) -> tuple[Course, bool]:
    """Atomically preserve normalized name/code uniqueness per teacher."""

    from backend.tools.catalog_matching import normalize_catalog_text

    with _course_store_lock:
        for existing in _course_store.values():
            if existing.teacher_id != course.teacher_id:
                continue
            _, existing_name = normalize_catalog_text(existing.name)
            _, existing_code = normalize_catalog_text(existing.code)
            if existing_name == normalized_name or (
                normalized_code and existing_code == normalized_code
            ):
                return existing, False
        _course_store[course.id] = course
        return course, True


def get_assignment_store() -> Dict[str, Assignment]:
    return _assignment_store


def get_submission_store() -> Dict[str, Submission]:
    return _submission_store


def submission_key(assignment_id: str, student_id: str) -> str:
    return f"{assignment_id}:{student_id}"


def get_submission_by_assignment_student(assignment_id: str, student_id: str) -> Optional[Submission]:
    sid = _submissions_by_assignment_student.get(submission_key(assignment_id, student_id))
    return _submission_store.get(sid) if sid else None


def index_submission(sub: Submission) -> None:
    _submission_store[sub.id] = sub
    _submissions_by_assignment_student[submission_key(sub.assignment_id, sub.student_id)] = sub.id


def get_invite_store() -> Dict[str, Dict[str, Any]]:
    return _invite_codes
