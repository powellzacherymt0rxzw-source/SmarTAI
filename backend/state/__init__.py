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

from backend.models import (
    AICompletionCandidate,
    AICompletionFieldProvenance,
    AICompletionJob,
    CourseMaterial,
    GradingJob,
    MaterialImportCandidate,
    MaterialImportDraft,
    MaterialImportPlan,
    MaterialFieldProvenance,
    ProblemSourceDraft,
    Tag,
    Task,
    is_programming_question_type,
)

logger = logging.getLogger(__name__)


def _slot_has_value(problem: Dict[str, Any], target: str) -> bool:
    if target == "test_cases":
        return bool(problem.get(target))
    return bool(str(problem.get(target) or "").strip())


def _slot_is_confirmed(problem: Dict[str, Any], target: str) -> bool:
    for key in ("ai_completion_provenance", "material_provenance"):
        provenance = problem.get(key)
        if isinstance(provenance, dict):
            value = provenance.get(target)
            if isinstance(value, dict) and value.get("review_status") == "confirmed":
                return True
    return False


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
    MAX_TASKS_PER_OWNER = 100
    DEFAULT_TTL = 7 * 24 * 60 * 60  # 7 days

    def __init__(self) -> None:
        self._tasks: OrderedDict[str, Task] = OrderedDict()
        self._idempotency: Dict[tuple[str, str], tuple[str, str]] = {}
        self._lock = RLock()

    def create(self, task: Task) -> None:
        with self._lock:
            self._ensure_capacity(task.owner_id, replacing_task_id=task.task_id)
            self._tasks[task.task_id] = task

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
            self._ensure_capacity(task.owner_id, replacing_task_id=task.task_id)
            self._tasks[task.task_id] = task
            self._idempotency[record_key] = (payload_hash, task.task_id)
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

    @staticmethod
    def _has_problem_replacement_artifacts(task: Task) -> bool:
        return bool(
            task.problem_data
            or task.student_data
            or task.problem_file_hash
            or task.submission_file_hash
            or task.grading_job_id
            or task.reference_file_hash
            or task.test_cases_file_hash
        )

    @classmethod
    def _problem_extraction_gate(
        cls,
        task: Task,
        *,
        expected_revision: int,
        request_fingerprint: str,
        legacy_same_completed_request: bool,
        replace_confirmed: bool,
    ) -> str:
        """Return the current extraction gate result without mutating ``task``."""

        if task.status == "extracting_problems" and task.extract_job_id:
            if task.pending_problem_request_fingerprint == request_fingerprint:
                return "already_running"
            return "different_source_running"
        if task.workflow_revision != expected_revision:
            return "stale_revision"
        if (
            task.problem_request_fingerprint == request_fingerprint
            or legacy_same_completed_request
        ) and task.status in {
            "problems_ready", "parsing_submissions", "submissions_ready",
            "grading", "graded",
        }:
            return "already_done"
        if (
            task.status in {"parsing_submissions", "grading"}
            or task.reference_parse_job_id
            or task.test_cases_parse_job_id
            or task.material_import_job_id
            or task.ai_completion_job_id
        ):
            return "workflow_busy"
        if cls._has_problem_replacement_artifacts(task) and not replace_confirmed:
            return "replacement_confirmation_required"
        return "ready"

    def inspect_problem_extraction(
        self,
        task_id: str,
        *,
        expected_revision: int,
        request_fingerprint: str,
        legacy_same_completed_request: bool,
        replace_confirmed: bool,
    ) -> tuple[str, Optional[Task]]:
        """Read the extraction gate before doing provider-dependent work.

        ``begin_problem_extraction`` repeats this check under the mutation lock,
        so this inspection is only an early UX/security gate and not the CAS.
        """

        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return "not_found", None
            return self._problem_extraction_gate(
                task,
                expected_revision=expected_revision,
                request_fingerprint=request_fingerprint,
                legacy_same_completed_request=legacy_same_completed_request,
                replace_confirmed=replace_confirmed,
            ), task

    def begin_problem_extraction(
        self,
        task_id: str,
        *,
        expected_revision: int,
        job_id: str,
        request_fingerprint: str,
        content_sha256: str,
        filename: str,
        legacy_same_completed_request: bool,
        replace_confirmed: bool,
    ) -> tuple[str, Optional[Task]]:
        """CAS the task into extraction without an await-sized race window."""

        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return "not_found", None
            outcome = self._problem_extraction_gate(
                task,
                expected_revision=expected_revision,
                request_fingerprint=request_fingerprint,
                legacy_same_completed_request=legacy_same_completed_request,
                replace_confirmed=replace_confirmed,
            )
            if outcome != "ready":
                return outcome, task
            task.status = "extracting_problems"
            task.extract_job_id = job_id
            task.pending_problem_request_fingerprint = request_fingerprint
            task.pending_problem_file_hash = content_sha256
            task.pending_problem_file_name = filename
            task.error = None
            task.last_failed_job_id = None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return "started", task

    def commit_problem_extraction(
        self,
        task_id: str,
        *,
        job_id: str,
        problem_data: Dict[str, Dict[str, Any]],
        structure_mode: str,
        extraction_hint: str,
        confirmed_candidates: List[str],
        library_material_id: Optional[str],
    ) -> tuple[Optional[Task], Optional[str]]:
        """Atomically publish a completed problem extraction.

        The worker must still own ``extract_job_id``; stale workers are ignored.
        Downstream data is cleared only after the new problem set is complete,
        so a failed replacement never destroys the last usable questions.
        Returns the committed task and any grading job id that should be
        discarded by the API layer.
        """

        with self._lock:
            task = self._tasks.get(task_id)
            if task is None or task.extract_job_id != job_id:
                return None, None
            old_grading_job_id = task.grading_job_id
            task.problem_data = dict(problem_data)
            task.student_data = {}
            task.problem_file_hash = task.pending_problem_file_hash
            task.problem_file_name = task.pending_problem_file_name
            task.problem_request_fingerprint = task.pending_problem_request_fingerprint
            task.pending_problem_request_fingerprint = None
            task.pending_problem_file_hash = None
            task.pending_problem_file_name = None
            task.problem_structure_mode = structure_mode
            task.problem_extraction_hint = extraction_hint
            task.problem_confirmed_candidates = list(confirmed_candidates)
            task.problem_library_material_id = library_material_id
            task.submission_file_hash = None
            task.submission_file_name = None
            task.pending_submission_file_hash = None
            task.pending_submission_file_name = None
            task.parse_job_id = None
            task.grading_job_id = None
            task.reference_file_hash = None
            task.reference_file_name = None
            task.reference_parse_job_id = None
            task.test_cases_file_hash = None
            task.test_cases_file_name = None
            task.test_cases_parse_job_id = None
            task.material_import_job_id = None
            task.pending_material_import_fingerprint = None
            task.material_import_fingerprint = None
            task.last_material_import_job_id = None
            task.material_import_error = None
            task.last_failed_material_import_fingerprint = None
            task.material_import_retry_revision = None
            task.ai_completion_job_id = None
            task.pending_ai_completion_fingerprint = None
            task.ai_completion_fingerprint = None
            task.last_ai_completion_job_id = None
            task.ai_completion_error = None
            task.last_failed_ai_completion_fingerprint = None
            task.ai_completion_retry_revision = None
            task.status = "problems_ready"
            task.error = None
            task.last_failed_job_id = None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return task, old_grading_job_id

    def fail_problem_extraction(
        self,
        task_id: str,
        *,
        job_id: str,
        error: str,
    ) -> Optional[Task]:
        """Fail only the current extraction and retain prior problem data."""

        with self._lock:
            task = self._tasks.get(task_id)
            if task is None or task.extract_job_id != job_id:
                return None
            task.pending_problem_request_fingerprint = None
            task.pending_problem_file_hash = None
            task.pending_problem_file_name = None
            task.status = "error"
            task.error = error
            task.last_failed_job_id = job_id
            task.workflow_revision += 1
            task.updated_at = time.time()
            return task

    def begin_submission_parse(
        self,
        task_id: str,
        *,
        expected_revision: int,
        job_id: str,
        content_sha256: str,
        filename: str,
    ) -> tuple[str, Optional[Task]]:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return "not_found", None
            if task.status == "parsing_submissions" and task.parse_job_id:
                if task.pending_submission_file_hash == content_sha256:
                    return "already_running", task
                return "different_submission_running", task
            if (
                task.submission_file_hash == content_sha256
                and task.status in {"submissions_ready", "grading", "graded"}
            ):
                return "already_done", task
            if task.workflow_revision != expected_revision:
                return "stale_revision", task
            if (
                task.status in {"extracting_problems", "grading"}
                or task.reference_parse_job_id
                or task.test_cases_parse_job_id
                or task.material_import_job_id
                or task.ai_completion_job_id
            ):
                return "workflow_busy", task
            if task.status not in {"problems_ready", "submissions_ready", "graded", "error"}:
                return "invalid_state", task
            if not task.problem_data:
                return "invalid_state", task
            task.status = "parsing_submissions"
            task.parse_job_id = job_id
            task.pending_submission_file_hash = content_sha256
            task.pending_submission_file_name = filename
            task.error = None
            task.last_failed_job_id = None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return "started", task

    def commit_submission_parse(
        self,
        task_id: str,
        *,
        job_id: str,
        student_data: Dict[str, Dict[str, Any]],
    ) -> tuple[Optional[Task], Optional[str]]:
        with self._lock:
            task = self._tasks.get(task_id)
            if (
                task is None
                or task.status != "parsing_submissions"
                or task.parse_job_id != job_id
            ):
                return None, None
            old_grading_job_id = task.grading_job_id
            task.student_data = dict(student_data)
            task.submission_file_hash = task.pending_submission_file_hash
            task.submission_file_name = task.pending_submission_file_name
            task.pending_submission_file_hash = None
            task.pending_submission_file_name = None
            task.grading_job_id = None
            task.status = "submissions_ready"
            task.error = None
            task.last_failed_job_id = None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return task, old_grading_job_id

    def fail_submission_parse(
        self,
        task_id: str,
        *,
        job_id: str,
        error: str,
    ) -> Optional[Task]:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None or task.parse_job_id != job_id:
                return None
            task.pending_submission_file_hash = None
            task.pending_submission_file_name = None
            task.status = "error"
            task.error = error
            task.last_failed_job_id = job_id
            task.workflow_revision += 1
            task.updated_at = time.time()
            return task

    def begin_auxiliary_parse(
        self,
        task_id: str,
        *,
        kind: str,
        expected_revision: int,
        job_id: str,
        content_sha256: str,
        filename: str,
    ) -> tuple[str, Optional[Task]]:
        if kind not in {"reference", "test_cases"}:
            raise ValueError("Unknown auxiliary parse kind")
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return "not_found", None
            job_field = f"{kind}_parse_job_id"
            hash_field = f"{kind}_file_hash"
            name_field = f"{kind}_file_name"
            active_job = getattr(task, job_field)
            if active_job:
                return "already_running", task
            if getattr(task, hash_field) == content_sha256:
                return "already_done", task
            if task.workflow_revision != expected_revision:
                return "stale_revision", task
            if (
                task.status in {"extracting_problems", "parsing_submissions", "grading"}
                or task.reference_parse_job_id
                or task.test_cases_parse_job_id
                or task.material_import_job_id
                or task.ai_completion_job_id
            ):
                return "workflow_busy", task
            if not task.problem_data:
                return "invalid_state", task
            setattr(task, hash_field, content_sha256)
            setattr(task, name_field, filename)
            setattr(task, job_field, job_id)
            task.error = None
            task.last_failed_job_id = None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return "started", task

    def finish_auxiliary_parse(
        self,
        task_id: str,
        *,
        kind: str,
        job_id: str,
        error: Optional[str] = None,
    ) -> Optional[Task]:
        if kind not in {"reference", "test_cases"}:
            raise ValueError("Unknown auxiliary parse kind")
        with self._lock:
            task = self._tasks.get(task_id)
            job_field = f"{kind}_parse_job_id"
            if task is None or getattr(task, job_field) != job_id:
                return None
            setattr(task, job_field, None)
            task.error = error
            task.last_failed_job_id = job_id if error else None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return task

    def begin_material_import(
        self,
        task_id: str,
        *,
        expected_revision: int,
        job_id: str,
        request_fingerprint: str,
    ) -> tuple[str, Optional[Task]]:
        """Atomically reserve the Q-08 plan-building slot for one task."""

        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return "not_found", None
            if task.material_import_job_id:
                if task.pending_material_import_fingerprint == request_fingerprint:
                    return "already_running", task
                return "different_material_import_running", task
            if (
                task.pending_material_import_fingerprint == request_fingerprint
                and task.last_material_import_job_id
            ):
                return "plan_ready", task
            if task.material_import_fingerprint == request_fingerprint:
                return "already_done", task
            if task.workflow_revision != expected_revision:
                return "stale_revision", task
            if (
                task.status in {"extracting_problems", "parsing_submissions", "grading"}
                or task.reference_parse_job_id
                or task.test_cases_parse_job_id
                or task.ai_completion_job_id
            ):
                return "workflow_busy", task
            if task.status != "problems_ready" or not task.problem_data:
                return "invalid_state", task
            task.material_import_job_id = job_id
            task.pending_material_import_fingerprint = request_fingerprint
            task.material_import_error = None
            task.last_failed_job_id = None
            task.last_failed_material_import_fingerprint = None
            task.material_import_retry_revision = None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return "started", task

    def finish_material_import_plan(
        self,
        task_id: str,
        *,
        job_id: str,
    ) -> Optional[Task]:
        """Publish plan readiness without changing question data."""

        with self._lock:
            task = self._tasks.get(task_id)
            if task is None or task.material_import_job_id != job_id:
                return None
            task.material_import_job_id = None
            task.last_material_import_job_id = job_id
            task.material_import_error = None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return task

    def fail_material_import(
        self,
        task_id: str,
        *,
        job_id: str,
        error: str,
    ) -> Optional[Task]:
        """Release a failed Q-08 attempt while retaining all prior fields."""

        with self._lock:
            task = self._tasks.get(task_id)
            if task is None or task.material_import_job_id != job_id:
                return None
            task.material_import_job_id = None
            task.last_failed_material_import_fingerprint = (
                task.pending_material_import_fingerprint
            )
            task.pending_material_import_fingerprint = None
            task.last_material_import_job_id = job_id
            task.material_import_error = error
            task.last_failed_job_id = job_id
            task.workflow_revision += 1
            task.material_import_retry_revision = task.workflow_revision
            task.updated_at = time.time()
            return task

    def expire_material_import_plan(
        self,
        task_id: str,
        *,
        job_id: str,
        request_fingerprint: str,
    ) -> Optional[Task]:
        """Release a task pointer whose terminal review plan expired."""

        with self._lock:
            task = self._tasks.get(task_id)
            if (
                task is None
                or task.material_import_job_id is not None
                or task.last_material_import_job_id != job_id
                or (
                    task.pending_material_import_fingerprint != request_fingerprint
                    and task.material_import_fingerprint != request_fingerprint
                )
            ):
                return task
            task.last_failed_material_import_fingerprint = request_fingerprint
            task.pending_material_import_fingerprint = None
            task.material_import_fingerprint = None
            task.material_import_error = "material_import_plan_expired"
            task.workflow_revision += 1
            task.material_import_retry_revision = task.workflow_revision
            task.updated_at = time.time()
            return task

    def apply_material_import(
        self,
        task_id: str,
        *,
        expected_revision: int,
        job_id: str,
        request_fingerprint: str,
        candidates: List[MaterialImportCandidate],
        accepted_candidate_ids: set[str],
        overwrite_candidate_ids: set[str],
        source_kind: str,
        source_filename: str,
        library_material_id: Optional[str],
    ) -> tuple[str, Optional[Task], Dict[str, Any]]:
        """Apply accepted Q-08 candidates in one lock-held workflow CAS."""

        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return "not_found", None, {}
            if task.workflow_revision != expected_revision:
                return "stale_revision", task, {}
            if (
                task.status != "problems_ready"
                or task.material_import_job_id
                or task.reference_parse_job_id
                or task.test_cases_parse_job_id
                or task.ai_completion_job_id
            ):
                return "workflow_busy", task, {}
            if (
                task.last_material_import_job_id != job_id
                or task.pending_material_import_fingerprint != request_fingerprint
            ):
                return "plan_superseded", task, {}

            new_problem_data = dict(task.problem_data)
            applied: List[str] = []
            conflicts: List[str] = []
            skipped: List[str] = []
            for candidate in candidates:
                if candidate.candidate_id not in accepted_candidate_ids:
                    continue
                current = new_problem_data.get(candidate.q_id)
                if not isinstance(current, dict):
                    skipped.append(candidate.candidate_id)
                    continue
                if (
                    candidate.target == "test_cases"
                    and not is_programming_question_type(current.get("type"))
                ):
                    skipped.append(candidate.candidate_id)
                    continue

                existing = False
                if candidate.target in {"criterion", "reference_answer"}:
                    existing = bool(str(current.get(candidate.target) or "").strip())
                    value: Any = (candidate.text_value or "").strip()
                    if not value:
                        skipped.append(candidate.candidate_id)
                        continue
                else:
                    existing = bool(current.get("test_cases"))
                    value = [case.model_dump() for case in (candidate.test_cases or [])]
                    if not value:
                        skipped.append(candidate.candidate_id)
                        continue

                if existing and candidate.candidate_id not in overwrite_candidate_ids:
                    conflicts.append(candidate.candidate_id)
                    continue
                patched = dict(current)
                patched[candidate.target] = value
                provenance = dict(patched.get("material_provenance") or {})
                provenance[candidate.target] = MaterialFieldProvenance(
                    import_job_id=job_id,
                    candidate_id=candidate.candidate_id,
                    source_kind=source_kind,  # type: ignore[arg-type]
                    source_filename=source_filename,
                    library_material_id=library_material_id,
                    confidence=candidate.confidence,
                    match_status=candidate.match_status,
                    source_excerpt=candidate.source_excerpt,
                    source_location=candidate.source_location,
                    reason=candidate.reason,
                    review_status="pending",
                ).model_dump()
                patched["material_provenance"] = provenance
                new_problem_data[candidate.q_id] = patched
                applied.append(candidate.candidate_id)

            task.problem_data = new_problem_data
            task.material_import_job_id = None
            task.pending_material_import_fingerprint = None
            task.material_import_fingerprint = request_fingerprint
            task.last_material_import_job_id = job_id
            task.material_import_error = None
            task.last_failed_job_id = None
            task.last_failed_material_import_fingerprint = None
            task.material_import_retry_revision = None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return "applied", task, {
                "applied_candidate_ids": applied,
                "conflict_candidate_ids": conflicts,
                "skipped_candidate_ids": skipped,
                "applied_count": len(applied),
                "conflict_count": len(conflicts),
                "skipped_count": len(skipped),
            }

    def begin_ai_completion(
        self,
        task_id: str,
        *,
        expected_revision: int,
        job_id: str,
        request_fingerprint: str,
    ) -> tuple[str, Optional[Task]]:
        """Atomically reserve one Q-09 generation slot after scope confirmation."""

        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return "not_found", None
            if task.ai_completion_job_id:
                if task.pending_ai_completion_fingerprint == request_fingerprint:
                    return "already_running", task
                return "different_ai_completion_running", task
            if (
                task.ai_completion_fingerprint == request_fingerprint
                and task.last_ai_completion_job_id
            ):
                return "already_done", task
            if task.workflow_revision != expected_revision:
                return "stale_revision", task
            if (
                task.status in {"extracting_problems", "parsing_submissions", "grading"}
                or task.reference_parse_job_id
                or task.test_cases_parse_job_id
                or task.material_import_job_id
            ):
                return "workflow_busy", task
            if task.status != "problems_ready" or not task.problem_data:
                return "invalid_state", task
            task.ai_completion_job_id = job_id
            task.pending_ai_completion_fingerprint = request_fingerprint
            task.ai_completion_error = None
            task.last_failed_job_id = None
            task.last_failed_ai_completion_fingerprint = None
            task.ai_completion_retry_revision = None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return "started", task

    def complete_ai_completion(
        self,
        task_id: str,
        *,
        expected_revision: int,
        job_id: str,
        request_fingerprint: str,
        requested_target_ids: List[str],
        candidates: List[AICompletionCandidate],
        provider_id: str,
    ) -> tuple[str, Optional[Task], Dict[str, Any]]:
        """Apply generated values in one lock-held CAS without overwriting."""

        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return "not_found", None, {}
            if task.workflow_revision != expected_revision:
                return "stale_revision", task, {}
            if (
                task.status != "problems_ready"
                or task.ai_completion_job_id != job_id
                or task.pending_ai_completion_fingerprint != request_fingerprint
                or task.material_import_job_id
                or task.reference_parse_job_id
                or task.test_cases_parse_job_id
            ):
                return "workflow_busy", task, {}

            requested = list(dict.fromkeys(requested_target_ids))
            candidate_by_target = {
                candidate.target_id: candidate
                for candidate in candidates
                if candidate.target_id in requested
            }
            new_problem_data = dict(task.problem_data)
            applied: List[str] = []
            skipped: List[str] = []
            invalid: List[str] = []
            applied_by_target: Dict[str, int] = {
                "criterion": 0,
                "reference_answer": 0,
                "solution_code": 0,
                "test_cases": 0,
            }

            for target_id in requested:
                candidate = candidate_by_target.get(target_id)
                if candidate is None:
                    invalid.append(target_id)
                    skipped.append(target_id)
                    continue
                if candidate.target_id != f"{candidate.q_id}:{candidate.target}":
                    invalid.append(target_id)
                    skipped.append(target_id)
                    continue
                current = new_problem_data.get(candidate.q_id)
                if not isinstance(current, dict):
                    invalid.append(target_id)
                    skipped.append(target_id)
                    continue
                programming = is_programming_question_type(current.get("type"))
                if candidate.target in {"solution_code", "test_cases"} and not programming:
                    invalid.append(target_id)
                    skipped.append(target_id)
                    continue
                if _slot_has_value(current, candidate.target) or _slot_is_confirmed(
                    current, candidate.target
                ):
                    skipped.append(target_id)
                    continue

                if candidate.target == "test_cases":
                    cases = [
                        {
                            **case.model_dump(),
                            "source": "llm_generated",
                        }
                        for case in (candidate.test_cases or [])[:12]
                    ]
                    if not cases:
                        invalid.append(target_id)
                        skipped.append(target_id)
                        continue
                    value: Any = cases
                else:
                    value = str(candidate.text_value or "").strip()
                    if not value:
                        invalid.append(target_id)
                        skipped.append(target_id)
                        continue

                patched = dict(current)
                patched[candidate.target] = value
                provenance = dict(patched.get("ai_completion_provenance") or {})
                provenance[candidate.target] = AICompletionFieldProvenance(
                    job_id=job_id,
                    candidate_id=candidate.candidate_id,
                    provider_id=provider_id,
                    review_status="pending",
                ).model_dump()
                patched["ai_completion_provenance"] = provenance
                new_problem_data[candidate.q_id] = patched
                applied.append(target_id)
                applied_by_target[candidate.target] += 1

            task.problem_data = new_problem_data
            task.ai_completion_job_id = None
            task.pending_ai_completion_fingerprint = None
            task.ai_completion_fingerprint = request_fingerprint
            task.last_ai_completion_job_id = job_id
            task.ai_completion_error = None
            task.last_failed_job_id = None
            task.last_failed_ai_completion_fingerprint = None
            task.ai_completion_retry_revision = None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return "done", task, {
                "requested_count": len(requested),
                "generated_count": len(candidate_by_target),
                "applied_count": len(applied),
                "skipped_count": len(skipped),
                "invalid_count": len(invalid),
                "by_target": applied_by_target,
                "applied_target_ids": applied,
                "skipped_target_ids": skipped,
            }

    def fail_ai_completion(
        self,
        task_id: str,
        *,
        job_id: str,
        error: str,
    ) -> Optional[Task]:
        """Release a failed Q-09 job while preserving every question field."""

        with self._lock:
            task = self._tasks.get(task_id)
            if task is None or task.ai_completion_job_id != job_id:
                return None
            task.ai_completion_job_id = None
            task.last_failed_ai_completion_fingerprint = (
                task.pending_ai_completion_fingerprint
            )
            task.pending_ai_completion_fingerprint = None
            task.last_ai_completion_job_id = job_id
            task.ai_completion_error = error
            task.last_failed_job_id = job_id
            task.workflow_revision += 1
            task.ai_completion_retry_revision = task.workflow_revision
            task.updated_at = time.time()
            return task

    def expire_ai_completion_job(
        self,
        task_id: str,
        *,
        job_id: str,
        request_fingerprint: str,
    ) -> Optional[Task]:
        """Release idempotency pointers after a terminal Q-09 job expires."""

        with self._lock:
            task = self._tasks.get(task_id)
            if (
                task is None
                or task.ai_completion_job_id is not None
                or task.last_ai_completion_job_id != job_id
                or (
                    task.pending_ai_completion_fingerprint != request_fingerprint
                    and task.ai_completion_fingerprint != request_fingerprint
                    and task.last_failed_ai_completion_fingerprint != request_fingerprint
                )
            ):
                return task
            task.pending_ai_completion_fingerprint = None
            task.ai_completion_fingerprint = None
            task.last_failed_ai_completion_fingerprint = request_fingerprint
            task.ai_completion_error = "ai_completion_job_expired"
            task.workflow_revision += 1
            task.ai_completion_retry_revision = task.workflow_revision
            task.updated_at = time.time()
            return task

    def begin_grading(
        self,
        task_id: str,
        *,
        expected_revision: int,
        job_id: str,
    ) -> tuple[str, Optional[Task]]:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return "not_found", None
            if task.status == "grading" and task.grading_job_id:
                return "already_running", task
            if task.status == "graded" and task.grading_job_id:
                return "already_done", task
            if task.workflow_revision != expected_revision:
                return "stale_revision", task
            if (
                task.status in {"extracting_problems", "parsing_submissions"}
                or task.reference_parse_job_id
                or task.test_cases_parse_job_id
                or task.material_import_job_id
                or task.ai_completion_job_id
            ):
                return "workflow_busy", task
            if task.status not in {"submissions_ready", "graded", "error"}:
                return "invalid_state", task
            if not task.problem_data or not task.student_data:
                return "invalid_state", task
            task.status = "grading"
            task.grading_job_id = job_id
            task.error = None
            task.last_failed_job_id = None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return "started", task

    def finish_grading(
        self,
        task_id: str,
        *,
        job_id: str,
        error: Optional[str] = None,
    ) -> Optional[Task]:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None or task.grading_job_id != job_id:
                return None
            task.status = "error" if error else "graded"
            task.error = error
            task.last_failed_job_id = job_id if error else None
            task.workflow_revision += 1
            task.updated_at = time.time()
            return task

    def update_workflow(self, task_id: str, **fields: Any) -> Optional[Task]:
        """Update a completed workflow artifact and invalidate old drafts."""

        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                return None
            for key, value in fields.items():
                setattr(task, key, value)
            task.workflow_revision += 1
            task.updated_at = time.time()
            return task

    def update_workflow_cas(
        self,
        task_id: str,
        *,
        expected_revision: int,
        **fields: Any,
    ) -> Optional[Task]:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None or task.workflow_revision != expected_revision:
                return None
            if (
                task.status in {
                    "extracting_problems", "parsing_submissions", "grading",
                }
                or task.reference_parse_job_id
                or task.test_cases_parse_job_id
                or task.material_import_job_id
                or task.ai_completion_job_id
            ):
                return None
            for key, value in fields.items():
                setattr(task, key, value)
            task.workflow_revision += 1
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

    def _ensure_capacity(
        self,
        owner_id: str,
        *,
        replacing_task_id: Optional[str] = None,
    ) -> None:
        existing = self._tasks.get(replacing_task_id or "")
        if existing is not None and existing.owner_id == owner_id:
            return
        owner_count = sum(
            1 for task in self._tasks.values() if task.owner_id == owner_id
        )
        if owner_count >= self.MAX_TASKS_PER_OWNER:
            raise ResourceQuotaError("task_owner_count_limit", 429)
        if len(self._tasks) >= self.MAX_TASKS:
            raise ResourceQuotaError("task_global_count_limit", 429)

    def _remove_idempotency_for_task(self, task_id: str) -> None:
        for key, (_, recorded_task_id) in list(self._idempotency.items()):
            if recorded_task_id == task_id:
                self._idempotency.pop(key, None)


