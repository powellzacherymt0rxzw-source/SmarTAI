"""
Analytics API — natural-language post-grading queries + per-question breakdown.

Endpoints:
  POST /analytics/{task_id}/query
    body: {question: str, mode: "filter"|"summary"|"chart"}
    returns: mode-specific structured output

  GET  /analytics/{task_id}/per_question/{q_id}
    returns: deterministic stats + (cached) LLM-summarized common mistakes

Rate limiting:
  Per user, max 1 NL query per 30s. The `chart`/`summary`/`filter` LLM calls
  are gated; `per_question` is mostly deterministic (only the common-mistakes
  bullet uses LLM and is cached per (task_id, q_id)).
"""
from __future__ import annotations

import logging
import time
from collections import OrderedDict
from dataclasses import dataclass
from threading import RLock
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from backend.auth import require_teacher
from backend.models import User, Task
from backend.state import (
    JobStore, TaskStore,
    get_job_store, get_task_store,
)
from backend.llm.registry import ExpertRegistry, get_expert_registry
from backend.agents import analytics_agent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/analytics", tags=["analytics"])

# ─── Rate limiting (in-memory) ───────────────────────────────────────────────

_RATE_WINDOW_SEC = 30.0
_last_query_at: Dict[str, float] = {}  # owner_id → ts of last NL query

# Per-question common-mistakes cache. Entries are bound to the grading job that
# produced them so a late async write can never be served after replace/delete.
_CM_CACHE_TTL_SECONDS = 2 * 60 * 60
_CM_CACHE_MAX_ENTRIES = 1000


@dataclass(frozen=True)
class _CommonMistakesEntry:
    markdown: str
    grading_job_id: str
    created_at: float


_cm_cache: "OrderedDict[str, _CommonMistakesEntry]" = OrderedDict()
_cm_cache_lock = RLock()


def _prune_common_mistakes_cache(now: Optional[float] = None) -> None:
    current = time.monotonic() if now is None else now
    for cache_key, entry in list(_cm_cache.items()):
        if current - entry.created_at > _CM_CACHE_TTL_SECONDS:
            _cm_cache.pop(cache_key, None)
    while len(_cm_cache) > _CM_CACHE_MAX_ENTRIES:
        _cm_cache.popitem(last=False)


def get_task_common_mistakes(task: Task, q_id: str) -> Optional[str]:
    if not task.grading_job_id:
        return None
    cache_key = f"{task.task_id}::{q_id}"
    with _cm_cache_lock:
        _prune_common_mistakes_cache()
        entry = _cm_cache.get(cache_key)
        if entry is None or entry.grading_job_id != task.grading_job_id:
            return None
        _cm_cache.move_to_end(cache_key)
        return entry.markdown


def cache_task_common_mistakes(
    *,
    task_id: str,
    q_id: str,
    grading_job_id: str,
    markdown: str,
) -> None:
    cache_key = f"{task_id}::{q_id}"
    with _cm_cache_lock:
        _cm_cache[cache_key] = _CommonMistakesEntry(
            markdown=markdown,
            grading_job_id=grading_job_id,
            created_at=time.monotonic(),
        )
        _cm_cache.move_to_end(cache_key)
        _prune_common_mistakes_cache()


def clear_task_analytics_cache(task_id: str) -> None:
    """Drop all derived analytics for one task after replace/delete."""

    prefix = f"{task_id}::"
    with _cm_cache_lock:
        for cache_key in list(_cm_cache):
            if cache_key.startswith(prefix):
                _cm_cache.pop(cache_key, None)


def _check_rate_limit(owner_id: str) -> None:
    last = _last_query_at.get(owner_id, 0.0)
    now = time.time()
    elapsed = now - last
    if elapsed < _RATE_WINDOW_SEC:
        wait = round(_RATE_WINDOW_SEC - elapsed, 1)
        raise HTTPException(429, detail=f"Rate limited. Retry in {wait}s.")
    _last_query_at[owner_id] = now


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _check_owner(task: Task, user: User) -> None:
    if user.role == "admin":
        return
    if task.owner_id != user.id:
        raise HTTPException(403, detail="Not your task")


def _require_task_llm_principal(task: Task, user: User) -> None:
    """Never let an admin silently spend another owner's BYOK credentials."""

    if task.owner_id != user.id:
        raise HTTPException(
            403,
            detail={"code": "task_llm_impersonation_forbidden"},
        )


