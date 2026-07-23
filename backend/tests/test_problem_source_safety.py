"""P1 safety contracts for Q-01 workflow CAS, quotas, and error handling."""
from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.main import app
from backend.api import analytics as analytics_api
from backend.api.analytics import _cm_cache
from backend.models import CourseMaterial, GradingJob, ProblemSourceDraft, Task
from backend.progress import tracker as progress_tracker
from backend.state import (
    CourseMaterialStore,
    ProblemSourceDraftStore,
    ResourceQuotaError,
    TaskStore,
    get_course_material_store,
    get_job_store,
    get_problem_source_draft_store,
    get_task_store,
)
from backend.tools import file_processing


HEADERS = {"Authorization": "Bearer demo-teacher-q01safety"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-q01safetyother"}
OWNER_ID = "demo_q01safety"


@pytest.fixture(autouse=True)
def reset_state():
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()
    get_course_material_store().clear()
    get_problem_source_draft_store().clear()
    get_job_store()._active.clear()
    get_job_store()._history.clear()
    progress_tracker._reporters.clear()
    progress_tracker._reporter_last_seen.clear()
    _cm_cache.clear()
    yield
    get_task_store()._tasks.clear()
    get_course_material_store().clear()
    get_problem_source_draft_store().clear()
    progress_tracker._reporters.clear()
    progress_tracker._reporter_last_seen.clear()
    _cm_cache.clear()


@pytest.fixture
def client():
    return TestClient(app)


def _task_with_problems(task_id: str = "T_cas") -> Task:
    return Task(
        task_id=task_id,
        owner_id=OWNER_ID,
        name="CAS task",
        status="problems_ready",
        problem_data={
            "q1": {"q_id": "q1", "number": "1", "stem": "old", "criterion": ""},
        },
        problem_file_hash="old-hash",
        problem_file_name="old.txt",
    )


def test_same_source_begin_is_atomic_and_starts_only_one_worker():
    store = TaskStore()
    store.create(Task(task_id="T_same", owner_id=OWNER_ID))
    barrier = threading.Barrier(2)

    def begin(index: int) -> tuple[str, str | None]:
        barrier.wait()
        outcome, task = store.begin_problem_extraction(
            "T_same",
            expected_revision=0,
            job_id=f"job-{index}",
            request_fingerprint="same-fingerprint",
            content_sha256="same-hash",
            filename="same.txt",
            legacy_same_completed_request=False,
            replace_confirmed=False,
        )
        return outcome, task.extract_job_id if task else None

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(begin, (1, 2)))
    assert sorted(outcome for outcome, _ in results) == ["already_running", "started"]
    assert len({job_id for _, job_id in results}) == 1
    assert store.get("T_same").workflow_revision == 1


def test_different_source_begin_is_atomic_and_rejects_second_worker():
    store = TaskStore()
    store.create(Task(task_id="T_different", owner_id=OWNER_ID))
    barrier = threading.Barrier(2)

    def begin(index: int) -> str:
        barrier.wait()
        outcome, _ = store.begin_problem_extraction(
            "T_different",
            expected_revision=0,
            job_id=f"job-{index}",
            request_fingerprint=f"fingerprint-{index}",
            content_sha256=f"hash-{index}",
            filename=f"{index}.txt",
            legacy_same_completed_request=False,
            replace_confirmed=False,
        )
        return outcome

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(begin, (1, 2)))
    assert sorted(outcomes) == ["different_source_running", "started"]
    assert store.get("T_different").workflow_revision == 1


def test_parse_and_extract_begin_cannot_overwrite_each_other():
    store = TaskStore()
    store.create(_task_with_problems("T_cross_workflow"))
    barrier = threading.Barrier(2)

    def begin_extract() -> str:
        barrier.wait()
        return store.begin_problem_extraction(
            "T_cross_workflow",
            expected_revision=0,
            job_id="extract-job",
            request_fingerprint="replacement",
            content_sha256="replacement-hash",
            filename="replacement.txt",
            legacy_same_completed_request=False,
            replace_confirmed=True,
        )[0]

    def begin_parse() -> str:
        barrier.wait()
        return store.begin_submission_parse(
            "T_cross_workflow",
            expected_revision=0,
            job_id="parse-job",
            content_sha256="submissions-hash",
            request_fingerprint="submissions-request",
            filename="submissions.zip",
            identity_mode="filename",
            roster_name=None,
            recognition_provider_id="mock:recognizer",
            replace_confirmed=False,
        )[0]

    with ThreadPoolExecutor(max_workers=2) as pool:
        extract_future = pool.submit(begin_extract)
        parse_future = pool.submit(begin_parse)
        outcomes = [extract_future.result(), parse_future.result()]
    assert outcomes.count("started") == 1
    assert any(outcome in {"stale_revision", "workflow_busy"} for outcome in outcomes)
    task = store.get("T_cross_workflow")
    assert task.workflow_revision == 1
    assert not (task.extract_job_id and task.parse_job_id)