_task_store = TaskStore()


def get_task_store() -> TaskStore:
    return _task_store


# ─── Q-01 problem source stores (owner scoped, in-memory) ───────────────────

class ResourceQuotaError(RuntimeError):
    """Stable store-layer quota signal translated by the API."""

    def __init__(self, code: str, status_code: int) -> None:
        super().__init__(code)
        self.code = code
        self.status_code = status_code

class CourseMaterialStore:
    """Extracted course text with non-evicting owner/global quotas."""

    MAX_MATERIALS = 500
    MAX_MATERIALS_PER_OWNER = 50
    MAX_RESIDENT_BYTES = 128 * 1024 * 1024
    MAX_RESIDENT_BYTES_PER_OWNER = 20 * 1024 * 1024

    def __init__(self) -> None:
        self._materials: OrderedDict[str, CourseMaterial] = OrderedDict()
        self._lock = RLock()

    def create_or_get(self, material: CourseMaterial) -> tuple[CourseMaterial, bool]:
        with self._lock:
            existing = next((
                item for item in self._materials.values()
                if item.owner_id == material.owner_id
                and item.course_id == material.course_id
                and item.sha256 == material.sha256
            ), None)
            if existing is not None:
                return existing, False
            owner_rows = [
                item for item in self._materials.values()
                if item.owner_id == material.owner_id
            ]
            owner_bytes = sum(item.resident_bytes for item in owner_rows)
            total_bytes = sum(item.resident_bytes for item in self._materials.values())
            if material.resident_bytes > self.MAX_RESIDENT_BYTES_PER_OWNER:
                raise ResourceQuotaError("course_material_too_large", 413)
            if len(owner_rows) >= self.MAX_MATERIALS_PER_OWNER:
                raise ResourceQuotaError("course_material_owner_count_limit", 429)
            if len(self._materials) >= self.MAX_MATERIALS:
                raise ResourceQuotaError("course_material_global_count_limit", 429)
            if owner_bytes + material.resident_bytes > self.MAX_RESIDENT_BYTES_PER_OWNER:
                raise ResourceQuotaError("course_material_owner_bytes_limit", 413)
            if total_bytes + material.resident_bytes > self.MAX_RESIDENT_BYTES:
                raise ResourceQuotaError("course_material_global_bytes_limit", 413)
            self._materials[material.material_id] = material
            return material, True

    def get_for_owner(self, material_id: str, owner_id: str) -> Optional[CourseMaterial]:
        with self._lock:
            material = self._materials.get(material_id)
            return material if material is not None and material.owner_id == owner_id else None

    def delete_for_owner(self, material_id: str, owner_id: str) -> bool:
        with self._lock:
            material = self._materials.get(material_id)
            if material is None or material.owner_id != owner_id:
                return False
            self._materials.pop(material_id, None)
            return True

    def list_for_owner(
        self,
        owner_id: str,
        *,
        course_id: Optional[str] = None,
        restrict_course: bool = False,
        query: str = "",
    ) -> List[CourseMaterial]:
        normalized_query = " ".join(query.casefold().split())
        with self._lock:
            rows = [item for item in self._materials.values() if item.owner_id == owner_id]
            if restrict_course:
                rows = [item for item in rows if item.course_id == course_id]
            if normalized_query:
                rows = [
                    item for item in rows
                    if normalized_query in " ".join(item.filename.casefold().split())
                ]
            return sorted(rows, key=lambda item: (-item.updated_at, item.filename.casefold(), item.material_id))

    def clear(self) -> None:
        with self._lock:
            self._materials.clear()


