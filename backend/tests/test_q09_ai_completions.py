"""Q-09 missing-material AI completion contracts."""
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
from backend.state import get_ai_completion_store, get_task_store


HEADERS = {"Authorization": "Bearer demo-teacher-q09owner"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-q09other"}
ADMIN_HEADERS = {"Authorization": "Bearer demo-admin-q09admin"}
OWNER_ID = "demo_q09owner"


@pytest.fixture(autouse=True)
def reset_q09_state():
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()
    get_ai_completion_store().clear()
    progress_tracker._reporters.clear()
    progress_tracker._reporter_last_seen.clear()
    yield
    get_task_store()._tasks.clear()
    get_ai_completion_store().clear()
    progress_tracker._reporters.clear()
    progress_tracker._reporter_last_seen.clear()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def _problem_data() -> dict[str, dict]:
    return {
        "q1": {
            "q_id": "q1",
            "number": "1",
            "type": "concept",
            "stem": "Explain dependency injection.",
            "criterion": "Teacher rubric",
            "reference_answer": "",
            "review_status": "confirmed",
        },
        "q2": {
            "q_id": "q2",
            "number": "2",
            "type": "programming",
            "stem": "Write a square function.",
            "criterion": "",
            "reference_answer": "",
            "solution_code": "",
            "test_cases": [],
            "review_status": "confirmed",
        },
        "q3": {
            "q_id": "q3",
            "number": "3",
            "type": "programming",
            "stem": "Return the input.",
            "criterion": "Existing rubric",
            "reference_answer": "Existing answer",
            "solution_code": "def identity(x): return x",
            "test_cases": [{"input": "1", "expected_output": "1"}],
            "review_status": "confirmed",
        },
    }


def _create_ready_task(task_id: str = "T_q09") -> Task:
    task = Task(
        task_id=task_id,
        owner_id=OWNER_ID,
        name="Q-09 AI completion",
        status="problems_ready",
        problem_data=_problem_data(),
    )
    get_task_store().create(task)
    return task


def _preflight(client: TestClient, task_id: str, *, headers=HEADERS) -> dict:
    response = client.get(
        f"/tasks/{task_id}/ai-completions/preflight",
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


def _confirm(
    client: TestClient,
    task_id: str,
    target_ids: list[str],
    revision: int,
    *,
    headers=HEADERS,
):
    return client.post(
        f"/tasks/{task_id}/ai-completions/confirm",
        headers=headers,
        json={
            "target_ids": target_ids,
            "expected_workflow_revision": revision,
            "test_case_count": 4,
        },
    )


def _wait_job(
    client: TestClient,
    task_id: str,
    job_id: str,
    status: str,
    *,
    timeout: float = 1.5,
) -> dict:
    deadline = time.monotonic() + timeout
    latest: dict = {}
    while time.monotonic() < deadline:
        response = client.get(
            f"/tasks/{task_id}/ai-completions/{job_id}",
            headers=HEADERS,
        )
        assert response.status_code == 200, response.text
        latest = response.json()
        if latest["status"] == status:
            return latest
        time.sleep(0.02)
    pytest.fail(f"AI completion never reached {status}: {latest}")


def _candidate(target_id: str, *, text: str | None = None, tests=None) -> dict:
    q_id, target = target_id.split(":", 1)
    return {
        "target_id": target_id,
        "q_id": q_id,
        "target": target,
        "text_value": text,
        "test_cases": tests,
    }


def test_preflight_is_zero_provider_and_lists_only_real_missing_slots(client, monkeypatch):
    task = _create_ready_task()

    def provider_must_not_be_selected(_self):
        raise AssertionError("preflight must be a zero-provider operation")

    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        provider_must_not_be_selected,
    )
    body = _preflight(client, task.task_id)
    assert body["provider_call_performed"] is False
    assert body["overwrite_policy"] == "missing_only"
    assert {row["target_id"] for row in body["missing_targets"]} == {
        "q1:reference_answer",
        "q2:criterion",
        "q2:reference_answer",
        "q2:solution_code",
        "q2:test_cases",
    }
    assert body["summary"]["missing_count"] == 5
    assert body["summary"]["by_target"]["solution_code"] == 1

    task.problem_data["q2"]["ai_completion_provenance"] = {
        "solution_code": {
            "job_id": "prior",
            "candidate_id": "prior-solution",
            "source_kind": "ai_generated",
            "provider_id": "mock:prior",
            "review_status": "confirmed",
            "generated_at": time.time(),
            "updated_at": time.time(),
        },
    }
    protected = _preflight(client, task.task_id)
    assert "q2:solution_code" not in {
        row["target_id"] for row in protected["missing_targets"]
    }


def test_confirm_is_owner_byok_scoped_and_requires_explicit_scope(client, monkeypatch):
    task = _create_ready_task()
    preflight = _preflight(client, task.task_id)
    target_id = preflight["missing_targets"][0]["target_id"]
    original = deepcopy(task.problem_data)

    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: None,
    )
    unavailable = _confirm(
        client,
        task.task_id,
        [target_id],
        preflight["workflow_revision"],
    )
    assert unavailable.status_code == 503
    assert get_task_store().get(task.task_id).problem_data == original

    other = Task(
        task_id="T_q09_other",
        owner_id="demo_q09other",
        name="Other owner",
        status="problems_ready",
        problem_data=_problem_data(),
    )
    get_task_store().create(other)
    crossed = client.get(
        f"/tasks/{other.task_id}/ai-completions/preflight",
        headers=HEADERS,
    )
    assert crossed.status_code == 403
    admin = _confirm(
        client,
        task.task_id,
        [target_id],
        preflight["workflow_revision"],
        headers=ADMIN_HEADERS,
    )
    assert admin.status_code == 403
    assert admin.json()["detail"]["code"] == "task_llm_impersonation_forbidden"


