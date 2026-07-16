"""Q-01 problem-source contracts: preflight, library reuse, and extraction."""
from __future__ import annotations

import asyncio
import os
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.api.tasks import _problem_source_fingerprint
from backend.main import app
from backend.state import (
    get_course_material_store,
    get_course_store,
    get_job_store,
    get_problem_source_draft_store,
    get_task_store,
)


HEADERS = {"Authorization": "Bearer demo-teacher-q01owner"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-q01other"}


@pytest.fixture(autouse=True)
def reset_q01_state():
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()
    get_course_store().clear()
    get_course_material_store().clear()
    get_problem_source_draft_store().clear()
    get_job_store()._active.clear()
    get_job_store()._history.clear()
    yield
    get_task_store()._tasks.clear()
    get_course_store().clear()
    get_course_material_store().clear()
    get_problem_source_draft_store().clear()


@pytest.fixture
def client():
    return TestClient(app)


def _create_task(client: TestClient, *, headers=HEADERS, course_id: str | None = None) -> str:
    payload = {"name": "Q-01 contract"}
    if course_id is not None:
        payload["course_id"] = course_id
    response = client.post("/tasks/", headers=headers, json=payload)
    assert response.status_code == 200, response.text
    return response.json()["task_id"]


def _preflight(
    client: TestClient,
    task_id: str,
    *,
    body: bytes = b"1. First question\n2. Second question",
    filename: str = "problems.txt",
    mode: str = "organized",
    hint: str = "",
    save_to_library: bool = False,
    headers=HEADERS,
):
    return client.post(
        f"/tasks/{task_id}/problem-sources/preflight",
        headers=headers,
        data={
            "structure_mode": mode,
            "extraction_hint": hint,
            "save_to_library": str(save_to_library).lower(),
        },
        files={"file": (filename, body, "text/plain")},
    )


def test_original_source_hint_is_optional_but_confirmation_is_explicit(client, monkeypatch):
    task_id = _create_task(client)
    preflight = _preflight(
        client,
        task_id,
        mode="extract_from_source",
        hint="",
    )
    assert preflight.status_code == 200, preflight.text
    prepared = preflight.json()
    assert prepared["requires_confirmation"] is True
    assert len(prepared["candidate_summary"]["possible_matches"]) == 2
    assert prepared["candidate_summary"]["semantic_match_performed"] is False

    missing_confirmation = client.post(
        f"/tasks/{task_id}/extract_problems",
        headers=HEADERS,
        data={"source_token": prepared["source_token"]},
    )
    assert missing_confirmation.status_code == 409
    assert missing_confirmation.json()["detail"]["code"] == "candidate_confirmation_required"

    observed: dict = {}

    async def fake_extract(text, provider, store, reporter=None, **kwargs):
        observed.update(kwargs)
        store["q1"] = {"q_id": "q1", "number": "1", "stem": "ok", "criterion": ""}
        return store

    monkeypatch.setattr("backend.api.tasks.extract_problems", fake_extract)
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock"),
    )
    started = client.post(
        f"/tasks/{task_id}/extract_problems",
        headers=HEADERS,
        data={
            "source_token": prepared["source_token"],
            # An explicitly submitted empty list means "use no local candidate".
            "confirmed_candidate_ids": "[]",
        },
    )
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "started"
    asyncio.run(asyncio.sleep(0.1))
    assert observed["structure_mode"] == "extract_from_source"
    assert observed["extraction_hint"] == ""
    assert observed["confirmed_candidates"] == []


def test_candidate_confirmation_rejects_unknown_ids(client):
    task_id = _create_task(client)
    prepared = _preflight(client, task_id, mode="extract_from_source").json()
    response = client.post(
        f"/tasks/{task_id}/extract_problems",
        headers=HEADERS,
        data={
            "source_token": prepared["source_token"],
            "confirmed_candidate_ids": '["candidate_404"]',
        },
    )
    assert response.status_code == 422
    assert response.json()["detail"] == {
        "code": "unknown_candidate_ids",
        "candidate_ids": ["candidate_404"],
    }


def test_organized_mode_always_selects_all_detected_headings(client, monkeypatch):
    task_id = _create_task(client)
    prepared = _preflight(client, task_id, mode="organized").json()
    detected = prepared["candidate_summary"]["matched"]
    observed: dict = {}

    async def fake_extract(text, provider, store, reporter=None, **kwargs):
        observed.update(kwargs)
        store["q1"] = {"q_id": "q1", "number": "1", "stem": "ok", "criterion": ""}
        return store

    monkeypatch.setattr("backend.api.tasks.extract_problems", fake_extract)
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock"),
    )
    started = client.post(
        f"/tasks/{task_id}/extract_problems",
        headers=HEADERS,
        data={
            "source_token": prepared["source_token"],
            # Generic clients may send this; organized mode must ignore it.
            "confirmed_candidate_ids": "[]",
        },
    )
    assert started.status_code == 200, started.text
    asyncio.run(asyncio.sleep(0.1))
    assert [item["candidate_id"] for item in observed["confirmed_candidates"]] == [
        item["candidate_id"] for item in detected
    ]


def test_upload_validation_is_strict_and_scanned_pdf_is_not_claimed(client, monkeypatch):
    task_id = _create_task(client)
    unsupported = _preflight(client, task_id, filename="questions.docx")
    assert unsupported.status_code == 400
    assert "Allowed: PDF, TXT, MD" in unsupported.json()["detail"]

    empty = _preflight(client, task_id, body=b"")
    assert empty.status_code == 400
    assert empty.json()["detail"] == "Problem source file is empty."

    async def no_extractable_text(_body: bytes) -> str:
        return ""

    monkeypatch.setattr("backend.api.tasks.extract_text_from_pdf", no_extractable_text)
    scanned = _preflight(
        client,
        task_id,
        body=b"%PDF-scanned-placeholder",
        filename="scan.pdf",
    )
    assert scanned.status_code == 400
    assert "OCR" in scanned.json()["detail"]


