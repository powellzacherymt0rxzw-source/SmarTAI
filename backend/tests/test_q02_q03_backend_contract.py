"""Backend contracts for factual recognition progress and problem review state."""
from __future__ import annotations

import time
from types import SimpleNamespace

import pytest

from backend.agents import ingest_agent
from backend.models import JobProgress, ProblemInfo
from backend.progress.tracker import ProgressReporter


def test_new_progress_fields_and_problem_review_status_are_backward_compatible():
    progress = JobProgress()
    assert progress.started_at is None
    assert progress.current_step is None
    assert progress.total_steps is None
    assert progress.completed_steps is None

    problem = ProblemInfo(
        q_id="q1",
        number="1",
        type="概念题",
        stem="Explain the concept.",
        criterion="Correct explanation.",
    )
    assert problem.review_status == "needs_review"


@pytest.mark.asyncio
async def test_stage_progress_updates_all_fields_together():
    reporter = ProgressReporter("stage-contract")
    before = time.time()
    await reporter.set_stage_progress(
        "source_prepared",
        total_steps=4,
        completed_steps=1,
    )
    snapshot = await reporter.snapshot()

    assert snapshot.started_at is not None
    assert before <= snapshot.started_at <= time.time()
    assert snapshot.current_step == "source_prepared"
    assert snapshot.total_steps == 4
    assert snapshot.completed_steps == 1

    with pytest.raises(ValueError):
        await reporter.set_stage_progress(
            "invalid",
            total_steps=4,
            completed_steps=5,
        )
    unchanged = await reporter.snapshot()
    assert unchanged.current_step == "source_prepared"
    assert unchanged.completed_steps == 1


@pytest.mark.asyncio
async def test_problem_extraction_reports_only_real_milestones(monkeypatch):
    async def fake_ainvoke(_provider, _messages):
        return SimpleNamespace(content=(
            '{"problems":[{"q_id":"q1","number":"1",'
            '"type":"概念题","stem":"Question",'
            '"criterion":"Criterion"}]}'
        ))

    monkeypatch.setattr(ingest_agent, "ainvoke_with_retry", fake_ainvoke)
    class RecordingReporter(ProgressReporter):
        def __init__(self):
            super().__init__("extract-stage-contract")
            self.stage_updates = []

        async def set_stage_progress(
            self,
            current_step,
            *,
            total_steps,
            completed_steps,
            message=None,
        ):
            self.stage_updates.append(
                (current_step, total_steps, completed_steps)
            )
            await super().set_stage_progress(
                current_step,
                total_steps=total_steps,
                completed_steps=completed_steps,
                message=message,
            )

    reporter = RecordingReporter()
    problem_store = {}

    await ingest_agent.extract_problems(
        "1. Question",
        SimpleNamespace(provider_id="mock:model"),
        problem_store,
        reporter=reporter,
    )

    snapshot = await reporter.snapshot()
    assert snapshot.phase == "done"
    assert snapshot.current_step == "completed"
    assert snapshot.total_steps == 4
    assert snapshot.completed_steps == 4
    assert snapshot.started_at is not None
    assert problem_store["q1"]["review_status"] == "needs_review"
    assert reporter.stage_updates == [
        ("source_prepared", 4, 1),
        # The active recognition/organization steps are not counted complete
        # until the corresponding real work returns.
        ("calling_recognition", 4, 1),
        ("organizing_structure", 4, 2),
        ("completed", 4, 4),
    ]
    messages = [event.message for event in snapshot.messages]
    assert [
        "Problem source prepared.",
        "Problem recognition started.",
        "Organizing recognized problem structure.",
        "Problem recognition completed.",
    ] == [message for message in messages if message in {
        "Problem source prepared.",
        "Problem recognition started.",
        "Organizing recognized problem structure.",
        "Problem recognition completed.",
    }]
