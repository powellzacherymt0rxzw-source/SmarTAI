# Q01–Q03 题目资料统一准备与审核：后端实施契约（2026-07-26）

> 状态：兼容期统一编排首版已实现并通过定向回归；结构化题目包、字段级 CAS、持久化与沙箱校验仍按本文继续实施。
>
> 适用范围：Q01 题目资料来源、Q02 统一处理进度、Q03 风险矩阵，以及后续连续题目审核页。
>
> 覆盖规则：本文是 2026-07-26 起题目准备后端的唯一实施入口。若本文与
> `Q01_ADD_PROBLEMS_STAGE_DECISION_AND_ACCEPTANCE_CN.md`、
> `Q08_BULK_MATERIAL_IMPORT_STAGE_DECISION_AND_ACCEPTANCE_CN.md`、
> `Q09_AI_COMPLETE_MISSING_MATERIALS_STAGE_DECISION_AND_ACCEPTANCE_CN.md`
> 冲突，以本文为准；后三份只保留为旧实现与可复用安全合同的历史记录。

## 1. 后端要支持的最终教师流程

```text
Q01：为四类资料分别添加 0..N 个来源
  题目（至少 1 个）
  标答（可选）
  评分标准（可选）
  编程题测试资料（可选）
        ↓
每个来源独立配置：上传/课程资料库 + 已按题整理/从原文提取 + 提取说明
评分标准额外允许自然语言 `inline_text` 来源
        ↓
一次点击“识别并准备题目资料”
        ↓
一个可恢复后台 Job 内部完成：抽题、匹配来源、生成缺项、风险检测、原子提交
        ↓
Q03：只显示低置信、来源冲突、AI/原文冲突、解析异常等需教师关注的问题
        ↓
连续审核页：左侧可滚动题号目录；右侧每题完整展示全部适用资料
        ↓
页面底部一次确认全部题目资料 → problems_ready
```

“一次处理”表示前端只有一个任务、一个进度和一个成功/失败结果；后台可以执行多个有界子步骤，不能要求教师再进入“批量导入”和“AI 补缺”两个独立流程。

## 2. 当前代码审计与必须停止扩展的旧形态

| 当前实现 | 现状 | 新实现要求 |
|---|---|---|
| `backend/agents/ingest_agent.py::extract_problems` | 一次 LLM 同时抽题并生成字符串 `criterion` | 只作为统一编排中的“题目结构识别”能力；不再是完整流程 |
| `POST /tasks/{id}/extract_problems` | 单一题目来源直接启动任务 | 迁移为新 manifest/job API 的兼容适配器 |
| `POST /tasks/{id}/upload_reference` | 题目完成后另起标答解析 | 底层匹配能力并入统一 Job，不再新增前端主入口 |
| `POST /tasks/{id}/upload_test_cases` | 题目完成后另起测试样例解析 | 底层解析能力并入统一 Job；数据模型升级后保留兼容适配 |
| Q08 material import | `preflight -> plan -> review -> CAS apply` | 复用 owner 隔离、来源 token、候选与 CAS；不再保持独立教师流程 |
| Q09 AI completion | problems_ready 后 missing-only 生成 | 复用幂等、provenance、失败恢复；生成改为统一 Job 的内部子步骤 |
| `ProblemInfo` | `stem/criterion/reference_answer` 为字符串，测试样例结构较薄 | 升级为带来源、置信度、版本、风险和步骤关系的题目知识包 |
| `Task.problem_data` | 松散 `dict[str, dict]`，任务级内存存储 | API 先通过 repository 接口访问；Stage 1 可用内存 adapter，正式阶段落 PostgreSQL/对象存储 |

禁止在旧 Q08/Q09 endpoint 中继续添加新业务分支；所有新能力先进入统一 domain service，再由旧 endpoint 调用兼容层。

## 3. 统一来源 Manifest

### 3.1 来源角色

