"""P0 contracts for owner-scoped BYOK and the shared model pool."""
from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.api.analytics import _last_query_at
from backend.config import settings
from backend.llm.registry import (
    ExpertRegistry,
    SharedPoolLimitError,
    _shared_pool_usage,
    get_expert_registry,
)
from backend.main import app
from backend.models import GradingJob, ProviderConfig, Task
from backend.state import get_job_store, get_problem_store, get_task_store


A_HEADERS = {"Authorization": "Bearer demo-teacher-keyowner_a"}
B_HEADERS = {"Authorization": "Bearer demo-teacher-keyowner_b"}
ADMIN_HEADERS = {"Authorization": "Bearer demo-admin-keyowner_admin"}
A_ID = "demo_keyowner_a"
B_ID = "demo_keyowner_b"


def _config(model: str, key: str, *, display_name: str | None = None) -> ProviderConfig:
    return ProviderConfig(
        provider_type="openai",
        api_key=key,
        model=model,
        display_name=display_name,
    )


def _empty_registry() -> ExpertRegistry:
    registry = ExpertRegistry()
    with registry._lock:
        registry._providers.clear()
        registry._configs.clear()
        registry._shared_provider_ids.clear()
        registry._entry_owners.clear()
        registry._public_provider_ids.clear()
    return registry


@pytest.fixture
def isolated_registry():
    previous_shared_pool_enabled = settings.shared_pool_enabled
    settings.shared_pool_enabled = True
    _shared_pool_usage.clear()
    registry = _empty_registry()
    app.dependency_overrides[get_expert_registry] = lambda: registry
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()
    get_job_store()._active.clear()
    get_job_store()._history.clear()
    get_problem_store().clear()
    _last_query_at.clear()
    yield registry
    settings.shared_pool_enabled = previous_shared_pool_enabled
    _shared_pool_usage.clear()
    app.dependency_overrides.clear()
    get_task_store()._tasks.clear()
    get_job_store()._active.clear()
    get_job_store()._history.clear()
    get_problem_store().clear()
    _last_query_at.clear()


@pytest.fixture
def client(isolated_registry):
    return TestClient(app)


def test_same_logical_model_is_stored_per_owner_and_unscoped_view_is_shared_only(
    isolated_registry,
):
    registry = isolated_registry
    provider_id_a = registry.register(
        _config("gpt-owner", "secret-a"), owner_id=A_ID,
    )
    provider_id_b = registry.register(
        _config("gpt-owner", "secret-b"), owner_id=B_ID,
    )
    assert provider_id_a == provider_id_b == "openai:gpt-owner"
    assert registry.for_owner(A_ID).get(provider_id_a).config.api_key == "secret-a"
    assert registry.for_owner(B_ID).get(provider_id_b).config.api_key == "secret-b"
    assert registry.list_available() == []
    assert registry.pick_default() is None

    a_listing = registry.for_owner(A_ID).list_configs()
    b_listing = registry.for_owner(B_ID).list_configs()
    assert a_listing == [{
        "provider_id": "openai:gpt-owner",
        "provider_type": "openai",
        "model": "gpt-owner",
        "base_url": None,
        "enabled": True,
        "display_name": "openai:gpt-owner",
        "max_concurrent": 5,
        "rpm": 0,
        "api_key": "***",
        "scope": "owner",
        "is_shared": False,
        "editable": True,
    }]
    assert b_listing == a_listing
    assert "secret-a" not in repr(a_listing)
    assert "secret-b" not in repr(b_listing)


def test_experts_api_is_authenticated_owner_scoped_and_keys_are_redacted(
    client,
    isolated_registry,
):
    assert client.get("/experts/available").status_code == 401

    a = client.post("/experts/keys", headers=A_HEADERS, json={
        "provider_type": "openai",
        "api_key": "api-key-a",
        "model": "gpt-private",
        "display_name": "A private model",
    })
    b = client.post("/experts/keys", headers=B_HEADERS, json={
        "provider_type": "openai",
        "api_key": "api-key-b",
        "model": "gpt-private",
        "display_name": "B private model",
    })
    assert a.status_code == b.status_code == 200
    assert a.json()["provider_id"] == b.json()["provider_id"] == "openai:gpt-private"
    assert "api-key" not in a.text and "api-key" not in b.text

    list_a = client.get("/experts/available", headers=A_HEADERS)
    list_b = client.get("/experts/available", headers=B_HEADERS)
    assert [item["display_name"] for item in list_a.json()] == ["A private model"]
    assert [item["display_name"] for item in list_b.json()] == ["B private model"]
    assert all(item["api_key"] == "***" for item in list_a.json() + list_b.json())
    assert isolated_registry.for_owner(A_ID).get("openai:gpt-private").config.api_key == "api-key-a"
    assert isolated_registry.for_owner(B_ID).get("openai:gpt-private").config.api_key == "api-key-b"


