from __future__ import annotations

import io
import zipfile
from unittest.mock import MagicMock

import pytest

from backend.api.tasks import _run_extract, _run_parse
from backend.models import Task
from backend.skills.ocr_ingest import OCRResult
from backend.state import TaskStore


class FakeOCRSkill:
    def __init__(self, text: str):
        self.text = text
        self.calls = []

    async def recognize_images(self, images, purpose):
        self.calls.append({"images": images, "purpose": purpose})
        return OCRResult(text=self.text, provider="fake:ocr")


def _provider():
    provider = MagicMock()
    provider.provider_id = "mock:text"
    provider.supports_vision = False
    return provider


def _zip_bytes(items: dict[str, bytes]) -> bytes:
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w") as zf:
        for name, body in items.items():
            zf.writestr(name, body)
    return bio.getvalue()


@pytest.mark.asyncio
async def test_run_extract_image_uses_ocr_text(monkeypatch):
    seen = {}

    async def fake_extract(text, provider, store, reporter=None):
        seen["text"] = text
        store.clear()
        store["q1"] = {
            "q_id": "q1",
            "number": "1",
            "type": "概念题",
            "stem": text,
            "criterion": "rubric",
        }
        if reporter:
            await reporter.set_phase("done")
        return store

    monkeypatch.setattr("backend.api.tasks.extract_problems", fake_extract)

    task_store = TaskStore()
    task = Task(task_id="T_ocr_extract", name="OCR extract", owner_id="u1")
    task_store.create(task)
    ocr = FakeOCRSkill("OCR problem text")

    await _run_extract(
        task,
        b"fake image bytes",
        "problem.png",
        _provider(),
        ocr,
        "job_ocr_extract",
        task_store,
    )

    saved = task_store.get(task.task_id)
    assert saved.status == "problems_ready"
    assert saved.problem_data["q1"]["stem"] == "OCR problem text"
    assert seen["text"] == "OCR problem text"
    assert ocr.calls[0]["purpose"] == "problems"
    assert ocr.calls[0]["images"][0].label == "problem.png"


@pytest.mark.asyncio
async def test_run_parse_archive_image_uses_ocr_text(monkeypatch):
    seen = {}

    async def fake_parse(files_data, problems_data, student_store, provider, reporter=None):
        seen["files_data"] = files_data
        student_store.clear()
        student_store["S1"] = {
            "stu_id": "S1",
            "stu_name": "Student One",
            "stu_ans": [
                {
                    "q_id": "q1",
                    "number": "1",
                    "type": "概念题",
                    "content": files_data[0]["content"],
                    "flag": [],
                }
            ],
        }
        if reporter:
            await reporter.set_phase("done")
        return student_store

    monkeypatch.setattr("backend.api.tasks.parse_student_answers", fake_parse)

    task_store = TaskStore()
    task = Task(
        task_id="T_ocr_parse",
        name="OCR parse",
        owner_id="u1",
        status="problems_ready",
        problem_data={
            "q1": {
                "q_id": "q1",
                "number": "1",
                "type": "概念题",
                "stem": "Question",
                "criterion": "rubric",
            }
        },
    )
    task_store.create(task)
    ocr = FakeOCRSkill("OCR answer text")

    await _run_parse(
        task,
        _zip_bytes({"student_001/page.png": b"fake image bytes"}),
        "students.zip",
        _provider(),
        ocr,
        "job_ocr_parse",
        task_store,
    )

    saved = task_store.get(task.task_id)
    assert saved.status == "submissions_ready"
    assert saved.student_data["S1"]["stu_ans"][0]["content"] == "OCR answer text"
    assert seen["files_data"] == [
        {"filename": "student_001/page.png", "content": "OCR answer text"}
    ]
    assert ocr.calls[0]["purpose"] == "submissions"
    assert ocr.calls[0]["images"][0].label == "student_001/page.png"
