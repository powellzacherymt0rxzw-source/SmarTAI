"""
Tasks API — task-centric workflow router.

A `Task` bundles `problem_data + student_data + grading_job` into one user-visible
unit so a teacher can pause mid-flow, switch between drafts, or resume work later.
This file replaces the global problem_store/student_store coupling that the
legacy /prob_preview /hw_preview endpoints rely on.

Endpoints:
  POST   /tasks/                              create draft task
  GET    /tasks/                              list current user's tasks (lite)
  GET    /tasks/{task_id}                     full task (incl. problem & student data)
  PUT    /tasks/{task_id}                     rename / update metadata
  DELETE /tasks/{task_id}                     delete task
  POST   /tasks/{task_id}/extract_problems    upload problem file → start extract job
  POST   /tasks/{task_id}/parse_submissions   upload submission archive → start parse job
  POST   /tasks/{task_id}/grade               start batch grading job
  GET    /tasks/{task_id}/state               current status + active reporter snapshot
  GET    /tasks/{task_id}/result              graded result

Idempotency:
  Each upload endpoint computes sha256(file_bytes). If a job for the same hash is
  already running OR has already completed, the endpoint returns
  `{"status": "already_running"}` or `{"status": "already_done"}` and skips the
  LLM call. Choosing a different file invalidates the hash and starts a fresh job.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import time
import uuid
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field

from backend.auth import require_teacher
from backend.models import CourseMaterial, GradingJob, ProblemSourceDraft, Task, TestCase, User
from backend.state import (
    CourseMaterialStore, JobStore, ProblemSourceDraftStore, ResourceQuotaError,
    TagStore, TaskStore,
    get_course_material_store, get_course_store, get_job_store,
    get_problem_source_draft_store, get_tag_store, get_task_store,
)
from backend.llm.registry import ExpertRegistry, ExpertRegistryView, get_expert_registry
from backend.agents.ingest_agent import (
    extract_problems,
    parse_student_answers,
    parse_reference_to_per_question,
    parse_test_cases_to_per_question,
)
from backend.agents.grading_agent import grade_batch
from backend.tools.file_processing import (
    decode_text_bytes, extract_files_from_archive, extract_text_from_pdf,
)
from backend.tools.knowledge import get_retriever
from backend.rag.chunker import extract_text as kb_extract_text, chunk_text, MAX_FILE_BYTES as KB_MAX_FILE_BYTES
from backend.rag.embedder import pick_embedder
from backend.rag.store import InMemoryTaskRetriever
from backend.progress.tracker import (
    ProgressReporter, get_or_create_reporter, get_reporter, remove_reporter,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tasks", tags=["tasks"])


# ─── Request models ──────────────────────────────────────────────────────────

class CreateTaskRequest(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    semester_id: Optional[str] = None
    course_id: Optional[str] = None
    tag_ids: List[str] = Field(default_factory=list, max_length=30)


class UpdateTaskRequest(BaseModel):
    name: Optional[str] = None
    semester_id: Optional[str] = None
    course_id: Optional[str] = None
    tag_ids: Optional[List[str]] = Field(default=None, max_length=30)


class InterpretTaskQueryRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)


class GradeRequest(BaseModel):
    language: str = "en"
    # ─── Per-task overrides for global settings ─────────────────────────────
    # When None, the corresponding `settings.*` value is used (current behavior).
    # When set, this value is used for THIS grading run only — does NOT persist
    # back to settings or TaskStore. The plan (hyssop-paper-jaybird) uses this
    # to surface a per-task multi-sample slider on the task_setup page so a
    # teacher can spend extra LLM calls on important tasks without changing
    # the global default.
    multi_sample_n: Optional[int] = Field(
        default=None,
        ge=1, le=10,
        description="单专家场景下并行采样次数；None = 用全局默认（settings.multi_sample_n，目前 1）。"
                    "≥ 2 个启用专家时本字段被忽略（变量来自专家本身）。",
    )


class UpdateProblemRequest(BaseModel):
    """Edit one focused question-preparation field and/or review state.

    Only fields you pass are applied; the rest stay as-is. Editing recognized
    content marks it ``edited`` unless the same request explicitly confirms it.
    Used by the Problems-page edit-in-place UI.
    """
    stem: Optional[str] = None
    criterion: Optional[str] = None
    reference_answer: Optional[str] = None
    test_cases: Optional[List[TestCase]] = None
    review_status: Optional[Literal["needs_review", "edited", "confirmed"]] = None


class UpdateStudentAnswerRequest(BaseModel):
    """Edit a single student's parsed answer for a specific question.

    Used by the student-answers preview page when the teacher spots an AI
    OCR / segmentation error and wants to fix the recognized content (or
    clear the recognition flag) before grading runs.
    """
    content: Optional[str] = None
    flag: Optional[List[str]] = None      # pass [] to clear flags


class UpdateTeacherCommentRequest(BaseModel):
    """Set or clear a teacher's manual comment on a (student, q_id) pair.

    Stored alongside the AI correction so the teacher's note is preserved
    when the task is reloaded, without overwriting the AI feedback. An empty
    string clears the comment.
    """
    student_id: str
    q_id: str
    comment: str = ""


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _check_owner(task: Task, user: User) -> None:
    if user.role == "admin":
        return
    if task.owner_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Not your task")


def _require_task_llm_principal(task: Task, user: User) -> None:
    """Block implicit admin impersonation from consuming an owner's BYOK."""

    if task.owner_id != user.id:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"code": "task_llm_impersonation_forbidden"},
        )


def _task_workflow_is_busy(task: Task) -> bool:
    return bool(
        task.status in {
            "extracting_problems", "parsing_submissions", "grading",
        }
        or task.reference_parse_job_id
        or task.test_cases_parse_job_id
    )


def _get_or_404(task_store: TaskStore, task_id: str) -> Task:
    t = task_store.get(task_id)
    if t is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Task not found")
    return t


_TASK_STATUSES = {
    "draft", "extracting_problems", "problems_ready", "parsing_submissions",
    "submissions_ready", "grading", "graded", "error",
}
_TASK_SORTS = {
    "updated_desc", "updated_asc", "created_desc", "created_asc",
    "name_asc", "name_desc", "attention_first", "stage_asc", "stage_desc",
}
_SEMESTER_PATTERN = re.compile(
    r"^(20\d{2})-(20\d{2})-(autumn|winter|spring|summer)$",
)
_PROBLEM_SOURCE_MAX_BYTES = 5 * 1024 * 1024
_PROBLEM_SOURCE_DRAFT_TTL_SECONDS = 2 * 60 * 60
_PROBLEM_SOURCE_EXTENSIONS = {".pdf", ".txt", ".md"}
_PROBLEM_SOURCE_MAX_CHARACTERS = 400_000
_PROBLEM_SOURCE_MAX_ESTIMATED_TOKENS = 120_000
_PROBLEM_REPLACEMENT_CLEARS = [
    "problem_data",
    "student_data",
    "submission_file",
    "grading_result",
    "reference_answers",
    "test_cases",
]
_PROBLEM_REPLACEMENT_PRESERVES = [
    "task_metadata",
    "tags",
    "course_library_materials",
    "task_knowledge_base_documents",
]
_QUESTION_HEADING_PATTERNS = (
    re.compile(
        r"(?im)^\s*(?P<number>(?:q(?:uestion)?\s*)?\d+(?:\.\d+)*|[IVXLCDM]+)"
        r"\s*(?:[.、):：]|题\b)\s*(?P<title>[^\n]{0,180})"
    ),
    re.compile(
        r"(?im)^\s*第\s*(?P<number>\d+(?:\.\d+)*|[一二三四五六七八九十百]+)"
        r"\s*题\s*(?P<title>[^\n]{0,180})"
    ),
)
_HINT_QUESTION_PATTERNS = (
    re.compile(r"(?i)(?:q(?:uestion)?\s*)(\d+(?:\.\d+)*)"),
    re.compile(r"第\s*(\d+(?:\.\d+)*)\s*题"),
    re.compile(r"题(?:号)?\s*[:：]?\s*(\d+(?:\.\d+)*)"),
)


async def _read_problem_source_upload(
    file: UploadFile,
) -> tuple[str, str, bytes, str, str]:
    """Validate and decode a Q-01 source without claiming OCR support."""

    filename = Path(file.filename or "").name.strip()
    extension = Path(filename).suffix.casefold()
    if not filename or extension not in _PROBLEM_SOURCE_EXTENSIONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail="Unsupported problem source type. Allowed: PDF, TXT, MD. DOCX and OCR/images are not supported yet.",
        )
    body = await file.read(_PROBLEM_SOURCE_MAX_BYTES + 1)
    if not body:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Problem source file is empty.")
    if len(body) > _PROBLEM_SOURCE_MAX_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Problem source is larger than {_PROBLEM_SOURCE_MAX_BYTES} bytes.",
        )
    try:
        text = await (
            extract_text_from_pdf(body)
            if extension == ".pdf"
            else decode_text_bytes(body)
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning(
            "Problem source decode failed; exception_type=%s",
            type(exc).__name__,
        )
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            detail={"code": "problem_source_decode_failed"},
        ) from exc
    text = (text or "").strip()
    if not text:
        if extension == ".pdf":
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                detail="PDF contains no extractable text. Scanned/image PDFs require OCR, which is not supported yet.",
            )
        raise HTTPException(status.HTTP_400_BAD_REQUEST, detail="Problem source contains no usable text.")
    _validate_problem_source_text(text)
    return filename, file.content_type or "application/octet-stream", body, text, hashlib.sha256(body).hexdigest()


def _estimate_problem_source_tokens(text: str) -> int:
    cjk_count = sum(1 for char in text if "\u3400" <= char <= "\u9fff")
    non_cjk_count = len(text) - cjk_count
    return cjk_count + (non_cjk_count + 3) // 4


