"""History metadata, filtering, tags, and NL interpretation contract tests."""
from __future__ import annotations

import asyncio
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.api.tasks import _allowed_semester_ids
from backend.config import settings
from backend.llm.registry import get_expert_registry
from backend.main import app
from backend.models import Course, Tag, Task
from backend.state import (
    TagStore,
    get_course_store,
    get_job_store,
    get_tag_store,
    get_task_store,
)


HEADERS = {"Authorization": "Bearer demo-teacher-historyowner"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-historyother"}
OWNER_ID = "demo_historyowner"
OTHER_ID = "demo_historyother"


class _NoProviderRegistry:
    def for_owner(self, _owner_id):
        return self

    def pick_default(self):
        return None


@pytest.fixture(autouse=True)
def reset_history_state():
    from backend.agents.history_query_agent import _last_llm_at, _llm_daily_usage

    get_task_store()._tasks.clear()
    get_tag_store().clear()
    get_course_store().clear()
    get_job_store()._active.clear()
    get_job_store()._history.clear()
    _last_llm_at.clear()
    _llm_daily_usage.clear()
    app.dependency_overrides[get_expert_registry] = lambda: _NoProviderRegistry()
    yield
    app.dependency_overrides.clear()
    get_task_store()._tasks.clear()
    get_tag_store().clear()
    get_course_store().clear()


@pytest.fixture
def client():
    return TestClient(app)


def test_semester_choices_follow_product_month_boundaries():
    cases = {
        # spring -> one later = summer
        (2026, 5): "2025-2026-summer",
        # summer -> one later = next academic year's autumn
        (2026, 6): "2026-2027-autumn",
        (2026, 7): "2026-2027-autumn",
        # autumn -> winter
        (2026, 8): "2026-2027-winter",
        (2026, 11): "2026-2027-winter",
        # winter -> spring, including year rollover
        (2026, 12): "2026-2027-spring",
        (2027, 1): "2026-2027-spring",
        (2027, 2): "2026-2027-spring",
    }
    for (year, month), expected_last in cases.items():
        choices = _allowed_semester_ids(datetime(year, month, 1))
        assert choices[0] == "2025-2026-autumn"
        assert choices[-1] == expected_last


def test_no_query_keeps_legacy_dictionary_and_owner_scope(client):
    own = client.post("/tasks/", headers=HEADERS, json={"name": "Own"})
    other = client.post("/tasks/", headers=OTHER_HEADERS, json={"name": "Other"})
    assert own.status_code == other.status_code == 200

    body = client.get("/tasks/", headers=HEADERS).json()
    assert isinstance(body, dict)
    assert list(body) == [own.json()["task_id"]]
    lite = next(iter(body.values()))
    assert lite["semester_id"] is None
    assert lite["course_id"] is None
    assert lite["tag_ids"] == []
    assert lite["needs_attention"] is True  # draft awaits the teacher's next action


def test_task_metadata_requires_owner_course_and_tags(client):
    own_course = Course(
        id="c_own", name="Calculus", code="MATH101", teacher_id=OWNER_ID,
    )
    other_course = Course(
        id="c_other", name="Private", code="X", teacher_id=OTHER_ID,
    )
    get_course_store()[own_course.id] = own_course
    get_course_store()[other_course.id] = other_course

    tag = client.post(
        "/tags/", headers=HEADERS, json={"name": "Midterm", "color": "blue"},
    ).json()
    other_tag = client.post(
        "/tags/", headers=OTHER_HEADERS, json={"name": "Secret"},
    ).json()
    assert [item["id"] for item in client.get("/tags/", headers=HEADERS).json()] == [
        tag["id"],
    ]

    created = client.post("/tasks/", headers=HEADERS, json={
        "name": "Quiz",
        "semester_id": "2025-2026-autumn",
        "course_id": own_course.id,
        "tag_ids": [tag["id"], tag["id"]],
    })
    assert created.status_code == 200, created.text
    assert created.json()["semester_id"] == "2025-2026-autumn"
    assert created.json()["course_id"] == own_course.id
    assert created.json()["tag_ids"] == [tag["id"]]

    assert client.post("/tasks/", headers=HEADERS, json={
        "name": "No leak", "course_id": other_course.id,
    }).status_code == 404
    assert client.put(
        f"/tasks/{created.json()['task_id']}",
        headers=HEADERS,
        json={"tag_ids": [other_tag["id"]]},
    ).status_code == 404


def test_tags_normalize_dedupe_report_usage_and_detach_only(client):
    first = client.post("/tags/", headers=HEADERS, json={
        "name": "  Quiz   Review  ", "color": "blue",
    })
    duplicate = client.post("/tags/", headers=HEADERS, json={
        "name": "quiz review", "color": "rose",
    })
    assert first.status_code == duplicate.status_code == 200
    assert first.json()["created"] is True
    assert duplicate.json()["created"] is False
    assert duplicate.json()["id"] == first.json()["id"]
    assert duplicate.json()["color"] == "blue"

    tag_id = first.json()["id"]
    task_ids = []
    for name in ("One", "Two"):
        response = client.post("/tasks/", headers=HEADERS, json={
            "name": name, "tag_ids": [tag_id],
        })
        task_ids.append(response.json()["task_id"])

    listed = client.get("/tags/", headers=HEADERS).json()
    assert listed[0]["usage_count"] == 2
    assert client.put(
        f"/tags/{tag_id}", headers=HEADERS,
        json={"name": "Reviewed", "color": "teal"},
    ).json()["usage_count"] == 2
    assert client.put(
        f"/tags/{tag_id}", headers=HEADERS,
        json={"color": "#ff0000"},
    ).status_code == 422

    deleted = client.delete(f"/tags/{tag_id}", headers=HEADERS)
    assert deleted.json()["affected_tasks"] == 2
    for task_id in task_ids:
        task = client.get(f"/tasks/{task_id}", headers=HEADERS)
        assert task.status_code == 200
        assert task.json()["tag_ids"] == []


def test_tag_store_atomic_rename_preserves_owner_unique_name():
    store = TagStore()
    store.create_or_get(Tag(
        id="tag_a", name="Alpha", normalized_name="alpha", owner_id=OWNER_ID,
    ))
    store.create_or_get(Tag(
        id="tag_b", name="Beta", normalized_name="beta", owner_id=OWNER_ID,
    ))
    barrier = threading.Barrier(2)

    def rename(tag_id: str) -> bool:
        barrier.wait()
        updated, conflict = store.rename_or_conflict(
            tag_id, OWNER_ID, "Shared", "shared",
        )
        assert updated is not None
        return conflict is None

    with ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(rename, ("tag_a", "tag_b")))

    assert outcomes.count(True) == 1
    assert outcomes.count(False) == 1
    assert sum(
        tag.normalized_name == "shared"
        for tag in store.list_for_owner(OWNER_ID)
    ) == 1


