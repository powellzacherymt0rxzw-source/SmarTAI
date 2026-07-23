"""
SmarTAI unified data models.
Extends the original Correction/StepScore with multi-expert support and progress tracking.
"""
from __future__ import annotations

import time
from typing import List, Optional, Literal, Dict, Any
from pydantic import BaseModel, ConfigDict, Field, field_validator


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
    # Teacher review is an overlay: the immutable AI score/comment above stay
    # available for audit while downstream result views use teacher_score when
    # present.  Task-level finalization is deliberately separate.
    teacher_score: Optional[float] = Field(
        None,
        ge=0,
        description="Teacher-approved score override; None keeps the AI score.",
    )
    teacher_comment: str = Field(
        "",
        max_length=4000,
        description="Teacher's result comment; empty keeps the AI comment as the effective comment.",
    )
    review_status: Literal["pending", "edited", "confirmed"] = "pending"
    reviewed_at: Optional[float] = None


# ─── Problem & student answer models ──────────────────────────────────────────

MaterialImportTarget = Literal["criterion", "reference_answer", "test_cases"]
AICompletionTarget = Literal[
    "criterion", "reference_answer", "solution_code", "test_cases",
]
SubmissionIdentityMode = Literal["filename", "roster", "manual_review"]
SubmissionIdentityStatus = Literal["matched", "needs_review"]

def is_programming_question_type(value: Any) -> bool:
    """Recognize legacy English and current Chinese programming type labels."""

    normalized = "".join(
        character for character in str(value or "").strip().casefold()
        if character not in {" ", "_", "-"}
    )
    return normalized in {
        "编程题", "程序设计题", "programming", "program", "code", "coding",
        "programmingquestion", "codingquestion",
    }

