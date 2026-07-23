"""A-00 formal result lifecycle and immutable version contracts."""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.main import app
from backend.models import GradingJob, Task
from backend.state import get_job_store, get_task_store


HEADERS = {"Authorization": "Bearer demo-teacher-a00owner"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-a00other"}
OWNER_ID = "demo_a00owner"


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


def _seed() -> tuple[Task, GradingJob]:
    task = Task(
        task_id="T_a00",
        name="A00 result fixture",
        owner_id=OWNER_ID,
        status="graded",
        workflow_revision=7,
        grading_job_id="job_a00",
        problem_data={
            "q1": {"q_id": "q1", "number": "1", "type": "calculation", "stem": "Q1", "criterion": "10"},
            "q2": {"q_id": "q2", "number": "2", "type": "concept", "stem": "Q2", "criterion": "5"},
        },
        student_data={
            "s1": {"stu_id": "s1", "stu_name": "Alice", "stu_ans": []},
        },
    )
    job = GradingJob(
        job_id="job_a00",
        job_type="batch",
        status="completed",
        results={
            "task_id": task.task_id,
            "results": [{
                "student_id": "s1",
                "student_name": "Alice",
                "corrections": [
                    {
                        "q_id": "q1",
                        "type": "calculation",
                        "score": 6.0,
                        "max_score": 10.0,
                        "confidence": 0.55,
                        "comment": "AI original",
                        "steps": [],
                        "expert_results": [],
                        "requires_human_review": True,
                        "review_reasons": ["low_confidence"],
                        "review_status": "pending",
                    },
                    {
                        "q_id": "q2",
                        "type": "concept",
                        "score": 4.0,
                        "max_score": 5.0,
                        "confidence": 0.92,
                        "comment": "AI original Q2",
                        "steps": [],
                        "expert_results": [],
                        "requires_human_review": False,
                        "review_reasons": [],
                        "review_status": "pending",
                    },
                ],
            }],
            "problem_data": task.problem_data,
            "student_data": task.student_data,
        },
    )
    get_task_store().create(task)
    get_job_store()._history[job.job_id] = job
    return task, job


def _review(client: TestClient, *, revision: int, score: float, confirm: bool):
    return client.put(
        "/tasks/T_a00/reviews/s1/q1",
        headers=HEADERS,
        json={
            "expected_workflow_revision": revision,
            "teacher_score": score,
            "teacher_comment": "Teacher final",
            "confirm": confirm,
        },
    )


def test_required_review_gate_and_owner_isolation(client: TestClient):
    _seed()

    state = client.get("/tasks/T_a00/finalization", headers=HEADERS)
    assert state.status_code == 200, state.text
    assert state.json()["required_review_count"] == 1
    assert state.json()["remaining_review_count"] == 1
    assert state.json()["ready_for_confirmation"] is False
    assert state.json()["remaining_reviews"][0]["q_id"] == "q1"

    blocked = client.post(
        "/tasks/T_a00/finalization/confirm",
        headers=HEADERS,
        json={"expected_workflow_revision": 7},
    )
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"]["code"] == "required_reviews_remaining"

    forbidden = client.get("/tasks/T_a00/finalization", headers=OTHER_HEADERS)
    assert forbidden.status_code == 403


def test_confirmation_versions_are_immutable_and_retry_idempotent(client: TestClient):
    task, job = _seed()
    reviewed = _review(client, revision=7, score=8.0, confirm=True)
    assert reviewed.status_code == 200, reviewed.text

    confirmed = client.post(
        "/tasks/T_a00/finalization/confirm",
        headers=HEADERS,
        json={"expected_workflow_revision": 8},
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["final_result_version"] == 1
    assert confirmed.json()["task_status"] == "review_confirmed"
    assert confirmed.json()["analysis_status"] == "not_generated"
    assert len(job.final_result_versions) == 1
    snapshot = job.final_result_versions[0]["payload"]["results"][0]["corrections"][0]
    assert snapshot["score"] == 6.0
    assert snapshot["comment"] == "AI original"
    assert snapshot["teacher_score"] == 8.0

    retry = client.post(
        "/tasks/T_a00/finalization/confirm",
        headers=HEADERS,
        json={"expected_workflow_revision": 8},
    )
    assert retry.status_code == 200, retry.text
    assert retry.json()["unchanged"] is True
    assert len(job.final_result_versions) == 1
    assert task.workflow_revision == 9


def test_post_confirmation_edit_marks_artifacts_stale_then_creates_v2(client: TestClient):
    task, job = _seed()
    assert _review(client, revision=7, score=8.0, confirm=True).status_code == 200
    assert client.post(
        "/tasks/T_a00/finalization/confirm",
        headers=HEADERS,
        json={"expected_workflow_revision": 8},
    ).status_code == 200
    get_task_store().update(
        task.task_id,
        analysis_status="ready",
        analysis_result_version=1,
        analysis_generated_at=123.0,
        status="finalized",
    )

    edited = _review(client, revision=9, score=9.0, confirm=False)
    assert edited.status_code == 200, edited.text
    assert task.status == "graded"
    assert task.final_result_dirty is True
    assert task.analysis_status == "stale"
    assert task.final_result_version == 1
    assert len(job.final_result_versions) == 1

    assert _review(client, revision=10, score=9.0, confirm=True).status_code == 200
    v2 = client.post(
        "/tasks/T_a00/finalization/confirm",
        headers=HEADERS,
        json={"expected_workflow_revision": 11},
    )
    assert v2.status_code == 200, v2.text
    assert v2.json()["final_result_version"] == 2
    assert v2.json()["analysis_status"] == "stale"
    assert len(job.final_result_versions) == 2
    assert job.final_result_versions[0]["payload"]["results"][0]["corrections"][0]["teacher_score"] == 8.0
    assert job.final_result_versions[1]["payload"]["results"][0]["corrections"][0]["teacher_score"] == 9.0


def test_problem_sources_are_locked_after_a_grading_result_exists(client: TestClient):
    task, _ = _seed()

    response = client.put(
        "/tasks/T_a00/problems/q1",
        headers=HEADERS,
        json={"criterion": "silently changed rubric"},
    )

    assert response.status_code == 409, response.text
    assert response.json()["detail"]["code"] == "graded_problem_source_locked"
    assert task.problem_data["q1"]["criterion"] == "10"