def _validate_problem_source_text(text: str) -> None:
    if len(text) > _PROBLEM_SOURCE_MAX_CHARACTERS:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={
                "code": "problem_source_character_limit_exceeded",
                "max_characters": _PROBLEM_SOURCE_MAX_CHARACTERS,
            },
        )
    estimated_tokens = _estimate_problem_source_tokens(text)
    if estimated_tokens > _PROBLEM_SOURCE_MAX_ESTIMATED_TOKENS:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail={
                "code": "problem_source_token_limit_exceeded",
                "max_estimated_tokens": _PROBLEM_SOURCE_MAX_ESTIMATED_TOKENS,
            },
        )


def _normalize_question_number(value: str) -> str:
    normalized = re.sub(r"(?i)^question\s*|^q\s*", "", value.strip())
    return normalized.casefold().rstrip(".、):：")


def _detect_problem_source_candidates(
    text: str,
    *,
    structure_mode: Literal["organized", "extract_from_source"],
    extraction_hint: str,
) -> tuple[List[Dict[str, Any]], List[str]]:
    """Find explicit headings locally; this is intentionally not semantic AI."""

    matches: List[tuple[int, str, str]] = []
    seen: set[tuple[int, str]] = set()
    for pattern in _QUESTION_HEADING_PATTERNS:
        for match in pattern.finditer(text):
            number = " ".join(match.group("number").split())
            dedupe_key = (match.start(), _normalize_question_number(number))
            if dedupe_key in seen:
                continue
            seen.add(dedupe_key)
            preview = " ".join((match.group("title") or "").strip().split())
            matches.append((match.start(), number, preview[:180]))
    matches.sort(key=lambda item: item[0])

    kind = "matched" if structure_mode == "organized" else "possible_match"
    candidates: List[Dict[str, Any]] = []
    detected_numbers: set[str] = set()
    for index, (offset, number, preview) in enumerate(matches[:200], start=1):
        normalized_number = _normalize_question_number(number)
        detected_numbers.add(normalized_number)
        candidates.append({
            "candidate_id": f"candidate_{index}",
            "question_number": number,
            "preview": preview,
            "line_number": text.count("\n", 0, offset) + 1,
            "match_kind": kind,
            "reason": "explicit_heading_detected",
        })

    requested: List[str] = []
    for pattern in _HINT_QUESTION_PATTERNS:
        requested.extend(match.group(1) for match in pattern.finditer(extraction_hint))
    not_found = [
        number for number in dict.fromkeys(requested)
        if _normalize_question_number(number) not in detected_numbers
    ]
    return candidates, not_found


def _problem_source_fingerprint(
    *,
    content_sha256: str,
    structure_mode: str,
    extraction_hint: str,
    confirmed_candidate_ids: List[str],
) -> str:
    payload = {
        "content_sha256": content_sha256,
        "structure_mode": structure_mode,
        "extraction_hint": " ".join(extraction_hint.split()),
        "confirmed_candidate_ids": sorted(dict.fromkeys(confirmed_candidate_ids)),
    }
    return hashlib.sha256(json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")).hexdigest()


def _problem_extraction_gate_response(
    outcome: str,
    current_task: Optional[Task],
    *,
    expected_workflow_revision: int,
) -> Optional[Dict[str, Any]]:
    """Map a problem-extraction gate outcome to its public API contract."""

    if outcome in {"ready", "started"}:
        return None
    if outcome == "not_found" or current_task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Task not found")
    if outcome == "already_running":
        return {
            "status": "already_running",
            "job_id": current_task.extract_job_id,
            "task_id": current_task.task_id,
            "workflow_revision": current_task.workflow_revision,
        }
    if outcome == "already_done":
        return {
            "status": "already_done",
            "unchanged": True,
            "job_id": current_task.extract_job_id,
            "task_id": current_task.task_id,
            "problem_count": len(current_task.problem_data),
            "workflow_revision": current_task.workflow_revision,
        }
    if outcome == "different_source_running":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "different_problem_source_running",
                "job_id": current_task.extract_job_id,
                "workflow_revision": current_task.workflow_revision,
            },
        )
    if outcome == "stale_revision":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "stale_problem_source",
                "base_workflow_revision": expected_workflow_revision,
                "workflow_revision": current_task.workflow_revision,
            },
        )
    if outcome == "replacement_confirmation_required":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "problem_replacement_confirmation_required",
                "will_clear": _PROBLEM_REPLACEMENT_CLEARS,
                "will_preserve": _PROBLEM_REPLACEMENT_PRESERVES,
                "workflow_revision": current_task.workflow_revision,
            },
        )
    if outcome == "workflow_busy":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "task_workflow_busy",
                "workflow_revision": current_task.workflow_revision,
            },
        )
    raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": outcome})


def _parse_confirmed_candidate_ids(
    raw: Optional[str],
    draft: ProblemSourceDraft,
) -> tuple[List[str], List[Dict[str, Any]]]:
    if not draft.requires_confirmation:
        # "Already organized" means every explicit heading is included.  Do
        # not let a generic client field accidentally narrow this mode.
        selected = [item["candidate_id"] for item in draft.candidates]
    elif raw is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "candidate_confirmation_required",
                "source_token": draft.source_token,
            },
        )
    else:
        try:
            decoded = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="confirmed_candidate_ids must be a JSON array of candidate IDs.",
            ) from exc
        if not isinstance(decoded, list) or not all(isinstance(item, str) for item in decoded):
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="confirmed_candidate_ids must be a JSON array of candidate IDs.",
            )
        selected = list(dict.fromkeys(item.strip() for item in decoded if item.strip()))

    by_id = {item["candidate_id"]: item for item in draft.candidates}
    unknown = [candidate_id for candidate_id in selected if candidate_id not in by_id]
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "unknown_candidate_ids", "candidate_ids": unknown},
        )
    return selected, [by_id[candidate_id] for candidate_id in selected]


def _allowed_semester_ids(now: Optional[datetime] = None) -> List[str]:
    """Fixed semester choices from 2025-2026 autumn through current + one.

    This mirrors the product decision recorded for the Figma rebuild.  The
    frontend localises labels; the API stores stable machine IDs only.
    """

    now = now or datetime.now()
    seasons = ("autumn", "winter", "spring", "summer")
    # Product calendar (not a registrar-grade calendar):
    # autumn Aug-Nov, winter Dec-Feb, spring Mar-May, summer Jun-Jul.
    if 8 <= now.month <= 11:
        current_start = now.year
        current_index = 0
    elif now.month == 12:
        current_start = now.year
        current_index = 1
    elif now.month <= 2:
        current_start = now.year - 1
        current_index = 1
    elif now.month <= 5:
        current_start = now.year - 1
        current_index = 2
    else:
        current_start = now.year - 1
        current_index = 3

    target_start = current_start
    target_index = current_index + 1
    if target_index >= len(seasons):
        target_start += 1
        target_index = 0

    out: List[str] = []
    start_year = 2025
    season_index = 0
    while (start_year, season_index) <= (target_start, target_index):
        out.append(f"{start_year}-{start_year + 1}-{seasons[season_index]}")
        season_index += 1
        if season_index == len(seasons):
            start_year += 1
            season_index = 0
    return out


def _validate_semester_id(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    semester_id = value.strip().lower()
    match = _SEMESTER_PATTERN.fullmatch(semester_id)
    if match is None or int(match.group(2)) != int(match.group(1)) + 1:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="semester_id must be YYYY-YYYY-autumn|winter|spring|summer",
        )
    if semester_id not in _allowed_semester_ids():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="semester_id is outside the currently selectable range",
        )
    return semester_id


def _validate_course_id(course_id: Optional[str], owner_id: str) -> Optional[str]:
    if course_id is None:
        return None
    course = get_course_store().get(course_id)
    # 404 avoids disclosing another owner's course.
    if course is None or course.teacher_id != owner_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Course not found")
    return course_id


def _validate_tag_ids(
    tag_ids: List[str], owner_id: str, tag_store: TagStore,
) -> List[str]:
    unique = list(dict.fromkeys(tag_ids))
    for tag_id in unique:
        tag = tag_store.get(tag_id)
        if tag is None or tag.owner_id != owner_id:
            # Same non-disclosure rule as courses.
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Tag not found")
    return unique


def _task_needs_attention(task: Task, job_store: JobStore) -> bool:
    if task.status == "error" or bool(task.error):
        return True
    # Paused states require the teacher's next action. `graded` means results
    # were generated, not that a teacher formally finalized review (that state
    # does not exist yet), so it remains attention-worthy.
    if task.status in {"draft", "problems_ready", "submissions_ready", "graded"}:
        return True
    if not task.grading_job_id:
        return False
    job = job_store.get(task.grading_job_id)
    if job is None:
        return False
    if job.status == "error" or bool(job.error):
        return True
    payload = job.results or {}
    students = payload.get("results", []) if isinstance(payload, dict) else []
    if isinstance(students, dict):
        students = [students]
    for student in students if isinstance(students, list) else []:
        if not isinstance(student, dict):
            continue
        for correction in student.get("corrections", []) or []:
            if not isinstance(correction, dict):
                continue
            if correction.get("requires_human_review") is True:
                return True
            if correction.get("synthesis_method") in {
                "all_failed", "quota_exhausted",
            }:
                return True
    return False


def _lite_with_attention(task: Task, job_store: JobStore) -> Dict[str, Any]:
    out = task.lite()
    out["needs_attention"] = _task_needs_attention(task, job_store)
    return out


def _split_query_values(*groups: Optional[List[str]]) -> List[str]:
    out: List[str] = []
    for group in groups:
        for value in group or []:
            out.extend(item.strip() for item in value.split(",") if item.strip())
    return list(dict.fromkeys(out))


