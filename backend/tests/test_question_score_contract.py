from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from pydantic import ValidationError as PydanticValidationError

from backend.api.task_preparation import (
    StartQuestionPreparationRequest,
    question_preparation_capabilities,
)
from backend.models import QuestionScorePolicy
from backend.skills.question_score import (
    InterpretedQuestionScore,
    InterpretedQuestionScorePlan,
    resolve_question_score_policy,
)


def _problems():
    return {
        "q1": {"q_id": "q1", "number": "1", "stem": "First question"},
        "q2": {"q_id": "q2", "number": "2", "stem": "Second question"},
    }


def test_question_preparation_request_defaults_to_reviewable_ten_points():
    request = StartQuestionPreparationRequest(
        source_tokens=["source-1"],
        expected_workflow_revision=0,
    )

    assert request.score_policy == QuestionScorePolicy()
    assert request.score_policy.mode == "default_10"


@pytest.mark.parametrize(
    "payload",
    [
        {"mode": "uniform"},
        {"mode": "uniform", "uniform_max_score": 0},
        {"mode": "per_question"},
        {"mode": "default_10", "uniform_max_score": 5},
        {"mode": "per_question", "per_question_text": "   "},
    ],
)
def test_question_score_policy_rejects_ambiguous_or_invalid_config(payload):
    with pytest.raises(PydanticValidationError):
        QuestionScorePolicy.model_validate(payload)


@pytest.mark.asyncio
async def test_default_and_uniform_score_policies_do_not_call_provider():
    provider = MagicMock()

    default = await resolve_question_score_policy(
        _problems(), QuestionScorePolicy(), provider
    )
    uniform = await resolve_question_score_policy(
        _problems(),
        QuestionScorePolicy(mode="uniform", uniform_max_score=5),
        provider,
    )

    assert {row.max_score for row in default.values()} == {10}
    assert {row.source for row in default.values()} == {"default_10"}
    assert {row.review_status for row in default.values()} == {"needs_review"}
    assert {row.issue_code for row in default.values()} == {
        "default_max_score_requires_review"
    }
    assert {row.max_score for row in uniform.values()} == {5}
    assert {row.source for row in uniform.values()} == {"uniform"}
    assert {row.review_status for row in uniform.values()} == {"confirmed"}
    provider.assert_not_called()


@pytest.mark.asyncio
async def test_per_question_policy_keeps_matches_and_flags_unmatched(monkeypatch):
    async def structured_call(*_args, **_kwargs):
        return (
            InterpretedQuestionScorePlan(scores=[
                InterpretedQuestionScore(q_id="q1", max_score=5),
                InterpretedQuestionScore(q_id="unknown", max_score=99),
            ]),
            SimpleNamespace(content="{}"),
        )

    monkeypatch.setattr(
        "backend.skills.question_score.structured_llm_call", structured_call
    )

    resolved = await resolve_question_score_policy(
        _problems(),
        QuestionScorePolicy(
            mode="per_question",
            per_question_text="第一题 5 分，第二题未说明。",
        ),
        MagicMock(),
    )

    assert resolved["q1"].max_score == 5
    assert resolved["q1"].source == "per_question_text"
    assert resolved["q1"].review_status == "needs_review"
    assert resolved["q2"].max_score == 10
    assert resolved["q2"].source == "default_10"
    assert resolved["q2"].issue_code == "max_score_not_found"


def _seed_question_task(owner_id: str, task_id: str):
    from backend.db import assignment_repository, workflow_repository
    from backend.db.models import AssignmentRecord, CourseRecord, UserRecord
    from backend.db.session import session_scope

    with session_scope() as session:
        session.add(UserRecord(
            id=owner_id,
            username=owner_id,
            password_hash="hash",
            role="teacher",
            is_active=True,
        ))
        session.flush()
        session.add(CourseRecord(
            id=f"{task_id}-course",
            name="Course",
            teacher_id=owner_id,
        ))
        session.flush()
        session.add(AssignmentRecord(
            id=task_id,
            course_id=f"{task_id}-course",
            teacher_id=owner_id,
            name="Assignment",
            status="draft",
            version=1,
        ))
    workflow_repository.ensure_workflow(assignment_id=task_id, owner_id=owner_id)
    assignment_repository.add_question(
        assignment_id=task_id,
        teacher_id=owner_id,
        q_id="q1",
        order_index=0,
        type="概念题",
        stem="Question",
        criterion="Reasoning 100%",
        max_score=10,
        source={
            "presentation": {
                "review_status": "needs_review",
                "max_score_source": "default_10",
                "max_score_review_status": "needs_review",
                "preparation_issues": [{
                    "field": "max_score",
                    "code": "default_max_score_requires_review",
                }],
            }
        },
    )


def test_task_problem_contract_serializes_and_edits_authoritative_max_score():
    from backend.services import task_facade

    owner_id = "score-owner"
    task_id = "score-task"
    _seed_question_task(owner_id, task_id)

    before = task_facade.get_task(task_id=task_id, owner_id=owner_id, full=True)
    assert before["problem_data"]["q1"]["max_score"] == 10
    assert before["problem_data"]["q1"]["max_score_source"] == "default_10"
    assert (
        before["problem_data"]["q1"]["max_score_review_status"]
        == "needs_review"
    )

    response = task_facade.update_problem(
        task_id=task_id,
        owner_id=owner_id,
        q_id="q1",
        patch={"max_score": 5},
    )

    problem = response["problem"]
    assert problem["max_score"] == 5
    assert problem["max_score_source"] == "teacher_edited"
    assert problem["max_score_review_status"] == "confirmed"
    assert not [
        issue
        for issue in problem["preparation_issues"]
        if issue.get("field") == "max_score"
    ]


def test_question_preparation_capabilities_expose_ocr_images_but_not_test_images():
    owner_id = "score-capability-owner"
    task_id = "score-capability-task"
    _seed_question_task(owner_id, task_id)
    registry = MagicMock()
    registry.pick_vision.return_value = MagicMock()

    capabilities = question_preparation_capabilities(
        task_id,
        current=SimpleNamespace(id=owner_id),
        registry=registry,
    )

    assert ".jpg" in capabilities["source_roles"]["problem"]["accepted_extensions"]
    assert ".webp" in capabilities["source_roles"]["rubric"]["accepted_extensions"]
    assert ".jpg" not in capabilities["source_roles"]["programming_tests"]["accepted_extensions"]
    assert capabilities["reader"]["images"] is True


def test_confirming_question_also_confirms_default_max_score():
    from backend.services import task_facade

    owner_id = "confirm-score-owner"
    task_id = "confirm-score-task"
    _seed_question_task(owner_id, task_id)

    response = task_facade.update_problem(
        task_id=task_id,
        owner_id=owner_id,
        q_id="q1",
        patch={"review_status": "confirmed"},
    )

    assert response["problem"]["max_score"] == 10
    assert response["problem"]["max_score_source"] == "default_10"
    assert response["problem"]["max_score_review_status"] == "confirmed"
