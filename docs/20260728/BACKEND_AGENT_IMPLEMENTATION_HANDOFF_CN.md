# SmarTAI 后端 Agent 实施交接书

> 日期：2026-07-28
> 目标读者：接手后端的 Codex/AI Agent 及其审核人
> 目标：在不破坏 OCR、Agent 主逻辑、RAG、数据库迁移和现有教师前端的前提下，把当前后端缺口一次接对

## 0. 任务目标

现有 Vite React 教师端的 canonical 页面和交互已经完成。后续工作的原则不是重写前端或建立第二条业务链，而是把稳定后端合同接到现有页面：

1. 把内存状态迁移到持久 repository/object storage。
2. 把题目、标答、评分标准和编程测试升级为结构化题目包。
3. 提供 OCR/vision provider abstraction，并通过能力合同和现有 Q02 进度页开放。
4. 统一 SmartQuery，支持大数据量服务端过滤/聚合、语义和拼音匹配。
5. 将最终分析、图表和报告变成版本化、可持久化 artifact。
6. 保留 owner 隔离、revision/CAS、幂等、ProgressReporter 和密钥安全。

不允许通过“新增一套临时 API + 新页面”绕过现有合同。

## 1. 开始前必须阅读

依次阅读：

1. `AGENTS.md`
2. `docs/20260620/PROJECT_STATUS_AND_ROADMAP_CN.md`
3. `docs/20260620/GO_TO_MARKET_AND_OPS_CN.md`
4. `docs/TASK_WORKFLOW_REFACTOR_CN.md`
5. `docs/20260728/FRONTEND_BACKEND_INTEGRATION_GUIDE_CN.md`
6. `docs/20260726/Q01_Q03_UNIFIED_QUESTION_PREPARATION_BACKEND_PLAN_CN.md`
7. `docs/20260726/Q01_Q03_UNIFIED_PREPARATION_IMPLEMENTATION_STAGE_CN.md`
8. `docs/20260711/FRONTEND_FIGMA_REBUILD_TRACKER_CN.md` 的 3、7、8、9.17、9.18 节

当前教师端以 `frontend/app/` 为准；`frontend/` 是旧 Reflex 回退/对照路径。不要把新 API 只接到旧 Reflex。

## 2. 不可破坏的约束

### 2.1 架构

- V2 only。`backend/main.py` 在非 V2 时会失败；不要恢复 V1 目录。
- 保持 Agent → Skill → Tool；Skill 从构造参数获得 provider。
- 共享状态必须通过 repository/store protocol；业务 Agent 不直接依赖 PostgreSQL driver、S3 client 或全局单例字典。
- proxy 环境变量必须早于 Google SDK/LangChain import。

### 2.2 安全

- 所有资源 owner-scoped：Task、Job、source、material、course、tag、BYOK、KB、artifact。
- BYOK key 不写磁盘明文、不进入 INFO 日志、不返回前端、不跨 owner 复用。
- 共享模型池开放前必须有持久化 per-user/day 请求和 token 硬限额、单专家/单采样强制及 kill switch。
- 错误响应只返回稳定 `detail.code` 和安全字段；原始 provider 异常只允许脱敏 ERROR/debug 记录。

### 2.3 并发与状态

- mutation 必须包含 owner 校验、expected revision/CAS 和幂等指纹。
- same request：返回 `already_running` 或 `already_done`。
- different request while busy：返回稳定 409，或显式 supersede；禁止两个 worker 同时提交。
- worker 提交前再次确认 job ownership/revision；stale worker 不写入。
- 失败保留上一成功版本，不先清空正式数据。

### 2.4 进度

- 外层 workflow 独占 `ProgressReporter` lifecycle。
- 嵌套 skill 可以发消息/事实计数，但不得替换 `workflow/stage_sequence`、降低 `completed_steps` 或提前 `done`。
- `completed_steps` 单调不减；最终完成只在原子提交成功后发布。
- 前端依据 `/tasks/{id}/state.active_job_id`、`active_operation` 和 `progress.job_id` 防止旧缓存串 Job。

## 3. 当前可复用实现

### 3.1 题目统一准备

- 编排：`backend/agents/question_preparation_agent.py`
- 提取/资料生成：`backend/agents/ingest_agent.py`
- API：`backend/api/tasks.py`
- 进度：`backend/progress/tracker.py`
- 数据模型：`backend/models.py`
- 内存 store：`backend/state/__init__.py`
- 合同测试：
  - `backend/tests/test_problem_sources_contract.py`
  - `backend/tests/test_q02_q03_backend_contract.py`
  - `backend/tests/test_problem_source_safety.py`
  - `backend/tests/test_q08_material_imports.py`
  - `backend/tests/test_q09_ai_completion.py`