def test_confirm_job_is_idempotent_reports_progress_and_applies_missing_only(
    client,
    monkeypatch,
):
    task = _create_ready_task()
    preflight = _preflight(client, task.task_id)
    selected = [row["target_id"] for row in preflight["missing_targets"]]
    selected_owners: list[str | None] = []

    def pick_provider(view):
        selected_owners.append(view.owner_id)
        return MagicMock(provider_id="mock:q09-owner")

    async def generate(*args, reporter=None, **kwargs):
        assert reporter is not None
        await reporter.set_stage_progress(
            "generating_missing_materials",
            total_steps=3,
            completed_steps=1,
            message="Generating selected missing fields",
        )
        await asyncio.sleep(0.15)
        return [
            _candidate("q1:reference_answer", text="Generated answer"),
            _candidate("q2:criterion", text="Generated rubric"),
            _candidate("q2:reference_answer", text="Programming explanation"),
            _candidate("q2:solution_code", text="def square(x): return x * x"),
            _candidate(
                "q2:test_cases",
                tests=[{"input": "2", "expected_output": "4"}],
            ),
        ]

    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        pick_provider,
    )
    monkeypatch.setattr("backend.api.tasks.generate_missing_question_materials", generate)
    first = _confirm(
        client,
        task.task_id,
        selected,
        preflight["workflow_revision"],
    )
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "started"
    second = _confirm(
        client,
        task.task_id,
        selected,
        preflight["workflow_revision"],
    )
    assert second.status_code == 200, second.text
    assert second.json()["status"] == "already_running"
    assert second.json()["job_id"] == first.json()["job_id"]

    different_scope = _confirm(
        client,
        task.task_id,
        ["q2:test_cases"],
        preflight["workflow_revision"],
    )
    assert different_scope.status_code == 200, different_scope.text
    assert different_scope.json()["status"] == "already_running"
    assert different_scope.json()["job_id"] == first.json()["job_id"]
    assert different_scope.json()["code"] == "different_scope_running"
    assert selected_owners == [OWNER_ID]

    state = client.get(f"/tasks/{task.task_id}/state", headers=HEADERS)
    assert state.status_code == 200
    assert state.json()["active_operation"] == "ai_completion"
    done = _wait_job(client, task.task_id, first.json()["job_id"], "done")
    assert done["summary"]["requested_count"] == 5
    assert done["summary"]["applied_count"] == 5
    assert done["summary"]["skipped_count"] == 0
    assert done["progress"]["completed_steps"] == done["progress"]["total_steps"]

    stored = get_task_store().get(task.task_id).problem_data
    assert stored["q1"]["criterion"] == "Teacher rubric"
    assert stored["q1"]["reference_answer"] == "Generated answer"
    assert stored["q2"]["solution_code"].startswith("def square")
    assert stored["q2"]["test_cases"][0]["source"] == "llm_generated"
    provenance = stored["q2"]["ai_completion_provenance"]["solution_code"]
    assert provenance["source_kind"] == "ai_generated"
    assert provenance["provider_id"] == "mock:q09-owner"
    assert provenance["review_status"] == "pending"
    # Generated preparation fields do not change stem/content review state.
    assert stored["q2"]["review_status"] == "confirmed"
    ProblemInfo.model_validate(stored["q2"])

    replay = _confirm(
        client,
        task.task_id,
        selected,
        preflight["workflow_revision"],
    )
    assert replay.status_code == 200
    assert replay.json()["status"] == "already_done"