# ─── CRUD ────────────────────────────────────────────────────────────────────

@router.post("/")
def create_task(
    req: CreateTaskRequest,
    idempotency_key: Optional[str] = Header(
        default=None,
        alias="Idempotency-Key",
        max_length=200,
    ),
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    tag_store: TagStore = Depends(get_tag_store),
):
    if not req.name.strip():
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Task name cannot be blank",
        )
    effective_name = req.name.strip()
    normalized_key = idempotency_key.strip() if idempotency_key is not None else None
    if normalized_key == "":
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Idempotency-Key cannot be blank",
        )
    canonical_semester_id = (
        req.semester_id.strip().lower() if req.semester_id is not None else None
    )
    canonical_tag_ids = sorted(dict.fromkeys(req.tag_ids))
    payload = {
        "name": effective_name,
        "semester_id": canonical_semester_id,
        "course_id": req.course_id,
        "tag_ids": canonical_tag_ids,
    }
    payload_hash = hashlib.sha256(json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")).hexdigest()
    if normalized_key is not None:
        replay, conflict = task_store.lookup_idempotent(
            owner_id=current.id,
            idempotency_key=normalized_key,
            payload_hash=payload_hash,
        )
        if conflict:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={
                    "code": "idempotency_key_reused",
                    "task_id": replay.task_id if replay is not None else None,
                },
            )
        if replay is not None:
            return replay.lite()

    semester_id = _validate_semester_id(canonical_semester_id)
    course_id = _validate_course_id(req.course_id, current.id)
    tag_ids = _validate_tag_ids(canonical_tag_ids, current.id, tag_store)
    task = Task(
        task_id=f"T_{uuid.uuid4().hex[:10]}",
        name=effective_name,
        owner_id=current.id,
        status="draft",
        semester_id=semester_id,
        course_id=course_id,
        tag_ids=tag_ids,
    )
    try:
        if normalized_key is None:
            task_store.create(task)
            logger.info(f"Created task {task.task_id} for {current.id}")
            return task.lite()

        stored, created, conflict = task_store.create_idempotent(
            task,
            idempotency_key=normalized_key,
            payload_hash=payload_hash,
        )
    except ResourceQuotaError as exc:
        raise HTTPException(
            exc.status_code,
            detail={"code": exc.code},
        ) from exc
    if conflict:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": "idempotency_key_reused",
                "task_id": stored.task_id if stored is not None else None,
            },
        )
    assert stored is not None
    if created:
        logger.info(f"Created task {stored.task_id} for {current.id}")
    return stored.lite()


@router.get("/")
def list_tasks(
    request: Request,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    q: Optional[str] = Query(default=None, max_length=120),
    semester_id: Optional[str] = Query(default=None),
    semester: Optional[str] = Query(default=None),
    course_id: Optional[str] = Query(default=None),
    course: Optional[str] = Query(default=None),
    tag_ids: Optional[List[str]] = Query(default=None),
    tags: Optional[List[str]] = Query(default=None),
    statuses: Optional[List[str]] = Query(default=None),
    status_filter: Optional[List[str]] = Query(default=None, alias="status"),
    unfinished: Optional[bool] = Query(default=None),
    needs_attention: Optional[bool] = Query(default=None),
    sort: str = Query(default="updated_desc"),
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    job_store: JobStore = Depends(get_job_store),
    tag_store: TagStore = Depends(get_tag_store),
):
    tasks = task_store.list_for_owner(current.id)
    tasks.sort(key=lambda t: t.updated_at, reverse=True)

    # Backwards compatibility is intentionally keyed on the literal absence of
    # a query string. Dashboard and legacy clients still receive the original
    # task-id dictionary rather than a pagination envelope.
    if not request.query_params:
        return {t.task_id: _lite_with_attention(t, job_store) for t in tasks}

    selected_semester = semester_id or semester
    selected_course = course_id or course
    selected_tags = _split_query_values(tag_ids, tags)
    selected_statuses = _split_query_values(statuses, status_filter)
    unknown_statuses = [item for item in selected_statuses if item not in _TASK_STATUSES]
    if unknown_statuses:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_status", "values": unknown_statuses},
        )
    if sort not in _TASK_SORTS:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "invalid_sort", "value": sort},
        )

    owner_courses = [
        item for item in get_course_store().values()
        if item.teacher_id == current.id
    ]
    owner_courses.sort(key=lambda item: (item.name.casefold(), item.code.casefold()))
    course_by_id = {item.id: item for item in owner_courses}
    owner_tags = tag_store.list_for_owner(current.id)
    owner_tags.sort(key=lambda item: (item.normalized_name, item.created_at))
    tag_by_id = {item.id: item for item in owner_tags}
    tag_usage_counts = {
        tag.id: sum(1 for task in tasks if tag.id in task.tag_ids)
        for tag in owner_tags
    }

    rows = [(task, _lite_with_attention(task, job_store)) for task in tasks]
    if selected_semester:
        rows = [item for item in rows if item[0].semester_id == selected_semester]
    if selected_course:
        rows = [item for item in rows if item[0].course_id == selected_course]
    if selected_tags:
        required = set(selected_tags)
        rows = [item for item in rows if required.issubset(set(item[0].tag_ids))]
    if selected_statuses:
        allowed = set(selected_statuses)
        rows = [item for item in rows if item[0].status in allowed]
    if unfinished is True:
        # "unfinished" means the automated grading pipeline has not reached
        # result generation. `graded` is *not* a formal teacher-finalized state;
        # the lifecycle currently has no review/finalized status.
        rows = [item for item in rows if item[0].status != "graded"]
    if needs_attention is not None:
        rows = [
            item for item in rows
            if bool(item[1]["needs_attention"]) is needs_attention
        ]
    if q and q.strip():
        needle = q.strip().casefold()

        def _search_text(task: Task) -> str:
            course_item = course_by_id.get(task.course_id or "")
            tag_names = [
                tag_by_id[tag_id].name
                for tag_id in task.tag_ids if tag_id in tag_by_id
            ]
            return " ".join([
                task.name,
                task.semester_id or "",
                course_item.name if course_item else "",
                course_item.code if course_item else "",
                *tag_names,
            ]).casefold()

        rows = [item for item in rows if needle in _search_text(item[0])]

    if sort == "updated_desc":
        rows.sort(key=lambda item: item[0].updated_at, reverse=True)
    elif sort == "updated_asc":
        rows.sort(key=lambda item: item[0].updated_at)
    elif sort == "created_desc":
        rows.sort(key=lambda item: item[0].created_at, reverse=True)
    elif sort == "created_asc":
        rows.sort(key=lambda item: item[0].created_at)
    elif sort == "name_asc":
        rows.sort(key=lambda item: (item[0].name.casefold(), -item[0].updated_at))
    elif sort == "name_desc":
        rows.sort(key=lambda item: item[0].name.casefold(), reverse=True)
    elif sort == "attention_first":
        rows.sort(key=lambda item: (not item[1]["needs_attention"], -item[0].updated_at))
    elif sort in {"stage_asc", "stage_desc"}:
        stage_order = {
            "draft": 0,
            "extracting_problems": 1,
            "problems_ready": 2,
            "parsing_submissions": 3,
            "submissions_ready": 4,
            "grading": 5,
            "graded": 6,
            "error": 7,
        }
        direction = 1 if sort == "stage_asc" else -1
        rows.sort(key=lambda item: (
            direction * stage_order[item[0].status], -item[0].updated_at,
        ))

    total = len(rows)
    start = (page - 1) * page_size
    items = [item[1] for item in rows[start:start + page_size]]
    status_counts = Counter(task.status for task in tasks)
    facets = {
        "semesters": _allowed_semester_ids(),
        "courses": [
            {"id": item.id, "name": item.name, "code": item.code}
            for item in owner_courses
        ],
        "tags": [
            {**item.public(), "usage_count": tag_usage_counts[item.id]}
            for item in owner_tags
        ],
        "statuses": {
            item: status_counts.get(item, 0)
            for item in (
                "draft", "extracting_problems", "problems_ready",
                "parsing_submissions", "submissions_ready", "grading",
                "graded", "error",
            )
        },
    }
    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "available_facets": facets,
        # Temporary alias lets independently-developed History clients land
        # safely; `available_facets` is the canonical field.
        "facets": facets,
    }