def test_other_owner_cannot_select_or_delete_and_shared_is_read_only(
    client,
    isolated_registry,
):
    private_id = isolated_registry.register(
        _config("a-only", "a-private"), owner_id=A_ID,
    )
    assert client.post(
        "/experts/select",
        headers=B_HEADERS,
        json={"provider_id": private_id, "enabled": False},
    ).status_code == 404
    assert client.delete(
        f"/experts/{private_id}", headers=B_HEADERS,
    ).status_code == 404
    assert isolated_registry.for_owner(A_ID).get(private_id) is not None

    shared_id = isolated_registry.register(
        _config("shared-model", "shared-secret"), shared=True,
    )
    a_listing = client.get("/experts/available", headers=A_HEADERS).json()
    assert [item["provider_id"] for item in a_listing] == [private_id]

    listed = client.get("/experts/available", headers=B_HEADERS).json()
    shared = next(item for item in listed if item["provider_id"] == shared_id)
    assert shared["is_shared"] is True
    assert shared["scope"] == "shared"
    assert shared["editable"] is False
    selected = client.post(
        "/experts/select",
        headers=B_HEADERS,
        json={"provider_id": shared_id, "enabled": False},
    )
    deleted = client.delete(f"/experts/{shared_id}", headers=B_HEADERS)
    assert selected.status_code == deleted.status_code == 403
    assert selected.json()["detail"]["code"] == "shared_provider_read_only"
    assert deleted.json()["detail"]["code"] == "shared_provider_read_only"
    assert isolated_registry.shared_view().get(shared_id) is not None


def test_owner_provider_shadows_same_shared_model_until_deleted(
    isolated_registry,
):
    registry = isolated_registry
    provider_id = registry.register(
        _config("same-model", "shared-key"), shared=True,
    )
    registry.register(_config("same-model", "owner-key"), owner_id=A_ID)

    a_view = registry.for_owner(A_ID)
    b_view = registry.for_owner(B_ID)
    assert a_view.get(provider_id).config.api_key == "owner-key"
    assert b_view.get(provider_id).config.api_key == "shared-key"
    assert a_view.list_configs()[0]["is_shared"] is False
    assert b_view.list_configs()[0]["is_shared"] is True
    assert len(a_view.list_available()) == 1

    assert registry.set_enabled_for_owner(A_ID, provider_id, False) == "updated"
    assert a_view.list_available() == []  # disabled owner still shadows shared
    assert registry.unregister_for_owner(A_ID, provider_id) == "removed"
    assert a_view.get(provider_id).config.api_key == "shared-key"
    assert a_view.list_configs()[0]["is_shared"] is True


def test_any_owner_byok_hides_the_entire_shared_pool(isolated_registry):
    registry = isolated_registry
    shared_id = registry.register(
        _config("shared-gemini", "shared-key"), shared=True,
    )
    owner_id = registry.register(
        _config("owner-openai", "owner-key"), owner_id=A_ID,
    )

    a_view = registry.for_owner(A_ID)
    b_view = registry.for_owner(B_ID)
    assert [provider.provider_id for provider in a_view.list_available()] == [owner_id]
    assert a_view.pick_default().config.api_key == "owner-key"
    assert [provider.provider_id for provider in b_view.list_available()] == [shared_id]

    assert registry.set_enabled_for_owner(A_ID, owner_id, False) == "updated"
    assert a_view.list_available() == []
    assert all(item["is_shared"] is False for item in a_view.list_configs())