```python
PreparationSourceRole = Literal[
    "problem",          # 题目
    "reference_answer", # 标答/解答
    "rubric",           # 评分标准
    "programming_tests",# 仅编程题消费
]
```

- 四类都允许多个来源，满足作业被拆成多份文件、教材答案与补充答案并存等情况。
- `problem` 至少一个；其余角色可以为零。
- manifest 中的稳定顺序只用于显示和匹配提示，不作为静默覆盖优先级。
- 多来源内容等价时合并 provenance；内容不等价时保留候选并产生 `source_conflict`，不能按上传先后悄悄覆盖。

### 3.2 每份来源独立配置

```python
class PreparationSourceDraft(BaseModel):
    source_token: str
    task_id: str
    owner_id: str
    role: PreparationSourceRole
    source_kind: Literal["upload", "library", "inline_text"]
    structure_mode: Literal["organized", "extract_from_source"]
    extraction_hint: str
    filename: str
    content_type: str
    size_bytes: int
    content_sha256: str
    library_material_id: str | None
    text: str | None                 # 仅短期内存 adapter；原始字节不放 Task
    base_workflow_revision: int
    expires_at: float
```

来源 token 必须绑定 owner、task、role、hash 和 workflow revision；`problem` token 不能被当作 rubric token 使用。上传文件与资料库引用使用同一公开 schema，但资料库读取时必须再次校验 owner 和 hash。`inline_text` 只允许 `rubric` 角色，不能假装成文件、不能直接标记“同时保存到资料库”，并且前后端统一限制为 12,000 字。

### 3.3 来源优先规则

最终字段选择顺序固定为：

1. 教师已保存的字段编辑；
2. 教师明确确认的来源候选；
3. 多来源内容一致的高置信候选；
4. AI 生成候选。

存在两个不一致的来源时，系统可以给出一个“当前建议值”方便阅读，但必须同时保留 alternatives 和风险项，等待教师处理；AI 不得擅自把冲突解释为某一方正确。

## 4. 题目知识包数据模型

### 4.1 共用字段外壳

```python
class PreparedField(BaseModel):
    value: Any  # 由题干/标答/rubric/programming 的外层 schema 约束具体类型
    origin: Literal["source", "ai_generated", "teacher_edited"]
    source_ids: list[str]
    confidence: float | None
    review_status: Literal["ready", "needs_review", "edited", "confirmed"]
    issue_ids: list[str]
    field_version: int
    updated_at: float
    updated_by: str | None
```

- LaTeX/Markdown 源码按原文保存，后端不把它转成 HTML；浏览态由前端安全渲染，编辑态返回同一源码。
- `ai_generated` 是正常来源，不等于“缺失”。只有生成失败或必需字段无有效值时才产生阻断问题。
- 每个字段独立 `field_version`，编辑接口做字段级 CAS，避免修改标答时覆盖另一处刚保存的评分标准。

### 4.2 标答步骤与评分步骤

```python
class SolutionStep(BaseModel):
    step_id: str
    order: int
    title: str
    content: str
    is_final_answer: bool = False

class RubricItem(BaseModel):
    item_id: str
    order: int
    answer_step_ids: list[str]
    criterion: str
    points: float
    partial_credit: str = ""

class StructuredRubric(BaseModel):
    max_score: float
    items: list[RubricItem]
```

- 上传标答只有最终答案时，统一 Job 生成可审核的 `SolutionStep[]`，并明确标注哪些步骤来自 AI 扩展。
- 每个非整体性 rubric item 必须引用至少一个真实 `answer_step_id`；整体表达/规范等评分项使用显式 `scope="holistic"`，不能伪造步骤关系。
- 服务端验证分值非负、总分一致和引用有效。删除被 rubric 引用的答案步骤时，要求同时重映射或返回 `rubric_step_reference_conflict`，不得留下悬空关系。

### 4.3 风险模型