@router.post("/query/interpret")
async def interpret_task_query(
    req: InterpretTaskQueryRequest,
    current: User = Depends(require_teacher),
    tag_store: TagStore = Depends(get_tag_store),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    """Interpret natural language without making ordinary filters model-bound.

    This static route must remain above ``/{task_id}`` so FastAPI never treats
    the word ``query`` as a task ID.
    """

    from backend.agents.history_query_agent import interpret_history_query

    query_id = f"history_query_{uuid.uuid4().hex[:12]}"
    reporter = ProgressReporter(query_id)
    owner_courses = [
        item for item in get_course_store().values()
        if item.teacher_id == current.id
    ]
    courses = [
        {"id": item.id, "name": item.name, "code": item.code}
        for item in owner_courses
    ]
    tags_payload = [
        {
            "id": item.id,
            "name": item.name,
            "normalized_name": item.normalized_name,
            "color": item.color,
        }
        for item in tag_store.list_for_owner(current.id)
    ]
    provider = registry.for_owner(current.id).pick_default()
    result = await interpret_history_query(
        req.query,
        semesters=_allowed_semester_ids(),
        courses=courses,
        tags=tags_payload,
        provider=provider,
        reporter=reporter,
        owner_id=current.id,
    )
    snapshot = await reporter.snapshot()
    return {
        **result,
        "query_id": query_id,
        "progress": snapshot.model_dump(),
    }


@router.get("/{task_id}")
def get_task(
    task_id: str,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
):
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    out = t.lite()
    out["problem_data"] = t.problem_data
    out["student_data"] = t.student_data
    return out


@router.put("/{task_id}")
def update_task(
    task_id: str,
    req: UpdateTaskRequest,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    tag_store: TagStore = Depends(get_tag_store),
):
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    fields: Dict[str, Any] = {}
    if req.name is not None:
        fields["name"] = req.name
    if "semester_id" in req.model_fields_set:
        fields["semester_id"] = _validate_semester_id(req.semester_id)
    if "course_id" in req.model_fields_set:
        fields["course_id"] = _validate_course_id(req.course_id, current.id)
    if "tag_ids" in req.model_fields_set:
        fields["tag_ids"] = _validate_tag_ids(
            req.tag_ids or [], current.id, tag_store,
        )
    if fields:
        task_store.update(task_id, **fields)
    return task_store.get(task_id).lite()  # type: ignore


@router.delete("/{task_id}")
def delete_task(
    task_id: str,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    job_store: JobStore = Depends(get_job_store),
    source_draft_store: ProblemSourceDraftStore = Depends(get_problem_source_draft_store),
):
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    if t.grading_job_id:
        job_store.discard(t.grading_job_id)
    for job_id in {
        t.extract_job_id,
        t.parse_job_id,
        t.grading_job_id,
        t.reference_parse_job_id,
        t.test_cases_parse_job_id,
        t.last_failed_job_id,
    }:
        if job_id:
            remove_reporter(job_id)
    from backend.api.analytics import clear_task_analytics_cache
    clear_task_analytics_cache(task_id)
    # Drop any in-memory KB index attached to this task. Safe even if the
    # active retriever is the NoOp default — remove_task is a no-op there.
    retriever = get_retriever()
    if isinstance(retriever, InMemoryTaskRetriever):
        retriever.remove_task(task_id)
    source_draft_store.delete_for_task(task_id)
    task_store.delete(task_id)
    return {"status": "success"}


# ─── Q-01 problem source preflight (local, no LLM spend) ────────────────────

@router.get("/{task_id}/problem-sources/library")
def list_problem_source_library(
    task_id: str,
    scope: Literal["course", "all"] = Query(default="course"),
    q: str = Query(default="", max_length=200),
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    material_store: CourseMaterialStore = Depends(get_course_material_store),
):
    task = _get_or_404(task_store, task_id)
    _check_owner(task, current)
    if task.course_id is not None:
        _validate_course_id(task.course_id, task.owner_id)
    materials = material_store.list_for_owner(
        task.owner_id,
        course_id=task.course_id,
        restrict_course=scope == "course",
        query=q,
    )
    return {
        "items": [material.public() for material in materials],
        "total": len(materials),
        "scope": scope,
        "course_id": task.course_id if scope == "course" else None,
        "storage": "memory",
    }


@router.post("/{task_id}/problem-sources/preflight")
async def preflight_problem_source(
    task_id: str,
    file: Optional[UploadFile] = File(default=None),
    library_material_id: Optional[str] = Form(default=None),
    structure_mode: Literal["organized", "extract_from_source"] = Form(default="organized"),
    extraction_hint: str = Form(default=""),
    save_to_library: bool = Form(default=False),
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    material_store: CourseMaterialStore = Depends(get_course_material_store),
    source_draft_store: ProblemSourceDraftStore = Depends(get_problem_source_draft_store),
):
    """Validate a source and detect explicit question headings without an LLM."""

    task = _get_or_404(task_store, task_id)
    _check_owner(task, current)
    base_workflow_revision = task.workflow_revision
    material_id = (library_material_id or "").strip() or None
    if (file is None) == (material_id is None):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide exactly one of file or library_material_id.",
        )
    hint = extraction_hint.strip()
    if len(hint) > 2000:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="extraction_hint cannot exceed 2000 characters.",
        )
    saved_material: Optional[CourseMaterial] = None
    saved_material_created = False
    if file is not None:
        filename, content_type, raw_bytes, text, content_sha256 = await _read_problem_source_upload(file)
        source_kind: Literal["upload", "library"] = "upload"
        if save_to_library:
            if task.course_id is not None:
                _validate_course_id(task.course_id, task.owner_id)
            proposed = CourseMaterial(
                material_id=f"material_{uuid.uuid4().hex[:12]}",
                owner_id=task.owner_id,
                course_id=task.course_id,
                filename=filename,
                content_type=content_type,
                size_bytes=len(raw_bytes),
                sha256=content_sha256,
                text=text,
                resident_bytes=len(text.encode("utf-8")),
            )
            try:
                saved_material, saved_material_created = material_store.create_or_get(proposed)
            except ResourceQuotaError as exc:
                raise HTTPException(
                    exc.status_code,
                    detail={"code": exc.code},
                ) from exc
            material_id = saved_material.material_id
    else:
        material = material_store.get_for_owner(material_id or "", task.owner_id)
        if material is None:
            # Non-disclosure: another owner's material has the same response.
            raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Course material not found")
        if material.course_id is not None:
            _validate_course_id(material.course_id, task.owner_id)
        filename = material.filename
        content_type = material.content_type
        source_size_bytes = material.size_bytes
        text = material.text
        content_sha256 = material.sha256
        source_kind = "library"

    if file is not None:
        source_size_bytes = len(raw_bytes)

    candidates, not_found = _detect_problem_source_candidates(
        text,
        structure_mode=structure_mode,
        extraction_hint=hint,
    )
    requires_confirmation = structure_mode == "extract_from_source"
    now = time.time()
    library_backed = material_id is not None
    draft_text = None if library_backed else text
    draft_resident_bytes = (
        len(draft_text.encode("utf-8")) if draft_text is not None else 0
    ) + len(hint.encode("utf-8")) + len(
        json.dumps(candidates, ensure_ascii=False).encode("utf-8")
    )
    proposed_draft = ProblemSourceDraft(
        source_token=f"ps_{uuid.uuid4().hex}",
        task_id=task.task_id,
        owner_id=task.owner_id,
        source_kind=source_kind,
        structure_mode=structure_mode,
        extraction_hint=hint,
        filename=filename,
        content_type=content_type,
        size_bytes=source_size_bytes,
        content_sha256=content_sha256,
        text=draft_text,
        library_material_id=material_id,
        base_workflow_revision=base_workflow_revision,
        resident_bytes=draft_resident_bytes,
        candidates=candidates,
        not_found=not_found,
        requires_confirmation=requires_confirmation,
        created_at=now,
        expires_at=now + _PROBLEM_SOURCE_DRAFT_TTL_SECONDS,
    )
    try:
        draft = source_draft_store.create(proposed_draft)
    except ResourceQuotaError as exc:
        if saved_material_created and saved_material is not None:
            material_store.delete_for_owner(saved_material.material_id, task.owner_id)
        raise HTTPException(
            exc.status_code,
            detail={"code": exc.code},
        ) from exc
    matched = [item for item in candidates if item["match_kind"] == "matched"]
    possible = [item for item in candidates if item["match_kind"] == "possible_match"]
    response: Dict[str, Any] = {
        "status": "ready",
        "source_token": draft.source_token,
        "source": {
            "kind": source_kind,
            "filename": filename,
            "size_bytes": source_size_bytes,
            "sha256": content_sha256,
            "library_material_id": draft.library_material_id,
        },
        "structure_mode": structure_mode,
        "requires_confirmation": requires_confirmation,
        "candidate_summary": {
            "matched": matched,
            "possible_matches": possible,
            "not_found": not_found,
            "matching_method": "local_explicit_heading_detection",
            "semantic_match_performed": False,
            "notice": "Preflight only detects explicit local headings. When supplied, the extraction hint is applied by the configured model during formal recognition.",
        },
        "expires_at": draft.expires_at,
        "base_workflow_revision": draft.base_workflow_revision,
        "workflow_revision": task.workflow_revision,
        "storage": "memory",
    }
    if saved_material is not None:
        response["saved_material"] = {
            **saved_material.public(),
            "created": saved_material_created,
        }
    return response


# ─── Extract problems (with idempotency) ─────────────────────────────────────

async def _run_extract(
    task_id: str,
    text: str,
    provider,
    job_id: str,
    task_store: TaskStore,
    job_store: JobStore,
    *,
    structure_mode: Literal["organized", "extract_from_source"],
    extraction_hint: str,
    confirmed_candidates: List[Dict[str, Any]],
    confirmed_candidate_ids: List[str],
    library_material_id: Optional[str],
    superseded_job_ids: List[str],
):
    reporter = get_or_create_reporter(job_id)
    new_problem_data: Dict[str, Dict[str, Any]] = {}
    try:
        await extract_problems(
            text,
            provider,
            new_problem_data,
            reporter=reporter,
            structure_mode=structure_mode,
            extraction_hint=extraction_hint,
            confirmed_candidates=confirmed_candidates,
        )
        committed, old_grading_job_id = task_store.commit_problem_extraction(
            task_id,
            job_id=job_id,
            problem_data=new_problem_data,
            structure_mode=structure_mode,
            extraction_hint=extraction_hint,
            confirmed_candidates=confirmed_candidate_ids,
            library_material_id=library_material_id,
        )
        if committed is None:
            logger.warning(f"[task:{task_id}] ignored stale extract worker {job_id}")
            return
        if old_grading_job_id:
            job_store.discard(old_grading_job_id)
        for superseded_job_id in superseded_job_ids:
            remove_reporter(superseded_job_id)
        from backend.api.analytics import clear_task_analytics_cache
        clear_task_analytics_cache(task_id)
        logger.info(f"[task:{task_id}] extract done, {len(new_problem_data)} problems")
    except Exception as exc:
        logger.error(
            "[task:%s] problem extraction failed; exception_type=%s",
            task_id,
            type(exc).__name__,
        )
        await reporter.set_error(
            "Problem recognition failed. Check the model configuration and retry."
        )
        task_store.fail_problem_extraction(
            task_id,
            job_id=job_id,
            error="problem_extraction_failed",
        )