def test_shared_pool_is_kill_switched_single_expert_and_hard_limited(
    isolated_registry,
    monkeypatch,
):
    registry = isolated_registry
    first_id = registry.register(
        _config("shared-first", "shared-key-1"), shared=True,
    )
    registry.register(
        _config("shared-second", "shared-key-2"), shared=True,
    )
    assert [
        provider.provider_id for provider in registry.for_owner(B_ID).list_available()
    ] == [first_id]

    monkeypatch.setattr(settings, "shared_pool_enabled", False)
    assert registry.for_owner(B_ID).list_available() == []
    monkeypatch.setattr(settings, "shared_pool_enabled", True)
    monkeypatch.setattr(settings, "shared_pool_daily_request_limit", 1)
    monkeypatch.setattr(settings, "shared_pool_daily_estimated_token_limit", 100)
    _shared_pool_usage.clear()

    raw_provider = registry.shared_view().get(first_id)

    async def fake_ainvoke(messages):
        return SimpleNamespace(content="ok")

    monkeypatch.setattr(raw_provider, "ainvoke", fake_ainvoke)
    guarded = registry.for_owner(B_ID).get(first_id)
    asyncio.run(guarded.ainvoke([SimpleNamespace(content="first")]))
    with pytest.raises(SharedPoolLimitError):
        asyncio.run(guarded.ainvoke([SimpleNamespace(content="second")]))


def test_q01_formal_extraction_uses_task_owner_provider(
    client,
    isolated_registry,
    monkeypatch,
):
    isolated_registry.register(
        _config("same-q01-model", "owner-a-key"), owner_id=A_ID,
    )
    isolated_registry.register(
        _config("same-q01-model", "owner-b-key"), owner_id=B_ID,
    )
    observed: dict = {}

    async def fake_extract(text, provider, store, reporter=None, **kwargs):
        observed["api_key"] = provider.config.api_key
        store["q1"] = {"q_id": "q1", "number": "1", "stem": "ok", "criterion": ""}
        return store

    monkeypatch.setattr("backend.api.tasks.extract_problems", fake_extract)
    task_id = client.post(
        "/tasks/", headers=A_HEADERS, json={"name": "Owner A Q-01"},
    ).json()["task_id"]
    preflight = client.post(
        f"/tasks/{task_id}/problem-sources/preflight",
        headers=A_HEADERS,
        data={"structure_mode": "organized"},
        files={"file": ("questions.txt", b"1. Question", "text/plain")},
    )
    assert preflight.status_code == 200, preflight.text
    started = client.post(
        f"/tasks/{task_id}/extract_problems",
        headers=A_HEADERS,
        data={"source_token": preflight.json()["source_token"]},
    )
    assert started.status_code == 200, started.text
    assert "owner-a-key" not in started.text and "owner-b-key" not in started.text
    asyncio.run(asyncio.sleep(0.1))
    assert observed["api_key"] == "owner-a-key"


def test_analytics_uses_graded_task_owner_provider(
    client,
    isolated_registry,
    monkeypatch,
):
    isolated_registry.register(
        _config("analytics", "analytics-a"), owner_id=A_ID,
    )
    isolated_registry.register(
        _config("analytics", "analytics-b"), owner_id=B_ID,
    )
    task = Task(
        task_id="T_owner_analytics",
        name="Owner analytics",
        owner_id=A_ID,
        status="graded",
        problem_data={
            "q1": {"q_id": "q1", "number": "1", "type": "concept", "stem": "?", "criterion": ""},
        },
        grading_job_id="job_owner_analytics",
    )
    get_task_store().create(task)
    get_job_store()._history["job_owner_analytics"] = GradingJob(
        job_id="job_owner_analytics",
        job_name="Owner analytics",
        job_type="batch",
        status="completed",
        results={"results": [], "task_id": task.task_id},
    )
    observed: dict = {}

    async def fake_filter(*, provider, **kwargs):
        from backend.agents.analytics_agent import FilterOutput

        observed["api_key"] = provider.config.api_key
        return FilterOutput(student_ids=[], explanation="ok")

    monkeypatch.setattr("backend.agents.analytics_agent.filter_students", fake_filter)
    response = client.post(
        f"/analytics/{task.task_id}/query",
        headers=A_HEADERS,
        json={"question": "show all", "mode": "filter"},
    )
    assert response.status_code == 200, response.text
    assert observed["api_key"] == "analytics-a"

    admin = client.post(
        f"/analytics/{task.task_id}/query",
        headers=ADMIN_HEADERS,
        json={"question": "show all", "mode": "filter"},
    )
    assert admin.status_code == 403
    assert admin.json()["detail"]["code"] == "task_llm_impersonation_forbidden"


