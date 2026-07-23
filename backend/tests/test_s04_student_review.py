from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.models import Task
from backend.state import get_task_store


OWNER_ID = "demo_s04teacher"
HEADERS = {"Authorization": "Bearer demo-teacher-s04teacher"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-s04other"}


@pytest.fixture(autouse=True)
def reset_task_state():
    get_task_store()._tasks.clear()
    yield
    get_task_store()._tasks.clear()


@pytest.fixture
def client():
    return TestClient(app)


def _task(*, status: str = "submissions_ready") -> Task:
    return Task(
        task_id="T_s04",
        name="S04",
        owner_id=OWNER_ID,
        status=status,
        problem_data={
            "q1": {"q_id": "q1", "number": "1", "type": "概念题", "stem": "Explain"},
        },
        student_data={
            "candidate-1": {
                "stu_id": "candidate-1",
                "stu_name": "[Unknown Student]",
                "identity_status": "needs_review",
                "identity_match_method": "manual_review",
                "source_filename": "submission-1.txt",
                "stu_ans": [{
                    "q_id": "q1",
                    "number": "1",
                    "type": "概念题",
                    "content": "answer",
                    "flag": ["identity unresolved"],
                }],
            },
            "PB002": {
                "stu_id": "PB002",
                "stu_name": "Existing",
                "identity_status": "matched",
                "identity_match_method": "roster",
                "stu_ans": [],
            },
        },
    )


def test_identity_correction_moves_key_preserves_answers_and_avoids_pii_log(client, caplog):
    task = _task()
    get_task_store().create(task)

    with caplog.at_level(logging.INFO, logger="backend.api.tasks"):
        response = client.put(
            "/tasks/T_s04/students/candidate-1/identity",
            headers=HEADERS,
            json={
                "expected_workflow_revision": 0,
                "student_id": " PB001 ",
                "student_name": " Kate   Wang ",
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["previous_student_id"] == "candidate-1"
    assert body["student"]["stu_id"] == "PB001"
    assert body["student"]["stu_name"] == "Kate Wang"
    assert body["student"]["identity_status"] == "matched"
    assert body["student"]["identity_match_method"] == "manual_review"
    assert body["student"]["source_filename"] == "submission-1.txt"
    assert body["student"]["stu_ans"][0]["content"] == "answer"
    assert body["workflow_revision"] == 1

    stored = get_task_store().get("T_s04")
    assert stored is not None
    assert "candidate-1" not in stored.student_data
    assert list(stored.student_data) == ["PB001", "PB002"]
    assert stored.workflow_revision == 1
    assert "candidate-1" not in caplog.text
    assert "PB001" not in caplog.text
    assert "Kate Wang" not in caplog.text


@pytest.mark.parametrize(
    ("payload", "expected_code"),
    [
        ({"expected_workflow_revision": 0, "student_id": "PB002", "student_name": "Kate"}, "student_id_conflict"),
        ({"expected_workflow_revision": 0, "student_id": "pb002", "student_name": "Kate"}, "student_id_conflict"),
        ({"expected_workflow_revision": 9, "student_id": "PB001", "student_name": "Kate"}, "task_workflow_changed"),
        ({"expected_workflow_revision": 0, "student_id": "   ", "student_name": "Kate"}, "student_identity_required"),
        ({"expected_workflow_revision": 0, "student_id": "PB001", "student_name": "   "}, "student_identity_required"),
    ],
)
def test_identity_correction_rejects_conflict_stale_or_blank_without_mutation(client, payload, expected_code):
    get_task_store().create(_task())
    response = client.put(
        "/tasks/T_s04/students/candidate-1/identity",
        headers=HEADERS,
        json=payload,
    )

    assert response.status_code in {409, 422}
    assert response.json()["detail"]["code"] == expected_code
    stored = get_task_store().get("T_s04")
    assert stored is not None
    assert list(stored.student_data) == ["candidate-1", "PB002"]
    assert stored.workflow_revision == 0


@pytest.mark.parametrize("status", ["draft", "problems_ready", "graded"])
def test_identity_correction_is_only_available_before_grading(client, status):
    get_task_store().create(_task(status=status))
    response = client.put(
        "/tasks/T_s04/students/candidate-1/identity",
        headers=HEADERS,
        json={"expected_workflow_revision": 0, "student_id": "PB001", "student_name": "Kate"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "student_identity_edit_unavailable"


def test_identity_correction_is_owner_scoped(client):
    get_task_store().create(_task())
    response = client.put(
        "/tasks/T_s04/students/candidate-1/identity",
        headers=OTHER_HEADERS,
        json={"expected_workflow_revision": 0, "student_id": "PB001", "student_name": "Kate"},
    )

    assert response.status_code == 403
    assert get_task_store().get("T_s04").workflow_revision == 0


def test_identity_correction_is_blocked_while_task_workflow_is_busy(client):
    task = _task(status="grading")
    task.grading_job_id = "J_busy"
    get_task_store().create(task)
    response = client.put(
        "/tasks/T_s04/students/candidate-1/identity",
        headers=HEADERS,
        json={"expected_workflow_revision": 0, "student_id": "PB001", "student_name": "Kate"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "task_workflow_busy"