@router.post("/{task_id}/extract_problems")
async def task_extract_problems(
    task_id: str,
    file: Optional[UploadFile] = File(default=None),
    source_token: Optional[str] = Form(default=None),
    confirmed_candidate_ids: Optional[str] = Form(default=None),
    replace_confirmed: bool = Form(default=False),
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    job_store: JobStore = Depends(get_job_store),
    material_store: CourseMaterialStore = Depends(get_course_material_store),
    source_draft_store: ProblemSourceDraftStore = Depends(get_problem_source_draft_store),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    _require_task_llm_principal(t, current)
    superseded_job_ids = [
        prior_job_id for prior_job_id in {
            t.extract_job_id,
            t.parse_job_id,
            t.grading_job_id,
            t.reference_parse_job_id,
            t.test_cases_parse_job_id,
            t.last_failed_job_id,
        }
        if prior_job_id
    ]
    direct_base_workflow_revision = t.workflow_revision
    normalized_token = (source_token or "").strip() or None
    if (file is None) == (normalized_token is None):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Provide exactly one of file or source_token.",
        )
    if normalized_token is not None:
        draft = source_draft_store.get_for_owner_task(
            normalized_token,
            owner_id=t.owner_id,
            task_id=t.task_id,
        )
        if draft is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                detail="Problem source token not found or expired.",
            )
        confirmed_candidate_ids_list, selected_candidates = _parse_confirmed_candidate_ids(
            confirmed_candidate_ids,
            draft,
        )
        filename = draft.filename
        content_sha256 = draft.content_sha256
        expected_workflow_revision = draft.base_workflow_revision
        if draft.library_material_id is not None:
            material = material_store.get_for_owner(
                draft.library_material_id,
                t.owner_id,
            )
            if material is None or material.sha256 != draft.content_sha256:
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    detail={"code": "problem_source_material_changed"},
                )
            text = material.text
        else:
            text = draft.text
        if text is None:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                detail={"code": "problem_source_text_unavailable"},
            )
        structure_mode = draft.structure_mode
        extraction_hint = draft.extraction_hint
        library_material_id = draft.library_material_id
    else:
        assert file is not None
        filename, _content_type, _raw_bytes, text, content_sha256 = await _read_problem_source_upload(file)
        expected_workflow_revision = direct_base_workflow_revision
        structure_mode = "organized"
        extraction_hint = ""
        selected_candidates, _ = _detect_problem_source_candidates(
            text,
            structure_mode="organized",
            extraction_hint="",
        )
        confirmed_candidate_ids_list = [item["candidate_id"] for item in selected_candidates]
        library_material_id = None

    fingerprint = _problem_source_fingerprint(
        content_sha256=content_sha256,
        structure_mode=structure_mode,
        extraction_hint=extraction_hint,
        confirmed_candidate_ids=confirmed_candidate_ids_list,
    )

    legacy_same_completed_request = (
        t.problem_request_fingerprint is None
        and structure_mode == "organized"
        and not extraction_hint
        and t.problem_file_hash == content_sha256
    )
    inspected_outcome, inspected_task = task_store.inspect_problem_extraction(
        task_id,
        expected_revision=expected_workflow_revision,
        request_fingerprint=fingerprint,
        legacy_same_completed_request=legacy_same_completed_request,
        replace_confirmed=replace_confirmed,
    )
    inspected_response = _problem_extraction_gate_response(
        inspected_outcome,
        inspected_task,
        expected_workflow_revision=expected_workflow_revision,
    )
    if inspected_response is not None:
        return inspected_response

    provider = registry.for_owner(current.id).pick_default()
    if provider is None:
        raise HTTPException(503, detail="No LLM provider configured. Add an API key first.")

    job_id = str(uuid.uuid4())
    outcome, current_task = task_store.begin_problem_extraction(
        task_id,
        expected_revision=expected_workflow_revision,
        job_id=job_id,
        request_fingerprint=fingerprint,
        content_sha256=content_sha256,
        filename=filename,
        legacy_same_completed_request=legacy_same_completed_request,
        replace_confirmed=replace_confirmed,
    )
    existing_response = _problem_extraction_gate_response(
        outcome,
        current_task,
        expected_workflow_revision=expected_workflow_revision,
    )
    if existing_response is not None:
        return existing_response
    assert current_task is not None
    asyncio.create_task(_run_extract(
        task_id,
        text,
        provider,
        job_id,
        task_store,
        job_store,
        structure_mode=structure_mode,
        extraction_hint=extraction_hint,
        confirmed_candidates=selected_candidates,
        confirmed_candidate_ids=confirmed_candidate_ids_list,
        library_material_id=library_material_id,
        superseded_job_ids=superseded_job_ids,
    ))
    return {
        "status": "started",
        "job_id": job_id,
        "task_id": t.task_id,
        "request_fingerprint": fingerprint,
        "workflow_revision": current_task.workflow_revision,
        "replace_confirmed": replace_confirmed,
    }


# ─── Parse submissions (with idempotency) ────────────────────────────────────

async def _run_parse(
    task_id: str,
    problems_data: Dict[str, Dict[str, Any]],
    files_data,
    provider,
    job_id: str,
    task_store: TaskStore,
    job_store: JobStore,
):
    reporter = get_or_create_reporter(job_id, total_students=len(files_data))
    new_student_data: Dict[str, Dict[str, Any]] = {}
    try:
        await parse_student_answers(
            files_data=files_data,
            problems_data=problems_data,
            student_store=new_student_data,
            provider=provider,
            reporter=reporter,
        )
        committed, old_grading_job_id = task_store.commit_submission_parse(
            task_id,
            job_id=job_id,
            student_data=new_student_data,
        )
        if committed is None:
            logger.warning("[task:%s] ignored stale submission parser", task_id)
            return
        if old_grading_job_id:
            job_store.discard(old_grading_job_id)
        logger.info(
            "[task:%s] submission parse done, %s students",
            task_id,
            len(new_student_data),
        )
    except Exception as exc:
        logger.error(
            "[task:%s] submission parse failed; exception_type=%s",
            task_id,
            type(exc).__name__,
        )
        await reporter.set_error("Submission recognition failed. Please retry.")
        task_store.fail_submission_parse(
            task_id,
            job_id=job_id,
            error="submission_parse_failed",
        )


@router.post("/{task_id}/parse_submissions")
async def task_parse_submissions(
    task_id: str,
    file: UploadFile = File(...),
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    job_store: JobStore = Depends(get_job_store),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    _require_task_llm_principal(t, current)
    base_workflow_revision = t.workflow_revision
    problems_snapshot = {
        q_id: dict(problem) for q_id, problem in t.problem_data.items()
    }

    provider = registry.for_owner(current.id).pick_default()
    if provider is None:
        raise HTTPException(503, detail="No LLM provider configured.")

    bytes_ = await file.read()
    new_hash = hashlib.sha256(bytes_).hexdigest()

    try:
        files_data = await extract_files_from_archive(bytes_, file.filename or "submissions")
    except Exception as exc:
        logger.warning(
            "[task:%s] submission archive rejected; exception_type=%s",
            task_id,
            type(exc).__name__,
        )
        raise HTTPException(
            400,
            detail={"code": "submission_archive_invalid"},
        ) from exc

    if not files_data:
        raise HTTPException(400, detail="No valid student files found in archive.")

    job_id = str(uuid.uuid4())
    outcome, current_task = task_store.begin_submission_parse(
        task_id,
        expected_revision=base_workflow_revision,
        job_id=job_id,
        content_sha256=new_hash,
        filename=file.filename or "submissions",
    )
    if current_task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Task not found")
    if outcome == "already_running":
        return {
            "status": "already_running",
            "job_id": current_task.parse_job_id,
            "task_id": current_task.task_id,
            "workflow_revision": current_task.workflow_revision,
        }
    if outcome == "already_done":
        return {
            "status": "already_done",
            "unchanged": True,
            "job_id": current_task.parse_job_id,
            "task_id": current_task.task_id,
            "student_count": len(current_task.student_data),
            "workflow_revision": current_task.workflow_revision,
        }
    if outcome != "started":
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={
                "code": outcome,
                "workflow_revision": current_task.workflow_revision,
            },
        )
    asyncio.create_task(_run_parse(
        task_id,
        problems_snapshot,
        files_data,
        provider,
        job_id,
        task_store,
        job_store,
    ))
    return {
        "status": "started",
        "job_id": job_id,
        "task_id": t.task_id,
        "file_count": len(files_data),
        "workflow_revision": current_task.workflow_revision,
    }


# ─── Reference answers (auxiliary upload — calculation-style problems) ──────
#
# This is an *auxiliary* upload that does NOT advance task.status. A teacher
# can upload (or re-upload, with a different file) at any point — draft,
# problems_ready, submissions_ready, graded — and the parsed answers are
# merged into problem_data[q_id]["reference_answer"]. CalculationSkill picks
# them up on the next grade pass; already-graded tasks must be re-graded
# manually (we do NOT auto-rerun LLM calls when a reference is added).

async def _read_text_for_parse(file: UploadFile, bytes_: bytes) -> str:
    """Decode a PDF / MD / TXT upload into plain text.

    Shared by reference + test-case parsing. Mirrors the logic in
    task_extract_problems so behavior stays consistent across upload paths.
    """
    if file.content_type == "application/pdf" or (file.filename or "").lower().endswith(".pdf"):
        return await extract_text_from_pdf(bytes_)
    return await decode_text_bytes(bytes_)