def test_paginated_filters_facets_and_default_page_size(client):
    course = Course(
        id="c_math", name="Linear Algebra", code="MATH202", teacher_id=OWNER_ID,
    )
    get_course_store()[course.id] = course
    tag = client.post(
        "/tags/", headers=HEADERS, json={"name": "Exam", "color": "amber"},
    ).json()

    task_store = get_task_store()
    now = time.time()
    task_store.create(Task(
        task_id="T_graded", name="Final", owner_id=OWNER_ID, status="graded",
        semester_id="2025-2026-autumn", course_id=course.id,
        tag_ids=[tag["id"]], created_at=now - 30, updated_at=now - 10,
    ))
    task_store.create(Task(
        task_id="T_error", name="Retry", owner_id=OWNER_ID, status="error",
        semester_id="2025-2026-autumn", course_id=course.id,
        error="provider failed", created_at=now - 20, updated_at=now - 20,
    ))
    task_store.create(Task(
        task_id="T_draft", name="Draft", owner_id=OWNER_ID, status="draft",
        semester_id="2025-2026-winter", created_at=now - 10, updated_at=now - 30,
    ))

    default_page = client.get("/tasks/?page=1", headers=HEADERS)
    assert default_page.status_code == 200
    assert default_page.json()["page_size"] == 25
    assert default_page.json()["total"] == 3
    assert default_page.json()["available_facets"] == default_page.json()["facets"]
    assert default_page.json()["available_facets"]["tags"][0]["usage_count"] == 1

    by_metadata = client.get(
        "/tasks/?semester_id=2025-2026-autumn&course_id=c_math",
        headers=HEADERS,
    ).json()
    assert by_metadata["total"] == 2
    assert client.get(
        f"/tasks/?tag_ids={tag['id']}", headers=HEADERS,
    ).json()["items"][0]["task_id"] == "T_graded"
    assert client.get(
        "/tasks/?unfinished=true", headers=HEADERS,
        ).json()["total"] == 3  # graded still awaits formal review/analysis finalization
    attention = client.get(
        "/tasks/?needs_attention=true", headers=HEADERS,
    ).json()
    assert [item["task_id"] for item in attention["items"]] == [
        "T_graded", "T_error", "T_draft",
    ]
    assert client.get(
        "/tasks/?status=error,draft", headers=HEADERS,
    ).json()["total"] == 2
    assert client.get(
        "/tasks/?q=linear%20algebra", headers=HEADERS,
    ).json()["total"] == 2
    assert [item["task_id"] for item in client.get(
        "/tasks/?sort=stage_asc", headers=HEADERS,
    ).json()["items"]] == ["T_draft", "T_graded", "T_error"]