class TestCase(BaseModel):
    """A single sandbox test case for programming problems.

    Replaces the dataclass previously defined in backend/tools/code_interpreter.py
    so the same shape is used by api/tasks upload, ingest_agent parsing,
    ProblemInfo storage, and the sandbox executor.
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


class MaterialFieldProvenance(BaseModel):
    """Durable per-slot audit metadata for an applied Q-08 candidate."""

    import_job_id: str
    candidate_id: str
    source_kind: Literal["upload", "library"]
    source_filename: str
    library_material_id: Optional[str] = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    match_status: Literal["exact", "possible"] = "possible"
    source_excerpt: str = Field(default="", max_length=600)
    source_location: str = Field(default="", max_length=160)
    reason: str = Field(default="", max_length=300)
    review_status: Literal["pending", "edited", "confirmed"] = "pending"
    imported_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class AICompletionFieldProvenance(BaseModel):
    """Durable audit metadata for one Q-09 generated preparation slot."""

    job_id: str
    candidate_id: str
    source_kind: Literal["ai_generated"] = "ai_generated"
    provider_id: str
    review_status: Literal["pending", "edited", "confirmed"] = "pending"
    generated_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)


class ProblemInfo(BaseModel):
    q_id: str = Field(description="Unique question ID, starting from 'q1'")
    number: str = Field(description="Display question number, e.g. '1', '2.3', 'III.'")
    type: str = Field(description="Question type: 概念题/计算题/编程题/证明题/推理题/其他")
    stem: str = Field(description="Complete question stem including all text, formulas, and code")
    criterion: str = Field(description="Grading rubric/criteria")
    review_status: Literal["needs_review", "edited", "confirmed"] = Field(
        default="needs_review",
        description=(
            "Teacher review state for the recognized question stem/content only. "
            "Preparation slots such as rubric, answer, solution code, and tests "
            "keep independent review state in their provenance records."
        ),
    )
    reference_answer: Optional[str] = Field(
        default=None,
        description="Teacher-supplied reference answer (calculation-style problems). "
                    "If None, CalculationSkill will ask the LLM to generate sympy code "
                    "and execute it in the sandbox to compute a reference value.",
    )
    solution_code: Optional[str] = Field(
        default=None,
        description=(
            "Teacher-confirmed or AI-generated reference implementation for a "
            "programming problem. It is preparation material only and is never "
            "executed by the Q-09 generation workflow."
        ),
    )
    test_cases: Optional[List[TestCase]] = Field(
        default=None,
        description="Teacher-supplied sandbox test cases (programming problems). "
                    "If None, ProgrammingSkill will scan keywords + ask the LLM to "
                    "generate up to 8 cases with a sandbox_feasible flag.",
    )
    material_provenance: Dict[MaterialImportTarget, MaterialFieldProvenance] = Field(
        default_factory=dict,
        description=(
            "Per preparation slot provenance retained after a Q-08 plan expires. "
            "It is audit metadata and does not change grading behavior."
        ),
    )
    ai_completion_provenance: Dict[
        AICompletionTarget, AICompletionFieldProvenance
    ] = Field(
        default_factory=dict,
        description=(
            "Per-slot Q-09 AI generation provenance. Generated values remain "
            "pending until a teacher explicitly edits or confirms them."
        ),
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
    stu_id: str = Field(description="Student ID candidate extracted from the configured identity source")
    stu_name: str = Field(description="Student name candidate extracted from the configured identity source")
    stu_ans: List[StudentAnswerInfo]
    source_filename: Optional[str] = None
    identity_match_method: Optional[SubmissionIdentityMode] = None
    identity_status: SubmissionIdentityStatus = "matched"


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
    # Optional stage fields keep older clients compatible while allowing
    # non-grading jobs to expose factual milestones instead of fabricated ETA
    # or page counts. They remain None until a workflow explicitly reports
    # stage progress.
    started_at: Optional[float] = None
    current_step: Optional[str] = None
    total_steps: Optional[int] = None
    completed_steps: Optional[int] = None
    stage_metrics: Dict[str, int] = Field(
        default_factory=dict,
        description="Factual workflow-specific counters; never estimated values.",
    )
    active: List[ActiveUnit] = Field(default_factory=list, description="Currently running units")
    messages: List[ProgressEvent] = Field(default_factory=list, description="Ring buffer of last N events")
    error_detail: Optional[str] = None


# ─── Job lifecycle model ──────────────────────────────────────────────────────

class GradingJob(BaseModel):
    """Represents a grading job (single student or batch)."""
    job_id: str
    job_name: Optional[str] = None
    job_type: Literal["student", "batch"] = "student"
    status: Literal["pending", "running", "completed", "error"] = "pending"
    student_id: Optional[str] = None
    created_at: float = Field(default_factory=time.time)
    completed_at: Optional[float] = None
    progress: JobProgress = Field(default_factory=JobProgress)
    grading_setup_snapshot: Optional[Dict[str, Any]] = Field(
        default=None,
        description=(
            "Public, key-free task grading configuration captured before a "
            "batch starts. It is audit metadata, never a provider credential."
        ),
    )
    results: Optional[Dict[str, Any]] = None
    final_result_versions: List[Dict[str, Any]] = Field(
        default_factory=list,
        description=(
            "Immutable teacher-confirmed result snapshots. Each entry carries "
            "a monotonically increasing version and the effective grading payload."
        ),
    )
    result_artifacts: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict,
        description=(
            "Version-keyed metadata for deterministic result exports. File bytes "
            "are rebuilt from the immutable snapshot and are never stored here."
        ),
    )
    error: Optional[str] = None


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


# ─── Task-level grading setup (C-01) ────────────────────────────────────────

GradingAggregationMethod = Literal["single", "weighted_average", "judge_agent"]
GradingKnowledgeScope = Literal["none", "all_task_docs"]
GradingFeedbackTone = Literal["encouraging", "neutral", "strict"]
GradingFeedbackLength = Literal["short", "medium", "long"]
GradingFeedbackLanguage = Literal["zh", "en"]


class TaskGradingSetup(BaseModel):
    """Versioned, key-free configuration that a task's grader really consumes.

    C-01 deliberately exposes only capabilities implemented by the current
    grading pipeline. In particular, task knowledge can be all-or-none; the
    in-memory retriever cannot yet select individual files or library groups.
    """

    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1] = 1
    selected_provider_ids: List[str] = Field(min_length=1, max_length=8)
    primary_provider_id: str = Field(min_length=1, max_length=240)
    aggregation_method: GradingAggregationMethod = "single"
    multi_sample_n: int = Field(default=1, ge=1, le=5)
    knowledge_scope: GradingKnowledgeScope = "all_task_docs"
    strictness: int = Field(default=50, ge=0, le=100)
    allow_partial_credit: bool = True
    feedback_tone: GradingFeedbackTone = "neutral"
    feedback_length: GradingFeedbackLength = "medium"
    feedback_language: GradingFeedbackLanguage = "zh"
    suggest_corrections: bool = True
    low_confidence_threshold: float = Field(default=0.60, ge=0.30, le=0.80)
    teacher_notes: str = Field(default="", max_length=500)

    @field_validator("selected_provider_ids", mode="before")
    @classmethod
    def _normalize_provider_ids(cls, value):
        if not isinstance(value, list):
            return value
        return [item.strip() if isinstance(item, str) else item for item in value]

    @field_validator("primary_provider_id", "teacher_notes", mode="before")
    @classmethod
    def _strip_text(cls, value):
        return value.strip() if isinstance(value, str) else value


# ─── User / Course / Assignment models (P0 — multi-role product) ──────────────

Role = Literal["teacher", "student", "admin"]


class User(BaseModel):
    """A user record (teacher / student / admin)."""
    id: str
    username: str
    email: str = ""
    role: Role = "teacher"
    password_hash: str = Field("", description="bcrypt hash; never returned to clients")
    course_ids: List[str] = Field(default_factory=list, description="Courses this user belongs to (teacher: owns; student: enrolled)")
    created_at: float = Field(default_factory=time.time)

    def public(self) -> Dict[str, Any]:
        """Dict safe to return to clients (no password hash)."""
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "role": self.role,
            "course_ids": self.course_ids,
            "created_at": self.created_at,
        }


class Course(BaseModel):
    """A course / class."""
    id: str
    name: str
    code: str = ""
    description: str = ""
    teacher_id: str
    student_ids: List[str] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time)


ProblemStructureMode = Literal["organized", "extract_from_source"]


class CourseMaterial(BaseModel):
    """Owner-scoped course-library source kept in process memory for Stage 1.

    Extracted ``text`` is deliberately excluded from ``public()`` so listing
    endpoints never expose source contents. Raw upload bytes are never retained
    after preflight. A future object-storage /
    PostgreSQL repository can replace the in-memory store without changing the
    API shape.
    """

    material_id: str
    owner_id: str
    course_id: Optional[str] = None
    filename: str
    content_type: str = "application/octet-stream"
    size_bytes: int
    sha256: str
    text: str = Field(repr=False)
    resident_bytes: int = 0
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

    def public(self) -> Dict[str, Any]:
        return {
            "material_id": self.material_id,
            "course_id": self.course_id,
            "filename": self.filename,
            "content_type": self.content_type,
            "size_bytes": self.size_bytes,
            "sha256": self.sha256,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class ProblemSourceDraft(BaseModel):
    """Short-lived, owner/task-scoped source prepared before LLM extraction."""

    source_token: str
    task_id: str
    owner_id: str
    source_kind: Literal["upload", "library"]
    structure_mode: ProblemStructureMode
    extraction_hint: str = ""
    filename: str
    content_type: str = "application/octet-stream"
    size_bytes: int
    content_sha256: str
    # Library-backed drafts retain only the stable material reference + hash.
    # Unsaved uploads retain only extracted text, never the original bytes.
    text: Optional[str] = Field(default=None, repr=False)
    library_material_id: Optional[str] = None
    base_workflow_revision: int = 0
    resident_bytes: int = 0
    candidates: List[Dict[str, Any]] = Field(default_factory=list)
    not_found: List[str] = Field(default_factory=list)
    requires_confirmation: bool = False
    created_at: float = Field(default_factory=time.time)
    expires_at: float


class MaterialImportDraft(BaseModel):
    """Short-lived, owner/task-scoped source for a Q-08 material import.

    It deliberately uses a different token/model from ``ProblemSourceDraft``:
    a material-import token must never be accepted by the destructive problem
    extraction endpoint.
    """

    source_token: str
    task_id: str
    owner_id: str
    source_kind: Literal["upload", "library"]
    targets: List[MaterialImportTarget]
    structure_mode: ProblemStructureMode
    extraction_hint: str = ""
    filename: str
    content_type: str = "application/octet-stream"
    size_bytes: int
    content_sha256: str
    text: Optional[str] = Field(default=None, repr=False)
    library_material_id: Optional[str] = None
    base_workflow_revision: int = 0
    resident_bytes: int = 0
    candidates: List[Dict[str, Any]] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time)
    expires_at: float


class MaterialImportCandidate(BaseModel):
    """One reviewed field proposal produced by the material-matching model."""

    candidate_id: str
    q_id: str
    target: MaterialImportTarget
    text_value: Optional[str] = None
    test_cases: Optional[List[TestCase]] = None
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    match_status: Literal["exact", "possible"] = "possible"
    source_excerpt: str = Field(default="", max_length=600)
    source_location: str = Field(default="", max_length=160)
    reason: str = Field(default="", max_length=300)
    would_overwrite: bool = False


class MaterialImportPlan(BaseModel):
    """Bounded in-memory review plan; no question data is changed until apply."""

    job_id: str
    task_id: str
    owner_id: str
    request_fingerprint: str
    source_kind: Literal["upload", "library"]
    source_filename: str
    library_material_id: Optional[str] = None
    targets: List[MaterialImportTarget]
    structure_mode: ProblemStructureMode
    extraction_hint: str = ""
    status: Literal["running", "ready", "applied", "error"] = "running"
    candidates: List[MaterialImportCandidate] = Field(default_factory=list)
    summary: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None
    applied_candidate_ids: List[str] = Field(default_factory=list)
    created_at: float = Field(default_factory=time.time)
    completed_at: Optional[float] = None
    expires_at: float


class AICompletionCandidate(BaseModel):
    """One bounded Q-09 generation result, applied only if its slot is empty."""

    candidate_id: str
    target_id: str
    q_id: str
    target: AICompletionTarget
    text_value: Optional[str] = Field(default=None, max_length=100_000)
    test_cases: Optional[List[TestCase]] = Field(default=None, max_length=12)


class AICompletionJob(BaseModel):
    """Owner-scoped Q-09 job metadata retained briefly for progress recovery."""

    job_id: str
    task_id: str
    owner_id: str
    request_fingerprint: str
    target_ids: List[str] = Field(default_factory=list, max_length=200)
    test_case_count: int = Field(default=6, ge=1, le=12)
    provider_id: str
    status: Literal["running", "done", "error"] = "running"
    summary: Dict[str, Any] = Field(default_factory=dict)
    applied_target_ids: List[str] = Field(default_factory=list)
    skipped_target_ids: List[str] = Field(default_factory=list)
    error: Optional[str] = None
    created_at: float = Field(default_factory=time.time)
    completed_at: Optional[float] = None
    expires_at: float


TagColor = Literal["slate", "blue", "teal", "green", "amber", "rose", "violet"]


class Tag(BaseModel):
    """Owner-scoped task label.

    Tags intentionally use a small semantic colour palette instead of accepting
    arbitrary CSS values.  The React client maps these names to the restrained,
    low-saturation pills used by the Figma design.

    Storage is currently in-memory (see :class:`backend.state.TagStore`) and is
    therefore lost when the backend process restarts.
    """

    id: str
    name: str
    normalized_name: str
    color: TagColor = "slate"
    owner_id: str
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

    def public(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "normalized_name": self.normalized_name,
            "color": self.color,
            "owner_id": self.owner_id,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


class Assignment(BaseModel):
    """An assignment within a course.

    Wraps the existing problem_data structure (dict[q_id → ProblemInfo-like]) and
    adds metadata (course, due date, publish status) so students can see and
    submit to it.
    """
    id: str
    course_id: str
    teacher_id: str
    name: str
    description: str = ""
    problem_data: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    status: Literal["draft", "published", "closed"] = "draft"
    due_at: Optional[float] = None
    created_at: float = Field(default_factory=time.time)
    published_at: Optional[float] = None


class Submission(BaseModel):
    """A student's submission for an assignment."""
    id: str
    assignment_id: str
    student_id: str
    answers: Dict[str, str] = Field(default_factory=dict, description="{q_id: answer_text}")
    file_name: str = ""
    submitted_at: float = Field(default_factory=time.time)
    job_id: Optional[str] = Field(None, description="Linked grading job_id")
    grade: Optional[Dict[str, Any]] = Field(None, description="Final grade dict (corrections + total)")