def test_replacement_requires_confirmation_and_old_source_token_becomes_stale(
    client,
    monkeypatch,
):
    task = _task_with_problems("T_replace")
    get_task_store().create(task)
    preflight = client.post(
        "/tasks/T_replace/problem-sources/preflight",
        headers=HEADERS,
        data={"structure_mode": "organized"},
        files={"file": ("new.txt", b"1. New question", "text/plain")},
    )
    assert preflight.status_code == 200, preflight.text
    prepared = preflight.json()
    assert prepared["base_workflow_revision"] == 0

    no_confirmation = client.post(
        "/tasks/T_replace/extract_problems",
        headers=HEADERS,
        data={"source_token": prepared["source_token"]},
    )
    assert no_confirmation.status_code == 409
    detail = no_confirmation.json()["detail"]
    assert detail["code"] == "problem_replacement_confirmation_required"
    assert detail["will_clear"] == [
        "problem_data", "student_data", "submission_file", "grading_result",
        "reference_answers", "test_cases",
    ]

    get_task_store().update_workflow("T_replace", problem_data=dict(task.problem_data))
    stale = client.post(
        "/tasks/T_replace/extract_problems",
        headers=HEADERS,
        data={
            "source_token": prepared["source_token"],
            "replace_confirmed": "true",
        },
    )
    assert stale.status_code == 409
    assert stale.json()["detail"] == {
        "code": "stale_problem_source",
        "base_workflow_revision": 0,
        "workflow_revision": 1,
    }

    async def fake_extract(text, provider, store, reporter=None, **kwargs):
        store["q-new"] = {"q_id": "q-new", "number": "1", "stem": "new", "criterion": ""}
        return store

    monkeypatch.setattr("backend.api.tasks.extract_problems", fake_extract)
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock"),
    )
    refreshed = client.post(
        "/tasks/T_replace/problem-sources/preflight",
        headers=HEADERS,
        data={"structure_mode": "organized"},
        files={"file": ("new.txt", b"1. New question", "text/plain")},
    ).json()
    started = client.post(
        "/tasks/T_replace/extract_problems",
        headers=HEADERS,
        data={
            "source_token": refreshed["source_token"],
            "replace_confirmed": "true",
        },
    )
    assert started.status_code == 200, started.text
    assert started.json()["replace_confirmed"] is True


def test_direct_file_replacement_also_requires_confirmation(client, monkeypatch):
    get_task_store().create(_task_with_problems("T_direct_replace"))
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock"),
    )
    response = client.post(
        "/tasks/T_direct_replace/extract_problems",
        headers=HEADERS,
        files={"file": ("different.txt", b"1. Different", "text/plain")},
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "problem_replacement_confirmation_required"


def test_kb_only_task_allows_first_problem_extraction_without_replace_confirmation():
    store = TaskStore()
    store.create(Task(
        task_id="T_kb_only",
        owner_id=OWNER_ID,
        kb_docs={"kb-1": {"filename": "reference.txt"}},
    ))
    outcome, task = store.begin_problem_extraction(
        "T_kb_only",
        expected_revision=0,
        job_id="extract-kb-only",
        request_fingerprint="first-problems",
        content_sha256="first-hash",
        filename="questions.txt",
        legacy_same_completed_request=False,
        replace_confirmed=False,
    )
    assert outcome == "started"
    assert task is not None and task.kb_docs["kb-1"]["filename"] == "reference.txt"


def test_successful_replacement_clears_old_result_cache_and_reporter(
    client,
    monkeypatch,
):
    task = _task_with_problems("T_replace_cleanup")
    task.status = "graded"
    task.student_data = {"s1": {"student_id": "s1", "stu_ans": []}}
    task.grading_job_id = "old-grade-job"
    get_task_store().create(task)
    get_job_store()._history["old-grade-job"] = GradingJob(
        job_id="old-grade-job",
        job_name="Old result",
        job_type="batch",
        status="completed",
        results={"results": []},
    )
    progress_tracker.get_or_create_reporter("old-grade-job")
    analytics_api.cache_task_common_mistakes(
        task_id="T_replace_cleanup",
        q_id="q1",
        markdown="stale analysis",
        grading_job_id="old-grading-job",
    )

    async def fake_extract(text, provider, store, reporter=None, **kwargs):
        store["q2"] = {"q_id": "q2", "number": "2", "stem": "new", "criterion": ""}
        return store

    monkeypatch.setattr("backend.api.tasks.extract_problems", fake_extract)
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock"),
    )
    prepared = client.post(
        "/tasks/T_replace_cleanup/problem-sources/preflight",
        headers=HEADERS,
        files={"file": ("new.txt", b"2. New question", "text/plain")},
    )
    assert prepared.status_code == 200, prepared.text
    started = client.post(
        "/tasks/T_replace_cleanup/extract_problems",
        headers=HEADERS,
        data={
            "source_token": prepared.json()["source_token"],
            "replace_confirmed": "true",
        },
    )
    assert started.status_code == 200, started.text
    time.sleep(0.1)
    assert get_task_store().get("T_replace_cleanup").status == "problems_ready"
    assert "T_replace_cleanup::q1" not in _cm_cache
    assert get_job_store().get("old-grade-job") is None
    assert progress_tracker.get_reporter("old-grade-job") is None