当前已经有四类来源 token、统一单 Job、八阶段事实进度、原子提交和基础 provenance/issues。不要另建 `QuestionUploadAgentV2` 或第二个进度系统。

### 3.2 作答、批改、复核、结果

- 作答识别与 grading/finalization API：`backend/api/tasks.py`
- grading Agent：`backend/agents/grading_agent.py`
- 多专家：`backend/agents/multi_expert.py`
- analytics Agent 与安全图表：`backend/agents/analytics_agent.py`
- 结果产物：`backend/services/result_artifacts.py`
- 状态/不可变版本：`backend/state/__init__.py`

### 3.3 RAG

- 任务 KB API 已在 `backend/api/tasks.py`。
- 启动 wiring 已存在；存储仍为内存。
- 新题目包只能保存引用/检索策略，不应复制或重写 RAG 主逻辑。

## 4. 目标领域模型

先定义 protocol/Pydantic schema，再写 adapter 和迁移。不要把 API 响应直接等同数据库行。

### 4.1 SourceManifest

```python
class PreparationSource(BaseModel):
    source_id: str
    task_id: str
    owner_id: str
    role: Literal["problem", "reference_answer", "rubric", "programming_tests"]
    source_kind: Literal["upload", "library", "inline_text"]
    structure_mode: Literal["organized", "extract_from_source"]
    extraction_hint: str
    blob_key: str | None
    library_material_id: str | None
    sha256: str
    order: int
    reader_version: str
    created_at: datetime

class SourceManifest(BaseModel):
    manifest_id: str
    task_id: str
    owner_id: str
    base_workflow_revision: int
    sources: list[PreparationSource]
    provider_id: str
    prompt_version: str
    schema_version: int
    fingerprint: str
```

要求：

- 题目至少一份，其余角色可空；每类允许多份。
- `fingerprint` 包含所有 source 的 role/kind/mode/hint/hash/order、教师确认候选、provider/model、prompt/schema/reader version。
- 上传原文件放 object storage；数据库只放稳定 blob key/hash/metadata。
- source token 仍是短期授权，不作为持久主键。

### 4.2 QuestionPackage

```python
class PreparedField(BaseModel):
    content: str
    origin: Literal["teacher_upload", "course_library", "ai_generated", "teacher_edited"]
    source_ids: list[str]
    confidence: float | None
    review_status: Literal["pending", "edited", "confirmed"]
    field_version: int

class SolutionStep(BaseModel):
    step_id: str
    order: int
    title: str
    content: str
    dependencies: list[str] = []
    source_ids: list[str] = []
    confidence: float | None = None

class RubricItem(BaseModel):
    rubric_id: str
    order: int
    answer_step_ids: list[str]
    criterion: str
    points: float
    partial_credit: str
    common_errors: list[str] = []
    source_ids: list[str] = []
    confidence: float | None = None

class StructuredRubric(BaseModel):
    max_points: float
    items: list[RubricItem]

class QuestionPackage(BaseModel):
    package_id: str
    package_version: int
    task_id: str
    q_id: str
    number: str
    question_type: str
    stem: PreparedField
    solution_steps: list[SolutionStep]
    rubric: StructuredRubric
    programming: ProgrammingPackage | None
    issues: list[PreparationIssue]
```

Pydantic validator 必须保证：

- `RubricItem.answer_step_ids` 全部存在；
- `sum(points) == max_points`（按可配置精度）；
- order 唯一且稳定；
- 非编程题 `programming is None`，序列化不出现测试占位；
- 必需字段为空或生成失败产生 blocking issue；
- 普通 AI 生成不是 “missing”。

### 4.3 ProgrammingPackage

沿用现有 `TestCase` 字段，并补足：

```text
case_id
visibility: example | hidden
io_mode: stdin | function
input / expected_output / explanation
function_name / function_args / expected_return
source_ids / confidence
reference_run: not_run | passed | failed | unavailable
reference_run_detail (safe)
```

hidden test：

- 教师审核接口可见详情；
- 学生/公开报告只返回数量；
- 下载 hidden test 必须是明确教师包，不能混进公开标答。

### 4.4 IssueRepository

`PreparationIssue` 需要持久化：