```python
class PreparationIssue(BaseModel):
    issue_id: str
    q_id: str | None
    field: Literal["stem", "answer", "rubric", "programming_tests", "source"]
    code: Literal[
        "low_confidence",
        "source_conflict",
        "ai_source_conflict",
        "ambiguous_question_match",
        "unmapped_source_content",
        "parse_anomaly",
        "generation_failed",
        "rubric_step_reference_conflict",
        "invalid_test_case",
        "reference_solution_failed_case",
    ]
    severity: Literal["info", "warning", "blocking"]
    source_ids: list[str]
    details: dict
    status: Literal["open", "acknowledged", "resolved"]
```

Q03 默认只消费 open issue；正常完成的题干、AI 生成标答和评分标准不返回“缺失”状态。非编程题不创建 `programming_tests` 字段或“不适用”问题。

### 4.4 最终题目包

```python
class QuestionPreparationPackage(BaseModel):
    q_id: str
    number: str
    type: str
    stem: PreparedField[str]
    solution: PreparedField[list[SolutionStep]]
    rubric: PreparedField[StructuredRubric]
    programming: PreparedField[ProgrammingSpec] | None = None
    issues: list[PreparationIssue]
    package_version: int
```

序列化使用 `exclude_none=True`。因此非编程题响应中不出现测试样例对象，前端也没有理由显示“编程题测试样例”字样。

## 5. 编程题测试样例：按成熟 OJ 的数据层次设计

LeetCode 的公开题目示例把每例清楚拆成 `Input / Output / Explanation`，函数题另有参数与返回值 metadata；运行与提交时又会使用未公开用例。SmarTAI 采用这种清晰层次，但面向教师审核增加来源、置信度和参考解校验。

```python
class ProgrammingTestCase(BaseModel):
    case_id: str
    title: str                         # 例 1、边界：空输入等
    visibility: Literal["example", "hidden"]
    purpose: Literal["normal", "boundary", "error", "performance", "other"]
    points: float | None = None
    io_mode: Literal["stdin", "function"]
    stdin: str | None = None
    expected_stdout: str | None = None
    function_name: str | None = None
    function_args: list[Any] | None = None
    expected_return: Any | None = None
    explanation: str = ""
    comparison: Literal["exact", "trimmed", "numeric_tolerance"] = "trimmed"
    tolerance: float | None = None
    origin: Literal["source", "ai_generated", "teacher_edited"]
    source_ids: list[str]
    confidence: float | None
    validation_status: Literal["not_run", "passed", "failed", "unsupported"]
    validation_message_code: str | None
```

后端行为：

- 教师审核页按“示例 1/2/3”展示输入、期望输出和解释；可逐例编辑、复制、运行参考解。
- 测试区先显示“公开样例数 / 隐藏测试数 / 参考解通过数”，再按例查看；不把所有输入输出挤进一个自由文本框。
- `example` 用例可进入教师下载/将来的学生题面；`hidden` 用例只显示给有权限的教师，学生接口和公开导出只返回数量，绝不返回输入与答案。
- 函数题使用结构化参数/返回值；标准输入题使用 stdin/stdout，不能混在一个含糊文本框里。
- 参考实现存在时，统一 Job 在现有沙箱限制内逐例验证。失败生成 `reference_solution_failed_case`，不能把失败用例悄悄保存为正常。
- AI 可以补边界用例，但必须标为 `ai_generated`；教师来源样例不会被 AI 覆盖。
- 对比策略、浮点容差、超时和运行环境是受限枚举/配置，禁止接受任意 shell 命令或不受控测试脚本。
- 每例可有分值与用途；正式评分按测试用例得分时，服务端验证总分和 rubric 中的编程测试评分项一致。

## 6. 新 API 契约

### 6.1 来源草稿

