"""Task KB contract: one inline grading-setup API for uploads and library sources."""
from __future__ import annotations

import os

import numpy as np
import pytest
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.llm.registry import ExpertRegistry, get_expert_registry
from backend.main import app
from backend.models import ProviderConfig
from backend.rag.embedder import Embedder
from backend.rag.store import InMemoryTaskRetriever
from backend.state import get_course_material_store, get_course_store, get_task_store
from backend.tools.knowledge import set_retriever


HEADERS = {"Authorization": "Bearer demo-teacher-kbowner"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-kbother"}
OWNER_ID = "demo_kbowner"


class _DeterministicEmbedder(Embedder):
    name = "task-kb-contract"

    async def embed(self, texts):
        return np.ones((len(texts), 4), dtype=np.float32)

    async def score(self, query, vectors, *, chunk_texts=None):
        return np.ones(vectors.shape[0], dtype=np.float32)


@pytest.fixture
def client(monkeypatch):
    registry = ExpertRegistry()
    with registry._lock:
        registry._providers.clear()
        registry._configs.clear()
        registry._shared_provider_ids.clear()
        registry._entry_owners.clear()
        registry._public_provider_ids.clear()
    registry.register(
        ProviderConfig(provider_type="openai", api_key="test-only", model="kb-contract"),
        owner_id=OWNER_ID,
    )
    app.dependency_overrides[get_expert_registry] = lambda: registry
    monkeypatch.setattr("backend.api.tasks.pick_embedder", lambda _registry: _DeterministicEmbedder())
    set_retriever(InMemoryTaskRetriever())
    get_course_material_store().clear()
    get_course_store().clear()
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    get_course_material_store().clear()
    get_course_store().clear()
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()


def _task(client: TestClient) -> dict:
    response = client.post("/tasks/", headers=HEADERS, json={"name": "KB contract"})
    assert response.status_code == 200, response.text
    return response.json()


def _library_material(client: TestClient) -> dict:
    response = client.post(
        "/course-materials/",
        headers=HEADERS,
        data={"category": "lecture", "labels": "[]"},
        files={"file": ("lecture.md", b"Dependency injection lecture context.", "text/markdown")},
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_library_material_attach_is_idempotent_owner_scoped_and_deletable(client):
    task = _task(client)
    material = _library_material(client)
    url = f"/tasks/{task['task_id']}/kb"

    foreign = client.post(
        url,
        headers=OTHER_HEADERS,
        data={"library_material_id": material["material_id"]},
    )
    assert foreign.status_code == 403

    attached = client.post(
        url,
        headers=HEADERS,
        data={
            "library_material_id": material["material_id"],
            "expected_workflow_revision": task["workflow_revision"],
        },
    )
    assert attached.status_code == 200, attached.text
    body = attached.json()
    assert body["status"] == "started"
    assert body["source_kind"] == "library"
    assert body["library_material_id"] == material["material_id"]
    assert body["saved_to_library"] is True

    duplicate = client.post(
        url,
        headers=HEADERS,
        data={"library_material_id": material["material_id"]},
    )
    assert duplicate.status_code == 200
    assert duplicate.json()["status"] == "already_done"
    assert duplicate.json()["doc_id"] == body["doc_id"]

    docs = client.get(url, headers=HEADERS).json()["docs"]
    assert len(docs) == 1
    assert docs[0]["source_kind"] == "library"
    library = client.get("/course-materials/", headers=HEADERS).json()["items"]
    assert library[0]["task_reference_count"] == 1

    stale = client.delete(
        f"{url}/{body['doc_id']}",
        headers=HEADERS,
        params={"expected_workflow_revision": task["workflow_revision"]},
    )
    assert stale.status_code == 409
    deleted = client.delete(
        f"{url}/{body['doc_id']}",
        headers=HEADERS,
        params={"expected_workflow_revision": body["workflow_revision"]},
    )
    assert deleted.status_code == 200, deleted.text
    assert client.get(url, headers=HEADERS).json()["docs"] == []
    library = client.get("/course-materials/", headers=HEADERS).json()["items"]
    assert library[0]["task_reference_count"] == 0


def test_upload_can_be_saved_to_library_and_exactly_one_source_is_required(client):
    task = _task(client)
    url = f"/tasks/{task['task_id']}/kb"

    missing = client.post(url, headers=HEADERS)
    assert missing.status_code == 422
    assert missing.json()["detail"]["code"] == "kb_source_required"

    uploaded = client.post(
        url,
        headers=HEADERS,
        data={"save_to_library": "true"},
        files={"file": ("context.txt", b"A short grading context.", "text/plain")},
    )
    assert uploaded.status_code == 200, uploaded.text
    body = uploaded.json()
    assert body["source_kind"] == "upload"
    assert body["saved_to_library"] is True
    assert body["saved_material_id"]
    materials = client.get("/course-materials/", headers=HEADERS).json()["items"]
    assert [item["material_id"] for item in materials] == [body["saved_material_id"]]