def test_worker_skips_a_slot_filled_after_start_and_never_overwrites(client, monkeypatch):
    task = _create_ready_task()
    preflight = _preflight(client, task.task_id)
    selected = ["q1:reference_answer", "q2:criterion"]
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock:q09"),
    )

    async def delayed(*args, **kwargs):
        await asyncio.sleep(0.12)
        return [
            _candidate("q1:reference_answer", text="AI must not overwrite"),
            _candidate("q2:criterion", text="Generated rubric"),
        ]

    monkeypatch.setattr("backend.api.tasks.generate_missing_question_materials", delayed)
    started = _confirm(
        client,
        task.task_id,
        selected,
        preflight["workflow_revision"],
    )
    assert started.status_code == 200
    # Simulate an external repository writer that fills one slot without
    # touching the task revision; complete_ai_completion still rechecks values
    # under its own lock and must skip it.
    get_task_store().get(task.task_id).problem_data["q1"]["reference_answer"] = "Teacher wins"
    done = _wait_job(client, task.task_id, started.json()["job_id"], "done")
    assert done["summary"]["applied_count"] == 1
    assert done["summary"]["skipped_count"] == 1
    assert "q1:reference_answer" in done["skipped_target_ids"]
    stored = get_task_store().get(task.task_id).problem_data
    assert stored["q1"]["reference_answer"] == "Teacher wins"
    assert stored["q2"]["criterion"] == "Generated rubric"


def test_failure_is_sanitized_preserves_values_and_same_scope_retries(client, monkeypatch):
    task = _create_ready_task()
    original = deepcopy(task.problem_data)
    preflight = _preflight(client, task.task_id)
    selected = ["q1:reference_answer"]
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock:q09"),
    )

    async def fail(*args, **kwargs):
        raise RuntimeError("RAW_PROVIDER_SECRET")

    monkeypatch.setattr("backend.api.tasks.generate_missing_question_materials", fail)
    started = _confirm(
        client,
        task.task_id,
        selected,
        preflight["workflow_revision"],
    )
    failed = _wait_job(client, task.task_id, started.json()["job_id"], "error")
    assert failed["error"] == "ai_completion_failed"
    assert "RAW_PROVIDER_SECRET" not in json.dumps(failed)
    assert get_task_store().get(task.task_id).problem_data == original
    assert get_task_store().get(task.task_id).ai_completion_job_id is None

    async def succeed(*args, **kwargs):
        return [_candidate("q1:reference_answer", text="Retry answer")]

    monkeypatch.setattr("backend.api.tasks.generate_missing_question_materials", succeed)
    retried = _confirm(
        client,
        task.task_id,
        selected,
        preflight["workflow_revision"],
    )
    assert retried.status_code == 200, retried.text
    assert retried.json()["status"] == "started"
    done = _wait_job(client, task.task_id, retried.json()["job_id"], "done")
    assert done["summary"]["applied_count"] == 1


