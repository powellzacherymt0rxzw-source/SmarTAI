"""
SmarTAI unified data models.
Extends the original Correction/StepScore with multi-expert support and progress tracking.
"""
from __future__ import annotations

import time
from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, Field, field_validator


# ─── Grading result models ────────────────────────────────────────────────────

class StepScore(BaseModel):
    step_no: int
    desc: str
    is_correct: bool
    score: float


class ExpertResult(BaseModel):
    """Result from a single expert (provider) grading a question."""
    provider: str = Field(description="Provider identifier, e.g. 'openai:gpt-4o', 'gemini:gemini-2.5-pro'")
    score: float
    max_score: float = 10.0
    confidence: float
    comment: str
    steps: List[StepScore] = []
    hits: Optional[List[str]] = None
    logs: Optional[str] = None
    raw_output: Optional[str] = Field(None, description="Raw LLM output for traceability")
    duration_ms: Optional[float] = Field(None, description="Wall-clock time for this expert's grading")
    error_kind: Optional[str] = Field(
        None,
        description="When confidence==0 (skill failed), why: "
                    "'quota_exhausted' | 'transient_llm' | 'parse_failed' | 'general'. "
                    "Used by multi_expert/grading_agent to pick a friendly comment.",
    )


class Correction(BaseModel):
    """Grading result for a single question."""
    q_id: str
    type: str
    score: float
    max_score: float
    confidence: float
    comment: str
    steps: List[StepScore]
    hits: Optional[List[str]] = None
    logs: Optional[str] = None
    # Multi-expert traceability
    expert_results: List[ExpertResult] = Field(default_factory=list, description="Individual expert results (empty for single-expert)")
    synthesis_method: Optional[str] = Field(None, description="'single' | 'multi_sample' | 'weighted_average' | 'judge_agent' | 'degraded_to_single' | 'all_failed' | 'quota_exhausted'")

    # ─── P0 fairness signals (Indecisiveness Score + Minority Veto) ───────────
    is_score: Optional[float] = Field(
        None,
        description="Indecisiveness Score: std-of-scores / max_score across experts/samples. "
                    "None when only one sample was available (cannot estimate variance).",
    )
    requires_human_review: bool = Field(
        False,
        description="True when IS > settings.is_threshold OR a minority-veto rule fires. "
                    "The score is still set (median-based) so the pipeline does not block; "
                    "the frontend should surface this flag for teacher attention.",
    )
    review_reasons: List[str] = Field(
        default_factory=list,
        description="Why review was flagged: e.g. 'high_indecisiveness', 'minority_veto'. "
                    "Stable string IDs so the frontend can localize without parsing.",
    )


# ─── Problem & student answer models ──────────────────────────────────────────

class TestCase(BaseModel):
    """A single sandbox test case for programming problems.

    Replaces the dataclass previously defined in backend/tools/code_interpreter.py
    so the same shape is used by normalized assignment questions,
    ingest_agent parsing, ProblemInfo storage, and the sandbox executor.
    """
    # Tell pytest NOT to try to collect this as a test class — without this,
    # the leading "Test" prefix triggers a PytestCollectionWarning.
    __test__ = False

    input: str = ""
    expected_output: str = ""
    description: str = ""
    source: Literal["teacher", "llm_generated"] = "teacher"
    sandbox_feasible: bool = Field(
        default=True,
        description="LLM marks False when the test requires GUI / network / "
                    "large input / special env; teachers' uploads default True.",
    )
    # ─── LeetCode-style function-call mode (optional) ────────────────────────
    # Populated when the problem asks the student to *implement a function*
    # (e.g. "实现 fibonacci(n)"). Sandbox then injects student's code, parses
    # function_args from JSON on stdin, calls fn(*args), prints repr(result).
    # When `function_name` is set, `input` / `expected_output` are ignored;
    # `function_args` / `expected_return` drive the comparison instead.
    function_name: Optional[str] = Field(
        default=None,
        description="If set, run student code in function-call mode (LeetCode style).",
    )
    function_args: Optional[List[Any]] = Field(
        default=None,
        description="Positional arguments passed to function_name. JSON-serializable.",
    )
    expected_return: Optional[str] = Field(
        default=None,
        description="repr() of expected return value; compared after ast.literal_eval normalization.",
    )


class ProblemInfo(BaseModel):
    q_id: str = Field(description="Unique question ID, starting from 'q1'")
    number: str = Field(description="Display question number, e.g. '1', '2.3', 'III.'")
    type: str = Field(description="Question type: 概念题/计算题/编程题/证明题/推理题/其他")
    stem: str = Field(description="Complete question stem including all text, formulas, and code")
    criterion: str = Field(description="Grading rubric/criteria")
    reference_answer: Optional[str] = Field(
        default=None,
        description="Teacher-supplied reference answer (calculation-style problems). "
                    "If None, CalculationSkill will ask the LLM to generate sympy code "
                    "and execute it in the sandbox to compute a reference value.",
    )
    test_cases: Optional[List[TestCase]] = Field(
        default=None,
        description="Teacher-supplied sandbox test cases (programming problems). "
                    "If None, ProgrammingSkill will scan keywords + ask the LLM to "
                    "generate up to 8 cases with a sandbox_feasible flag.",
    )

    @field_validator("q_id", mode="before")
    @classmethod
    def _coerce_q_id(cls, v):
        # Some LLMs (notably Gemini Flash variants) emit q_id as a bare JSON
        # integer (e.g. `"q_id": 1`) despite the prompt asking for "q1".
        # Normalize so Pydantic doesn't reject an otherwise-correct response.
        if isinstance(v, bool):
            return v
        if isinstance(v, int):
            return f"q{v}"
        return v

    @field_validator("number", mode="before")
    @classmethod
    def _coerce_number(cls, v):
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)):
            return str(v)
        return v


