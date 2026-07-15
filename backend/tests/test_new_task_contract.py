"""Focused contracts for the Figma 03 New Task backend slice."""
from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.main import app
from backend.state import get_course_store, get_tag_store, get_task_store


HEADERS = {"Authorization": "Bearer demo-teacher-newtaskowner"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-newtaskother"}
OWNER_ID = "demo_newtaskowner"


@pytest.fixture(autouse=True)
def reset_catalog_state():
    get_course_store().clear()
    get_tag_store().clear()
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()
    yield
    get_course_store().clear()
    get_tag_store().clear()
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()


@pytest.fixture
def client():
    return TestClient(app)


def test_course_search_is_owner_scoped_and_classifies_name_or_code(client):
    own = client.post("/courses/", headers=HEADERS, json={
        "name": "Linear Algebra", "code": "MATH 201",
    }).json()
    own.pop("created")
    client.post("/courses/", headers=OTHER_HEADERS, json={
        "name": "Linear Algebra", "code": "PRIVATE 201",
    })

    exact = client.get(
        "/courses/search", headers=HEADERS,
        params={"q": "  math   201  ", "page": 1, "page_size": 10},
    )
    assert exact.status_code == 200, exact.text
    assert exact.json()["total"] == 1
    assert exact.json()["items"][0] == {
        "item": own,
        "match_kind": "exact",
        "score": 1.0,
        "reason": "code_exact",
    }

    related = client.get(
        "/courses/search", headers=HEADERS,
        params={"q": "Linear Alg", "page": 1, "page_size": 1},
    ).json()
    assert related["total"] == 1
    assert related["page"] == 1
    assert related["page_size"] == 1
    assert related["items"][0]["match_kind"] == "related"
    assert related["items"][0]["item"]["teacher_id"] == OWNER_ID


def test_course_exact_reuses_and_related_requires_force(client):
    first = client.post("/courses/", headers=HEADERS, json={
        "name": "  Calculus   I ", "code": "MATH101",
    })
    duplicate = client.post("/courses/", headers=HEADERS, json={
        "name": "ＣＡＬＣＵＬＵＳ I", "code": "other",
    })
    assert first.status_code == duplicate.status_code == 200
    assert first.json()["created"] is True
    assert duplicate.json()["created"] is False
    assert duplicate.json()["id"] == first.json()["id"]

    similar = client.post("/courses/", headers=HEADERS, json={
        "name": "Calculus II", "code": "MATH102",
    })
    assert similar.status_code == 409
    assert similar.json()["detail"]["code"] == "similar_items"
    assert similar.json()["detail"]["resource"] == "course"
    assert similar.json()["detail"]["candidates"][0]["match_kind"] == "related"

    forced = client.post("/courses/", headers=HEADERS, json={
        "name": "Calculus II", "code": "MATH102", "force_create": True,
    })
    assert forced.status_code == 200, forced.text
    assert forced.json()["created"] is True
    assert forced.json()["id"] != first.json()["id"]


def test_course_creation_is_exact_unique_under_concurrency():
    barrier = threading.Barrier(2)

    def create_once(_: int) -> dict:
        barrier.wait()
        with TestClient(app) as thread_client:
            response = thread_client.post("/courses/", headers=HEADERS, json={
                "name": "Concurrent Systems", "code": "CS 401",
            })
            assert response.status_code == 200, response.text
            return response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create_once, (1, 2)))

    assert len({item["id"] for item in results}) == 1
    assert sorted(item["created"] for item in results) == [False, True]
    assert len([
        course for course in get_course_store().values()
        if course.teacher_id == OWNER_ID
    ]) == 1