def test_static_query_route_is_not_captured_and_needs_no_provider(client):
    response = client.post(
        "/tasks/query/interpret",
        headers=HEADERS,
        json={"query": "未完成 需要关注"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filters"]["unfinished"] is True
    assert body["filters"]["needs_attention"] is True
    assert body["source"] == "deterministic"
    assert body["query_id"].startswith("history_query_")
    assert body["progress"]["phase"] == "done"

    formal = client.post(
        "/tasks/query/interpret",
        headers=HEADERS,
        json={"query": "正式完成"},
    ).json()
    assert formal["filters"]["statuses"] == ["finalized"]
    assert formal["ambiguities"] == []

    unfinished = client.post(
        "/tasks/query/interpret",
        headers=HEADERS,
        json={"query": "还没批完的任务"},
    ).json()
    assert unfinished["filters"]["unfinished"] is True
    assert "q" not in unfinished["filters"]


@pytest.mark.parametrize(
    ("query", "expected_q"),
    [
        ("standard", "standard"),
        ("和尚作业", "和尚作业"),
        ("please show small tasks", "small"),
    ],
)
def test_deterministic_free_text_preserves_real_keywords(
    client, query: str, expected_q: str,
):
    response = client.post(
        "/tasks/query/interpret",
        headers=HEADERS,
        json={"query": query},
    )
    assert response.status_code == 200
    assert response.json()["filters"]["q"] == expected_q


def test_short_latin_course_code_does_not_match_inside_word(client):
    get_course_store()["c_ai"] = Course(
        id="c_ai", name="Artificial Intelligence", code="AI", teacher_id=OWNER_ID,
    )
    response = client.post(
        "/tasks/query/interpret",
        headers=HEADERS,
        json={"query": "explain standard"},
    )
    assert response.status_code == 200
    assert response.json()["filters"].get("course_id") is None
    assert response.json()["filters"]["q"] == "explain standard"


def test_optional_llm_path_uses_owner_candidates_and_progress(client, monkeypatch):
    from backend.agents.history_query_agent import (
        HistoryLLMOutput, HistoryQueryAmbiguity,
        HistoryQueryFilters,
    )
    from backend.skills.history_query_skill import HistoryQuerySkill

    course = Course(
        id="c_calc", name="Advanced Calculus", code="MATH500", teacher_id=OWNER_ID,
    )
    get_course_store()[course.id] = course

    class _Provider:
        provider_id = "mock:history"

    class _Registry:
        def for_owner(self, _owner_id):
            return self

        def pick_default(self):
            return _Provider()

    app.dependency_overrides[get_expert_registry] = lambda: _Registry()
    monkeypatch.setattr(settings, "history_query_llm_enabled", True)
    monkeypatch.setattr(settings, "history_query_llm_daily_limit", 1)
    monkeypatch.setattr(settings, "history_query_llm_cooldown_seconds", 0.0)

    calls = {"count": 0}

    async def fake_interpret(self, **_kwargs):
        calls["count"] += 1
        return HistoryLLMOutput(
            filters=HistoryQueryFilters(course_id="c_calc"),
            explanation="Matched the owner's calculus course.",
            ambiguities=[HistoryQueryAmbiguity(
                fragment="calculus",
                message="Choose a course",
                candidates=["c_calc", "Advanced Calculus", "foreign_course"],
            )],
        )

    monkeypatch.setattr(HistoryQuerySkill, "interpret", fake_interpret)
    response = client.post(
        "/tasks/query/interpret",
        headers=HEADERS,
        json={"query": "微积分相关"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filters"]["course_id"] == "c_calc"
    assert body["source"] == "llm"
    assert body["progress"]["phase"] == "done"
    assert body["ambiguities"][0]["candidates"] == [
        "c_calc", "Advanced Calculus",
    ]

    # Same owner has exhausted the explicit daily hard cap; deterministic
    # keyword fallback still succeeds and does not invoke the model again.
    limited = client.post(
        "/tasks/query/interpret",
        headers=HEADERS,
        json={"query": "另一个模糊课程"},
    )
    assert limited.status_code == 200
    assert limited.json()["source"] == "deterministic"
    assert limited.json()["filters"]["q"] == "另一个模糊课程"
    assert calls["count"] == 1


def test_llm_kill_switch_defaults_to_deterministic_fallback(client, monkeypatch):
    from backend.skills.history_query_skill import HistoryQuerySkill

    class _Provider:
        provider_id = "mock:shared"

    class _Registry:
        def for_owner(self, _owner_id):
            return self

        def pick_default(self):
            return _Provider()

    app.dependency_overrides[get_expert_registry] = lambda: _Registry()
    monkeypatch.setattr(settings, "history_query_llm_enabled", False)

    async def must_not_run(self, **_kwargs):
        raise AssertionError("kill-switched LLM path must not run")

    monkeypatch.setattr(HistoryQuerySkill, "interpret", must_not_run)
    response = client.post(
        "/tasks/query/interpret",
        headers=HEADERS,
        json={"query": "模糊语义"},
    )
    assert response.status_code == 200
    assert response.json()["source"] == "deterministic"
    assert response.json()["filters"]["q"] == "模糊语义"
    assert "模型增强当前关闭" in response.json()["explanation"]


@pytest.mark.asyncio
async def test_llm_owner_cooldown_gate_is_atomic(monkeypatch):
    from backend.agents.history_query_agent import (
        HistoryLLMOutput,
        HistoryQueryFilters,
        interpret_history_query,
    )
    from backend.progress.tracker import ProgressReporter
    from backend.skills.history_query_skill import HistoryQuerySkill

    monkeypatch.setattr(settings, "history_query_llm_enabled", True)
    monkeypatch.setattr(settings, "history_query_llm_daily_limit", 10)
    monkeypatch.setattr(settings, "history_query_llm_cooldown_seconds", 60.0)

    calls = {"count": 0}

    async def fake_interpret(self, **_kwargs):
        calls["count"] += 1
        await asyncio.sleep(0.05)
        return HistoryLLMOutput(
            filters=HistoryQueryFilters(q="semantic"),
            explanation="semantic match",
        )

    monkeypatch.setattr(HistoryQuerySkill, "interpret", fake_interpret)

    class _Provider:
        provider_id = "mock:shared"

    async def run_one(index: int):
        return await interpret_history_query(
            "模糊语义",
            semesters=["2025-2026-autumn"],
            courses=[],
            tags=[],
            provider=_Provider(),
            reporter=ProgressReporter(f"atomic_{index}"),
            owner_id=OWNER_ID,
        )

    results = await asyncio.gather(run_one(1), run_one(2))
    assert sorted(item["source"] for item in results) == ["deterministic", "llm"]
    assert calls["count"] == 1