| Method | Path | 作用 |
|---|---|---|
| `POST` | `/tasks/{id}/question-preparation/sources/preflight` | 上传文件或引用资料库，返回 role-bound token、确定性候选与事实摘要；零 provider |
| `GET` | `/tasks/{id}/question-preparation/draft` | 返回当前来源 manifest，不返回原始文件字节 |
| `DELETE` | `/tasks/{id}/question-preparation/sources/{token}` | 删除尚未启动的本人来源草稿 |

### 6.2 一次性准备 Job

```python
class StartQuestionPreparationRequest(BaseModel):
    source_tokens: list[str]
    expected_workflow_revision: int
    replace_confirmed: bool = False
    generation_policy: Literal["complete_required_materials"]
```

| Method | Path | 作用 |
|---|---|---|
| `POST` | `/tasks/{id}/question-preparation/jobs` | 校验整个 manifest 后启动唯一后台 Job |
| `GET` | `/tasks/{id}/question-preparation/jobs/{job_id}` | 返回事实进度、稳定步骤码、指标和脱敏错误 |
| `GET` | `/tasks/{id}/question-preparation` | 返回当前成功版本、compact index、风险摘要 |

请求 fingerprint 必须包含：排序后的 role/source hash、每份来源模式与 hint、确认候选、generation policy、provider/model、prompt/schema version。相同请求运行中返回 `already_running`，成功完成返回 `already_done`；不同请求运行中返回稳定冲突码。失败不得清空上一次成功题目包。

### 6.3 连续审核与独立编辑

| Method | Path | 作用 |
|---|---|---|
| `GET` | `/tasks/{id}/question-preparation/index` | 左侧题号栏的轻量全量索引：题号、题型、风险数、当前锚点 |
| `GET` | `/tasks/{id}/question-preparation/questions?cursor=&limit=` | 连续长页按顺序分批加载完整题目包 |
| `GET` | `/tasks/{id}/question-preparation/issues` | Q03 风险矩阵；支持字段、题型、严重度、状态与排序白名单 |
| `PATCH` | `/tasks/{id}/question-preparation/questions/{qid}/fields/{field}` | 独立保存题干、标答、评分标准或编程测试，要求 `expected_field_version` |
| `POST` | `/tasks/{id}/question-preparation/confirm` | 页面底部一次确认全部；提交已处理/已知晓 issue 和 expected revision |

“保存并看下一题”是前端保存成功后滚动到下一个锚点，不建立第二套单题模式，也不要求逐题确认。`confirm` 是唯一阶段确认动作。

### 6.4 下载

新增独立的题目准备导出，不与最终批改报告混淆：

`GET /tasks/{id}/question-preparation/exports/{answers|rubrics|tests}?format=md|tex|json|zip`

- 标答与评分标准可以在题目资料确认后导出；测试导出只包含编程题。
- 公开导出默认不含 hidden case；教师专用包必须显式选择并做 owner/role 校验。
- 未就绪时返回稳定 `artifact_not_ready`，前端据此灰化并说明，不用猜状态。

## 7. Agent → Skill → Tool 编排

新增 `QuestionPreparationAgent`，保持项目分层：

```text
API
  → QuestionPreparationAgent（事务、顺序、进度、失败恢复）
      → ProblemExtractionSkill
      → MaterialAlignmentSkill
      → SolutionExpansionSkill
      → RubricAlignmentSkill
      → ProgrammingTestPreparationSkill
          → file_processing / structured_llm / sandbox_runtime / numerical
```

每个 Skill 通过构造函数接收 provider，每个 meaningful substep 接收同一个 `ProgressReporter`。建议稳定步骤码：

1. `validating_sources`
2. `extracting_questions`
3. `aligning_uploaded_materials`
4. `generating_solutions`
5. `aligning_rubrics`
6. `preparing_programming_tests`
7. `detecting_conflicts`
8. `committing_question_packages`