```text
issue_id, task_id, q_id, field, code, severity,
source_ids, details, status, created_at, resolved_at, resolved_by
```

至少支持：低置信、来源冲突、AI/原文冲突、题号歧义、未映射内容、解析异常、生成失败、rubric-step 引用错误、非法测试、参考解测试失败。

## 5. API 目标与兼容策略

### 5.1 保持不变的现有公开入口

- `GET /tasks/{id}/question-preparation/capabilities`
- `POST /tasks/{id}/question-preparation/sources/preflight`
- `POST /tasks/{id}/question-preparation/jobs`
- `GET /tasks/{id}/state`
- `GET /tasks/{id}`

可以加字段，不得无版本改名或改变已有语义。

### 5.2 应新增的 canonical 接口

建议前缀全部位于 `/tasks/{task_id}/question-preparation`：

```text
GET   /index?cursor=&limit=&risk=&query=
GET   /questions/{q_id}
PATCH /questions/{q_id}/fields/{field}
POST  /issues/{issue_id}/resolve
POST  /confirm
GET   /exports
POST  /exports
GET   /exports/{export_id}
```

合同：

- `index` 返回紧凑矩阵数据和游标，不返回全部长文本。
- `PATCH` 请求包含 `expected_workflow_revision`、`expected_field_version`、内容和可选 review status；返回新 field/package/workflow version。
- `confirm` 一次确认全部，若有 blocking issue 返回 409 和可安全展示的 issue IDs；不要求逐题点击确认。
- `exports` 显式区分标答、评分标准、公开测试和教师 hidden-test 包。

在这些接口落地前，保留当前 `PUT /tasks/{id}/problems/{q_id}` 兼容路径。迁移顺序是：domain service → 新 API → 前端类型/client → 兼容适配 → 删除旧实现，不能先删。

### 5.3 旧 Q08/Q09 与 legacy endpoints

待迁移：

- `/extract_problems`
- `/upload_reference`
- `/upload_test_cases`
- `/material-imports/*`
- `/ai-completions/*`
- 前端 `/questions/import*`、`/questions/ai-complete*`

正确做法：这些 endpoint 调同一个 QuestionPreparationService/repository，并标记 deprecation。确认无主流程/外部客户端依赖后，再删除兼容前端 route 和 API。禁止让兼容路径继续维护另一份 orchestration。

## 6. OCR/vision 接入方案

### 6.1 新 abstraction

建议新增：

```text
backend/ocr/base.py
backend/ocr/registry.py
backend/ocr/providers/<provider>.py
backend/ocr/models.py
```

接口示意：

```python
class OCRProvider(Protocol):
    provider_id: str
    async def inspect(self, blob: BlobRef) -> DocumentInspection: ...
    async def recognize(
        self,
        blob: BlobRef,
        *,
        pages: list[int] | None,
        reporter: ProgressReporter,
    ) -> RecognizedDocument: ...
```

`RecognizedDocument` 必须保留页码、块坐标、阅读顺序、文本/LaTeX、置信度、源图引用和 provider/version。不要直接返回一段无定位纯文本。

### 6.2 与现有流程的连接

1. capabilities 中将对应 reader flags 改为 true，并新增接受扩展名。
2. Q01 preflight 将原文件写 object storage，创建 inspection，不直接把图片 bytes 放 TaskStore。
3. QuestionPreparationAgent 在后端 `stage_sequence` 中插入真实阶段，例如：
   - `inspecting_documents`
   - `recognizing_scanned_content`
   - `normalizing_layout`
4. 前端 Q02 已按后端 stage sequence 动态渲染；只需新增 i18n label，未知 stage 也不会重置进度。
5. OCR 失败必须产生结构化 issue/error；不能把空 OCR 当作“题目为空”继续生成。

OCR provider 不应知道课程 RAG、grading skill 或数据库事务；只返回版本化文档结果。

## 7. 评分标准质量改造

当前频繁 `5+5` 的原因是 `ProblemInfo.criterion: str` 和生成提示没有结构验证。实施顺序：

1. 新增 `SolutionStep / RubricItem / StructuredRubric` Pydantic schema。
2. 修改 `backend/agents/ingest_agent.py` 的题目/资料生成输出为结构化 JSON。
3. Prompt 明确：先解题并识别不可省略步骤，再按教学价值分配分值；不得默认均分；必须描述部分得分、等价方法和常见错误。
4. validation：分值和、step 引用、覆盖、空 criterion、重复 item。
5. validation 失败时只允许一次 bounded repair；仍失败则产生 blocking `rubric_invalid` issue，不提交伪精细结果。
6. grading skill 优先消费结构化 rubric；兼容期可生成旧 `criterion` 展示文本，但它是派生字段而非 source of truth。
7. 增加金标 fixture：概念、计算、证明、编程、多解题、只有最终答案的来源。