class ProblemSourceDraftStore:
    """Short-lived tokens with non-evicting owner/global quotas."""

    MAX_DRAFTS = 1000
    MAX_DRAFTS_PER_OWNER = 20
    MAX_RESIDENT_BYTES = 64 * 1024 * 1024
    MAX_RESIDENT_BYTES_PER_OWNER = 8 * 1024 * 1024

    def __init__(self) -> None:
        self._drafts: OrderedDict[str, ProblemSourceDraft] = OrderedDict()
        self._lock = RLock()

    def create(self, draft: ProblemSourceDraft) -> ProblemSourceDraft:
        with self._lock:
            self._prune_expired()
            owner_rows = [
                item for item in self._drafts.values()
                if item.owner_id == draft.owner_id
            ]
            owner_bytes = sum(item.resident_bytes for item in owner_rows)
            total_bytes = sum(item.resident_bytes for item in self._drafts.values())
            if draft.resident_bytes > self.MAX_RESIDENT_BYTES_PER_OWNER:
                raise ResourceQuotaError("problem_source_draft_too_large", 413)
            if len(owner_rows) >= self.MAX_DRAFTS_PER_OWNER:
                raise ResourceQuotaError("problem_source_draft_owner_count_limit", 429)
            if len(self._drafts) >= self.MAX_DRAFTS:
                raise ResourceQuotaError("problem_source_draft_global_count_limit", 429)
            if owner_bytes + draft.resident_bytes > self.MAX_RESIDENT_BYTES_PER_OWNER:
                raise ResourceQuotaError("problem_source_draft_owner_bytes_limit", 413)
            if total_bytes + draft.resident_bytes > self.MAX_RESIDENT_BYTES:
                raise ResourceQuotaError("problem_source_draft_global_bytes_limit", 413)
            self._drafts[draft.source_token] = draft
            return draft

    def get_for_owner_task(
        self,
        source_token: str,
        *,
        owner_id: str,
        task_id: str,
    ) -> Optional[ProblemSourceDraft]:
        with self._lock:
            self._prune_expired()
            draft = self._drafts.get(source_token)
            if draft is None or draft.owner_id != owner_id or draft.task_id != task_id:
                return None
            return draft

    def delete_for_task(self, task_id: str) -> None:
        with self._lock:
            for token, draft in list(self._drafts.items()):
                if draft.task_id == task_id:
                    self._drafts.pop(token, None)

    def clear(self) -> None:
        with self._lock:
            self._drafts.clear()

    def _prune_expired(self) -> None:
        now = time.time()
        for token, draft in list(self._drafts.items()):
            if draft.expires_at <= now:
                self._drafts.pop(token, None)