前端只展示一个进度任务；并行子调用必须有并发上限，遵守 provider RPM/重试和用户额度。来源文档是非可信输入，必须继续使用反提示注入前缀，日志只记 hash/数量/稳定错误码，不记 key、全文或 provider 原始响应。

## 8. 状态机与确认语义

目标状态：

```text
draft
  → preparing_questions
  → questions_review_pending
  → problems_ready
  → parsing_submissions ...
```

- 兼容期可把 `preparing_questions` 映射到旧 `extracting_problems`，但公开 API 应返回稳定的新 phase。
- Job 原子提交成功后进入 `questions_review_pending`；不能因为 AI 已生成资料就直接冒充教师确认。
- 底部一次确认后才进入 `problems_ready` 并开放作答上传/批改设置。
- warning 可以由教师明确知晓后整体确认；blocking issue 必须先解决。
- 编辑已确认的题目资料会提高 workflow revision，并使下游解析/批改/结果按既有 stale 规则失效；禁止静默改变既有正式结果。

## 9. 持久化边界：先定义 repository，避免再重写业务层

当前 `TaskStore`、source draft、job 和 `problem_data` 都是进程内存。实现统一流程时先定义以下 repository protocol，即使首版 adapter 仍使用内存：

- `PreparationSourceRepository`
- `QuestionPreparationJobRepository`
- `QuestionPackageRepository`
- `PreparationIssueRepository`

正式存储建议拆为：`question_preparation_sources`、`question_preparation_jobs`、`questions`、`question_field_versions`、`solution_steps`、`rubric_items`、`programming_test_cases`、`preparation_issues`。原始文件进入 owner-scoped 对象存储，数据库只存 object key、hash、元数据和引用；hidden test 必须使用单独访问策略。这样 PostgreSQL/对象存储接入时替换 adapter，不重写 Agent/Skill/API 语义。

## 10. 旧数据与旧路由迁移

1. 为旧 `ProblemInfo` 建只读转换器：
   - `stem` → `PreparedField[str]`
   - `reference_answer` → 一个 legacy solution step
   - `criterion` → 一个 legacy rubric item；未建立步骤关系时产生 warning，不伪造对应
   - `test_cases` → 新 `ProgrammingTestCase[]`
2. 旧 `/extract_problems`、`/upload_reference`、`/upload_test_cases`、Q08、Q09 endpoint 只调用新 domain service 或返回 canonical migration 信息；不得复制编排逻辑。
3. 新版本稳定并完成前端迁移后，再分阶段 deprecate 旧 endpoint；不能直接删除导致已有草稿不可恢复。

## 11. 后端实现顺序

### BQ-01：模型与 repository 接口

- 新来源 manifest、知识包、步骤 rubric、OJ 测试样例、issue 和 field-version 模型。
- 旧 `ProblemInfo` 转换器与非编程题 `programming=None` 合同。

### BQ-02：统一来源与幂等 Job

- 复用 Q01/Q08 token 安全合同，支持每类多来源。
- 新 Agent/Skills、一个 fingerprint、一个 ProgressReporter、一次原子提交。
- Q08/Q09 只保留兼容适配。

### BQ-03：风险矩阵与连续审核 API

- compact index、分页题目包、风险查询、字段级 CAS 保存和底部 confirm-all。
- LaTeX 源码往返不损坏；非编程题 API 不返回测试区。

### BQ-04：编程题 OJ 校验与导出

- example/hidden、stdin/function 两种模式、参考解逐例沙箱校验、稳定失败码。
- 标答/评分标准/测试资料导出及 hidden 防泄漏测试。

### BQ-05：PostgreSQL/对象存储 adapter

- owner 隔离、事务/CAS、job 恢复、source 生命周期和 hidden test 权限落库。

前端 G08/Q01 不能等待 BQ-05 才开始，但 BQ-01 就必须以 repository 为边界，不能继续直接向 `Task.problem_data` 塞更多松散字段。

## 12. 必须通过的后端验收矩阵