# ─── Task lifecycle (frontend_v2 task-centric workflow) ───────────────────────

TaskStatus = Literal[
    "draft",
    "extracting_problems",
    "problems_ready",
    "parsing_submissions",
    "submissions_ready",
    "grading",
    "graded",
    "review_confirmed",
    "generating_analysis",
    "finalized",
    "error",
]


class Task(BaseModel):
    """A grading task — bundles problems + submissions + grading job into one
    user-visible unit. Replaces the global problem_store/student_store coupling
    by making each task carry its own data.

    Status machine (linear, with `error` as a sink):
        draft
          → extracting_problems → problems_ready
          → parsing_submissions → submissions_ready
          → grading → graded → review_confirmed
          → generating_analysis → finalized
        any phase → error (recoverable by re-uploading)
    """
    task_id: str
    name: str = "Untitled task"
    owner_id: str = "anonymous"
    status: TaskStatus = "draft"

    # History/catalogue metadata.  These are IDs, not embedded mutable
    # objects: course_id must refer to a course owned by owner_id and tag_ids
    # must refer to tags owned by owner_id (enforced by the Tasks API).
    semester_id: Optional[str] = None
    course_id: Optional[str] = None
    tag_ids: List[str] = Field(default_factory=list)
    workflow_revision: int = 0

    problem_data: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    student_data: Dict[str, Dict[str, Any]] = Field(default_factory=dict)

    extract_job_id: Optional[str] = None
    parse_job_id: Optional[str] = None
    grading_job_id: Optional[str] = None

    # A-00 separates mutable teacher review overlays from immutable formal
    # result versions. Analysis/export freshness is intentionally independent
    # from the top-level task status: editing a confirmed result marks the
    # artifacts stale without deleting the last auditable snapshot.
    final_result_version: int = Field(default=0, ge=0)
    final_result_fingerprint: Optional[str] = None
    final_result_updated_at: Optional[float] = None
    final_result_updated_by: Optional[str] = None
    final_result_dirty: bool = False
    analysis_status: Literal[
        "not_generated", "generating", "ready", "stale"
    ] = "not_generated"
    analysis_result_version: Optional[int] = Field(default=None, ge=1)
    analysis_generated_at: Optional[float] = None
    analysis_error: Optional[str] = None

    # C-01 is the single editable source for task-level grading behavior.
    # It is embedded in the in-memory task so C-02 can later be a read-only
    # preflight instead of a second configuration page.
    grading_setup: Optional[TaskGradingSetup] = None
    grading_setup_fingerprint: Optional[str] = None
    grading_setup_updated_at: Optional[float] = None

    problem_file_hash: Optional[str] = None
    submission_file_hash: Optional[str] = None
    problem_file_name: Optional[str] = None
    submission_file_name: Optional[str] = None

    # The successful extraction fingerprint includes bytes + structure mode +
    # hint + confirmed candidates.  Pending fields keep replacement atomic: a
    # failed extraction must not destroy the previous successful source/data.
    problem_request_fingerprint: Optional[str] = None
    pending_problem_request_fingerprint: Optional[str] = None
    pending_problem_file_hash: Optional[str] = None
    pending_problem_file_name: Optional[str] = None
    problem_structure_mode: ProblemStructureMode = "organized"
    problem_extraction_hint: str = ""
    problem_confirmed_candidates: List[str] = Field(default_factory=list)
    problem_library_material_id: Optional[str] = None
    pending_submission_file_hash: Optional[str] = None
    pending_submission_file_name: Optional[str] = None
    submission_request_fingerprint: Optional[str] = None
    pending_submission_request_fingerprint: Optional[str] = None
    submission_identity_mode: SubmissionIdentityMode = "filename"
    pending_submission_identity_mode: Optional[SubmissionIdentityMode] = None
    submission_roster_name: Optional[str] = None
    pending_submission_roster_name: Optional[str] = None
    submission_recognition_provider_id: Optional[str] = None
    pending_submission_recognition_provider_id: Optional[str] = None
    last_failed_job_id: Optional[str] = None

    # Reference answers (calculation-style problems) — auxiliary upload, does NOT
    # change task.status. Stored per-question in problem_data[q_id]["reference_answer"]
    # after parsing; these top-level fields hold the upload metadata.
    reference_file_hash: Optional[str] = None
    reference_file_name: Optional[str] = None
    reference_parse_job_id: Optional[str] = None

    # Test cases (programming problems) — same model as reference. Stored per-question
    # in problem_data[q_id]["test_cases"] after parsing.
    test_cases_file_hash: Optional[str] = None
    test_cases_file_name: Optional[str] = None
    test_cases_parse_job_id: Optional[str] = None

    # Q-08 material import is a two-phase auxiliary workflow. The background
    # job only builds a review plan; accepted candidates are applied later in
    # one workflow-revision CAS. Pending and successful fingerprints are kept
    # separate so a failed attempt can be retried with the same source.
    material_import_job_id: Optional[str] = None
    pending_material_import_fingerprint: Optional[str] = None
    material_import_fingerprint: Optional[str] = None
    last_material_import_job_id: Optional[str] = None
    material_import_error: Optional[str] = None
    last_failed_material_import_fingerprint: Optional[str] = None
    material_import_retry_revision: Optional[int] = None

    # Q-09 AI completion runs only after the teacher confirms an explicit
    # missing-field scope. The worker may fill still-empty slots in one CAS;
    # it never overwrites teacher/imported/confirmed material.
    ai_completion_job_id: Optional[str] = None
    pending_ai_completion_fingerprint: Optional[str] = None
    ai_completion_fingerprint: Optional[str] = None
    last_ai_completion_job_id: Optional[str] = None
    ai_completion_error: Optional[str] = None
    last_failed_ai_completion_fingerprint: Optional[str] = None
    ai_completion_retry_revision: Optional[int] = None

    # ─── Task-scoped knowledge base (RAG MVP) ─────────────────────────────
    # Mirror metadata for documents uploaded via POST /tasks/{id}/kb. The
    # actual chunks + vectors live in backend.rag.store.InMemoryTaskRetriever
    # (pure in-memory, evicted with the task). Keys = doc_id (random hex);
    # values = KBDoc.public() shape. Frontend reads this dict to render the
    # uploaded-files list on the Setup page.
    kb_docs: Dict[str, Dict[str, Any]] = Field(default_factory=dict)

    error: Optional[str] = None
    created_at: float = Field(default_factory=time.time)
    updated_at: float = Field(default_factory=time.time)

    def lite(self) -> Dict[str, Any]:
        """Metadata-only representation for list views (no problem/student data)."""
        return {
            "task_id": self.task_id,
            "name": self.name,
            "owner_id": self.owner_id,
            "status": self.status,
            "semester_id": self.semester_id,
            "course_id": self.course_id,
            "tag_ids": list(self.tag_ids),
            "workflow_revision": self.workflow_revision,
            "extract_job_id": self.extract_job_id,
            "parse_job_id": self.parse_job_id,
            "grading_job_id": self.grading_job_id,
            "final_result_version": self.final_result_version,
            "final_result_updated_at": self.final_result_updated_at,
            "final_result_dirty": self.final_result_dirty,
            "analysis_status": self.analysis_status,
            "analysis_result_version": self.analysis_result_version,
            "analysis_generated_at": self.analysis_generated_at,
            "analysis_error": self.analysis_error,
            "grading_setup_configured": self.grading_setup is not None,
            "problem_file_name": self.problem_file_name,
            "pending_problem_file_name": self.pending_problem_file_name,
            "pending_submission_file_name": self.pending_submission_file_name,
            "submission_identity_mode": self.submission_identity_mode,
            "submission_roster_name": self.submission_roster_name,
            "submission_recognition_provider_id": self.submission_recognition_provider_id,
            "last_failed_job_id": self.last_failed_job_id,
            "problem_structure_mode": self.problem_structure_mode,
            "problem_extraction_hint": self.problem_extraction_hint,
            "problem_confirmed_candidates": list(self.problem_confirmed_candidates),
            "problem_library_material_id": self.problem_library_material_id,
            "submission_file_name": self.submission_file_name,
            "reference_file_name": self.reference_file_name,
            "test_cases_file_name": self.test_cases_file_name,
            "reference_parse_job_id": self.reference_parse_job_id,
            "test_cases_parse_job_id": self.test_cases_parse_job_id,
            "material_import_job_id": self.material_import_job_id,
            "last_material_import_job_id": self.last_material_import_job_id,
            "material_import_error": self.material_import_error,
            "ai_completion_job_id": self.ai_completion_job_id,
            "last_ai_completion_job_id": self.last_ai_completion_job_id,
            "ai_completion_error": self.ai_completion_error,
            "problem_count": len(self.problem_data),
            "student_count": len(self.student_data),
            "kb_docs": dict(self.kb_docs),
            "kb_doc_count": len(self.kb_docs),
            "error": self.error,
            # List endpoints enrich this with grading-result review signals.
            # The base value remains truthful for state/detail responses.
            "needs_attention": (
                self.status in {"draft", "problems_ready", "submissions_ready", "graded", "error"}
                or self.final_result_dirty
                or self.analysis_status == "stale"
                or bool(self.error)
            ),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