class ProblemSet(BaseModel):
    problems: List[ProblemInfo] = Field(description="List of parsed problems")


class StudentAnswerInfo(BaseModel):
    q_id: str
    number: str
    type: str
    content: str = Field(description="Student's answer content; empty string if unanswered")
    flag: List[str] = Field(default_factory=list, description="Recognition issues/flags")

    @field_validator("q_id", mode="before")
    @classmethod
    def _coerce_q_id(cls, v):
        if isinstance(v, bool):
            return v
        if isinstance(v, int):
            return f"q{v}"
        return v

    @field_validator("number", mode="before")
    @classmethod
    def _coerce_number(cls, v):
        if isinstance(v, bool):
            return v
        if isinstance(v, (int, float)):
            return str(v)
        return v


class StudentSubmission(BaseModel):
    stu_id: str = Field(description="Student ID extracted from filename")
    stu_name: str = Field(description="Student name extracted from filename")
    stu_ans: List[StudentAnswerInfo]


# ─── Progress tracking models (for frontend feedback) ─────────────────────────

class ActiveUnit(BaseModel):
    """Represents a currently-running grading unit."""
    student_id: str
    q_id: str
    skill: str = Field(description="e.g. 'ConceptSkill', 'CalculationSkill'")
    expert: Optional[str] = Field(None, description="e.g. 'gemini:gemini-2.5-pro'; None for single-model")
    step: str = Field(description="Current substep, e.g. 'retrieve_knowledge', 'llm_grade', 'sympy_verify'")


class ProgressEvent(BaseModel):
    """A single progress event for the frontend timeline."""
    ts: float = Field(default_factory=time.time)
    level: Literal["info", "warn", "error"] = "info"
    message: str = Field(description="Human-readable message for frontend display")
    unit: Optional[ActiveUnit] = None


class JobProgress(BaseModel):
    """Fine-grained progress for a grading job, polled by frontend."""
    phase: Literal[
        "pending",
        "ingesting",
        "extracting",      # NEW: extracting problems from assignment file
        "parsing",         # NEW: parsing student submissions
        "classifying",
        "grading",
        "reviewing",
        "aggregating",
        "done",
        "error",
    ] = "pending"
    total_students: int = 0
    total_questions: int = 0
    completed_units: int = Field(0, description="Number of (student, question) pairs finished")
    active: List[ActiveUnit] = Field(default_factory=list, description="Currently running units")
    messages: List[ProgressEvent] = Field(default_factory=list, description="Ring buffer of last N events")
    error_detail: Optional[str] = None


# ─── LLM provider config ─────────────────────────────────────────────────────

class ProviderConfig(BaseModel):
    """Configuration for a single LLM provider."""
    provider_type: Literal["openai", "gemini", "anthropic", "zhipu"]
    api_key: str
    model: str = Field(description="Model name, e.g. 'gpt-4o', 'gemini-2.5-pro'")
    base_url: Optional[str] = None
    enabled: bool = True
    display_name: Optional[str] = Field(
        default=None,
        description="User-supplied label shown in dropdowns. Falls back to f'{provider_type}:{model}'.",
    )
    max_concurrent: int = Field(
        default=5,
        ge=1,
        description="Max in-flight LLM calls for this key. GLM Air ≤ 5, OpenAI/Gemini may set 10+.",
    )
    rpm: int = Field(
        default=0,
        ge=0,
        description="Requests per minute cap for this key (sliding-window token bucket). "
                    "0 = no rate gating (only `max_concurrent` applies). Set this to the "
                    "provider's per-minute quota (e.g. Gemini free-tier flash-lite = 15). "
                    "When grading would exceed this, calls automatically queue until the "
                    "rolling 60s window has room — prevents 429 quota errors instead of "
                    "burning retries on them.",
    )


# ─── User / Course / Assignment models (P0 — multi-role product) ──────────────

Role = Literal["teacher", "student", "admin"]


class User(BaseModel):
    """A user record (teacher / student / admin).

    Membership is read only from ``course_enrollments``; the legacy
    ``course_ids`` mirror is intentionally absent so there is one source of
    truth for who belongs to which course.
    """
    id: str
    username: str
    email: str = ""
    role: Role = "teacher"
    password_hash: str = Field("", description="bcrypt hash; never returned to clients")
    created_at: float = Field(default_factory=time.time)
    is_active: bool = True

    def public(self) -> Dict[str, Any]:
        """Dict safe to return to clients (no password hash, no course_ids)."""
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "role": self.role,
            "is_active": self.is_active,
            "created_at": self.created_at,
        }