def test_teacher_comment_invalidates_older_replacement_preflight(client):
    task = _task_with_problems("T_comment_revision")
    task.status = "graded"
    task.grading_job_id = "comment-job"
    get_task_store().create(task)
    get_job_store()._history["comment-job"] = GradingJob(
        job_id="comment-job",
        job_name="Comment result",
        job_type="batch",
        status="completed",
        results={
            "results": [{
                "student_id": "s1",
                "corrections": [{"q_id": "q1", "comment": "AI"}],
            }],
        },
    )
    prepared = client.post(
        "/tasks/T_comment_revision/problem-sources/preflight",
        headers=HEADERS,
        files={"file": ("new.txt", b"1. New", "text/plain")},
    )
    assert prepared.status_code == 200, prepared.text
    commented = client.post(
        "/tasks/T_comment_revision/teacher_comment",
        headers=HEADERS,
        json={"student_id": "s1", "q_id": "q1", "comment": "Keep this"},
    )
    assert commented.status_code == 200, commented.text
    stale = client.post(
        "/tasks/T_comment_revision/extract_problems",
        headers=HEADERS,
        data={
            "source_token": prepared.json()["source_token"],
            "replace_confirmed": "true",
        },
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "stale_problem_source"


def test_reporter_store_is_bounded_and_explicit_removal_cleans_metadata(monkeypatch):
    monkeypatch.setattr(progress_tracker, "_REPORTER_MAX_ENTRIES", 2)
    progress_tracker.get_or_create_reporter("job-1")
    progress_tracker.get_or_create_reporter("job-2")
    progress_tracker.get_or_create_reporter("job-3")
    assert progress_tracker.get_reporter("job-1") is None
    assert list(progress_tracker._reporters) == ["job-2", "job-3"]
    progress_tracker.remove_reporter("job-2")
    assert "job-2" not in progress_tracker._reporter_last_seen


def test_common_mistakes_cache_is_job_bound_and_bounded(monkeypatch):
    monkeypatch.setattr(analytics_api, "_CM_CACHE_MAX_ENTRIES", 2)
    task = Task(
        task_id="T_cache_bound",
        owner_id=OWNER_ID,
        status="graded",
        grading_job_id="new-job",
    )
    analytics_api.cache_task_common_mistakes(
        task_id=task.task_id,
        q_id="q-old",
        grading_job_id="old-job",
        markdown="stale",
    )
    assert analytics_api.get_task_common_mistakes(task, "q-old") is None
    for q_id in ("q1", "q2", "q3"):
        analytics_api.cache_task_common_mistakes(
            task_id=task.task_id,
            q_id=q_id,
            grading_job_id="new-job",
            markdown=q_id,
        )
    assert len(_cm_cache) == 2
    assert analytics_api.get_task_common_mistakes(task, "q3") == "q3"


def test_manual_problem_and_answer_edits_are_blocked_during_active_workflow(client):
    task = _task_with_problems("T_busy_edit")
    task.status = "grading"
    task.grading_job_id = "busy-grade"
    task.student_data = {
        "s1": {
            "student_id": "s1",
            "stu_ans": [{
                "q_id": "q1", "number": "1", "type": "concept",
                "content": "old", "flag": [],
            }],
        },
    }
    get_task_store().create(task)
    problem_edit = client.put(
        "/tasks/T_busy_edit/problems/q1",
        headers=HEADERS,
        json={"stem": "new"},
    )
    answer_edit = client.put(
        "/tasks/T_busy_edit/students/s1/answers/q1",
        headers=HEADERS,
        json={"content": "new"},
    )
    for response in (problem_edit, answer_edit):
        assert response.status_code == 409
        assert response.json()["detail"]["code"] == "task_workflow_busy"
    assert get_task_store().get("T_busy_edit").problem_data["q1"]["stem"] == "old"


def test_problem_review_status_follows_manual_edits_and_explicit_confirmation(client):
    task = _task_with_problems("T_problem_review")
    get_task_store().create(task)

    edited = client.put(
        "/tasks/T_problem_review/problems/q1",
        headers=HEADERS,
        json={"stem": "teacher edit"},
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["problem"]["review_status"] == "edited"
    assert get_task_store().get("T_problem_review").workflow_revision == 1

    confirmed = client.put(
        "/tasks/T_problem_review/problems/q1",
        headers=HEADERS,
        json={"review_status": "confirmed"},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["problem"]["review_status"] == "confirmed"

    edit_and_confirm = client.put(
        "/tasks/T_problem_review/problems/q1",
        headers=HEADERS,
        json={"criterion": "teacher rubric", "review_status": "confirmed"},
    )
    assert edit_and_confirm.status_code == 200, edit_and_confirm.text
    # Slot confirmation does not alter the already-confirmed stem state.
    assert edit_and_confirm.json()["problem"]["review_status"] == "confirmed"

    unconfirmed_edit = client.put(
        "/tasks/T_problem_review/problems/q1",
        headers=HEADERS,
        json={"criterion": "revised rubric", "review_status": "needs_review"},
    )
    assert unconfirmed_edit.status_code == 200, unconfirmed_edit.text
    assert unconfirmed_edit.json()["problem"]["review_status"] == "confirmed"

    invalid = client.put(
        "/tasks/T_problem_review/problems/q1",
        headers=HEADERS,
        json={"review_status": "reviewed"},
    )
    assert invalid.status_code == 422
    stored = get_task_store().get("T_problem_review").problem_data["q1"]
    assert stored["criterion"] == "revised rubric"
    assert stored["review_status"] == "confirmed"


def test_problem_preparation_fields_can_be_saved_per_question(client):
    task = _task_with_problems("T_problem_material_edit")
    get_task_store().create(task)

    response = client.put(
        "/tasks/T_problem_material_edit/problems/q1",
        headers=HEADERS,
        json={
            "reference_answer": "Teacher answer",
            "test_cases": [{
                "input": "2",
                "expected_output": "4",
                "description": "square",
                "source": "teacher",
                "sandbox_feasible": True,
            }],
        },
    )

    assert response.status_code == 200, response.text
    problem = response.json()["problem"]
    assert problem["reference_answer"] == "Teacher answer"
    assert problem["test_cases"][0]["expected_output"] == "4"
    assert problem["review_status"] == "needs_review"


def test_deleting_active_grade_cannot_resurrect_job_history(client, monkeypatch):
    task = _task_with_problems("T_delete_active_grade")
    task.status = "submissions_ready"
    task.student_data = {
        "s1": {
            "student_id": "s1",
            "student_name": "Student",
            "stu_ans": [{
                "q_id": "q1", "number": "1", "type": "concept",
                "content": "answer", "flag": [],
            }],
        },
    }
    get_task_store().create(task)

    async def delayed_grade_batch(**kwargs):
        await asyncio.sleep(0.1)
        return []

    monkeypatch.setattr("backend.api.tasks.grade_batch", delayed_grade_batch)
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.count",
        lambda self: 1,
    )
    started = client.post(
        "/tasks/T_delete_active_grade/grade",
        headers=HEADERS,
        json={"multi_sample_n": 1},
    )
    assert started.status_code == 200, started.text
    job_id = started.json()["job_id"]
    deleted = client.delete("/tasks/T_delete_active_grade", headers=HEADERS)
    assert deleted.status_code == 200
    time.sleep(0.2)
    assert get_task_store().get("T_delete_active_grade") is None
    assert get_job_store().get(job_id) is None


@pytest.mark.asyncio
async def test_pdf_subprocess_enforces_page_and_killable_time_limits():
    if file_processing.fitz is None:
        pytest.skip("PyMuPDF is not installed")
    doc = file_processing.fitz.open()
    doc.new_page().insert_text((72, 72), "Page one")
    doc.new_page().insert_text((72, 72), "Page two")
    pdf_body = doc.tobytes()
    doc.close()

    with pytest.raises(HTTPException) as page_error:
        await file_processing.extract_text_from_pdf(pdf_body, max_pages=1)
    assert page_error.value.status_code == 413
    assert page_error.value.detail["code"] == "pdf_page_limit_exceeded"

    with pytest.raises(HTTPException) as timeout_error:
        await file_processing.extract_text_from_pdf(
            pdf_body,
            timeout_seconds=0.000001,
        )
    assert timeout_error.value.status_code == 408
    assert timeout_error.value.detail["code"] == "pdf_extraction_timeout"


def test_character_and_estimated_token_limits_are_stable_413(client):
    character_limit = client.post(
        "/tasks/" + client.post(
            "/tasks/", headers=HEADERS, json={"name": "Character limit"},
        ).json()["task_id"] + "/problem-sources/preflight",
        headers=HEADERS,
        files={"file": ("large.txt", b"a" * 400_001, "text/plain")},
    )
    assert character_limit.status_code == 413
    assert character_limit.json()["detail"]["code"] == "problem_source_character_limit_exceeded"

    task_id = client.post(
        "/tasks/", headers=HEADERS, json={"name": "Token limit"},
    ).json()["task_id"]
    token_limit = client.post(
        f"/tasks/{task_id}/problem-sources/preflight",
        headers=HEADERS,
        files={"file": ("cjk.txt", ("题" * 120_001).encode(), "text/plain")},
    )
    assert token_limit.status_code == 413
    assert token_limit.json()["detail"]["code"] == "problem_source_token_limit_exceeded"


def test_non_evicting_store_quotas_are_owner_scoped(monkeypatch):
    materials = CourseMaterialStore()
    monkeypatch.setattr(materials, "MAX_MATERIALS_PER_OWNER", 1)
    first = CourseMaterial(
        material_id="m-a1", owner_id="a", filename="a.txt", size_bytes=1,
        sha256="a1", text="a", resident_bytes=1,
    )
    materials.create_or_get(first)
    with pytest.raises(ResourceQuotaError) as owner_limit:
        materials.create_or_get(CourseMaterial(
            material_id="m-a2", owner_id="a", filename="a2.txt", size_bytes=1,
            sha256="a2", text="b", resident_bytes=1,
        ))
    assert owner_limit.value.code == "course_material_owner_count_limit"
    materials.create_or_get(CourseMaterial(
        material_id="m-b1", owner_id="b", filename="b.txt", size_bytes=1,
        sha256="b1", text="b", resident_bytes=1,
    ))
    assert materials.get_for_owner("m-a1", "a") is first
    assert materials.get_for_owner("m-b1", "b") is not None

    drafts = ProblemSourceDraftStore()
    monkeypatch.setattr(drafts, "MAX_DRAFTS_PER_OWNER", 1)

    def draft(token: str, owner: str) -> ProblemSourceDraft:
        return ProblemSourceDraft(
            source_token=token,
            task_id=f"task-{owner}",
            owner_id=owner,
            source_kind="upload",
            structure_mode="organized",
            filename="x.txt",
            size_bytes=1,
            content_sha256=token,
            text="x",
            resident_bytes=1,
            expires_at=time.time() + 60,
        )

    drafts.create(draft("d-a1", "a"))
    with pytest.raises(ResourceQuotaError) as draft_limit:
        drafts.create(draft("d-a2", "a"))
    assert draft_limit.value.code == "problem_source_draft_owner_count_limit"
    drafts.create(draft("d-b1", "b"))
    assert drafts.get_for_owner_task("d-a1", owner_id="a", task_id="task-a") is not None
    assert drafts.get_for_owner_task("d-b1", owner_id="b", task_id="task-b") is not None


def test_task_quota_never_evicts_another_owner(monkeypatch):
    store = TaskStore()
    monkeypatch.setattr(store, "MAX_TASKS", 1)
    monkeypatch.setattr(store, "MAX_TASKS_PER_OWNER", 1)
    first = Task(task_id="T_owner_a", owner_id="owner-a")
    store.create(first)
    with pytest.raises(ResourceQuotaError) as global_limit:
        store.create(Task(task_id="T_owner_b", owner_id="owner-b"))
    assert global_limit.value.code == "task_global_count_limit"
    assert store.get("T_owner_a") is first
    assert store.get("T_owner_b") is None


def test_task_create_quota_returns_stable_429_without_eviction(client, monkeypatch):
    store = get_task_store()
    monkeypatch.setattr(store, "MAX_TASKS_PER_OWNER", 0)
    response = client.post(
        "/tasks/",
        headers=HEADERS,
        json={"name": "Over quota"},
    )
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "task_owner_count_limit"


def test_preflight_quota_errors_have_stable_http_status(client, monkeypatch):
    task_id = client.post(
        "/tasks/", headers=HEADERS, json={"name": "Quota"},
    ).json()["task_id"]
    draft_store = get_problem_source_draft_store()
    monkeypatch.setattr(draft_store, "MAX_DRAFTS_PER_OWNER", 0)
    draft_limit = client.post(
        f"/tasks/{task_id}/problem-sources/preflight",
        headers=HEADERS,
        files={"file": ("q.txt", b"1. Question", "text/plain")},
    )
    assert draft_limit.status_code == 429
    assert draft_limit.json()["detail"]["code"] == "problem_source_draft_owner_count_limit"


def test_provider_failure_reporter_and_task_error_are_redacted(
    client,
    monkeypatch,
    caplog,
):
    secret = "SUPER_SECRET_RAW_PROVIDER_FRAGMENT"

    async def failing_extract(*args, **kwargs):
        raise RuntimeError(secret)

    monkeypatch.setattr("backend.api.tasks.extract_problems", failing_extract)
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock"),
    )
    task_id = client.post(
        "/tasks/", headers=HEADERS, json={"name": "Redaction"},
    ).json()["task_id"]
    caplog.set_level(logging.INFO)
    started = client.post(
        f"/tasks/{task_id}/extract_problems",
        headers=HEADERS,
        files={"file": ("q.txt", b"1. Question", "text/plain")},
    )
    assert started.status_code == 200, started.text
    time.sleep(0.1)
    state = client.get(f"/tasks/{task_id}/state", headers=HEADERS)
    assert state.status_code == 200
    body = state.json()
    assert body["status"] == "error"
    assert body["error"] == "problem_extraction_failed"
    assert body["active_job_id"] == started.json()["job_id"]
    assert body["progress"]["phase"] == "error"
    assert "Problem recognition failed" in body["progress"]["error_detail"]
    assert secret not in state.text
    assert secret not in caplog.text


def test_source_token_cannot_cross_owners(client):
    first_task = client.post(
        "/tasks/", headers=HEADERS, json={"name": "Owner A"},
    ).json()["task_id"]
    source_token = client.post(
        f"/tasks/{first_task}/problem-sources/preflight",
        headers=HEADERS,
        files={"file": ("q.txt", b"1. Question", "text/plain")},
    ).json()["source_token"]
    other_task = client.post(
        "/tasks/", headers=OTHER_HEADERS, json={"name": "Owner B"},
    ).json()["task_id"]
    denied = client.post(
        f"/tasks/{other_task}/extract_problems",
        headers=OTHER_HEADERS,
        data={"source_token": source_token},
    )
    assert denied.status_code == 404


def test_saved_library_draft_retains_no_raw_bytes_or_duplicate_text(client):
    task_id = client.post(
        "/tasks/", headers=HEADERS, json={"name": "Resident memory"},
    ).json()["task_id"]
    response = client.post(
        f"/tasks/{task_id}/problem-sources/preflight",
        headers=HEADERS,
        data={"save_to_library": "true", "structure_mode": "organized"},
        files={"file": ("q.txt", b"1. Question", "text/plain")},
    )
    assert response.status_code == 200, response.text
    token = response.json()["source_token"]
    draft = get_problem_source_draft_store().get_for_owner_task(
        token,
        owner_id=OWNER_ID,
        task_id=task_id,
    )
    material_id = response.json()["saved_material"]["material_id"]
    material = get_course_material_store().get_for_owner(material_id, OWNER_ID)
    assert draft is not None and material is not None
    assert draft.text is None
    assert not hasattr(draft, "raw_bytes")
    assert not hasattr(material, "raw_bytes")
    assert material.text == "1. Question"