- owner/task/role-bound token 不能跨用户、跨任务或跨资料角色复用。
- 四类各多来源，顺序变化但语义相同时幂等；来源内容变化时新 fingerprint。
- 两份来源冲突时保留 alternatives 并返回 issue，不静默覆盖。
- 只上传题目时同一 Job 生成步骤标答与对应 rubric；正常生成项不被标成 missing。
- 只上传最终答案时补全过程，并保留“原文件最终答案 + AI 扩展步骤”的 provenance。
- rubric 分值、step 引用和答案步骤删除冲突均由 schema/服务端验证。
- 非编程题响应完全省略 programming/tests；不生成“不适用”风险。
- 编程题公开样例含 Input/Output/Explanation；hidden case 不出现在学生/公开导出。
- 参考实现跑不过某例时产生风险，不能显示为已准备完成。
- 同请求 running/done、不同请求 running、失败重试、worker 过期和 CAS 冲突均有确定性测试。
- 任一子步骤失败时保留上一成功版本；不出现半套新题干配旧标答。
- 独立编辑只增加目标 field version；另一字段并发保存不被覆盖。
- confirm-all 遇 blocking issue 拒绝；warning 明确知晓后可一次确认。
- 旧数据转换和旧 endpoint 兼容回归通过。
- ProgressReporter 覆盖每个 Agent/Skill/Tool 重要子步骤，错误对外只返回稳定码。

## 13. OJ 参考依据

- LeetCode 官方 Two Sum 题面：公开样例按 Example 编号，并分别展示 Input、Output、Explanation；题目 metadata 另存函数名、参数和返回类型：<https://leetcode.com/problems/two-sum/description/>。
- LeetCode 官方竞赛规则明确存在不向用户展示的 hidden test cases，并在测试问题修正后执行 rejudge：<https://leetcode.com/discuss/post/951105/New-Contest-Rule-/>
- HackerRank 官方测试用例文档同样把 sample 与 hidden 分开；每例具有 input 和 expected output，sample 对作答者可见，hidden 用于覆盖边界场景：<https://support.hackerrank.com/articles/3245197419-test-cases-in-coding-questions>。
- HackerRank 官方 custom checker 文档说明近似答案需要受控校验逻辑，并可返回逐例结果、分数和消息：<https://support.hackerrank.com/articles/6515044510-creating-a-custom-checker>。

SmarTAI 只借鉴上述清晰的信息层次和防泄漏边界，不复制 LeetCode 的视觉样式；可见外观仍以本项目 Figma 的留白、字体、圆角和克制配色为准。

## 14. 2026-07-26 兼容期实施快照

本节记录已经进入代码的事实，避免后续后端把“目标契约”和“现有能力”混为一谈。目标数据模型与最终 API 仍以前文为准。

### 14.1 本轮已经实现

