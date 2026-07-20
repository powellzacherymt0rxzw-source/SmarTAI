"""C-01 task grading setup API, safety, and execution contracts."""
from __future__ import annotations

import asyncio
import os
import threading
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

os.environ["SMARTAI_HTTP_PROXY"] = ""
os.environ["SMARTAI_HTTPS_PROXY"] = ""

from backend.agents.grading_agent import (
    _apply_low_confidence_policy,
    _grade_single_answer,
    _grading_failure_feedback,
)
from backend.agents.multi_expert import run_multi_expert
from backend.api.tasks import _run_grade
from backend.config import settings
from backend.llm.registry import ExpertRegistry, get_expert_registry
from backend.main import app
from backend.models import (
    Correction,
    ExpertResult,
    GradingJob,
    ProblemInfo,
    ProviderConfig,
    StudentAnswerInfo,
    Task,
    TaskGradingSetup,
)
from backend.progress import tracker as progress_tracker
from backend.progress.tracker import ProgressReporter
from backend.skills.base import build_system_prompt
from backend.skills.programming import ProgrammingSkill
from backend.state import get_job_store, get_task_store


HEADERS = {"Authorization": "Bearer demo-teacher-c01owner"}
OTHER_HEADERS = {"Authorization": "Bearer demo-teacher-c01other"}
ADMIN_HEADERS = {"Authorization": "Bearer demo-admin-c01admin"}
OWNER_ID = "demo_c01owner"


def _empty_registry() -> ExpertRegistry:
    registry = ExpertRegistry()
    with registry._lock:
        registry._providers.clear()
        registry._configs.clear()
        registry._shared_provider_ids.clear()
        registry._entry_owners.clear()
        registry._public_provider_ids.clear()
    return registry


def _config(model: str, key: str) -> ProviderConfig:
    return ProviderConfig(provider_type="openai", api_key=key, model=model)


def _problem_data() -> dict:
    return {
        "q1": {
            "q_id": "q1",
            "number": "1",
            "type": "概念题",
            "stem": "Explain dependency injection.",
            "criterion": "10 points for a correct explanation.",
            "review_status": "confirmed",
        },
    }


def _student_data() -> dict:
    return {
        "s1": {
            "stu_id": "s1",
            "stu_name": "Student One",
            "stu_ans": [{
                "q_id": "q1",
                "number": "1",
                "type": "概念题",
                "content": "It supplies dependencies from outside.",
                "flag": [],
            }],
        },
    }


def _task(
    task_id: str = "T_c01",
    *,
    owner_id: str = OWNER_ID,
    status: str = "problems_ready",
    with_students: bool = False,
) -> Task:
    return Task(
        task_id=task_id,
        owner_id=owner_id,
        name="C01 grading setup",
        status=status,
        problem_data=_problem_data(),
        student_data=_student_data() if with_students else {},
    )


@pytest.fixture
def isolated_registry(monkeypatch):
    old_shared = settings.shared_pool_enabled
    settings.shared_pool_enabled = True
    registry = _empty_registry()
    app.dependency_overrides[get_expert_registry] = lambda: registry
    get_task_store()._tasks.clear()
    get_task_store()._idempotency.clear()
    get_job_store()._active.clear()
    get_job_store()._history.clear()
    progress_tracker._reporters.clear()
    progress_tracker._reporter_last_seen.clear()
    yield registry
    settings.shared_pool_enabled = old_shared
    app.dependency_overrides.clear()
    get_task_store()._tasks.clear()
    get_job_store()._active.clear()
    get_job_store()._history.clear()
    progress_tracker._reporters.clear()
    progress_tracker._reporter_last_seen.clear()


@pytest.fixture
def client(isolated_registry):
    with TestClient(app) as test_client:
        yield test_client


def _put(client: TestClient, task: Task, setup: dict, *, revision: int | None = None):
    return client.put(
        f"/tasks/{task.task_id}/grading-setup",
        headers=HEADERS,
        json={
            "expected_workflow_revision": (
                task.workflow_revision if revision is None else revision
            ),
            "grading_setup": setup,
        },
    )