def test_saved_course_material_is_reusable_and_owner_scoped(client):
    course = client.post(
        "/courses/",
        headers=HEADERS,
        json={"name": "Linear Algebra", "code": "MATH201"},
    )
    assert course.status_code == 200, course.text
    course_id = course.json()["id"]
    task_id = _create_task(client, course_id=course_id)
    prepared = _preflight(client, task_id, save_to_library=True)
    assert prepared.status_code == 200, prepared.text
    material = prepared.json()["saved_material"]
    assert material["created"] is True
    assert "raw_bytes" not in material and "text" not in material and "owner_id" not in material

    listing = client.get(
        f"/tasks/{task_id}/problem-sources/library",
        headers=HEADERS,
        params={"scope": "course"},
    )
    assert listing.status_code == 200
    assert [item["material_id"] for item in listing.json()["items"]] == [material["material_id"]]
    assert listing.json()["storage"] == "memory"

    second_task = _create_task(client, course_id=course_id)
    reused = client.post(
        f"/tasks/{second_task}/problem-sources/preflight",
        headers=HEADERS,
        data={
            "library_material_id": material["material_id"],
            "structure_mode": "organized",
        },
    )
    assert reused.status_code == 200, reused.text
    assert reused.json()["source"]["kind"] == "library"

    other_task = _create_task(client, headers=OTHER_HEADERS)
    hidden = client.post(
        f"/tasks/{other_task}/problem-sources/preflight",
        headers=OTHER_HEADERS,
        data={
            "library_material_id": material["material_id"],
            "structure_mode": "organized",
        },
    )
    assert hidden.status_code == 404


def test_source_token_is_owner_and_task_scoped(client):
    first_task = _create_task(client)
    second_task = _create_task(client)
    source_token = _preflight(client, first_task).json()["source_token"]
    wrong_task = client.post(
        f"/tasks/{second_task}/extract_problems",
        headers=HEADERS,
        data={"source_token": source_token},
    )
    assert wrong_task.status_code == 404


def test_fingerprint_includes_mode_hint_and_confirmed_candidates():
    base = {
        "content_sha256": "same-bytes",
        "structure_mode": "organized",
        "extraction_hint": "",
        "confirmed_candidate_ids": ["candidate_1"],
    }
    fingerprints = {
        _problem_source_fingerprint(**base),
        _problem_source_fingerprint(**{**base, "structure_mode": "extract_from_source"}),
        _problem_source_fingerprint(**{**base, "extraction_hint": "Chapter 3"}),
        _problem_source_fingerprint(**{**base, "confirmed_candidate_ids": []}),
    }
    assert len(fingerprints) == 4
    # Order and duplicates do not create a false change.
    assert _problem_source_fingerprint(**{
        **base,
        "confirmed_candidate_ids": ["candidate_1", "candidate_1"],
    }) == _problem_source_fingerprint(**base)


def test_failed_replacement_keeps_previous_successful_questions(client, monkeypatch):
    task_id = _create_task(client)
    task = get_task_store().get(task_id)
    assert task is not None
    task.status = "problems_ready"
    task.problem_data = {
        "q-old": {"q_id": "q-old", "number": "1", "stem": "keep me", "criterion": ""},
    }
    task.problem_file_hash = "old-hash"
    task.problem_file_name = "old.txt"

    async def failing_extract(*args, **kwargs):
        raise RuntimeError("controlled extraction failure")

    monkeypatch.setattr("backend.api.tasks.extract_problems", failing_extract)
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock"),
    )
    started = client.post(
        f"/tasks/{task_id}/extract_problems",
        headers=HEADERS,
        data={"replace_confirmed": "true"},
        files={"file": ("replacement.txt", b"1. replacement", "text/plain")},
    )
    assert started.status_code == 200
    assert started.json()["status"] == "started"
    asyncio.run(asyncio.sleep(0.1))

    retained = client.get(f"/tasks/{task_id}", headers=HEADERS).json()
    assert retained["status"] == "error"
    assert retained["problem_data"]["q-old"]["stem"] == "keep me"
    assert retained["problem_file_name"] == "old.txt"
    assert retained["pending_problem_file_name"] is None
    stored = get_task_store().get(task_id)
    assert stored is not None
    assert stored.problem_file_hash == "old-hash"
    assert stored.pending_problem_file_hash is None


@pytest.mark.asyncio
async def test_legacy_direct_file_upload_still_supported(monkeypatch):
    async def fake_extract(text, provider, store, reporter=None, **kwargs):
        store["q1"] = {"q_id": "q1", "number": "1", "stem": text, "criterion": ""}
        return store

    monkeypatch.setattr("backend.api.tasks.extract_problems", fake_extract)
    monkeypatch.setattr(
        "backend.llm.registry.ExpertRegistryView.pick_default",
        lambda self: MagicMock(provider_id="mock"),
    )
    with TestClient(app) as client:
        task_id = _create_task(client)
        started = client.post(
            f"/tasks/{task_id}/extract_problems",
            headers=HEADERS,
            files={"file": ("legacy.txt", b"legacy question", "text/plain")},
        )
        assert started.status_code == 200, started.text
        assert started.json()["status"] == "started"
        await asyncio.sleep(0.1)
        completed = client.get(f"/tasks/{task_id}", headers=HEADERS).json()
        assert completed["status"] == "problems_ready"
        assert completed["problem_file_name"] == "legacy.txt"
