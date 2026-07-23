from __future__ import annotations

import logging

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.models import Task
from backend.state import get_task_store


OWNER_ID = "demo_s05teacher"
HEADERS = {"Authorization": "Bearer demo-teacher-s05teacher"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-s05other"}


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
        task_id="T_s05",
        name="S05",
        owner_id=OWNER_ID,
        status=status,
        problem_data={
            "q-sensitive-1": {
                "q_id": "q-sensitive-1",
                "number": "1",
                "type": "计算题",
                "stem": "Integrate the expression.",
            },
            "q2": {
                "q_id": "q2",
                "number": "2",
                "type": "证明题",
                "stem": "Prove the claim.",
            },
        },
        student_data={
            "PB-SENSITIVE": {
                "stu_id": "PB-SENSITIVE",
                "stu_name": "Sensitive Student",
                "identity_status": "matched",
                "source_filename": "private-submission.pdf",
                "stu_ans": [
                    {
                        "q_id": "q-sensitive-1",
                        "number": "1",
                        "type": "计算题",
                        "content": "old recognized text",
                        "flag": ["low confidence"],
                    }
                ],
            }
        },
    )


def test_answer_correction_uses_revision_cas_and_avoids_pii_log(client, caplog):
    get_task_store().create(_task())

    with caplog.at_level(logging.INFO, logger="backend.api.tasks"):
        response = client.put(
            "/tasks/T_s05/students/PB-SENSITIVE/answers/q-sensitive-1",
            headers=HEADERS,
            json={
                "expected_workflow_revision": 0,
                "content": "teacher corrected text",
                "flag": [],
            },
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["answer"]["content"] == "teacher corrected text"
    assert body["answer"]["flag"] == []
    assert body["workflow_revision"] == 1
    assert get_task_store().get("T_s05").workflow_revision == 1
    assert "PB-SENSITIVE" not in caplog.text
    assert "Sensitive Student" not in caplog.text
    assert "q-sensitive-1" not in caplog.text
    assert "teacher corrected text" not in caplog.text


def test_missing_matrix_cell_can_be_created_only_for_real_question(client):
    get_task_store().create(_task())

    response = client.put(
        "/tasks/T_s05/students/PB-SENSITIVE/answers/q2",
        headers=HEADERS,
        json={
            "expected_workflow_revision": 0,
            "content": "newly restored answer",
            "flag": ["teacher restored from source"],
        },
    )

    assert response.status_code == 200, response.text
    answer = response.json()["answer"]
    assert answer == {
        "q_id": "q2",
        "number": "2",
        "type": "证明题",
        "content": "newly restored answer",
        "flag": ["teacher restored from source"],
    }
    stored_answers = get_task_store().get("T_s05").student_data["PB-SENSITIVE"]["stu_ans"]
    assert [item["q_id"] for item in stored_answers] == ["q-sensitive-1", "q2"]


@pytest.mark.parametrize(
    ("q_id", "revision", "expected_code"),
    [
        ("q-sensitive-1", 9, "task_workflow_changed"),
        ("unknown-question", 0, "answer_question_not_found"),
    ],
)
def test_answer_correction_rejects_stale_or_unknown_without_mutation(
    client,
    q_id,
    revision,
    expected_code,
):
    get_task_store().create(_task())

    response = client.put(
        f"/tasks/T_s05/students/PB-SENSITIVE/answers/{q_id}",
        headers=HEADERS,
        json={"expected_workflow_revision": revision, "content": "must not save"},
    )

    assert response.status_code in {404, 409}
    assert response.json()["detail"]["code"] == expected_code
    stored = get_task_store().get("T_s05")
    assert stored.workflow_revision == 0
    assert stored.student_data["PB-SENSITIVE"]["stu_ans"][0]["content"] == "old recognized text"


def test_answer_correction_is_owner_scoped(client):
    get_task_store().create(_task())
    response = client.put(
        "/tasks/T_s05/students/PB-SENSITIVE/answers/q-sensitive-1",
        headers=OTHER_HEADERS,
        json={"expected_workflow_revision": 0, "content": "must not save"},
    )

    assert response.status_code == 403
    assert get_task_store().get("T_s05").workflow_revision == 0


def test_answer_correction_is_blocked_while_workflow_is_busy(client):
    task = _task(status="grading")
    task.grading_job_id = "J_busy"
    get_task_store().create(task)

    response = client.put(
        "/tasks/T_s05/students/PB-SENSITIVE/answers/q-sensitive-1",
        headers=HEADERS,
        json={"expected_workflow_revision": 0, "content": "must not save"},
    )

    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "task_workflow_busy"
    assert get_task_store().get("T_s05").workflow_revision == 0