def test_first_get_suggested_setup_is_ready_and_can_be_saved_directly(
    client,
    isolated_registry,
):
    task = _task()
    get_task_store().create(task)
    provider_id = isolated_registry.register(
        _config("c01-primary", "secret-must-not-leak"), owner_id=OWNER_ID,
    )

    first = client.get(f"/tasks/{task.task_id}/grading-setup", headers=HEADERS)
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["configured"] is False
    assert body["grading_setup"] is None
    assert body["suggested_setup"]["selected_provider_ids"] == [provider_id]
    assert body["readiness"] == {
        "ready": True, "blocking_issues": [], "warnings": [],
    }
    assert "api_key" not in first.text
    assert "secret-must-not-leak" not in first.text

    saved = _put(client, task, body["suggested_setup"])
    assert saved.status_code == 200, saved.text
    result = saved.json()
    assert result["status"] == "saved"
    assert result["configured"] is True
    assert result["workflow_revision"] == 1
    assert result["grading_setup_fingerprint"]


def test_get_without_provider_is_zero_work_and_reports_a_stable_gate(
    client,
    monkeypatch,
):
    task = _task()
    get_task_store().create(task)

    def must_not_invoke(*_args, **_kwargs):
        raise AssertionError("C01 GET must never invoke a provider")

    monkeypatch.setattr("backend.llm.providers.BaseProvider.ainvoke", must_not_invoke)
    response = client.get(f"/tasks/{task.task_id}/grading-setup", headers=HEADERS)
    assert response.status_code == 200
    assert response.json()["suggested_setup"] is None
    assert response.json()["readiness"]["blocking_issues"] == ["provider_required"]


def test_save_is_cas_idempotent_and_different_stale_payload_conflicts(
    client,
    isolated_registry,
):
    task = _task()
    get_task_store().create(task)
    isolated_registry.register(_config("c01-one", "key"), owner_id=OWNER_ID)
    setup = client.get(
        f"/tasks/{task.task_id}/grading-setup", headers=HEADERS,
    ).json()["suggested_setup"]

    first = _put(client, task, setup, revision=0)
    assert first.status_code == 200
    assert first.json()["status"] == "saved"
    replay = _put(client, task, setup, revision=0)
    assert replay.status_code == 200
    assert replay.json()["status"] == "unchanged"
    assert replay.json()["workflow_revision"] == 1

    changed = {**setup, "strictness": 65}
    stale = _put(client, task, changed, revision=0)
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "stale_revision"


def test_unknown_grading_setup_field_is_rejected_with_stable_code(
    client,
    isolated_registry,
):
    task = _task()
    get_task_store().create(task)
    isolated_registry.register(_config("c01-strict", "key"), owner_id=OWNER_ID)
    setup = client.get(
        f"/tasks/{task.task_id}/grading-setup", headers=HEADERS,
    ).json()["suggested_setup"]

    response = _put(
        client,
        task,
        {**setup, "feedback_lenght": "short"},
        revision=0,
    )
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_grading_setup"


def test_semantic_validation_and_shared_pool_limits(client, isolated_registry):
    task = _task()
    get_task_store().create(task)
    first = isolated_registry.register(_config("c01-a", "a"), owner_id=OWNER_ID)
    second = isolated_registry.register(_config("c01-b", "b"), owner_id=OWNER_ID)
    base = client.get(
        f"/tasks/{task.task_id}/grading-setup", headers=HEADERS,
    ).json()["suggested_setup"]

    cases = [
        ({**base, "selected_provider_ids": [first, first]}, "duplicate_provider_ids"),
        ({**base, "primary_provider_id": second}, "primary_provider_not_selected"),
        ({**base, "selected_provider_ids": [first, second]}, "invalid_provider_count"),
        ({
            **base,
            "selected_provider_ids": [first, second],
            "aggregation_method": "weighted_average",
            "multi_sample_n": 2,
        }, "multi_sample_not_applicable"),
    ]
    for payload, code in cases:
        response = _put(client, task, payload, revision=0)
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["code"] == code

    assert isolated_registry.set_enabled_for_owner(OWNER_ID, first, False) == "updated"
    disabled = _put(client, task, base, revision=0)
    assert disabled.status_code == 422
    assert disabled.json()["detail"]["code"] == "provider_not_enabled"

    # A shared fallback remains owner-wrapped and cannot multiply calls.
    with isolated_registry._lock:
        isolated_registry._providers.clear()
        isolated_registry._configs.clear()
        isolated_registry._shared_provider_ids.clear()
        isolated_registry._entry_owners.clear()
        isolated_registry._public_provider_ids.clear()
    shared = isolated_registry.register(_config("c01-shared", "shared-key"), shared=True)
    shared_setup = {
        **base,
        "selected_provider_ids": [shared],
        "primary_provider_id": shared,
        "multi_sample_n": 2,
    }
    rejected = _put(client, task, shared_setup, revision=0)
    assert rejected.status_code == 422
    assert rejected.json()["detail"]["code"] == "shared_pool_single_expert_required"