async def _run_parse_reference(
    task: Task,
    text: str,
    provider,
    job_id: str,
    task_store: TaskStore,
):
    """Background worker for /tasks/{id}/upload_reference.

    Calls the LLM helper, merges results into per-question reference_answer
    fields, then clears reference_parse_job_id so the frontend knows the
    auxiliary parse is done.
    """
    reporter = get_or_create_reporter(job_id)
    try:
        mapping = await parse_reference_to_per_question(
            text=text,
            problems_data=task.problem_data,
            provider=provider,
            reporter=reporter,
        )
        # Merge into problem_data — preserve existing fields.
        for q_id, ref_text in mapping.items():
            if q_id in task.problem_data:
                task.problem_data[q_id]["reference_answer"] = ref_text
        task_store.finish_auxiliary_parse(
            task.task_id,
            kind="reference",
            job_id=job_id,
        )
        logger.info(
            f"[task:{task.task_id}] reference parse done, matched "
            f"{len(mapping)}/{len(task.problem_data)} problems"
        )
    except Exception as exc:
        logger.error(
            "[task:%s] reference parse failed; exception_type=%s",
            task.task_id,
            type(exc).__name__,
        )
        task_store.finish_auxiliary_parse(
            task.task_id,
            kind="reference",
            job_id=job_id,
            error="reference_parse_failed",
        )


@router.post("/{task_id}/upload_reference")
async def task_upload_reference(
    task_id: str,
    file: UploadFile = File(...),
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    """Upload a reference-answer document (PDF / MD / TXT).

    Teachers can either upload a dedicated solution file, OR re-upload the
    same file as the problems (which triggers the LLM to extract solution
    text from a doc that contains both questions and answers).

    Idempotency: same sha256 → already_done. Concurrent re-upload while parsing
    → already_running.

    The endpoint does NOT change ``task.status`` — reference answers are an
    auxiliary annotation that can be added in any state including ``graded``
    (re-grading is manual).
    """
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    base_workflow_revision = t.workflow_revision
    _require_task_llm_principal(t, current)

    # Need problems to anchor q_ids — uploading reference for a draft (no
    # problems yet) doesn't make sense.
    if t.status == "draft" or not t.problem_data:
        raise HTTPException(
            409, detail="Upload problems first — reference answers are matched per problem."
        )

    bytes_ = await file.read()
    new_hash = hashlib.sha256(bytes_).hexdigest()

    provider = registry.for_owner(current.id).pick_default()
    if provider is None:
        raise HTTPException(503, detail="No LLM provider configured. Add an API key first.")

    try:
        text = await _read_text_for_parse(file, bytes_)
    except Exception as exc:
        logger.warning(
            "[task:%s] reference file rejected; exception_type=%s",
            task_id,
            type(exc).__name__,
        )
        raise HTTPException(
            400,
            detail={"code": "reference_file_invalid"},
        ) from exc

    job_id = str(uuid.uuid4())
    outcome, current_task = task_store.begin_auxiliary_parse(
        task_id,
        kind="reference",
        expected_revision=base_workflow_revision,
        job_id=job_id,
        content_sha256=new_hash,
        filename=file.filename or "reference",
    )
    if current_task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Task not found")
    if outcome == "already_running":
        return {
            "status": "already_running",
            "job_id": current_task.reference_parse_job_id,
            "task_id": current_task.task_id,
        }
    if outcome == "already_done":
        return {
            "status": "already_done",
            "unchanged": True,
            "task_id": current_task.task_id,
            "reference_file_name": current_task.reference_file_name,
        }
    if outcome != "started":
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": outcome})
    asyncio.create_task(_run_parse_reference(t, text, provider, job_id, task_store))
    return {
        "status": "started",
        "job_id": job_id,
        "task_id": t.task_id,
    }


# ─── Test cases (auxiliary upload — programming problems) ──────────────────

async def _run_parse_test_cases(
    task: Task,
    text: str,
    provider,
    job_id: str,
    task_store: TaskStore,
):
    """Background worker for /tasks/{id}/upload_test_cases.

    Mirrors _run_parse_reference. Stores TestCase objects as model_dump()ed
    dicts so JSON round-tripping (via Task.lite() etc.) stays clean.
    """
    reporter = get_or_create_reporter(job_id)
    try:
        mapping = await parse_test_cases_to_per_question(
            text=text,
            problems_data=task.problem_data,
            provider=provider,
            reporter=reporter,
        )
        for q_id, cases in mapping.items():
            if q_id in task.problem_data:
                # Store as list[dict] for JSON serialization compatibility.
                task.problem_data[q_id]["test_cases"] = [tc.model_dump() for tc in cases]
        total = sum(len(v) for v in mapping.values())
        task_store.finish_auxiliary_parse(
            task.task_id,
            kind="test_cases",
            job_id=job_id,
        )
        logger.info(
            f"[task:{task.task_id}] test-case parse done, "
            f"{len(mapping)} programming problems, {total} cases total"
        )
    except Exception as exc:
        logger.error(
            "[task:%s] test-case parse failed; exception_type=%s",
            task.task_id,
            type(exc).__name__,
        )
        task_store.finish_auxiliary_parse(
            task.task_id,
            kind="test_cases",
            job_id=job_id,
            error="test_cases_parse_failed",
        )


@router.post("/{task_id}/upload_test_cases")
async def task_upload_test_cases(
    task_id: str,
    file: UploadFile = File(...),
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    """Upload a test-case document (any format — JSON / Markdown / natural language).

    The LLM normalizes whatever shape into structured stdin/stdout cases keyed
    by q_id. Only programming problems are populated; non-programming
    problems are silently skipped.

    Same idempotency contract as upload_reference (sha256 + parse_job_id).
    Same constraint: does NOT change task.status.
    """
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    _require_task_llm_principal(t, current)
    base_workflow_revision = t.workflow_revision

    if t.status == "draft" or not t.problem_data:
        raise HTTPException(
            409, detail="Upload problems first — test cases are matched per problem."
        )

    bytes_ = await file.read()
    new_hash = hashlib.sha256(bytes_).hexdigest()

    provider = registry.for_owner(current.id).pick_default()
    if provider is None:
        raise HTTPException(503, detail="No LLM provider configured. Add an API key first.")

    try:
        text = await _read_text_for_parse(file, bytes_)
    except Exception as exc:
        logger.warning(
            "[task:%s] test-case file rejected; exception_type=%s",
            task_id,
            type(exc).__name__,
        )
        raise HTTPException(
            400,
            detail={"code": "test_case_file_invalid"},
        ) from exc

    job_id = str(uuid.uuid4())
    outcome, current_task = task_store.begin_auxiliary_parse(
        task_id,
        kind="test_cases",
        expected_revision=base_workflow_revision,
        job_id=job_id,
        content_sha256=new_hash,
        filename=file.filename or "test_cases",
    )
    if current_task is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Task not found")
    if outcome == "already_running":
        return {
            "status": "already_running",
            "job_id": current_task.test_cases_parse_job_id,
            "task_id": current_task.task_id,
        }
    if outcome == "already_done":
        return {
            "status": "already_done",
            "unchanged": True,
            "task_id": current_task.task_id,
            "test_cases_file_name": current_task.test_cases_file_name,
        }
    if outcome != "started":
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": outcome})
    asyncio.create_task(_run_parse_test_cases(t, text, provider, job_id, task_store))
    return {
        "status": "started",
        "job_id": job_id,
        "task_id": t.task_id,
    }


# ─── Grade ───────────────────────────────────────────────────────────────────

async def _run_grade(
    task: Task,
    registry: ExpertRegistryView,
    job_id: str,
    task_store: TaskStore,
    job_store: JobStore,
    language: str,
    multi_sample_n: Optional[int] = None,
):
    reporter = get_or_create_reporter(
        job_id,
        total_students=len(task.student_data),
        total_questions=len(task.problem_data),
    )
    try:
        results = await grade_batch(
            student_store=task.student_data,
            problem_store=task.problem_data,
            registry=registry,
            reporter=reporter,
            language=language,
            task_id=task.task_id,
            multi_sample_n=multi_sample_n,
        )
        # Serialize corrections
        serialized = []
        for r in results:
            corrections_ser = []
            for c in r.get("corrections", []):
                corrections_ser.append(c.model_dump() if hasattr(c, "model_dump") else c)
            serialized.append({
                "student_id": r.get("student_id"),
                "student_name": r.get("student_name"),
                "corrections": corrections_ser,
                "student_answers": r.get("student_answers", []),
            })

        # Complete the pending JobStore row created before begin_grading.  If
        # the task was deleted meanwhile, delete_task has already discarded it
        # and this becomes a no-op rather than resurrecting student data.
        job_store.complete(job_id, {
            "results": serialized,
            "task_id": task.task_id,
            "problem_data": task.problem_data,
            "student_data": task.student_data,
            "timestamp": time.time(),
        })

        # ── Pre-bake per-question common-mistakes (D1) ─────────────────────
        # Run sequentially (the user explicitly chose serial over parallel
        # to avoid LLM rework). The deep-dive page is uncached without this.
        # Failures per-question are non-fatal; we log + continue so a single
        # bad LLM call doesn't block the "graded" transition.
        common_mistakes_by_question: Dict[str, str] = {}
        try:
            from backend.agents import analytics_agent
            provider_for_cm = registry.pick_default()
            results_payload = {"results": serialized}
            await reporter._emit_message("正在分析全班易错点…", "info")
            for q_id in task.problem_data.keys():
                try:
                    breakdown = analytics_agent.per_question_breakdown(
                        q_id, results_payload, task.problem_data,
                    )
                    if breakdown.get("rows") and provider_for_cm is not None:
                        out = await analytics_agent.question_common_mistakes(
                            q_id=q_id,
                            breakdown=breakdown,
                            provider=provider_for_cm,
                        )
                        common_mistakes_by_question[q_id] = out.common_mistakes_md
                        await reporter._emit_message(f"易错点完成：{q_id}", "info")
                except Exception as cm_err:
                    logger.warning(
                        "[task:%s] common_mistakes for q_id=%s failed; exception_type=%s",
                        task.task_id,
                        q_id,
                        type(cm_err).__name__,
                    )
        except Exception as exc:
            logger.warning(
                "[task:%s] common_mistakes pre-bake failed; exception_type=%s",
                task.task_id,
                type(exc).__name__,
            )

        # Only NOW mark the task as graded — the user's complaint was that
        # "graded" fired before the deep-dive analytics were ready.
        committed_task = task_store.finish_grading(task.task_id, job_id=job_id)
        if committed_task is not None:
            from backend.api.analytics import cache_task_common_mistakes
            for q_id, markdown in common_mistakes_by_question.items():
                cache_task_common_mistakes(
                    task_id=task.task_id,
                    q_id=q_id,
                    grading_job_id=job_id,
                    markdown=markdown,
                )
            logger.info(
                "[task:%s] grading done, %s students",
                task.task_id,
                len(serialized),
            )

    except Exception as exc:
        logger.error(
            "[task:%s] grading failed; exception_type=%s",
            task.task_id,
            type(exc).__name__,
        )
        task_store.finish_grading(
            task.task_id,
            job_id=job_id,
            error="grading_failed",
        )
        job_store.fail(job_id, "grading_failed")


@router.post("/{task_id}/grade")
async def task_grade(
    task_id: str,
    req: GradeRequest = GradeRequest(),
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    job_store: JobStore = Depends(get_job_store),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    _require_task_llm_principal(t, current)
    base_workflow_revision = t.workflow_revision

    # Fast UX gate; begin_grading repeats these checks atomically.
    if t.status == "grading" and t.grading_job_id:
        return {
            "status": "already_running",
            "job_id": t.grading_job_id,
            "task_id": t.task_id,
        }
    if t.status == "graded" and t.grading_job_id:
        return {
            "status": "already_done",
            "job_id": t.grading_job_id,
            "task_id": t.task_id,
        }
    if t.status not in {"submissions_ready", "graded", "error"}:
        raise HTTPException(409, detail={"code": "invalid_state"})
    if not t.problem_data or not t.student_data:
        raise HTTPException(409, detail={"code": "invalid_state"})

    owner_registry = registry.for_owner(current.id)
    if owner_registry.count() == 0:
        raise HTTPException(503, detail="No LLM provider configured.")
    effective_multi_sample_n = (
        1 if owner_registry.uses_shared_pool() else req.multi_sample_n
    )

    if job_store.active_count() >= 10:
        raise HTTPException(429, detail="Too many concurrent jobs. Try again later.")

    job_id = str(uuid.uuid4())
    job_store.create(GradingJob(
        job_id=job_id,
        job_name=t.name,
        job_type="batch",
    ))
    outcome, current_task = task_store.begin_grading(
        task_id,
        expected_revision=base_workflow_revision,
        job_id=job_id,
    )
    if current_task is None:
        job_store.discard(job_id)
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="Task not found")
    if outcome == "already_running":
        job_store.discard(job_id)
        return {
            "status": "already_running",
            "job_id": current_task.grading_job_id,
            "task_id": current_task.task_id,
        }
    if outcome == "already_done":
        job_store.discard(job_id)
        return {
            "status": "already_done",
            "job_id": current_task.grading_job_id,
            "task_id": current_task.task_id,
        }
    if outcome != "started":
        job_store.discard(job_id)
        raise HTTPException(status.HTTP_409_CONFLICT, detail={"code": outcome})
    asyncio.create_task(_run_grade(
        t, owner_registry, job_id, task_store, job_store, req.language,
        multi_sample_n=effective_multi_sample_n,
    ))

    return {
        "status": "started",
        "job_id": job_id,
        "task_id": t.task_id,
    }


# ─── State / Result ──────────────────────────────────────────────────────────

@router.get("/{task_id}/state")
async def task_state(
    task_id: str,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
):
    """
    Unified snapshot: task metadata + active reporter progress.
    Frontend polls this single endpoint to drive the entire UI state.
    """
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)

    out = t.lite()

    # Pick the active job's reporter, if any
    active_job_id: Optional[str] = None
    if t.status == "extracting_problems":
        active_job_id = t.extract_job_id
    elif t.status == "parsing_submissions":
        active_job_id = t.parse_job_id
    elif t.status == "grading":
        active_job_id = t.grading_job_id
    elif t.status == "error":
        # Failed reporters remain available so the error screen can explain
        # the last attempt without exposing the underlying provider exception.
        active_job_id = t.last_failed_job_id

    progress = None
    if active_job_id:
        reporter = get_reporter(active_job_id)
        if reporter is not None:
            snap = await reporter.snapshot()
            progress = snap.model_dump()

    out["progress"] = progress
    out["active_job_id"] = active_job_id
    return out


@router.get("/{task_id}/result")
def task_result(
    task_id: str,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    job_store: JobStore = Depends(get_job_store),
):
    """Return the grading result if available, else status info."""
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)

    if t.status != "graded" or not t.grading_job_id:
        return {"status": t.status, "task_id": t.task_id, "error": t.error}

    job = job_store.get(t.grading_job_id)
    if job is None or job.results is None:
        return {"status": "not_found", "task_id": t.task_id}
    return {"status": "completed", "task_id": t.task_id, **(job.results or {})}