class MaterialImportStore:
    """Bounded owner-scoped storage for Q-08 drafts and review plans."""

    MAX_DRAFTS = 1000
    MAX_DRAFTS_PER_OWNER = 20
    MAX_PLANS = 1000
    MAX_PLANS_PER_OWNER = 20
    MAX_RESIDENT_BYTES = 64 * 1024 * 1024
    MAX_RESIDENT_BYTES_PER_OWNER = 8 * 1024 * 1024
    PLAN_TERMINAL_TTL = 2 * 60 * 60

    def __init__(self) -> None:
        self._drafts: OrderedDict[str, MaterialImportDraft] = OrderedDict()
        self._plans: OrderedDict[str, MaterialImportPlan] = OrderedDict()
        self._lock = RLock()

    @staticmethod
    def _draft_bytes(draft: MaterialImportDraft) -> int:
        return draft.resident_bytes

    @staticmethod
    def _plan_bytes(plan: MaterialImportPlan) -> int:
        return len(plan.model_dump_json().encode("utf-8"))

    def create_draft(self, draft: MaterialImportDraft) -> MaterialImportDraft:
        with self._lock:
            self._prune_expired()
            owner_rows = [item for item in self._drafts.values() if item.owner_id == draft.owner_id]
            owner_bytes = sum(self._draft_bytes(item) for item in owner_rows)
            total_bytes = sum(self._draft_bytes(item) for item in self._drafts.values())
            size = self._draft_bytes(draft)
            if size > self.MAX_RESIDENT_BYTES_PER_OWNER:
                raise ResourceQuotaError("material_import_draft_too_large", 413)
            if len(owner_rows) >= self.MAX_DRAFTS_PER_OWNER:
                raise ResourceQuotaError("material_import_draft_owner_count_limit", 429)
            if len(self._drafts) >= self.MAX_DRAFTS:
                raise ResourceQuotaError("material_import_draft_global_count_limit", 429)
            if owner_bytes + size > self.MAX_RESIDENT_BYTES_PER_OWNER:
                raise ResourceQuotaError("material_import_draft_owner_bytes_limit", 413)
            if total_bytes + size > self.MAX_RESIDENT_BYTES:
                raise ResourceQuotaError("material_import_draft_global_bytes_limit", 413)
            self._drafts[draft.source_token] = draft
            return draft

    def get_draft_for_owner_task(
        self,
        source_token: str,
        *,
        owner_id: str,
        task_id: str,
    ) -> Optional[MaterialImportDraft]:
        with self._lock:
            self._prune_expired()
            draft = self._drafts.get(source_token)
            if draft is None or draft.owner_id != owner_id or draft.task_id != task_id:
                return None
            return draft

    def create_plan(self, plan: MaterialImportPlan) -> MaterialImportPlan:
        with self._lock:
            self._prune_expired()
            owner_rows = [item for item in self._plans.values() if item.owner_id == plan.owner_id]
            if len(owner_rows) >= self.MAX_PLANS_PER_OWNER:
                raise ResourceQuotaError("material_import_plan_owner_count_limit", 429)
            if len(self._plans) >= self.MAX_PLANS:
                raise ResourceQuotaError("material_import_plan_global_count_limit", 429)
            self._plans[plan.job_id] = plan
            return plan

    def get_plan_for_owner_task(
        self,
        job_id: str,
        *,
        owner_id: str,
        task_id: str,
    ) -> Optional[MaterialImportPlan]:
        with self._lock:
            self._prune_expired()
            plan = self._plans.get(job_id)
            if plan is None or plan.owner_id != owner_id or plan.task_id != task_id:
                return None
            return plan.model_copy(deep=True)

    def set_plan_ready(
        self,
        job_id: str,
        *,
        candidates: List[MaterialImportCandidate],
        summary: Dict[str, Any],
    ) -> Optional[MaterialImportPlan]:
        with self._lock:
            self._prune_expired()
            plan = self._plans.get(job_id)
            if plan is None or plan.status != "running":
                return None
            candidate_plan = plan.model_copy(deep=True)
            candidate_plan.candidates = list(candidates)
            candidate_plan.summary = dict(summary)
            candidate_plan.status = "ready"
            candidate_plan.completed_at = time.time()
            candidate_plan.expires_at = time.time() + self.PLAN_TERMINAL_TTL
            new_size = self._plan_bytes(candidate_plan)
            owner_bytes = sum(
                self._plan_bytes(item)
                for key, item in self._plans.items()
                if key != job_id and item.owner_id == plan.owner_id
            )
            total_bytes = sum(
                self._plan_bytes(item)
                for key, item in self._plans.items()
                if key != job_id
            )
            if new_size > self.MAX_RESIDENT_BYTES_PER_OWNER:
                raise ResourceQuotaError("material_import_plan_too_large", 413)
            if owner_bytes + new_size > self.MAX_RESIDENT_BYTES_PER_OWNER:
                raise ResourceQuotaError("material_import_plan_owner_bytes_limit", 413)
            if total_bytes + new_size > self.MAX_RESIDENT_BYTES:
                raise ResourceQuotaError("material_import_plan_global_bytes_limit", 413)
            self._plans[job_id] = candidate_plan
            return candidate_plan.model_copy(deep=True)

    def set_plan_error(self, job_id: str, error: str) -> Optional[MaterialImportPlan]:
        with self._lock:
            self._prune_expired()
            plan = self._plans.get(job_id)
            if plan is None:
                return None
            plan.status = "error"
            plan.error = error
            plan.completed_at = time.time()
            plan.expires_at = time.time() + self.PLAN_TERMINAL_TTL
            return plan.model_copy(deep=True)

    def set_plan_applied(
        self,
        job_id: str,
        applied_candidate_ids: List[str],
        summary: Dict[str, Any],
    ) -> Optional[MaterialImportPlan]:
        with self._lock:
            plan = self._plans.get(job_id)
            if plan is None or plan.status not in {"ready", "applied"}:
                return None
            plan.status = "applied"
            plan.applied_candidate_ids = list(applied_candidate_ids)
            plan.summary = {**plan.summary, **summary}
            plan.completed_at = time.time()
            plan.expires_at = time.time() + self.PLAN_TERMINAL_TTL
            return plan.model_copy(deep=True)

    def delete_plan(self, job_id: str) -> None:
        with self._lock:
            self._plans.pop(job_id, None)

    def delete_for_task(self, task_id: str) -> None:
        with self._lock:
            for token, draft in list(self._drafts.items()):
                if draft.task_id == task_id:
                    self._drafts.pop(token, None)
            for job_id, plan in list(self._plans.items()):
                if plan.task_id == task_id:
                    self._plans.pop(job_id, None)

    def clear(self) -> None:
        with self._lock:
            self._drafts.clear()
            self._plans.clear()

    def _prune_expired(self) -> None:
        now = time.time()
        for token, draft in list(self._drafts.items()):
            if draft.expires_at <= now:
                self._drafts.pop(token, None)
        for job_id, plan in list(self._plans.items()):
            # A running provider call owns the task's workflow slot. Do not
            # silently evict its plan and strand that slot; completion/failure
            # will transition it to a TTL-prunable terminal state.
            if plan.status != "running" and plan.expires_at <= now:
                self._plans.pop(job_id, None)