def test_owner_busy_locked_and_empty_knowledge_contracts(client, isolated_registry):
    task = _task()
    other = _task("T_c01_other", owner_id="demo_c01other")
    get_task_store().create(task)
    get_task_store().create(other)
    isolated_registry.register(_config("c01-owner", "key"), owner_id=OWNER_ID)
    setup = client.get(
        f"/tasks/{task.task_id}/grading-setup", headers=HEADERS,
    ).json()["suggested_setup"]
    setup["knowledge_scope"] = "all_task_docs"

    crossed = client.get(f"/tasks/{other.task_id}/grading-setup", headers=HEADERS)
    assert crossed.status_code == 403
    admin = client.put(
        f"/tasks/{task.task_id}/grading-setup",
        headers=ADMIN_HEADERS,
        json={"expected_workflow_revision": 0, "grading_setup": setup},
    )
    assert admin.status_code == 403
    assert admin.json()["detail"]["code"] == "task_llm_impersonation_forbidden"

    saved = _put(client, task, setup, revision=0)
    assert saved.status_code == 200
    assert saved.json()["readiness"]["warnings"] == ["task_knowledge_empty"]

    task.material_import_job_id = "active-import"
    busy = _put(client, task, {**setup, "strictness": 60}, revision=1)
    assert busy.status_code == 409
    assert busy.json()["detail"]["code"] == "workflow_busy"
    task.material_import_job_id = None
    task.status = "graded"
    locked = _put(client, task, {**setup, "strictness": 60}, revision=1)
    assert locked.status_code == 409
    assert locked.json()["detail"]["code"] == "grading_setup_locked"


def test_grade_uses_saved_exact_selection_and_rejects_runtime_override(
    client,
    isolated_registry,
    monkeypatch,
):
    task = _task(status="submissions_ready", with_students=True)
    get_task_store().create(task)
    first = isolated_registry.register(_config("c01-first", "first-key"), owner_id=OWNER_ID)
    second = isolated_registry.register(_config("c01-second", "second-key"), owner_id=OWNER_ID)
    setup = TaskGradingSetup(
        selected_provider_ids=[first],
        primary_provider_id=first,
        aggregation_method="single",
        multi_sample_n=3,
        knowledge_scope="none",
        feedback_language="zh",
        teacher_notes="check definitions",
    ).model_dump(mode="json")
    assert _put(client, task, setup, revision=0).status_code == 200

    override = client.post(
        f"/tasks/{task.task_id}/grade",
        headers=HEADERS,
        json={"multi_sample_n": 5},
    )
    assert override.status_code == 409
    assert override.json()["detail"]["code"] == "grading_setup_override_forbidden"

    observed: dict = {}
    called = threading.Event()

    async def fake_run(
        task_arg, registry_arg, job_id, task_store_arg, job_store_arg, language,
        **kwargs,
    ):
        observed["provider_ids"] = [p.provider_id for p in registry_arg.list_available()]
        observed["primary"] = registry_arg.pick_default().provider_id
        observed["language"] = language
        observed["multi_sample_n"] = kwargs["multi_sample_n"]
        observed["setup"] = kwargs["grading_setup"]
        called.set()

    monkeypatch.setattr("backend.api.tasks._run_grade", fake_run)
    started = client.post(f"/tasks/{task.task_id}/grade", headers=HEADERS, json={})
    assert started.status_code == 200, started.text
    assert called.wait(1.0)
    assert observed["provider_ids"] == [first]
    assert second not in observed["provider_ids"]
    assert observed["primary"] == first
    assert observed["multi_sample_n"] == 3
    assert observed["language"] == "zh"
    job = get_job_store().get(started.json()["job_id"])
    assert job is not None
    assert job.grading_setup_snapshot["selected_provider_ids"] == [first]
    assert "api_key" not in str(job.grading_setup_snapshot)
    assert "first-key" not in str(job.grading_setup_snapshot)


