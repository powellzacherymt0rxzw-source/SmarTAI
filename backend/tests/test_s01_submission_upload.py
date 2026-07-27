from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.models import Task, TaskGradingSetup
from backend.progress.tracker import get_reporter
from backend.state import get_task_store


OWNER_ID = "demo_s01teacher"
HEADERS = {"Authorization": "Bearer demo-teacher-s01teacher"}
PROVIDER_ID = "mock:s01-recognizer"


@pytest.fixture(autouse=True)
def reset_task_state():
    get_task_store()._tasks.clear()
    yield
    get_task_store()._tasks.clear()


@pytest.fixture
def client():
    return TestClient(app)


def _task(*, configured: bool = True, status: str = "problems_ready") -> Task:
    return Task(
        task_id="T_s01",
        name="S01",
        owner_id=OWNER_ID,
        status=status,
        problem_data={
            "q1": {
                "q_id": "q1",
                "number": "1",
                "type": "概念题",
                "stem": "Explain S01",
                "criterion": "10 points",
            }
        },
        grading_setup=(
            TaskGradingSetup(
                selected_provider_ids=[PROVIDER_ID],
                primary_provider_id=PROVIDER_ID,
            )
            if configured
            else None
        ),
    )


def _select_recognition_provider(monkeypatch):
    selected = SimpleNamespace(pick_default=lambda: MagicMock(provider_id=PROVIDER_ID))
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.select",
        lambda _self, provider_ids, *, primary_provider_id: selected,
    )


def _fake_parser(observed: dict):
    async def fake_parse(
        files_data,
        problems_data,
        student_store,
        provider,
        reporter=None,
        *,
        identity_mode="filename",
        roster_entries=None,
    ):
        observed.update({
            "files": files_data,
            "identity_mode": identity_mode,
            "roster_entries": roster_entries,
            "provider_id": provider.provider_id,
        })
        student_store["PB20111600"] = {
            "stu_id": "PB20111600",
            "stu_name": "Kate",
            "stu_ans": [],
            "source_filename": files_data[0]["filename"],
            "identity_match_method": identity_mode,
            "identity_status": "matched" if identity_mode != "manual_review" else "needs_review",
        }
        if reporter:
            await reporter.set_phase("done")
        return student_store

    return fake_parse


def test_submission_upload_uses_owner_default_independent_of_saved_grading_setup(client, monkeypatch):
    task = _task(configured=True)
    task.grading_setup = TaskGradingSetup(
        selected_provider_ids=["mock:stale-grader"],
        primary_provider_id="mock:stale-grader",
    )
    get_task_store().create(task)
    provider = MagicMock(provider_id=PROVIDER_ID)
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda _self: provider,
    )
    monkeypatch.setattr("backend.api.tasks.parse_student_answers", _fake_parser({}))
    response = client.post(
        "/tasks/T_s01/parse_submissions",
        headers=HEADERS,
        files={"file": ("PB20111600_Kate.txt", b"answer", "text/plain")},
    )

    assert response.status_code == 200, response.text
    assert response.json()["recognition_provider_id"] == PROVIDER_ID


@pytest.mark.asyncio
async def test_roster_mode_is_forwarded_and_saved_without_credentials(client, monkeypatch):
    get_task_store().create(_task())
    _select_recognition_provider(monkeypatch)
    observed: dict = {}
    monkeypatch.setattr("backend.api.tasks.parse_student_answers", _fake_parser(observed))

    response = client.post(
        "/tasks/T_s01/parse_submissions",
        headers=HEADERS,
        data={
            "identity_mode": "roster",
            "recognition_provider_id": PROVIDER_ID,
        },
        files=[
            ("file", ("PB20111600_Kate.txt", b"answer", "text/plain")),
            ("roster_file", ("roster.csv", "学号,姓名\nPB20111600,Kate\n".encode(), "text/csv")),
        ],
    )
    assert response.status_code == 200, response.text
    assert response.json()["identity_mode"] == "roster"
    await asyncio.sleep(0.1)

    stored = get_task_store().get("T_s01")
    assert stored is not None
    assert stored.status == "submissions_ready"
    assert stored.submission_identity_mode == "roster"
    assert stored.submission_roster_name == "roster.csv"
    assert stored.submission_recognition_provider_id == PROVIDER_ID
    assert stored.student_data["PB20111600"]["identity_status"] == "matched"
    assert observed["roster_entries"] == [{"stu_id": "PB20111600", "stu_name": "Kate"}]
    assert observed["provider_id"] == PROVIDER_ID
    assert "api_key" not in response.text
    reporter = get_reporter(response.json()["job_id"])
    assert reporter is not None
    progress = await reporter.snapshot()
    assert progress.phase == "done"
    assert progress.current_step == "completed"


@pytest.mark.asyncio
async def test_same_request_is_idempotent_and_changed_identity_requires_confirmation(client, monkeypatch):
    get_task_store().create(_task())
    _select_recognition_provider(monkeypatch)
    observed: dict = {}
    monkeypatch.setattr("backend.api.tasks.parse_student_answers", _fake_parser(observed))
    upload = {"file": ("PB20111600_Kate.txt", b"answer", "text/plain")}

    first = client.post(
        "/tasks/T_s01/parse_submissions",
        headers=HEADERS,
        data={"identity_mode": "filename", "recognition_provider_id": PROVIDER_ID},
        files=upload,
    )
    assert first.status_code == 200
    await asyncio.sleep(0.1)

    same = client.post(
        "/tasks/T_s01/parse_submissions",
        headers=HEADERS,
        data={"identity_mode": "filename", "recognition_provider_id": PROVIDER_ID},
        files=upload,
    )
    assert same.status_code == 200
    assert same.json()["status"] == "already_done"

    changed = client.post(
        "/tasks/T_s01/parse_submissions",
        headers=HEADERS,
        data={"identity_mode": "manual_review", "recognition_provider_id": PROVIDER_ID},
        files=upload,
    )
    assert changed.status_code == 409
    assert changed.json()["detail"]["code"] == "replacement_confirmation_required"

    confirmed = client.post(
        "/tasks/T_s01/parse_submissions",
        headers=HEADERS,
        data={
            "identity_mode": "manual_review",
            "recognition_provider_id": PROVIDER_ID,
            "replace_confirmed": "true",
        },
        files=upload,
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "started"
    await asyncio.sleep(0.1)
    assert get_task_store().get("T_s01").submission_identity_mode == "manual_review"


def test_roster_mode_rejects_missing_or_invalid_roster(client, monkeypatch):
    get_task_store().create(_task())
    _select_recognition_provider(monkeypatch)
    upload = ("PB20111600_Kate.txt", b"answer", "text/plain")

    missing = client.post(
        "/tasks/T_s01/parse_submissions",
        headers=HEADERS,
        data={"identity_mode": "roster", "recognition_provider_id": PROVIDER_ID},
        files={"file": upload},
    )
    assert missing.status_code == 422
    assert missing.json()["detail"]["code"] == "submission_roster_required"

    invalid = client.post(
        "/tasks/T_s01/parse_submissions",
        headers=HEADERS,
        data={"identity_mode": "roster", "recognition_provider_id": PROVIDER_ID},
        files=[
            ("file", upload),
            ("roster_file", ("roster.csv", b"email\na@example.com\n", "text/csv")),
        ],
    )
    assert invalid.status_code == 400
    assert invalid.json()["detail"]["code"] == "submission_roster_headers_invalid"