- `PreparationSourceRole` 已进入 `backend/models.py`，来源草稿按 `problem / reference_answer / rubric / programming_tests` 绑定角色；旧抽题接口拒绝复用非题目 token。
- rubric 自然语言规则已作为明确的 `source_kind="inline_text"` 接入同一个 preflight；服务端要求 file/library/inline_text 三选一、限制 rubric 角色与 12,000 字，并继续绑定 owner、task、hash 和 workflow revision。它进入统一准备 Job，不另建“保存文字规则”旁路。
- `POST /tasks/{id}/question-preparation/sources/preflight` 已作为 role-aware 预检入口；上传和课程资料库来源都继续复用 owner、task、hash、workflow revision 与过期校验。JSON 只新增为编程测试资料可接受格式，不代表 OCR/DOCX 已支持。
- `POST /tasks/{id}/question-preparation/jobs` 已接入一次性编排：一个请求收集四类多来源、一个 fingerprint、一个后台任务、一个 `ProgressReporter` 和一次 `TaskStore.commit_problem_extraction` 原子提交。相同请求继续沿用既有 running/done 幂等门禁。
- 新增 `backend/agents/question_preparation_agent.py` 作为兼容期编排层，顺序执行题目抽取、可选资料匹配、缺项生成、答案过程扩展、rubric 对齐提示、编程测试归一化与风险收集。任一步异常都走旧成功版本保留/失败恢复路径。
- 未上传的标答与评分标准会在同一任务内生成；上传标答即使只有最终答案，也会进入“保留最终答案并补全过程”的生成要求。非编程题在提交前删除 `solution_code/test_cases`。
- `TestCase` 已补 `title / visibility / purpose / io_mode`，前端可按成熟 OJ 的“示例/隐藏、输入、期望输出、解释”层次审核；当前仍未执行参考解沙箱。
- 当前兼容数据在每题 `preparation_issues` 中记录 open risk；教师编辑某一字段时，只把同字段的 open risk 标记为 resolved，不会顺手清掉其他冲突。
- 契约回归覆盖 role-aware 预检、JSON、统一任务一次提交、旧 token 角色隔离及逐字段风险解除；2026-07-26 定向结果为 `51 passed, 1 skipped`，随后整库回归为 `233 passed, 1 skipped`。

### 14.2 本轮尚未实现，后端不得误判为完成

1. 当前 `ProblemInfo` 仍以字符串题干/标答/评分标准和松散 provenance 为主；`PreparedField`、`SolutionStep`、`RubricItem.answer_step_ids`、独立 `field_version` 尚未落地。
2. 当前风险来自资料匹配置信度、来源候选差异和生成失败；真正的 AI/原文逐字段冲突检测、alternatives 完整保留和 blocking/warning 确认规则仍需 BQ-03。
3. `/question-preparation/index`、分页 questions、独立 issues 查询、字段级 PATCH/CAS、confirm-all 和准备资料导出仍未成为正式后端 API；前端首版暂时通过现有 task/problem 更新合同完成连续审核。
4. repository protocol、PostgreSQL、对象存储、可恢复 job 和 hidden test 独立权限仍未实现；来源、任务、问题包依旧受进程内存生命周期限制。
5. OJ 测试只完成展示字段兼容；参考解执行、逐例结果、超时/容差、hidden 防泄漏接口与 tests 导出仍属于 BQ-04。
6. 旧 Q08/Q09 route 仍保留兼容能力，但新前端主流程已删除对应“批量导入资料 / AI 补全缺失项”入口。后端后续应让旧 endpoint 调用统一 domain service，再做 deprecate，不复制新分支。

### 14.3 2026-07-28 自然语言评分标准合同验证

- `POST /tasks/{id}/question-preparation/sources/preflight` 接受 rubric `inline_text`，返回 `source.kind = inline_text` 和不冒充真实上传的稳定展示名。
- 非 rubric 角色使用文字来源返回 `inline_text_requires_rubric_role`；同时提交多种来源仍按“恰好一个来源”拒绝；文字来源不能直接保存到课程资料库。
- 超过 12,000 字返回 `413` 和稳定码 `inline_rubric_character_limit_exceeded`；契约测试已覆盖成功、角色隔离、超长和多来源冲突。

### 14.4 后续后端一次做对的顺序

1. 先完成 `PreparedField + SolutionStep + StructuredRubric + PreparationIssue` 与旧数据转换器，并建立 repository protocol；这是字段级编辑、步骤对应和持久化的共同前置。
2. 再把当前兼容编排从松散 `problem_data` 迁入统一 domain service，补 alternatives、结构化 provenance、语义冲突检测和稳定 issue code。
3. 接着交付 index / questions / issues / field-CAS / confirm-all API，让连续审核页不再逐题循环调用旧 PUT。
4. 最后完成 OJ 沙箱与导出，再替换 PostgreSQL/对象存储 adapter。每一步继续保留旧 route 适配和 idempotency 回归，直到前端迁移完成。