# ─── Edit problem (manual stem / rubric refinement) ──────────────────────────

@router.put("/{task_id}/problems/{q_id}")
def update_problem(
    task_id: str,
    q_id: str,
    req: UpdateProblemRequest,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
):
    """Update a single problem's stem, criterion, and/or review status.

    Allowed in any post-extract status (problems_ready through graded). The
    new text is stored verbatim — math delimiters / markdown are preserved
    so the teacher can re-read their edits without re-conversion.

    Returns the updated problem dict.
    """
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    base_workflow_revision = t.workflow_revision

    if _task_workflow_is_busy(t):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "task_workflow_busy"},
        )
    if t.status in ("draft", "extracting_problems"):
        raise HTTPException(409, detail="Problems not extracted yet")

    if q_id not in t.problem_data:
        raise HTTPException(404, detail=f"Problem {q_id} not found")

    # Patch in-place; updates Task.updated_at via TaskStore
    new_problem = dict(t.problem_data[q_id])
    content_edited = (
        ("stem" in req.model_fields_set and req.stem is not None)
        or ("criterion" in req.model_fields_set and req.criterion is not None)
        or "reference_answer" in req.model_fields_set
        or "test_cases" in req.model_fields_set
    )
    if req.stem is not None:
        new_problem["stem"] = req.stem
    if req.criterion is not None:
        new_problem["criterion"] = req.criterion
    if "reference_answer" in req.model_fields_set:
        new_problem["reference_answer"] = req.reference_answer
    if "test_cases" in req.model_fields_set:
        new_problem["test_cases"] = (
            [case.model_dump() for case in req.test_cases]
            if req.test_cases is not None
            else None
        )
    if req.review_status == "confirmed":
        new_problem["review_status"] = "confirmed"
    elif content_edited:
        # Recognition content changed manually, so it is no longer untouched
        # even when a caller also asks to move it back to needs_review. Only an
        # explicit confirmation may confirm a content edit in the same CAS.
        new_problem["review_status"] = "edited"
    elif req.review_status is not None:
        new_problem["review_status"] = req.review_status

    new_problems = dict(t.problem_data)
    new_problems[q_id] = new_problem
    committed_task = task_store.update_workflow_cas(
        task_id,
        expected_revision=base_workflow_revision,
        problem_data=new_problems,
    )
    if committed_task is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "task_workflow_changed"},
        )
    logger.info(f"[task:{task_id}] problem {q_id} edited by {current.id}")

    return {"status": "ok", "q_id": q_id, "problem": new_problem}


# ─── Edit student answer (manual OCR/segmentation correction) ────────────────

@router.put("/{task_id}/students/{stu_id}/answers/{q_id}")
def update_student_answer(
    task_id: str,
    stu_id: str,
    q_id: str,
    req: UpdateStudentAnswerRequest,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
):
    """Patch a single (student, question) parsed answer.

    Allowed once submissions are parsed (status `submissions_ready` or any
    later status — it's safe to fix recognition errors even after grading,
    though the existing grade will not auto-rerun).

    Returns the patched answer dict.
    """
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    base_workflow_revision = t.workflow_revision

    if _task_workflow_is_busy(t):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "task_workflow_busy"},
        )
    if t.status in ("draft", "extracting_problems", "problems_ready", "parsing_submissions"):
        raise HTTPException(409, detail="Submissions not parsed yet")

    student = t.student_data.get(stu_id)
    if student is None:
        raise HTTPException(404, detail=f"Student {stu_id} not found")

    answers = student.get("stu_ans") if isinstance(student, dict) else None
    if not isinstance(answers, list):
        raise HTTPException(500, detail="Malformed student data")

    # Locate the matching answer
    target_idx = None
    for i, a in enumerate(answers):
        if isinstance(a, dict) and a.get("q_id") == q_id:
            target_idx = i
            break
    if target_idx is None:
        raise HTTPException(404, detail=f"No answer for q_id={q_id} on student {stu_id}")

    # Patch — copy-on-write so TaskStore's update detects the change
    new_answer = dict(answers[target_idx])
    if req.content is not None:
        new_answer["content"] = req.content
    if req.flag is not None:
        new_answer["flag"] = list(req.flag)

    new_answers = list(answers)
    new_answers[target_idx] = new_answer

    new_student = dict(student)
    new_student["stu_ans"] = new_answers

    new_student_data = dict(t.student_data)
    new_student_data[stu_id] = new_student
    committed_task = task_store.update_workflow_cas(
        task_id,
        expected_revision=base_workflow_revision,
        student_data=new_student_data,
    )
    if committed_task is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "task_workflow_changed"},
        )
    logger.info(f"[task:{task_id}] student {stu_id} answer for {q_id} edited by {current.id}")

    return {"status": "ok", "stu_id": stu_id, "q_id": q_id, "answer": new_answer}


