"""Q-08 bulk material-import contracts.

These tests deliberately exercise the public two-phase API.  Preflight is a
local, zero-LLM operation; starting an import builds an owner-scoped review
plan; applying selected candidates is the only operation allowed to mutate
question preparation fields.
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from copy import deepcopy
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.main import app
from backend.models import ProblemInfo, Task
from backend.progress import tracker as progress_tracker
from backend.state import (
    get_course_material_store,
    get_job_store,
    get_material_import_store,
    get_task_store,
)


HEADERS = {"Authorization": "Bearer demo-teacher-q08owner"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-q08other"}
ADMIN_HEADERS = {"Authorization": "Bearer demo-admin-q08admin"}
OWNER_ID = "demo_q08owner"


@pytest.fixture(autouse=True)
def reset_q08_state():
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()
    get_course_material_store().clear()
    get_material_import_store().clear()
    get_job_store()._active.clear()
    get_job_store()._history.clear()
    progress_tracker._reporters.clear()
    progress_tracker._reporter_last_seen.clear()
    yield
    get_task_store()._tasks.clear()
    get_course_material_store().clear()
    get_material_import_store().clear()
    progress_tracker._reporters.clear()
    progress_tracker._reporter_last_seen.clear()


@pytest.fixture
def client():
    # Keep one application portal alive so intentionally delayed background
    # workers are not cancelled when the request that scheduled them returns.
    with TestClient(app) as test_client:
        yield test_client


def _problem_data() -> dict[str, dict]:
    return {
        "q1": {
            "q_id": "q1",
            "number": "1",
            "type": "concept",
            "stem": "Explain the theorem.",
            "criterion": "Teacher rubric stays",
            "reference_answer": "",
            "review_status": "confirmed",
        },
        "q2": {
            "q_id": "q2",
            "number": "2",
            "type": "programming",
            "stem": "Write a square function.",
            "criterion": "",
            "reference_answer": "Teacher answer stays",
            "test_cases": [],
            "review_status": "confirmed",
        },
    }


def _create_ready_task(task_id: str = "T_q08") -> Task:
    task = Task(
        task_id=task_id,
        owner_id=OWNER_ID,
        name="Q-08 material import",
        status="problems_ready",
        problem_data=_problem_data(),
    )
    get_task_store().create(task)
    return task


def _preflight(
    client: TestClient,
    task_id: str,
    *,
    targets: tuple[str, ...] = ("criterion", "reference_answer", "test_cases"),
    body: bytes = b"Q1 answer and rubric\nQ2 tests",
    filename: str = "teacher-notes.txt",
    structure_mode: str = "organized",
    extraction_hint: str = "",
    headers=HEADERS,
):
    return client.post(
        f"/tasks/{task_id}/material-imports/preflight",
        headers=headers,
        data={
            "targets": json.dumps(list(targets)),
            "structure_mode": structure_mode,
            "extraction_hint": extraction_hint,
        },
        files={"file": (filename, body, "text/plain")},
    )


def _start(client: TestClient, task_id: str, source_token: str, *, headers=HEADERS):
    return client.post(
        f"/tasks/{task_id}/material-imports",
        headers=headers,
        json={"source_token": source_token},
    )


def _wait_for_plan(
    client: TestClient,
    task_id: str,
    job_id: str,
    expected_status: str,
    *,
    timeout: float = 1.5,
    headers=HEADERS,
) -> dict:
    deadline = time.monotonic() + timeout
    latest: dict = {}
    while time.monotonic() < deadline:
        response = client.get(
            f"/tasks/{task_id}/material-imports/{job_id}",
            headers=headers,
        )
        assert response.status_code == 200, response.text
        latest = response.json()
        if latest["status"] == expected_status:
            return latest
        time.sleep(0.02)
    pytest.fail(f"material import never reached {expected_status}: {latest}")


def _wait_for_progress_step(
    client: TestClient,
    task_id: str,
    job_id: str,
    expected_step: str,
    *,
    timeout: float = 1.0,
) -> dict:
    deadline = time.monotonic() + timeout
    latest: dict = {}
    while time.monotonic() < deadline:
        response = client.get(
            f"/tasks/{task_id}/material-imports/{job_id}",
            headers=HEADERS,
        )
        assert response.status_code == 200, response.text
        latest = response.json()
        if (latest.get("progress") or {}).get("current_step") == expected_step:
            return latest
        time.sleep(0.02)
    pytest.fail(f"material import never reported {expected_step}: {latest}")


def _candidate(
    candidate_id: str,
    q_id: str,
    target: str,
    *,
    text_value: str | None = None,
    test_cases: list[dict] | None = None,
    would_overwrite: bool = False,
    match_status: str = "exact",
) -> dict:
    return {
        "candidate_id": candidate_id,
        "q_id": q_id,
        "target": target,
        "text_value": text_value,
        "test_cases": test_cases,
        "confidence": 0.91,
        "match_status": match_status,
        "source_excerpt": f"source for {candidate_id}",
        "source_location": "teacher-notes.txt:1",
        "reason": "explicit question-number match",
        "would_overwrite": would_overwrite,
    }


def test_preflight_requires_exactly_one_owner_scoped_source_and_zero_provider(
    client,
    monkeypatch,
):
    task = _create_ready_task()

    def provider_must_not_be_selected(_self):
        raise AssertionError("preflight must not select or call an LLM provider")

    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        provider_must_not_be_selected,
    )

    missing = client.post(
        f"/tasks/{task.task_id}/material-imports/preflight",
        headers=HEADERS,
        data={"targets": '["reference_answer"]'},
    )
    assert missing.status_code == 422

    both = client.post(
        f"/tasks/{task.task_id}/material-imports/preflight",
        headers=HEADERS,
        data={
            "targets": '["reference_answer"]',
            "library_material_id": "material_fake",
        },
        files={"file": ("answers.txt", b"Q1 answer", "text/plain")},
    )
    assert both.status_code == 422

    prepared = _preflight(client, task.task_id, targets=("reference_answer",))
    assert prepared.status_code == 200, prepared.text
    body = prepared.json()
    assert body["status"] == "ready"
    assert body["targets"] == ["reference_answer"]
    assert body["source"]["kind"] == "upload"
    assert body["workflow_revision"] == task.workflow_revision

    hidden_task = Task(
        task_id="T_q08_other",
        owner_id="demo_q08other",
        name="Other owner",
        status="problems_ready",
        problem_data={"q1": _problem_data()["q1"]},
    )
    get_task_store().create(hidden_task)
    wrong_owner = _preflight(
        client,
        hidden_task.task_id,
        targets=("reference_answer",),
        headers=HEADERS,
    )
    assert wrong_owner.status_code == 403


def test_library_source_and_source_token_do_not_cross_owners(client, monkeypatch):
    task = _create_ready_task()
    saved = client.post(
        f"/tasks/{task.task_id}/material-imports/preflight",
        headers=HEADERS,
        data={
            "targets": '["criterion"]',
            "structure_mode": "organized",
            "save_to_library": "true",
        },
        files={"file": ("rubric.txt", b"Q1 rubric", "text/plain")},
    )
    assert saved.status_code == 200, saved.text
    saved_body = saved.json()
    material_id = saved_body["saved_material"]["material_id"]

    other = Task(
        task_id="T_q08_other",
        owner_id="demo_q08other",
        name="Other owner",
        status="problems_ready",
        problem_data={"q1": _problem_data()["q1"]},
    )
    get_task_store().create(other)
    hidden_material = client.post(
        f"/tasks/{other.task_id}/material-imports/preflight",
        headers=OTHER_HEADERS,
        data={
            "targets": '["criterion"]',
            "structure_mode": "organized",
            "library_material_id": material_id,
        },
    )
    assert hidden_material.status_code == 404

    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock:q08"),
    )
    crossed_token = _start(
        client,
        other.task_id,
        saved_body["source_token"],
        headers=OTHER_HEADERS,
    )
    assert crossed_token.status_code == 404

    admin_impersonation = _start(
        client,
        task.task_id,
        saved_body["source_token"],
        headers=ADMIN_HEADERS,
    )
    assert admin_impersonation.status_code == 403
    assert admin_impersonation.json()["detail"]["code"] == "task_llm_impersonation_forbidden"


def test_start_uses_task_owner_provider_and_is_idempotent(client, monkeypatch):
    task = _create_ready_task()
    source_token = _preflight(client, task.task_id).json()["source_token"]
    selected_for: list[str | None] = []

    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: None,
    )
    no_byok = _start(client, task.task_id, source_token)
    assert no_byok.status_code == 503
    assert get_task_store().get(task.task_id).material_import_job_id is None

    def pick_owner_provider(view):
        selected_for.append(view.owner_id)
        return MagicMock(provider_id="mock:q08-owner")

    async def delayed_plan(*args, **kwargs):
        await asyncio.sleep(0.15)
        return [_candidate("c-answer", "q1", "reference_answer", text_value="Imported")]

    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        pick_owner_provider,
    )
    monkeypatch.setattr(
        "backend.api.tasks.parse_material_import_to_candidates",
        delayed_plan,
    )

    first = _start(client, task.task_id, source_token)
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "started"
    second = _start(client, task.task_id, source_token)
    assert second.status_code == 200, second.text
    assert second.json()["status"] == "already_running"
    assert second.json()["job_id"] == first.json()["job_id"]
    assert selected_for == [OWNER_ID]

    _wait_for_plan(client, task.task_id, first.json()["job_id"], "ready")
    replay = _start(client, task.task_id, source_token)
    assert replay.status_code == 200, replay.text
    assert replay.json()["status"] == "plan_ready"
    assert replay.json()["job_id"] == first.json()["job_id"]
    assert selected_for == [OWNER_ID]


def test_failed_plan_keeps_questions_and_same_source_can_retry(client, monkeypatch):
    task = _create_ready_task()
    original = deepcopy(task.problem_data)
    source_token = _preflight(client, task.task_id).json()["source_token"]
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock:q08"),
    )

    async def fail_plan(*args, **kwargs):
        raise RuntimeError("RAW_PROVIDER_SECRET")

    monkeypatch.setattr(
        "backend.api.tasks.parse_material_import_to_candidates",
        fail_plan,
    )
    failed_start = _start(client, task.task_id, source_token)
    assert failed_start.status_code == 200, failed_start.text
    failed = _wait_for_plan(
        client,
        task.task_id,
        failed_start.json()["job_id"],
        "error",
    )
    assert "RAW_PROVIDER_SECRET" not in json.dumps(failed)
    retained = get_task_store().get(task.task_id)
    assert retained is not None
    assert retained.problem_data == original
    assert retained.pending_material_import_fingerprint is None

    async def succeed_plan(*args, **kwargs):
        return [_candidate("c-retry", "q1", "reference_answer", text_value="Retry")]

    monkeypatch.setattr(
        "backend.api.tasks.parse_material_import_to_candidates",
        succeed_plan,
    )
    retried = _start(client, task.task_id, source_token)
    assert retried.status_code == 200, retried.text
    assert retried.json()["status"] == "started"
    assert retried.json()["job_id"] != failed_start.json()["job_id"]
    _wait_for_plan(client, task.task_id, retried.json()["job_id"], "ready")
    assert get_task_store().get(task.task_id).problem_data == original


def test_get_plan_exposes_factual_progress_without_mutating_questions(
    client,
    monkeypatch,
):
    task = _create_ready_task()
    original = deepcopy(task.problem_data)
    source_token = _preflight(client, task.task_id).json()["source_token"]
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock:q08"),
    )

    async def staged_plan(*args, reporter=None, **kwargs):
        assert reporter is not None
        await reporter.set_stage_progress(
            "matching_questions",
            total_steps=3,
            completed_steps=1,
            message="Matching source to questions",
        )
        await asyncio.sleep(0.18)
        candidate = _candidate("c-progress", "q1", "reference_answer", text_value="Answer")
        candidate.pop("match_status")
        return [candidate]

    monkeypatch.setattr(
        "backend.api.tasks.parse_material_import_to_candidates",
        staged_plan,
    )
    started = _start(client, task.task_id, source_token)
    assert started.status_code == 200, started.text
    job_id = started.json()["job_id"]

    running = _wait_for_progress_step(
        client,
        task.task_id,
        job_id,
        "matching_questions",
    )
    progress = running["progress"]
    assert progress["current_step"] == "matching_questions"
    assert progress["total_steps"] == 3
    assert progress["completed_steps"] == 1
    task_state = client.get(f"/tasks/{task.task_id}/state", headers=HEADERS)
    assert task_state.status_code == 200, task_state.text
    assert task_state.json()["active_job_id"] == job_id
    assert task_state.json()["active_operation"] == "material_import"
    assert task_state.json()["progress"]["current_step"] == "matching_questions"
    assert get_task_store().get(task.task_id).problem_data == original

    ready = _wait_for_plan(client, task.task_id, job_id, "ready")
    assert ready["progress"]["completed_steps"] == ready["progress"]["total_steps"]
    assert ready["candidates"][0]["match_status"] == "possible"
    assert ready["workflow_revision"] == get_task_store().get(task.task_id).workflow_revision
    assert get_task_store().get(task.task_id).problem_data == original


def test_apply_missing_only_and_rejects_nonprogramming_test_cases(client, monkeypatch):
    task = _create_ready_task()
    source_token = _preflight(client, task.task_id).json()["source_token"]
    candidates = [
        _candidate(
            "c-q1-rubric",
            "q1",
            "criterion",
            text_value="Imported rubric must not overwrite",
            would_overwrite=True,
        ),
        _candidate("c-q1-answer", "q1", "reference_answer", text_value="Imported answer"),
        _candidate(
            "c-q1-tests",
            "q1",
            "test_cases",
            test_cases=[{"input": "1", "expected_output": "1"}],
        ),
        _candidate(
            "c-q2-answer",
            "q2",
            "reference_answer",
            text_value="Imported answer must not overwrite",
            would_overwrite=True,
        ),
        _candidate(
            "c-q2-tests",
            "q2",
            "test_cases",
            test_cases=[{"input": "2", "expected_output": "4"}],
        ),
    ]
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock:q08"),
    )

    async def build_plan(*args, **kwargs):
        return candidates

    monkeypatch.setattr(
        "backend.api.tasks.parse_material_import_to_candidates",
        build_plan,
    )
    started = _start(client, task.task_id, source_token)
    plan = _wait_for_plan(client, task.task_id, started.json()["job_id"], "ready")
    assert plan["summary"]["skipped_non_programming"] == 1
    assert not any(
        item["q_id"] == "q1" and item["target"] == "test_cases"
        for item in plan["candidates"]
    )

    accepted_ids = [item["candidate_id"] for item in plan["candidates"]]
    applied = client.post(
        f"/tasks/{task.task_id}/material-imports/{started.json()['job_id']}/apply",
        headers=HEADERS,
        json={
            "accepted_candidate_ids": accepted_ids,
            "overwrite_candidate_ids": [],
            "expected_workflow_revision": plan["workflow_revision"],
        },
    )
    assert applied.status_code == 200, applied.text
    assert applied.json()["summary"]["applied_count"] == 2
    assert applied.json()["summary"]["conflict_count"] == 2
    stored = get_task_store().get(task.task_id).problem_data
    assert stored["q1"]["criterion"] == "Teacher rubric stays"
    assert stored["q1"]["reference_answer"] == "Imported answer"
    assert not stored["q1"].get("test_cases")
    assert stored["q2"]["reference_answer"] == "Teacher answer stays"
    assert stored["q2"]["test_cases"][0]["expected_output"] == "4"
    # Importing preparation slots must not alter independent stem/content review.
    assert stored["q1"]["review_status"] == "confirmed"
    assert stored["q2"]["review_status"] == "confirmed"
    answer_candidate = next(
        item for item in plan["candidates"]
        if item["q_id"] == "q1" and item["target"] == "reference_answer"
    )
    answer_provenance = stored["q1"]["material_provenance"]["reference_answer"]
    assert answer_provenance["candidate_id"] == answer_candidate["candidate_id"]
    assert answer_provenance["import_job_id"] == started.json()["job_id"]
    assert answer_provenance["source_kind"] == "upload"
    assert answer_provenance["source_filename"] == "teacher-notes.txt"
    assert answer_provenance["source_excerpt"]
    assert answer_provenance["confidence"] == pytest.approx(0.91)
    assert answer_provenance["match_status"] == "exact"
    assert answer_provenance["review_status"] == "pending"
    assert answer_provenance["imported_at"] > 0
    ProblemInfo.model_validate(stored["q1"])


def test_apply_requires_revision_cas_and_explicit_overwrite_ids(client, monkeypatch):
    task = _create_ready_task()
    source_token = _preflight(
        client,
        task.task_id,
        targets=("criterion", "reference_answer"),
    ).json()["source_token"]
    candidates = [
        _candidate(
            "c-rubric-overwrite",
            "q1",
            "criterion",
            text_value="Explicit new rubric",
            would_overwrite=True,
        ),
        _candidate(
            "c-answer-overwrite",
            "q2",
            "reference_answer",
            text_value="Explicit new answer",
            would_overwrite=True,
        ),
    ]
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock:q08"),
    )

    async def build_plan(*args, **kwargs):
        return candidates

    monkeypatch.setattr(
        "backend.api.tasks.parse_material_import_to_candidates",
        build_plan,
    )
    started = _start(client, task.task_id, source_token)
    plan = _wait_for_plan(client, task.task_id, started.json()["job_id"], "ready")
    stale_revision = plan["workflow_revision"]
    get_task_store().update_workflow(task.task_id, name="Concurrent teacher edit")

    accepted_ids = [item["candidate_id"] for item in plan["candidates"]]
    stale = client.post(
        f"/tasks/{task.task_id}/material-imports/{started.json()['job_id']}/apply",
        headers=HEADERS,
        json={
            "accepted_candidate_ids": accepted_ids,
            "overwrite_candidate_ids": accepted_ids,
            "expected_workflow_revision": stale_revision,
        },
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "stale_revision"
    unchanged = get_task_store().get(task.task_id).problem_data
    assert unchanged["q1"]["criterion"] == "Teacher rubric stays"
    assert unchanged["q2"]["reference_answer"] == "Teacher answer stays"

    current_revision = get_task_store().get(task.task_id).workflow_revision
    applied = client.post(
        f"/tasks/{task.task_id}/material-imports/{started.json()['job_id']}/apply",
        headers=HEADERS,
        json={
            "accepted_candidate_ids": accepted_ids,
            "overwrite_candidate_ids": accepted_ids,
            "expected_workflow_revision": current_revision,
        },
    )
    assert applied.status_code == 200, applied.text
    stored = get_task_store().get(task.task_id).problem_data
    assert stored["q1"]["criterion"] == "Explicit new rubric"
    assert stored["q2"]["reference_answer"] == "Explicit new answer"


def test_delete_task_cleans_material_plan_and_stale_worker_reporter(client, monkeypatch):
    task = _create_ready_task()
    source_token = _preflight(client, task.task_id).json()["source_token"]
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock:q08"),
    )

    async def delayed_plan(*args, **kwargs):
        await asyncio.sleep(0.18)
        return [_candidate("late", "q1", "reference_answer", text_value="Late")]

    monkeypatch.setattr(
        "backend.api.tasks.parse_material_import_to_candidates",
        delayed_plan,
    )
    started = _start(client, task.task_id, source_token)
    assert started.status_code == 200, started.text
    job_id = started.json()["job_id"]
    deleted = client.delete(f"/tasks/{task.task_id}", headers=HEADERS)
    assert deleted.status_code == 200, deleted.text
    time.sleep(0.3)

    assert get_task_store().get(task.task_id) is None
    assert get_material_import_store().get_plan_for_owner_task(
        job_id,
        owner_id=OWNER_ID,
        task_id=task.task_id,
    ) is None
    assert progress_tracker.get_reporter(job_id) is None


def test_expired_ready_plan_releases_pointer_and_same_token_restarts(client, monkeypatch):
    task = _create_ready_task()
    source_token = _preflight(client, task.task_id).json()["source_token"]
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock:q08"),
    )

    async def build_plan(*args, **kwargs):
        return [_candidate("candidate", "q1", "reference_answer", text_value="Answer")]

    monkeypatch.setattr(
        "backend.api.tasks.parse_material_import_to_candidates",
        build_plan,
    )
    first = _start(client, task.task_id, source_token)
    first_plan = _wait_for_plan(client, task.task_id, first.json()["job_id"], "ready")
    assert first_plan["status"] == "ready"
    with get_material_import_store()._lock:
        get_material_import_store()._plans[first.json()["job_id"]].expires_at = time.time() - 1

    restarted = _start(client, task.task_id, source_token)
    assert restarted.status_code == 200, restarted.text
    assert restarted.json()["status"] == "started"
    assert restarted.json()["job_id"] != first.json()["job_id"]
    _wait_for_plan(client, task.task_id, restarted.json()["job_id"], "ready")


def test_confirming_one_slot_does_not_confirm_other_imported_slots(client):
    task = _create_ready_task()
    base_provenance = {
        "import_job_id": "job-a",
        "candidate_id": "candidate-a",
        "source_kind": "upload",
        "source_filename": "materials.txt",
        "confidence": 0.8,
        "source_excerpt": "source",
        "source_location": "Q1",
        "reason": "number match",
        "review_status": "pending",
        "imported_at": time.time(),
        "updated_at": time.time(),
    }
    task.problem_data["q1"]["material_provenance"] = {
        "criterion": dict(base_provenance),
        "reference_answer": {
            **base_provenance,
            "candidate_id": "candidate-b",
        },
    }

    confirmed = client.put(
        f"/tasks/{task.task_id}/problems/q1",
        headers=HEADERS,
        json={"reference_answer": "Confirmed answer", "review_status": "confirmed"},
    )
    assert confirmed.status_code == 200, confirmed.text
    provenance = confirmed.json()["problem"]["material_provenance"]
    assert provenance["reference_answer"]["review_status"] == "confirmed"
    assert provenance["criterion"]["review_status"] == "pending"
    assert confirmed.json()["problem"]["review_status"] == "confirmed"