def test_solution_code_can_be_edited_and_confirmed_without_confirming_other_slots(client):
    task = _create_ready_task()
    task.problem_data["q2"]["review_status"] = "needs_review"
    now = time.time()
    task.problem_data["q2"]["solution_code"] = "generated"
    task.problem_data["q2"]["ai_completion_provenance"] = {
        "solution_code": {
            "job_id": "job-a",
            "candidate_id": "candidate-a",
            "source_kind": "ai_generated",
            "provider_id": "mock:q09",
            "review_status": "pending",
            "generated_at": now,
            "updated_at": now,
        },
        "criterion": {
            "job_id": "job-a",
            "candidate_id": "candidate-b",
            "source_kind": "ai_generated",
            "provider_id": "mock:q09",
            "review_status": "pending",
            "generated_at": now,
            "updated_at": now,
        },
    }
    confirmed = client.put(
        f"/tasks/{task.task_id}/problems/q2",
        headers=HEADERS,
        json={
            "solution_code": "def square(x):\n    return x * x",
            "review_status": "confirmed",
        },
    )
    assert confirmed.status_code == 200, confirmed.text
    problem = confirmed.json()["problem"]
    assert problem["solution_code"].startswith("def square")
    provenance = problem["ai_completion_provenance"]
    assert provenance["solution_code"]["review_status"] == "confirmed"
    assert provenance["criterion"]["review_status"] == "pending"
    assert problem["review_status"] == "needs_review"

    content_confirmed = client.put(
        f"/tasks/{task.task_id}/problems/q2",
        headers=HEADERS,
        json={"review_status": "confirmed"},
    )
    assert content_confirmed.status_code == 200, content_confirmed.text
    content_problem = content_confirmed.json()["problem"]
    assert content_problem["review_status"] == "confirmed"
    assert (
        content_problem["ai_completion_provenance"]["criterion"]["review_status"]
        == "pending"
    )


def test_delete_and_terminal_ttl_clean_q09_state(client, monkeypatch):
    task = _create_ready_task()
    preflight = _preflight(client, task.task_id)
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock:q09"),
    )

    async def generate(*args, **kwargs):
        return [_candidate("q1:reference_answer", text="Answer")]

    monkeypatch.setattr("backend.api.tasks.generate_missing_question_materials", generate)
    started = _confirm(
        client,
        task.task_id,
        ["q1:reference_answer"],
        preflight["workflow_revision"],
    )
    done = _wait_job(client, task.task_id, started.json()["job_id"], "done")
    assert done["status"] == "done"
    with get_ai_completion_store()._lock:
        get_ai_completion_store()._jobs[started.json()["job_id"]].expires_at = time.time() - 1
    expired = client.get(
        f"/tasks/{task.task_id}/ai-completions/{started.json()['job_id']}",
        headers=HEADERS,
    )
    assert expired.status_code == 410
    assert expired.json()["detail"]["code"] == "ai_completion_job_expired"

    other = _create_ready_task("T_q09_delete")

    async def delayed(*args, **kwargs):
        await asyncio.sleep(0.2)
        return [_candidate("q1:reference_answer", text="Late")]

    monkeypatch.setattr("backend.api.tasks.generate_missing_question_materials", delayed)
    other_preflight = _preflight(client, other.task_id)
    running = _confirm(
        client,
        other.task_id,
        ["q1:reference_answer"],
        other_preflight["workflow_revision"],
    )
    deleted = client.delete(f"/tasks/{other.task_id}", headers=HEADERS)
    assert deleted.status_code == 200
    time.sleep(0.3)
    assert get_ai_completion_store().get_for_owner_task(
        running.json()["job_id"],
        owner_id=OWNER_ID,
        task_id=other.task_id,
    ) is None
    assert progress_tracker.get_reporter(running.json()["job_id"]) is None
