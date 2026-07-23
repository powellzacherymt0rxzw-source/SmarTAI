"""A-07 deterministic, version-bound result artifact contracts."""
from __future__ import annotations

import io
import os
import zipfile

import pytest
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.main import app
from backend.models import GradingJob, Task
from backend.state import get_job_store, get_task_store


HEADERS = {"Authorization": "Bearer demo-teacher-a07owner"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-a07other"}
OWNER_ID = "demo_a07owner"


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


def _payload(teacher_score: float = 8.0):
    problem_data = {
        "q1": {
            "q_id": "q1",
            "number": "1",
            "type": "calculation",
            "stem": "Integrate x.",
            "criterion": "10 points",
            "reference_answer": "x^2 / 2 + C",
        },
        "q2": {
            "q_id": "q2",
            "number": "2",
            "type": "concept",
            "stem": "Define continuity.",
            "criterion": "5 points",
            "reference_answer": "epsilon-delta definition",
        },
    }
    student_data = {
        "s1": {"stu_id": "s1", "stu_name": "Alice", "stu_ans": []},
    }
    return {
        "task_id": "T_a07",
        "results": [{
            "student_id": "s1",
            "student_name": "Alice",
            "corrections": [
                {
                    "q_id": "q1", "type": "calculation", "score": 6.0,
                    "teacher_score": teacher_score, "max_score": 10.0,
                    "confidence": 0.55, "comment": "AI original",
                    "teacher_comment": "Teacher final", "steps": [],
                    "requires_human_review": True,
                    "review_reasons": ["low_confidence"], "review_status": "confirmed",
                },
                {
                    "q_id": "q2", "type": "concept", "score": 4.0,
                    "max_score": 5.0, "confidence": 0.92,
                    "comment": "AI original Q2", "steps": [],
                    "requires_human_review": False, "review_reasons": [],
                    "review_status": "pending",
                },
            ],
        }],
        "problem_data": problem_data,
        "student_data": student_data,
    }


def _seed() -> tuple[Task, GradingJob]:
    payload = _payload()
    task = Task(
        task_id="T_a07",
        name="A07 result fixture",
        owner_id=OWNER_ID,
        status="review_confirmed",
        workflow_revision=9,
        grading_job_id="job_a07",
        problem_data=payload["problem_data"],
        student_data=payload["student_data"],
        final_result_version=1,
        final_result_fingerprint="fingerprint-v1",
        final_result_updated_at=1000.0,
    )
    job = GradingJob(
        job_id="job_a07",
        job_type="batch",
        status="completed",
        results=payload,
        final_result_versions=[{
            "version": 1,
            "created_at": 1000.0,
            "created_by": OWNER_ID,
            "workflow_revision": 9,
            "fingerprint": "fingerprint-v1",
            "payload": payload,
        }],
    )
    get_task_store().create(task)
    get_job_store()._history[job.job_id] = job
    return task, job


def test_generate_is_idempotent_and_exposes_real_downloads(client: TestClient):
    task, job = _seed()

    before = client.get("/tasks/T_a07/artifacts", headers=HEADERS)
    assert before.status_code == 200, before.text
    assert before.json()["versions"][0]["status"] == "not_generated"
    assert before.json()["versions"][0]["files"] == []

    generated = client.post(
        "/tasks/T_a07/artifacts/generate",
        headers=HEADERS,
        json={"expected_workflow_revision": 9},
    )
    assert generated.status_code == 200, generated.text
    body = generated.json()
    assert body["status"] == "ok"
    assert body["unchanged"] is False
    assert body["task_status"] == "finalized"
    assert body["analysis_status"] == "ready"
    assert body["analysis_result_version"] == 1
    assert len(body["artifacts"]["versions"][0]["files"]) == 5
    assert task.workflow_revision == 10
    assert "1" in job.result_artifacts

    retry = client.post(
        "/tasks/T_a07/artifacts/generate",
        headers=HEADERS,
        json={"expected_workflow_revision": 9},
    )
    assert retry.status_code == 200, retry.text
    assert retry.json()["status"] == "already_done"
    assert retry.json()["unchanged"] is True
    assert task.workflow_revision == 10

    csv_response = client.get("/tasks/T_a07/artifacts/1/grades_csv", headers=HEADERS)
    assert csv_response.status_code == 200, csv_response.text
    csv_text = csv_response.content.decode("utf-8-sig")
    assert "student_id,student_name,total_score,total_max" in csv_text
    assert "s1,Alice,12,15,80" in csv_text
    assert ",8,10,80,4,5,80" in csv_text
    assert csv_response.headers["x-smartai-result-version"] == "1"

    bundle_response = client.get("/tasks/T_a07/artifacts/1/bundle", headers=HEADERS)
    assert bundle_response.status_code == 200, bundle_response.text
    with zipfile.ZipFile(io.BytesIO(bundle_response.content)) as archive:
        names = archive.namelist()
        assert "manifest.json" in names
        assert len(names) == 6
        report_name = next(name for name in names if name.endswith("_learning_report.md"))
        report = archive.read(report_name).decode("utf-8")
        assert "确定性汇总" in report
        assert "80.0%" in report


def test_owner_isolation_and_missing_artifact_version_do_not_fallback(client: TestClient):
    _seed()
    assert client.get("/tasks/T_a07/artifacts", headers=OTHER_HEADERS).status_code == 403
    assert client.post(
        "/tasks/T_a07/artifacts/generate",
        headers=OTHER_HEADERS,
        json={"expected_workflow_revision": 9},
    ).status_code == 403
    missing = client.get("/tasks/T_a07/artifacts/1/grades_csv", headers=HEADERS)
    assert missing.status_code == 409
    assert missing.json()["detail"]["code"] == "artifact_version_not_generated"


def test_old_artifacts_remain_explicit_after_a_new_formal_version(client: TestClient):
    task, job = _seed()
    assert client.post(
        "/tasks/T_a07/artifacts/generate",
        headers=HEADERS,
        json={"expected_workflow_revision": 9},
    ).status_code == 200

    payload_v2 = _payload(teacher_score=9.0)
    job.final_result_versions.append({
        "version": 2,
        "created_at": 2000.0,
        "created_by": OWNER_ID,
        "workflow_revision": 12,
        "fingerprint": "fingerprint-v2",
        "payload": payload_v2,
    })
    task.final_result_version = 2
    task.final_result_fingerprint = "fingerprint-v2"
    task.final_result_updated_at = 2000.0
    task.status = "review_confirmed"
    task.workflow_revision = 12
    task.analysis_status = "stale"
    task.analysis_result_version = 1

    index = client.get("/tasks/T_a07/artifacts", headers=HEADERS)
    assert index.status_code == 200, index.text
    versions = index.json()["versions"]
    assert [(item["version"], item["status"]) for item in versions] == [
        (2, "not_generated"),
        (1, "historical"),
    ]
    assert versions[0]["files"] == []
    assert len(versions[1]["files"]) == 5

    current_missing = client.get("/tasks/T_a07/artifacts/2/bundle", headers=HEADERS)
    assert current_missing.status_code == 409
    old_explicit = client.get("/tasks/T_a07/artifacts/1/bundle", headers=HEADERS)
    assert old_explicit.status_code == 200
    assert old_explicit.headers["x-smartai-result-version"] == "1"