def _get_results_payload(task: Task, job_store: JobStore) -> Dict[str, Any]:
    if task.status not in {
        "graded", "review_confirmed", "generating_analysis", "finalized",
    } or not task.grading_job_id:
        raise HTTPException(409, detail=f"Task not graded yet (status={task.status})")
    job = job_store.get(task.grading_job_id)
    if job is None or job.results is None:
        raise HTTPException(404, detail="Grading result not found")
    return dict(job.results)


# ─── Schemas ─────────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    mode: Literal["filter", "summary", "chart"] = "filter"


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.post("/{task_id}/query")
async def nl_query(
    task_id: str,
    req: QueryRequest,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    job_store: JobStore = Depends(get_job_store),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    task = task_store.get(task_id)
    if task is None:
        raise HTTPException(404, detail="Task not found")
    _check_owner(task, current)
    _require_task_llm_principal(task, current)

    # Rate limit (per owner)
    _check_rate_limit(current.id)

    payload = _get_results_payload(task, job_store)
    provider = registry.for_owner(current.id).pick_default()
    if provider is None:
        raise HTTPException(503, detail="No LLM provider configured.")

    try:
        if req.mode == "filter":
            out = await analytics_agent.filter_students(
                question=req.question,
                results_payload=payload,
                problem_data=task.problem_data,
                provider=provider,
            )
            return {"mode": "filter", **out.model_dump()}

        elif req.mode == "summary":
            out = await analytics_agent.summarize(
                question=req.question,
                results_payload=payload,
                problem_data=task.problem_data,
                provider=provider,
            )
            return {"mode": "summary", **out.model_dump()}

        elif req.mode == "chart":
            out = await analytics_agent.make_chart(
                question=req.question,
                results_payload=payload,
                problem_data=task.problem_data,
                provider=provider,
            )
            return {"mode": "chart", **out.model_dump()}

        else:
            raise HTTPException(400, detail=f"Unknown mode: {req.mode}")

    except HTTPException:
        raise
    except Exception as exc:
        logger.error(
            "NL query failed for task=%s mode=%s; exception_type=%s",
            task_id,
            req.mode,
            type(exc).__name__,
        )
        raise HTTPException(
            500,
            detail={"code": "analytics_query_failed"},
        ) from exc


@router.get("/{task_id}/per_question/{q_id}")
async def per_question(
    task_id: str,
    q_id: str,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
    job_store: JobStore = Depends(get_job_store),
    registry: ExpertRegistry = Depends(get_expert_registry),
):
    task = task_store.get(task_id)
    if task is None:
        raise HTTPException(404, detail="Task not found")
    _check_owner(task, current)
    _require_task_llm_principal(task, current)

    payload = _get_results_payload(task, job_store)
    breakdown = analytics_agent.per_question_breakdown(q_id, payload, task.problem_data)

    common_mistakes_md = get_task_common_mistakes(task, q_id)
    if common_mistakes_md is None:
        expected_grading_job_id = task.grading_job_id
        provider = registry.for_owner(current.id).pick_default()
        if provider is not None and breakdown["rows"]:
            try:
                out = await analytics_agent.question_common_mistakes(
                    q_id=q_id,
                    breakdown=breakdown,
                    provider=provider,
                )
                common_mistakes_md = out.common_mistakes_md
                latest_task = task_store.get(task_id)
                if (
                    expected_grading_job_id
                    and latest_task is not None
                    and latest_task.status in {
                        "graded", "review_confirmed", "generating_analysis", "finalized",
                    }
                    and latest_task.grading_job_id == expected_grading_job_id
                ):
                    cache_task_common_mistakes(
                        task_id=task_id,
                        q_id=q_id,
                        grading_job_id=expected_grading_job_id,
                        markdown=common_mistakes_md,
                    )
            except Exception as exc:
                logger.warning(
                    "common-mistakes summary failed; exception_type=%s",
                    type(exc).__name__,
                )
                common_mistakes_md = ""
        else:
            common_mistakes_md = ""

    return {
        **breakdown,
        "common_mistakes_md": common_mistakes_md,
    }


@router.delete("/{task_id}/per_question/{q_id}/cache")
def reset_per_question_cache(
    task_id: str,
    q_id: str,
    current: User = Depends(require_teacher),
    task_store: TaskStore = Depends(get_task_store),
):
    task = task_store.get(task_id)
    if task is None:
        raise HTTPException(404, detail="Task not found")
    _check_owner(task, current)
    with _cm_cache_lock:
        _cm_cache.pop(f"{task_id}::{q_id}", None)
    return {"status": "cleared"}