不要在前端把字符串按换行猜成步骤。

## 8. SmartQuery 后端计划

统一请求/响应：

```text
SmartQueryRequest {
  scope, text, current_filters, current_sort, cursor, limit, result_version
}

SmartQueryResponse {
  filters, sort, explanation, matched_ids, match_kind,
  chart_request?, cursor?, total?, warnings[]
}
```

要求：

- 先执行白名单 deterministic parser；可选 LLM 只生成 schema，不生成 SQL。
- 服务端把 schema 编译为参数化 repository 查询。
- 学生与题目两个 scope 独立维护，不相互清空。
- exact 与 related 分开；语义/拼音结果必须有解释。
- 查询覆盖完整数据集或服务端聚合，不先取前 50 条再过滤。
- chart request 经过 `ChartOutput` 白名单；如新增 heatmap，定义专门 `x/y/z` schema 和尺寸上限。
- rate limit/timeout 返回稳定错误码，前端保留用户输入与已有筛选。

建议先实现历史、题目、学生三个 repository adapter，再扩展复核和可视化；不要为每个页面定义不同自然语言协议。

## 9. 持久化迁移

### 9.1 Repository protocols

先为当前内存 store 抽象 protocol：

```text
TaskRepository
JobRepository
ExpertRepository
CourseRepository
TagRepository
CourseMaterialRepository
PreparationSourceRepository
QuestionPackageRepository
IssueRepository
KnowledgeRepository
ArtifactRepository
UsageLimitRepository
```

现有 `backend/state/__init__.py` 变为 memory adapter，不再让 API/Agent 访问 `_tasks/_active` 等内部字典。

### 9.2 PostgreSQL 与对象存储职责

- PostgreSQL：owner、任务/版本、关系、状态、CAS revision、metadata、审计、usage counter。
- 对象存储：原始上传、OCR 中间结果、报告、ZIP、PNG/PDF、hidden-test 教师包。
- 不在数据库存 BYOK 明文；使用 envelope encryption/KMS 或受控 secret store，表中只放 ciphertext metadata。
- artifact 下载使用 owner 校验后的短时 URL 或后端流式响应。
- transaction 同时写 domain 状态和 outbox/event；长 Job 不持有数据库事务。

### 9.3 迁移兼容

- 所有公开 ID 保持稳定。
- API 响应继续保留现有字段，新增 `schema_version`/`package_version`。
- 提供 memory→DB 开发迁移脚本只用于测试数据；不要假装恢复丢失的生产内存数据。
- deployment 前增加备份、迁移锁、health/readiness 与回滚说明。

## 10. 实施波次

### Wave 1：合同与 repository 骨架

- 建 Pydantic schema、protocol、memory adapter。
- 不改变前端响应。
- 增加 owner/CAS/idempotency contract tests。

完成门禁：全量旧测试通过；API snapshot 无破坏变化。

### Wave 2：结构化题目包与 rubric

- QuestionPreparationAgent 返回 `QuestionPackage`。
- 旧 `ProblemInfo` 由 adapter 派生。
- 新 index/detail/field PATCH/confirm 接口落地。
- grading skill 双读，优先新 schema。

完成门禁：金标 rubric 测试、分值和/step 引用 validator、失败保留旧版本。

### Wave 3：PostgreSQL/object storage

- 逐个 repository 切换；先 Task/Job/source/package/issue，再 BYOK/RAG/artifact。
- 不同时重写 Agent 算法。

完成门禁：重启恢复、并发 CAS、跨 owner、迁移回滚、对象孤儿清理。

### Wave 4：OCR provider

- 先 inspection/capability，再 OCR 识别，再题目/作答接入。
- 使用现有 ProgressReporter workflow，不新建页面。

完成门禁：文本 PDF 回归不变；扫描 PDF/图片有页块定位和置信度；失败可重试。

### Wave 5：SmartQuery 与 analytics artifact

- 统一 schema、服务端查询、语义/拼音、持久图表/报告。
- 保持 ChartOutput 白名单和 result version 绑定。

完成门禁：大班级全量查询、输入解释、限流恢复、stale 版本与下载安全。