class AICompletionStore:
    """Bounded owner-scoped storage for recoverable Q-09 job summaries."""

    MAX_JOBS = 1000
    MAX_JOBS_PER_OWNER = 20
    MAX_RESIDENT_BYTES = 16 * 1024 * 1024
    MAX_RESIDENT_BYTES_PER_OWNER = 2 * 1024 * 1024
    TERMINAL_TTL = 2 * 60 * 60

    def __init__(self) -> None:
        self._jobs: OrderedDict[str, AICompletionJob] = OrderedDict()
        self._lock = RLock()

    @staticmethod
    def _job_bytes(job: AICompletionJob) -> int:
        return len(job.model_dump_json().encode("utf-8"))

    @classmethod
    def _reserved_job_bytes(cls, job: AICompletionJob) -> int:
        # A terminal row adds one applied-or-skipped copy of every requested
        # target ID plus a small fixed summary. Reserve that bounded growth at
        # creation so completion can never fail after TaskStore has committed.
        terminal_growth = sum(
            len(target_id.encode("utf-8")) for target_id in job.target_ids
        ) + 4096
        return max(cls._job_bytes(job), cls._job_bytes(job) + terminal_growth)

    def create(self, job: AICompletionJob) -> AICompletionJob:
        with self._lock:
            self._prune_expired()
            owner_jobs = [
                item for item in self._jobs.values() if item.owner_id == job.owner_id
            ]
            if len(owner_jobs) >= self.MAX_JOBS_PER_OWNER:
                raise ResourceQuotaError("ai_completion_owner_count_limit", 429)
            if len(self._jobs) >= self.MAX_JOBS:
                raise ResourceQuotaError("ai_completion_global_count_limit", 429)
            job_size = self._reserved_job_bytes(job)
            owner_bytes = sum(self._reserved_job_bytes(item) for item in owner_jobs)
            total_bytes = sum(
                self._reserved_job_bytes(item) for item in self._jobs.values()
            )
            if owner_bytes + job_size > self.MAX_RESIDENT_BYTES_PER_OWNER:
                raise ResourceQuotaError("ai_completion_owner_bytes_limit", 413)
            if total_bytes + job_size > self.MAX_RESIDENT_BYTES:
                raise ResourceQuotaError("ai_completion_global_bytes_limit", 413)
            self._jobs[job.job_id] = job
            return job.model_copy(deep=True)

    def get_for_owner_task(
        self,
        job_id: str,
        *,
        owner_id: str,
        task_id: str,
    ) -> Optional[AICompletionJob]:
        with self._lock:
            self._prune_expired()
            job = self._jobs.get(job_id)
            if job is None or job.owner_id != owner_id or job.task_id != task_id:
                return None
            return job.model_copy(deep=True)

    def set_done(
        self,
        job_id: str,
        *,
        summary: Dict[str, Any],
    ) -> Optional[AICompletionJob]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None or job.status != "running":
                return None
            candidate = job.model_copy(deep=True)
            candidate.status = "done"
            candidate.summary = {
                key: value for key, value in summary.items()
                if key not in {"applied_target_ids", "skipped_target_ids"}
            }
            candidate.applied_target_ids = list(summary.get("applied_target_ids") or [])
            candidate.skipped_target_ids = list(summary.get("skipped_target_ids") or [])
            candidate.completed_at = time.time()
            candidate.expires_at = time.time() + self.TERMINAL_TTL
            # create() reserved the maximum bounded terminal growth.
            self._jobs[job_id] = candidate
            return candidate.model_copy(deep=True)

    def set_error(self, job_id: str, error: str) -> Optional[AICompletionJob]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            job.status = "error"
            job.error = error
            job.completed_at = time.time()
            job.expires_at = time.time() + self.TERMINAL_TTL
            return job.model_copy(deep=True)

    def delete(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)

    def delete_for_task(self, task_id: str) -> None:
        with self._lock:
            for job_id, job in list(self._jobs.items()):
                if job.task_id == task_id:
                    self._jobs.pop(job_id, None)

    def clear(self) -> None:
        with self._lock:
            self._jobs.clear()

    def _prune_expired(self) -> None:
        now = time.time()
        for job_id, job in list(self._jobs.items()):
            if job.status != "running" and job.expires_at <= now:
                self._jobs.pop(job_id, None)


_course_material_store = CourseMaterialStore()
_problem_source_draft_store = ProblemSourceDraftStore()
_material_import_store = MaterialImportStore()
_ai_completion_store = AICompletionStore()


def get_course_material_store() -> CourseMaterialStore:
    return _course_material_store


def get_problem_source_draft_store() -> ProblemSourceDraftStore:
    return _problem_source_draft_store


def get_material_import_store() -> MaterialImportStore:
    return _material_import_store


def get_ai_completion_store() -> AICompletionStore:
    return _ai_completion_store


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