def test_legacy_ingest_can_only_see_shared_pool(
    client,
    isolated_registry,
    monkeypatch,
):
    isolated_registry.register(
        _config("private-legacy", "must-not-be-used"), owner_id=A_ID,
    )
    blocked = client.post(
        "/prob_preview/",
        headers=ADMIN_HEADERS,
        files={"file": ("questions.txt", b"1. Question", "text/plain")},
    )
    assert blocked.status_code == 503

    isolated_registry.register(
        _config("shared-legacy", "shared-used"), shared=True,
    )
    observed: dict = {}

    async def fake_extract(text, provider, store, reporter=None, **kwargs):
        observed["api_key"] = provider.config.api_key
        store["q1"] = {"q_id": "q1", "number": "1", "stem": "ok", "criterion": ""}
        return store

    monkeypatch.setattr("backend.api.ingest.extract_problems", fake_extract)
    accepted = client.post(
        "/prob_preview/",
        headers=ADMIN_HEADERS,
        files={"file": ("questions.txt", b"1. Question", "text/plain")},
    )
    assert accepted.status_code == 200, accepted.text
    assert observed["api_key"] == "shared-used"
    assert "shared-used" not in accepted.text and "must-not-be-used" not in accepted.text


def test_expert_quota_validation_and_public_url_redaction(
    client,
    isolated_registry,
    monkeypatch,
):
    invalid_concurrency = client.post(
        "/experts/keys",
        headers=A_HEADERS,
        json={
            "provider_type": "openai",
            "api_key": "key",
            "model": "model",
            "max_concurrent": 0,
        },
    )
    assert invalid_concurrency.status_code == 422

    blocked_ssrf = client.post(
        "/experts/keys",
        headers=A_HEADERS,
        json={
            "provider_type": "openai",
            "api_key": "secret-key",
            "model": "blocked-url",
            "base_url": "https://user:password@127.0.0.1/internal?token=secret",
        },
    )
    assert blocked_ssrf.status_code == 422
    assert blocked_ssrf.json()["detail"]["code"] == "provider_base_url_not_allowed"
    assert "password" not in blocked_ssrf.text and "token=secret" not in blocked_ssrf.text

    first = client.post(
        "/experts/keys",
        headers=A_HEADERS,
        json={
            "provider_type": "openai",
            "api_key": "secret-key",
            "model": "safe-url",
            "base_url": "https://api.openai.com/v1",
        },
    )
    assert first.status_code == 200, first.text
    listing = client.get("/experts/available", headers=A_HEADERS)
    assert listing.status_code == 200
    assert listing.json()[0]["base_url"] == "https://api.openai.com"

    monkeypatch.setattr(isolated_registry, "MAX_PROVIDERS_PER_OWNER", 1)
    quota = client.post(
        "/experts/keys",
        headers=A_HEADERS,
        json={
            "provider_type": "openai",
            "api_key": "another-key",
            "model": "second-model",
        },
    )
    assert quota.status_code == 429
    assert quota.json()["detail"]["code"] == "expert_owner_count_limit"


def test_production_auth_rejects_all_demo_principals(client, monkeypatch):
    monkeypatch.setattr(settings, "require_auth", True)
    for headers in (A_HEADERS, ADMIN_HEADERS):
        response = client.get("/tasks/", headers=headers)
        assert response.status_code == 401
        assert response.json()["detail"] == "Demo tokens are disabled"


def test_legacy_global_routes_are_admin_only(client):
    assert client.get("/ai_grading/all_history").status_code == 401
    assert client.get(
        "/ai_grading/all_history", headers=A_HEADERS,
    ).status_code == 403
    assert client.get(
        "/ai_grading/all_history", headers=ADMIN_HEADERS,
    ).status_code == 200
    assert client.post(
        "/prob_preview/",
        headers=A_HEADERS,
        files={"file": ("q.txt", b"1. Question", "text/plain")},
    ).status_code == 403
    assert client.post(
        "/human_edit/problems",
        headers=A_HEADERS,
        json={},
    ).status_code == 403
    assert client.post(
        "/human_edit/problems",
        headers=ADMIN_HEADERS,
        json={},
    ).status_code == 200


def test_admin_cannot_spend_foreign_owner_byok(client, isolated_registry):
    isolated_registry.register(
        _config("owner-a-paid", "owner-a-secret"), owner_id=A_ID,
    )
    task_id = client.post(
        "/tasks/", headers=A_HEADERS, json={"name": "Owner A paid task"},
    ).json()["task_id"]
    response = client.post(
        f"/tasks/{task_id}/extract_problems",
        headers=ADMIN_HEADERS,
        files={"file": ("q.txt", b"1. Question", "text/plain")},
    )
    assert response.status_code == 403
    assert response.json()["detail"]["code"] == "task_llm_impersonation_forbidden"