# ─── Teacher comments (manual annotation on AI corrections) ──────────────────

@router.post("/{task_id}/teacher_comment")
def set_teacher_comment(
    task_id: str,
    req: UpdateTeacherCommentRequest,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    job_store: JobStore = Depends(get_job_store),
):
    """Set / update / clear a teacher's manual comment on a graded answer.

    The comment is stored on the matching `Correction` entry in the grading
    job's results dict (mirrored into JobStore on grading completion). It
    coexists with — never replaces — the AI's `comment` field.

    Empty string clears the comment.
    """
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)

    if t.status != "graded" or not t.grading_job_id:
        raise HTTPException(409, detail=f"Task not graded yet (status={t.status})")

    job = job_store.get(t.grading_job_id)
    if job is None or job.results is None:
        raise HTTPException(404, detail="Grading result not found")

    results = job.results or {}
    students = results.get("results", []) or []
    if not isinstance(students, list):
        raise HTTPException(500, detail="Malformed results payload")

    target_student = None
    for s in students:
        if str(s.get("student_id", "")) == req.student_id:
            target_student = s
            break
    if target_student is None:
        raise HTTPException(404, detail=f"Student {req.student_id} not found in results")

    target_correction = None
    for c in target_student.get("corrections", []) or []:
        if str(c.get("q_id", "")) == req.q_id:
            target_correction = c
            break
    if target_correction is None:
        raise HTTPException(404, detail=f"No correction for q_id={req.q_id} on student {req.student_id}")

    # Advance the workflow revision before mutating the mirrored JobStore
    # payload. This invalidates any older replacement preflight token so a
    # concurrent Q-01 replace cannot silently discard a newly added comment.
    committed_task = task_store.update_workflow_cas(
        task_id,
        expected_revision=t.workflow_revision,
    )
    if committed_task is None:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "task_workflow_changed"},
        )

    # Mutate in place — JobStore keeps a reference to the dict, so this persists
    # for the lifetime of the in-memory job.
    target_correction["teacher_comment"] = (req.comment or "").strip()
    logger.info(
        f"[task:{task_id}] teacher comment {'cleared' if not req.comment else 'set'} "
        f"on student={req.student_id} q={req.q_id}"
    )
    return {
        "status": "ok",
        "student_id": req.student_id,
        "q_id": req.q_id,
        "teacher_comment": target_correction["teacher_comment"],
    }


@router.get("/{task_id}/teacher_comments")
def list_teacher_comments(
    task_id: str,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    job_store: JobStore = Depends(get_job_store),
):
    """Return all teacher comments for a task as a flat dict.

    Keyed by f"{student_id}::{q_id}" — easy for the frontend to merge into
    its TaskState.teacher_comments dict on task load.
    """
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)

    if t.status != "graded" or not t.grading_job_id:
        return {"comments": {}}

    job = job_store.get(t.grading_job_id)
    if job is None or job.results is None:
        return {"comments": {}}

    out: Dict[str, str] = {}
    for s in job.results.get("results", []) or []:
        sid = str(s.get("student_id", ""))
        for c in s.get("corrections", []) or []:
            qid = str(c.get("q_id", ""))
            tc = c.get("teacher_comment", "")
            if tc:
                out[f"{sid}::{qid}"] = tc
    return {"comments": out}


# ─── Task-scoped knowledge base (RAG MVP) ────────────────────────────────────
#
# Upload a reference document (PDF / MD / TXT) for the current task. The
# backend chunks + embeds it and indexes it in
# `backend.rag.store.InMemoryTaskRetriever` keyed by task_id. Grading skills
# (concept, proof) retrieve from this scope at LLM-call time.
#
# Lifecycle:
#   - Pure in-memory: lost on Render free-tier sleep / restart. The user has
#     accepted this trade-off — it matches the "测一两个 task,退出失效" UX.
#   - Cleaned up on DELETE /tasks/{id} (see delete_task).
#   - Limits: 5 MB / file, 500 chunks / doc, 3 docs / task. See
#     backend/rag/chunker.py and backend/rag/store.py.
#
# Idempotency: same as extract_problems / parse_submissions — sha256(file)
# hash is stored on each KBDoc; uploading the same bytes returns the
# existing doc_id with status "already_done".


@router.post("/{task_id}/kb")
async def task_upload_kb(
    task_id: str,
    file: UploadFile = File(...),
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    """Chunk + embed a reference document and add it to this task's KB index."""
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    _require_task_llm_principal(t, current)
    base_workflow_revision = t.workflow_revision

    owner_registry = registry.for_owner(current.id)
    if owner_registry.count() == 0:
        raise HTTPException(
            503,
            detail="Configure at least one BYOK provider before uploading KB; "
                   "the embedder needs an API key (Zhipu / OpenAI for dense; "
                   "any provider for BM25 fallback).",
        )
    if owner_registry.uses_shared_pool():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            detail={"code": "shared_pool_kb_requires_byok"},
        )

    retriever = get_retriever()
    if not isinstance(retriever, InMemoryTaskRetriever):
        raise HTTPException(
            503,
            detail="Task-scoped KB retriever is not active on this deployment.",
        )

    body = await file.read()
    if len(body) > KB_MAX_FILE_BYTES:
        raise HTTPException(
            413,
            detail=f"KB file too large ({len(body)} bytes > {KB_MAX_FILE_BYTES}).",
        )

    sha256 = hashlib.sha256(body).hexdigest()

    # Idempotency: same file already indexed for this task
    existing = retriever.find_doc_by_hash(task_id, sha256)
    if existing is not None:
        return {
            "status": "already_done",
            "task_id": t.task_id,
            "doc_id": existing.doc_id,
            "filename": existing.filename,
            "chunk_count": existing.chunk_count,
        }

    # Extract → chunk
    text = await kb_extract_text(file.filename or "kb.txt", body)
    chunks = chunk_text(text)
    if not chunks:
        raise HTTPException(400, detail="Document produced no usable chunks.")

    # Embed + index. pick_embedder picks zhipu > openai > BM25 from BYOK.
    embedder = pick_embedder(owner_registry)
    doc_id = f"kb_{uuid.uuid4().hex[:10]}"
    try:
        entry = await retriever.add_document(
            task_id=task_id,
            doc_id=doc_id,
            filename=file.filename or "kb.txt",
            sha256=sha256,
            chunks=chunks,
            embedder=embedder,
        )
    except ValueError as exc:
        # Limit exceeded / dim mismatch / embedder switch — caller-facing 4xx
        logger.warning(
            "[task:%s] KB index conflict; exception_type=%s",
            task_id,
            type(exc).__name__,
        )
        raise HTTPException(
            409,
            detail={"code": "knowledge_base_index_conflict"},
        ) from exc
    except Exception as exc:
        logger.error(
            "[task:%s] KB embed failed; exception_type=%s",
            task_id,
            type(exc).__name__,
        )
        raise HTTPException(
            502,
            detail={"code": "knowledge_base_embedding_failed"},
        ) from exc

    # Mirror metadata into the Task so frontend can list without hitting the
    # retriever directly.
    new_kb_docs = dict(t.kb_docs)
    new_kb_docs[doc_id] = entry.public()
    committed_task = task_store.update_workflow_cas(
        task_id,
        expected_revision=base_workflow_revision,
        kb_docs=new_kb_docs,
    )
    if committed_task is None:
        retriever.remove_doc(task_id, doc_id)
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            detail={"code": "task_workflow_changed"},
        )
    logger.info(
        f"[task:{task_id}] KB upload doc_id={doc_id} filename={file.filename!r} "
        f"chunks={len(chunks)} embedder={embedder.name}"
    )
    return {
        "status": "started",  # synchronous in MVP, kept for symmetry with other endpoints
        "task_id": t.task_id,
        "doc_id": doc_id,
        "filename": entry.filename,
        "chunk_count": entry.chunk_count,
        "embedder": embedder.name,
    }


@router.get("/{task_id}/kb")
def task_list_kb(
    task_id: str,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
):
    """Return the metadata for all KB documents currently indexed under this task."""
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    retriever = get_retriever()
    # Source of truth = retriever (Task.kb_docs is just a serialization mirror).
    if isinstance(retriever, InMemoryTaskRetriever):
        return {"docs": retriever.list_docs(task_id)}
    return {"docs": list((t.kb_docs or {}).values())}


@router.delete("/{task_id}/kb/{doc_id}")
def task_delete_kb(
    task_id: str,
    doc_id: str,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
):
    """Remove a single KB document from this task's index."""
    t = _get_or_404(task_store, task_id)
    _check_owner(t, current)
    retriever = get_retriever()
    removed = False
    if isinstance(retriever, InMemoryTaskRetriever):
        removed = retriever.remove_doc(task_id, doc_id)

    if doc_id in (t.kb_docs or {}):
        new_kb_docs = dict(t.kb_docs)
        new_kb_docs.pop(doc_id, None)
        task_store.update_workflow(task_id, kb_docs=new_kb_docs)
        removed = True

    if not removed:
        raise HTTPException(404, detail=f"KB doc {doc_id} not found on task {task_id}")
    return {"status": "success", "doc_id": doc_id}
