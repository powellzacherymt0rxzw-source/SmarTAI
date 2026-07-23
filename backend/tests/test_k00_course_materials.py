"""K00 contracts for the real, owner-scoped course material library."""
from __future__ import annotations

import os

import pytest
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.main import app
from backend.state import get_course_material_store, get_course_store, get_task_store


HEADERS = {"Authorization": "Bearer demo-teacher-k00owner"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-k00other"}


@pytest.fixture(autouse=True)
def reset_k00_state():
    get_course_material_store().clear()
    get_course_store().clear()
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()
    yield
    get_course_material_store().clear()
    get_course_store().clear()
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()


@pytest.fixture
def client():
    return TestClient(app)


def _course(client: TestClient) -> str:
    response = client.post(
        "/courses/",
        headers=HEADERS,
        json={"name": "Calculus I", "code": "MATH101"},
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def _group(client: TestClient, course_id: str | None = None, name: str = "Answer Sets") -> dict:
    response = client.post(
        "/course-materials/groups",
        headers=HEADERS,
        json={"name": name, "course_id": course_id},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _upload(
    client: TestClient,
    *,
    course_id: str | None = None,
    group_id: str | None = None,
    body: bytes = b"1. Worked solution\n2. Another solution",
    filename: str = "calculus-answers.md",
    headers=HEADERS,
):
    data = {
        "category": "answer",
        "labels": '["Midterm", "Chapter 1", "midterm"]',
    }
    if course_id is not None:
        data["course_id"] = course_id
    if group_id is not None:
        data["group_id"] = group_id
    return client.post(
        "/course-materials/",
        headers=headers,
        data=data,
        files={"file": (filename, body, "text/markdown")},
    )


def test_groups_reuse_exact_names_and_require_confirmation_for_related_names(client):
    course_id = _course(client)
    group = _group(client, course_id)
    assert group["created"] is True
    assert group["course_name"] == "Calculus I"

    exact = client.post(
        "/course-materials/groups",
        headers=HEADERS,
        json={"name": "  answer   sets  ", "course_id": course_id},
    )
    assert exact.status_code == 200
    assert exact.json()["created"] is False
    assert exact.json()["group_id"] == group["group_id"]

    related = client.post(
        "/course-materials/groups",
        headers=HEADERS,
        json={"name": "Answer Set", "course_id": course_id},
    )
    assert related.status_code == 409
    assert related.json()["detail"]["code"] == "similar_items"

    forced = client.post(
        "/course-materials/groups",
        headers=HEADERS,
        json={"name": "Answer Set", "course_id": course_id, "force_create": True},
    )
    assert forced.status_code == 200
    assert forced.json()["created"] is True

    hidden = client.get("/course-materials/groups", headers=OTHER_HEADERS)
    assert hidden.status_code == 200
    assert hidden.json()["items"] == []


def test_upload_deduplicates_content_and_supports_metadata_search_and_edit(client):
    course_id = _course(client)
    group = _group(client, course_id)
    response = _upload(client, course_id=course_id, group_id=group["group_id"])
    assert response.status_code == 200, response.text
    material = response.json()
    assert material["created"] is True
    assert material["parse_status"] == "ready"
    assert material["group_name"] == "Answer Sets"
    assert material["course_name"] == "Calculus I"
    assert material["labels"] == ["Midterm", "Chapter 1"]
    assert "text" not in material and "owner_id" not in material

    duplicate = _upload(client, course_id=course_id, group_id=group["group_id"])
    assert duplicate.status_code == 200
    assert duplicate.json()["created"] is False
    assert duplicate.json()["material_id"] == material["material_id"]

    search = client.get(
        "/course-materials/",
        headers=HEADERS,
        params={"q": "Midterm"},
    )
    assert search.status_code == 200
    assert search.json()["total"] == 1
    assert search.json()["items"][0]["match_kind"] in {"exact", "related"}
    assert search.json()["storage"] == "memory"
    assert search.json()["capabilities"]["durable"] is False
    assert search.json()["capabilities"]["ocr"] is False

    edited = client.put(
        f"/course-materials/{material['material_id']}",
        headers=HEADERS,
        json={
            "filename": "Week 1 solutions.md",
            "group_id": None,
            "category": "rubric",
            "labels": ["Week 1"],
        },
    )
    assert edited.status_code == 200, edited.text
    assert edited.json()["filename"] == "Week 1 solutions.md"
    assert edited.json()["group_id"] is None
    assert edited.json()["category"] == "rubric"

    ungrouped = client.get(
        "/course-materials/",
        headers=HEADERS,
        params={"group_id": "ungrouped", "category": "rubric"},
    )
    assert [item["material_id"] for item in ungrouped.json()["items"]] == [
        material["material_id"],
    ]


def test_upload_inherits_group_course_and_rejects_unsupported_types(client):
    course_id = _course(client)
    group = _group(client, course_id)
    inherited = _upload(client, group_id=group["group_id"])
    assert inherited.status_code == 200
    assert inherited.json()["course_id"] == course_id

    unsupported = _upload(client, filename="answers.docx", body=b"not a docx")
    assert unsupported.status_code == 400
    assert "PDF, TXT, MD" in unsupported.json()["detail"]


def test_referenced_material_requires_confirmation_and_task_delete_detaches_reference(client):
    uploaded = _upload(client)
    assert uploaded.status_code == 200
    material_id = uploaded.json()["material_id"]
    task = client.post("/tasks/", headers=HEADERS, json={"name": "Uses library"})
    assert task.status_code == 200
    task_id = task.json()["task_id"]

    preflight = client.post(
        f"/tasks/{task_id}/problem-sources/preflight",
        headers=HEADERS,
        data={"library_material_id": material_id, "structure_mode": "organized"},
    )
    assert preflight.status_code == 200, preflight.text

    listing = client.get("/course-materials/", headers=HEADERS).json()
    assert listing["items"][0]["task_reference_count"] == 1
    blocked = client.delete(f"/course-materials/{material_id}", headers=HEADERS)
    assert blocked.status_code == 409
    assert blocked.json()["detail"]["code"] == "course_material_is_referenced"

    deleted_task = client.delete(f"/tasks/{task_id}", headers=HEADERS)
    assert deleted_task.status_code == 200
    detached = client.get("/course-materials/", headers=HEADERS).json()
    assert detached["items"][0]["task_reference_count"] == 0
    deleted = client.delete(f"/course-materials/{material_id}", headers=HEADERS)
    assert deleted.status_code == 200


def test_group_delete_moves_files_to_ungrouped_without_deleting_content(client):
    group = _group(client)
    uploaded = _upload(client, group_id=group["group_id"])
    assert uploaded.status_code == 200
    material_id = uploaded.json()["material_id"]

    response = client.delete(
        f"/course-materials/groups/{group['group_id']}",
        headers=HEADERS,
    )
    assert response.status_code == 200
    assert response.json()["moved_to_ungrouped"] == 1
    listing = client.get(
        "/course-materials/",
        headers=HEADERS,
        params={"group_id": "ungrouped"},
    ).json()
    assert [item["material_id"] for item in listing["items"]] == [material_id]


def test_cross_owner_material_ids_are_non_disclosing(client):
    material_id = _upload(client).json()["material_id"]
    update = client.put(
        f"/course-materials/{material_id}",
        headers=OTHER_HEADERS,
        json={"filename": "stolen.md"},
    )
    delete = client.delete(
        f"/course-materials/{material_id}",
        headers=OTHER_HEADERS,
    )
    assert update.status_code == 404
    assert delete.status_code == 404
