"""R02 teacher review overlay API contracts."""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.main import app
from backend.models import GradingJob, Task
from backend.state import get_job_store, get_task_store


HEADERS = {"Authorization": "Bearer demo-teacher-r02owner"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-r02other"}
OWNER_ID = "demo_r02owner"


@pytest.fixture(autouse=True)
def isolated_stores():
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()
    get_job_store()._active.clear()
    get_job_store()._history.clear()
    yield
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()
    get_job_store()._active.clear()
    get_job_store()._history.clear()


@pytest.fixture
def client():
    with TestClient(app) as test_client:
        yield test_client


def _seed(task_id: str = "T_r02", *, status: str = "graded", owner_id: str = OWNER_ID):
    job_id = f"job_{task_id}"
    task = Task(
        task_id=task_id,
        name="R02 review fixture",
        owner_id=owner_id,
        status=status,
        workflow_revision=4,
        grading_job_id=job_id if status == "graded" else None,
        problem_data={
            "q1": {
                "q_id": "q1",
                "number": "1",
                "type": "计算题",
                "stem": "Evaluate the integral.",
                "criterion": "Ten points for correct method and result.",
            },
        },
        student_data={
            "s1": {
                "stu_id": "s1",
                "stu_name": "Alice",
                "stu_ans": [{
                    "q_id": "q1",
                    "number": "1",
                    "type": "计算题",
                    "content": "Integration by parts gives 1/2.",
                    "flag": [],
                }],
            },
        },
    )
    get_task_store().create(task)
    if status == "graded":
        get_job_store()._history[job_id] = GradingJob(
            job_id=job_id,
            job_name="R02 result",
            job_type="batch",
            status="completed",
            results={
                "task_id": task_id,
                "results": [{
                    "student_id": "s1",
                    "student_name": "Alice",
                    "corrections": [{
                        "q_id": "q1",
                        "type": "计算题",
                        "score": 7.0,
                        "max_score": 10.0,
                        "confidence": 0.62,
                        "comment": "AI original rationale",
                        "steps": [],
                        "expert_results": [],
                        "requires_human_review": True,
                        "review_reasons": ["low_confidence"],
                    }],
                }],
                "problem_data": task.problem_data,
                "student_data": task.student_data,
            },
        )
    return task


def _put(client, task_id="T_r02", **overrides):
    payload = {
        "expected_workflow_revision": 4,
        "teacher_score": 8.5,
        "teacher_comment": "Teacher correction",
        "confirm": False,
        **overrides,
    }
    return client.put(
        f"/tasks/{task_id}/reviews/s1/q1",
        headers=HEADERS,
        json=payload,
    )


def test_review_overlay_preserves_ai_result_and_exact_retry_is_idempotent(client):
    _seed()

    saved = _put(client)
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["unchanged"] is False
    assert body["workflow_revision"] == 5
    assert body["correction"]["score"] == 7.0
    assert body["correction"]["comment"] == "AI original rationale"
    assert body["correction"]["teacher_score"] == 8.5
    assert body["correction"]["teacher_comment"] == "Teacher correction"
    assert body["correction"]["review_status"] == "edited"

    retry = _put(client)
    assert retry.status_code == 200, retry.text
    assert retry.json()["unchanged"] is True
    assert retry.json()["workflow_revision"] == 5

    result = client.get("/tasks/T_r02/result", headers=HEADERS)
    assert result.status_code == 200, result.text
    correction = result.json()["results"][0]["corrections"][0]
    assert correction["score"] == 7.0
    assert correction["teacher_score"] == 8.5


def test_confirmation_timestamp_and_workflow_cas_are_enforced(client):
    _seed()

    stale = _put(client, expected_workflow_revision=3)
    assert stale.status_code == 409, stale.text
    assert stale.json()["detail"]["code"] == "task_workflow_changed"

    confirmed = _put(client, confirm=True)
    assert confirmed.status_code == 200, confirmed.text
    correction = confirmed.json()["correction"]
    assert correction["review_status"] == "confirmed"
    assert isinstance(correction["reviewed_at"], float)

    conflicting = _put(
        client,
        expected_workflow_revision=4,
        teacher_score=9.0,
        teacher_comment="Different",
        confirm=True,
    )
    assert conflicting.status_code == 409, conflicting.text


def test_score_bounds_owner_and_task_state_are_guarded(client):
    _seed()
    out_of_range = _put(client, teacher_score=10.1)
    assert out_of_range.status_code == 422, out_of_range.text
    assert out_of_range.json()["detail"]["code"] == "teacher_score_out_of_range"

    forbidden = client.put(
        "/tasks/T_r02/reviews/s1/q1",
        headers=OTHER_HEADERS,
        json={
            "expected_workflow_revision": 4,
            "teacher_score": 8,
            "teacher_comment": "Must not write",
            "confirm": True,
        },
    )
    assert forbidden.status_code == 403, forbidden.text

    _seed("T_not_graded", status="submissions_ready")
    invalid_state = _put(client, task_id="T_not_graded")
    assert invalid_state.status_code == 409, invalid_state.text
    assert invalid_state.json()["detail"]["code"] == "task_not_graded"

    missing = client.put(
        "/tasks/T_r02/reviews/s1/q404",
        headers=HEADERS,
        json={
            "expected_workflow_revision": 4,
            "teacher_score": 1,
            "teacher_comment": "",
            "confirm": False,
        },
    )
    assert missing.status_code == 404, missing.text