def test_tag_search_exact_related_force_and_owner_scope(client):
    first = client.post("/tags/", headers=HEADERS, json={
        "name": "Final Review", "color": "blue",
    })
    assert first.status_code == 200
    client.post("/tags/", headers=OTHER_HEADERS, json={
        "name": "Final Review", "color": "rose",
    })

    exact = client.get(
        "/tags/search", headers=HEADERS,
        params={"q": "ＦＩＮＡＬ   review", "page": 1, "page_size": 10},
    ).json()
    assert exact["total"] == 1
    assert exact["items"][0]["match_kind"] == "exact"
    assert exact["items"][0]["item"]["id"] == first.json()["id"]
    assert exact["items"][0]["item"]["usage_count"] == 0

    duplicate = client.post("/tags/", headers=HEADERS, json={
        "name": " final review ", "color": "amber",
    })
    assert duplicate.status_code == 200
    assert duplicate.json()["created"] is False
    assert duplicate.json()["id"] == first.json()["id"]

    similar = client.post("/tags/", headers=HEADERS, json={
        "name": "Final Reviews", "color": "teal",
    })
    assert similar.status_code == 409
    assert similar.json()["detail"]["resource"] == "tag"
    assert similar.json()["detail"]["candidates"][0]["item"]["id"] == first.json()["id"]

    forced = client.post("/tags/", headers=HEADERS, json={
        "name": "Final Reviews", "color": "teal", "force_create": True,
    })
    assert forced.status_code == 200
    assert forced.json()["created"] is True


def test_tag_creation_is_exact_unique_under_concurrency():
    barrier = threading.Barrier(2)

    def create_once(_: int) -> dict:
        barrier.wait()
        with TestClient(app) as thread_client:
            response = thread_client.post("/tags/", headers=HEADERS, json={
                "name": "  Shared   Label  ", "color": "blue",
            })
            assert response.status_code == 200, response.text
            return response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create_once, (1, 2)))

    assert len({item["id"] for item in results}) == 1
    assert sorted(item["created"] for item in results) == [False, True]
    assert len(get_tag_store().list_for_owner(OWNER_ID)) == 1


def test_task_create_idempotency_is_owner_scoped_and_detects_payload_conflict(client):
    idem_headers = {**HEADERS, "Idempotency-Key": "new-task-click-1"}
    tag_a = client.post("/tags/", headers=HEADERS, json={"name": "Section One"}).json()
    tag_b = client.post("/tags/", headers=HEADERS, json={"name": "Exam Set"}).json()
    payload = {"name": "Weekly Quiz", "tag_ids": [tag_a["id"], tag_b["id"]]}
    first = client.post("/tasks/", headers=idem_headers, json=payload)
    replay = client.post("/tasks/", headers=idem_headers, json={
        **payload, "tag_ids": list(reversed(payload["tag_ids"])),
    })
    assert first.status_code == replay.status_code == 200
    assert replay.json() == first.json()

    conflict = client.post(
        "/tasks/", headers=idem_headers, json={"name": "Different Quiz"},
    )
    assert conflict.status_code == 409
    assert conflict.json()["detail"] == {
        "code": "idempotency_key_reused",
        "task_id": first.json()["task_id"],
    }

    other = client.post(
        "/tasks/",
        headers={**OTHER_HEADERS, "Idempotency-Key": "new-task-click-1"},
        json={"name": "Weekly Quiz"},
    )
    assert other.status_code == 200
    assert other.json()["task_id"] != first.json()["task_id"]

    assert client.post(
        "/tasks/", headers=HEADERS, json={"name": "   "},
    ).status_code == 422


def test_task_create_idempotency_is_atomic_and_legacy_list_stays_dict():
    barrier = threading.Barrier(2)
    headers = {**HEADERS, "Idempotency-Key": "concurrent-double-click"}

    def create_once(_: int) -> dict:
        barrier.wait()
        with TestClient(app) as thread_client:
            response = thread_client.post(
                "/tasks/", headers=headers, json={"name": "Atomic Draft"},
            )
            assert response.status_code == 200, response.text
            return response.json()

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(create_once, (1, 2)))

    assert len({item["task_id"] for item in results}) == 1
    with TestClient(app) as verify_client:
        legacy = verify_client.get("/tasks/", headers=HEADERS)
    assert legacy.status_code == 200
    assert isinstance(legacy.json(), dict)
    assert list(legacy.json()) == [results[0]["task_id"]]