def test_failed_job_preserves_owner_visible_key_free_setup_snapshot(client):
    setup = TaskGradingSetup(
        selected_provider_ids=["openai:c01-failed"],
        primary_provider_id="openai:c01-failed",
        feedback_language="zh",
        teacher_notes="Audit this failed attempt.",
    )
    task = _task("T_c01_failed", status="grading", with_students=True)
    task.grading_setup = setup
    task.grading_setup_fingerprint = "safe-fingerprint"
    task.grading_job_id = "job-c01-failed"
    get_task_store().create(task)
    get_job_store().create(GradingJob(
        job_id=task.grading_job_id,
        job_type="batch",
        grading_setup_snapshot=setup.model_dump(mode="json"),
    ))

    get_job_store().fail(task.grading_job_id, "grading_failed")
    get_task_store().finish_grading(
        task.task_id,
        job_id=task.grading_job_id,
        error="grading_failed",
    )

    stored_job = get_job_store().get(task.grading_job_id)
    assert stored_job is not None
    assert stored_job.results["grading_setup_snapshot"]["teacher_notes"] == (
        "Audit this failed attempt."
    )
    response = client.get(f"/tasks/{task.task_id}/result", headers=HEADERS)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "error"
    assert body["grading_setup_snapshot"] == setup.model_dump(mode="json")
    assert "api_key" not in response.text


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("scope", "expected_task_id"),
    [("none", None), ("all_task_docs", "T_scope")],
)
async def test_run_grade_threads_real_knowledge_scope_and_policy(
    isolated_registry,
    monkeypatch,
    scope,
    expected_task_id,
):
    provider_id = isolated_registry.register(
        _config(f"scope-{scope}", "scope-key"), owner_id=OWNER_ID,
    )
    selected = isolated_registry.for_owner(OWNER_ID).select(
        [provider_id], primary_provider_id=provider_id,
    )
    setup = TaskGradingSetup(
        selected_provider_ids=[provider_id],
        primary_provider_id=provider_id,
        knowledge_scope=scope,
        strictness=75,
    )
    task = _task("T_scope", status="grading", with_students=True)
    task.grading_job_id = f"job-{scope}"
    get_task_store().create(task)
    get_job_store().create(GradingJob(
        job_id=task.grading_job_id,
        job_type="batch",
        grading_setup_snapshot=setup.model_dump(mode="json"),
    ))
    observed: dict = {}

    async def fake_grade_batch(**kwargs):
        observed.update(kwargs)
        return []

    monkeypatch.setattr("backend.api.tasks.grade_batch", fake_grade_batch)
    await _run_grade(
        task, selected, task.grading_job_id, get_task_store(), get_job_store(),
        setup.feedback_language, multi_sample_n=setup.multi_sample_n,
        grading_setup=setup,
    )
    assert observed["task_id"] == expected_task_id
    assert observed["grading_setup"].strictness == 75
    assert observed["aggregation_method"] == "single"


@pytest.mark.asyncio
async def test_weighted_never_calls_judge_and_judge_uses_primary(monkeypatch):
    first = SimpleNamespace(provider_id="mock:first", provider_type="mock")
    second = SimpleNamespace(provider_id="mock:second", provider_type="mock")

    class Registry:
        def list_available(self):
            return [first, second]

        def pick_default(self):
            return second

    class Skill:
        name = "Canned"

        def __init__(self, provider, **_kwargs):
            self.provider = provider

        async def grade(self, *_args, **_kwargs):
            return ExpertResult(
                provider=self.provider.provider_id,
                score=8.0 if self.provider is first else 6.0,
                max_score=10.0,
                confidence=0.8,
                comment="ok",
            )

    monkeypatch.setattr("backend.agents.multi_expert.get_skill_for_type", lambda _type: Skill)

    async def judge_must_not_run(**_kwargs):
        raise AssertionError("weighted_average must not invoke the judge")

    monkeypatch.setattr("backend.agents.multi_expert._synthesize", judge_must_not_run)
    problem = SimpleNamespace(q_id="q1", type="概念题", stem="?", criterion="rubric")
    answer = SimpleNamespace(content="answer")
    reporter = ProgressReporter("job-c01-synthesis")
    weighted = await run_multi_expert(
        problem=problem,
        answer=answer,
        student_id="s1",
        registry=Registry(),
        aggregation_method="weighted_average",
        reporter=reporter,
    )
    assert weighted.synthesis_method == "weighted_average"
    assert (await reporter.snapshot()).messages == []

    observed: dict = {}

    async def fake_judge(**kwargs):
        observed["provider"] = kwargs["synthesis_provider"].provider_id
        return Correction(
            q_id="q1", type="概念题", score=7, max_score=10,
            confidence=.8, comment="judged", steps=[], synthesis_method="judge_agent",
        )

    monkeypatch.setattr("backend.agents.multi_expert._synthesize", fake_judge)
    judged = await run_multi_expert(
        problem=problem,
        answer=answer,
        student_id="s1",
        registry=Registry(),
        aggregation_method="judge_agent",
        reporter=reporter,
    )
    assert judged.synthesis_method == "judge_agent"
    assert observed["provider"] == "mock:second"
    assert [event.message for event in (await reporter.snapshot()).messages] == [
        "s1/q1: synthesize_experts_started",
        "s1/q1: synthesize_experts_finished",
    ]