## 11. 文件级变更地图

优先修改：

| 目标 | 文件/目录 |
|---|---|
| Pydantic schema | `backend/models.py`，成熟后可拆 `backend/domain/question_preparation.py` |
| Question preparation 编排 | `backend/agents/question_preparation_agent.py` |
|  bounded extraction/generation | `backend/agents/ingest_agent.py` |
| Task API | `backend/api/tasks.py`；稳定后按 domain 拆 API module，但不恢复 V1 router |
| Analytics schema/Agent | `backend/agents/analytics_agent.py`、`backend/api/analytics.py` |
| Progress | `backend/progress/tracker.py` |
| State/repository adapter | `backend/state/__init__.py`，新增 `backend/repositories/` |
| Result artifacts | `backend/services/result_artifacts.py` |
| OCR | 新增 `backend/ocr/` |
| 前端合同 | `frontend/app/src/types/` |
| 前端 API client | `frontend/app/src/api/`、`frontend/app/src/api/hooks/` |

不要无关修改：

- `frontend/app/src/main.tsx` 的 canonical route，除非产品明确新增页面。
- 已统一的学生/题目连续详情布局。
- 旧 Reflex 前端，除非单独要求同步。
- grading provider/RAG 内核与持久化/OCR 同一提交大改；每波保持可回滚。

## 12. 必须新增或保留的测试

### 12.1 题目准备

- 四类多来源、三选一来源、role-bound token、过期 token、跨 owner。
- same-running/same-done/different-running、stale worker、失败重试、原子提交。
- 八阶段单调进度、nested skill 不改 workflow、完成后才 8/8。
- 来源冲突不按上传顺序静默覆盖。
- 结构化 rubric 分值和、step 引用、部分得分与多解。
- 非编程题不序列化 programming/test 文案。
- hidden test 不进入公开 API/导出。

### 12.2 OCR

- selectable-text PDF 不走 OCR。
- scanned PDF/image 走 OCR；capabilities 与扩展名一致。
- 页码/块坐标/阅读顺序/LaTeX/置信度。
- provider timeout/quota/partial page failure/retry。
- 原文件与识别结果 owner 隔离及对象清理。

### 12.3 持久化

- 服务重启后 Task/Job/BYOK/RAG/artifact 恢复。
- PostgreSQL transaction/CAS 与多 worker 并发。
- artifact version/stale/explicit historical download。
- 删除任务后的引用计数与对象回收。

### 12.4 SmartQuery

- 中文 composition 与请求幂等不属于后端，但后端必须接受最终完整字符串。
- exact/related/拼音/语义解释。
- 全量分页、游标稳定、排序、无匹配和大班级。
- LLM schema 注入、未知 filter/trace 拒绝、禁止任意 SQL/Plotly。

## 13. 验证命令

在激活的 `smartai` Conda 环境中使用 `python`/`pip`：

```bash
pytest backend/tests
pytest backend/tests/test_problem_sources_contract.py \
       backend/tests/test_q02_q03_backend_contract.py \
       backend/tests/test_problem_source_safety.py

cd frontend/app
npm run lint
npm run build

cd ../..
git diff --check
```

涉及数据库/OCR/provider 时还需新增隔离集成测试；默认测试不得消费真实付费 provider。

## 14. Definition of Done

每个波次只有同时满足以下条件才可完成：

- 旧 canonical API 与前端页面不回归。
- 新 schema 有版本、有 Pydantic validation、有 migration。
- owner、CAS、幂等、stale worker、失败保留旧版本测试齐全。
- 长任务有事实 ProgressReporter 子步骤；无伪 ETA/计时进度。
- 错误码稳定、安全、可恢复；无 key/隐私泄漏。
- memory 与持久 adapter 的 contract test 一致。
- 前端 TypeScript 类型、API client、React Query invalidation 同步。
- 后端全量测试、前端 lint/build、`git diff --check` 通过。
- 文档更新当前能力与明确未实现边界，不把 OCR/持久化/语义能力提前写成可用。

## 15. 交接时的停手条件

遇到以下情况不要自行扩张范围：

- 需要改变八步教师流程或新增教师页面；
- 需要改变评分总分来源、课程权限或学生可见 hidden test；
- 需要选择 KMS/secret store、对象存储供应商或生产数据保留周期；
- 需要开放共享付费模型池；
- 数据迁移可能删除/覆盖现有正式结果版本。

此时先提交合同、迁移影响和最小决策问题，不要先写不可逆代码。