@pytest.mark.asyncio
async def test_deterministic_feedback_obeys_c01_and_preserves_legacy(monkeypatch):
    problem = ProblemInfo(
        q_id="q1",
        number="1",
        type="编程题",
        stem="Write a function.",
        criterion="10 points for a working solution.",
    )
    answer = StudentAnswerInfo(
        q_id="q1", number="1", type="编程题", content="", flag=[],
    )
    failure = ExpertResult(
        provider="mock:one",
        score=0,
        max_score=10,
        confidence=0,
        comment="raw provider error",
        error_kind="quota_exhausted",
    )

    async def fail_all(**_kwargs):
        from backend.agents.multi_expert import AllExpertsFailed
        raise AllExpertsFailed([failure])

    monkeypatch.setattr("backend.agents.grading_agent.run_multi_expert", fail_all)
    en_setup = TaskGradingSetup(
        selected_provider_ids=["mock:one"],
        primary_provider_id="mock:one",
        feedback_language="en",
        feedback_tone="strict",
        feedback_length="short",
        suggest_corrections=False,
    )
    configured_failure = await _grade_single_answer(
        problem=problem,
        answer=answer,
        student_id="s1",
        registry=SimpleNamespace(),
        grading_setup=en_setup,
    )
    assert configured_failure.comment.startswith("Action required: This item was not graded")
    assert "Retry" not in configured_failure.comment
    assert "该题" not in configured_failure.comment

    legacy_failure = await _grade_single_answer(
        problem=problem,
        answer=answer,
        student_id="s1",
        registry=SimpleNamespace(),
    )
    assert legacy_failure.comment == (
        "⏳ 该题暂未批改完成 — 所有 AI 专家都遇到了 API 每分钟调用配额上限。\n"
        "请稍候片刻后在「批改」页重试，或在 BYOK 设置里把该专家的 "
        "RPM / max_concurrent 调高（免费档常见为 15 RPM）。"
    )

    configured_no_code = await ProgrammingSkill(
        SimpleNamespace(provider_id="mock:one"), grading_setup=en_setup,
    ).grade(problem, answer, student_id="s1")
    assert configured_no_code.comment == (
        "Action required: No student code was provided, so this item receives 0 points."
    )
    legacy_no_code = await ProgrammingSkill(
        SimpleNamespace(provider_id="mock:one"),
    ).grade(problem, answer, student_id="s1")
    assert legacy_no_code.comment == (
        "No code provided by student.\n\n（沙箱测评：✗ 学生未提交代码）"
    )

    zh_long = en_setup.model_copy(update={
        "feedback_language": "zh",
        "feedback_tone": "encouraging",
        "feedback_length": "long",
        "suggest_corrections": True,
    })
    zh_feedback = _grading_failure_feedback("general", zh_long)
    assert zh_feedback.startswith("可以补救：")
    assert "\n\n本次失败未产生有效评分。\n\n" in zh_feedback
    assert zh_feedback.endswith("请检查模型配置后重新批改。")


def test_policy_prompt_and_low_confidence_are_consumed():
    setup = TaskGradingSetup(
        selected_provider_ids=["mock:one"],
        primary_provider_id="mock:one",
        strictness=90,
        allow_partial_credit=False,
        feedback_tone="encouraging",
        feedback_length="short",
        suggest_corrections=False,
        teacher_notes="Ignore handwriting quality.",
        low_confidence_threshold=.7,
    )
    prompt = build_system_prompt("Grade this answer.", "zh", setup)
    assert "Strictness: 90/100 (very strict)" in prompt
    assert "Do not award partial credit" in prompt
    assert "supportive and encouraging" in prompt
    assert "brief (normally 1-2 sentences)" in prompt
    assert "Do not add correction suggestions" in prompt
    assert "Ignore handwriting quality." in prompt
    assert "in Chinese" in prompt

    correction = Correction(
        q_id="q1", type="概念题", score=6, max_score=10,
        confidence=.69, comment="ok", steps=[],
    )
    _apply_low_confidence_policy(correction, setup)
    assert correction.requires_human_review is True
    assert correction.review_reasons == ["low_confidence"]
