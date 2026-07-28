# SmarTAI 教师端前端完成度与后端对接指南

> 日期：2026-07-28
> 适用分支：`codex/figma-first-frontend-redesign`
> 当前前端：`frontend/app/`（Vite + React）
> 当前后端：`backend/`（FastAPI，V2 only）
> 面向读者：产品负责人、前端/后端工程师、测试人员

## 1. 结论先行

### 1.1 前端完成度

按“教师端 canonical 页面、导航、主要交互、真实 API 消费和错误恢复是否已经实现”计算，当前前端工程完成度为 **100%**：没有尚未搭建的教师主流程页面，也没有需要再保留第二套页面才能完成的功能。

这个结论不等于整个产品能力已经 100% 上线。以下内容仍是后端或外部验收边界：

- OCR、图片、扫描 PDF、手写作答和 DOCX 识别尚未实现；前端已经读取能力合同并如实禁用。
- Task、Job、BYOK、课程/标签、题目来源草稿、RAG 和结果产物仍主要保存在内存，重启会丢失。
- 真正语义/拼音 SmartQuery、大班级全量服务端查询和持久化图表尚未完成。
- 题目包仍以 `stem / reference_answer / criterion / test_cases` 为主，缺少稳定“答案步骤 ↔ 评分项”结构；这也是评分标准常出现粗略 `5+5` 的根因。
- 真实 provider 的成功、quota、rate limit、超时恢复仍需低成本测试 key 验收。
- 原生 200% 缩放、VoiceOver/NVDA 和最终用户主观签收属于人工验收，不是缺页。

用户已明确本轮不再复核 Figma，因此 Figma 逐帧签收不计入本次代码完整度。

### 1.2 当前唯一教师流程

```text
1 新建任务
→ 2 上传题目
→ 3 审核题目
→ 4 上传作答
→ 5 校对作答
→ 6 执行批改
→ 7 复核批改
→ 8 结果分析
```

第 6 步内部是：批改设置 → 10 秒只读任务摘要 → 批改进度。摘要页不是第二套设置页。

## 2. Canonical 前端页面

路由入口位于 `frontend/app/src/main.tsx`。

| 业务区域 | Canonical route | 前端实现 |
|---|---|---|
| 工作台 | `/` | `routes/DashboardPage.tsx` |
| 历史任务 | `/history` | `routes/HistoryPage.tsx` |
| 课程资料库 | `/knowledge-base` | `routes/KnowledgeBasePage.tsx` |
| 新建/编辑任务 | `/tasks/new`、`/tasks/:id/edit` | `routes/NewTaskPage.tsx` |
| 上传题目与可选资料 | `/tasks/:id/upload/problems` | `routes/tasks/AddProblemsPage.tsx` |
| 题目资料准备进度 | `/tasks/:id/problems/progress` | `routes/tasks/ProblemRecognitionProgressPage.tsx` |
| 题目风险矩阵 | `/tasks/:id/questions` | `routes/tasks/QuestionPreparationOverviewPage.tsx` |
| 题目连续审核 | `/tasks/:id/questions/:qid/:section` | `routes/tasks/QuestionPreparationDetailPage.tsx` |
| 上传作答 | `/tasks/:id/submissions/upload` | `routes/tasks/AddSubmissionsPage.tsx` |
| 作答识别进度 | `/tasks/:id/submissions/progress` | `routes/tasks/SubmissionRecognitionProgressPage.tsx` |
| 作答矩阵 | `/tasks/:id/submissions` | `routes/tasks/SubmissionReviewOverviewPage.tsx` |
| 单学生全题连续校对 | `/tasks/:id/students/:sid?question=:qid` | `routes/tasks/StudentAnswerReviewPage.tsx` |
| 批改设置 | `/tasks/:id/grading-setup` | `routes/tasks/GradingSetupPage.tsx` |
| 批改任务摘要 | `/tasks/:id/grading/preflight` | `routes/tasks/GradingPreflightPage.tsx` |
| 批改进度 | `/tasks/:id/grading/progress` | `routes/tasks/GradingProgressPage.tsx` |
| 复核矩阵 | `/tasks/:id/review` | `routes/tasks/ReviewOverviewPage.tsx` |
| 单学生全题连续复核 | `/tasks/:id/review/:sid/:qid` | `routes/tasks/ReviewDetailPage.tsx`；`:qid` 只用于首次定位 |
| 结果总览 | `/tasks/:id/results` | `routes/tasks/FinalResultsWorkspacePage.tsx` |
| 题目分析 | `/tasks/:id/results/questions[/:qid]` | 同一结果工作区 |
| 学生分析 | `/tasks/:id/results/students[/:sid]` | 同一结果工作区 |
| 可视化分析 | `/tasks/:id/results/visualizations` | 同一结果工作区 |
| 报告与下载 | `/tasks/:id/results/reports` | 同一结果工作区 |
| 模型与 BYOK | `/settings/byok` | `routes/ExpertsPage.tsx` |
| 账户设置 | `/settings/account` | `routes/SettingsPage.tsx` |

说明：`/questions/import` 和 `/questions/ai-complete` 仍是旧 Q08/Q09 的兼容深链，主流程没有入口。后端完成统一 domain service 迁移前不要直接删除其 API；迁移完成后可连同兼容前端路由一起废弃。

## 3. 前端代码分层与后端对接位置

### 3.1 HTTP 与错误标准化

- `frontend/app/src/api/client.ts`
  - Axios 基础实例、认证、后端 URL、错误标准化。
  - 后端应优先返回 `detail: { code, ...safe_fields }`；不要让前端解析 provider 原始异常字符串。

### 3.2 API client

| 前端文件 | 负责的后端区域 |
|---|---|
| `api/auth.ts` | `/auth/*` |
| `api/tasks.ts` | `/tasks/*` 的任务、作答、批改、复核、finalization、artifact |
| `api/problemSources.ts` | 题目来源能力、预检、统一题目准备 Job |
| `api/materialImports.ts` | 旧 Q08 兼容链 |
| `api/aiCompletions.ts` | 旧 Q09 兼容链 |
| `api/gradingSetup.ts` | `/tasks/:id/grading-setup` |
| `api/analytics.ts` | `/analytics/:task_id/*` |
| `api/courseMaterials.ts` | `/materials/*` |
| `api/kb.ts` | `/tasks/:id/kb/*` |
| `api/experts.ts` | `/experts/*` |
| `api/courses.ts` | `/courses/*` |
| `api/tags.ts` | `/tags/*` |

每个区域的 React Query 缓存、mutation 和失效规则位于 `frontend/app/src/api/hooks/`。共享 query key 位于 `frontend/app/src/api/hooks/keys.ts`；后端修改 mutation 响应字段时应同步检查该文件和相应 hook。

### 3.3 TypeScript 合同

| 前端文件 | 核心类型 |
|---|---|
| `types/task.ts` | `Task`、`TaskStateSnapshot`、题目、作答、批改结果、复核覆盖层、finalization/artifact |
| `types/problemSources.ts` | 四类来源、能力合同、预检与统一 Job |
| `types/progress.ts` | `JobProgress` v1 |
| `types/gradingSetup.ts` | 任务级模型、资料和评分策略 |
| `types/analytics.ts` | 安全图表与题目统计 |
| `types/history.ts` | 历史查询、条件与分页 |
| `types/courseMaterials.ts` | 课程资料及分组 |
| `types/experts.ts` | BYOK 配置与验证状态 |

后端 Pydantic 模型或响应新增/改名时，必须先更新这些类型，再更新 API client 和页面；不要在页面里用 `any` 绕过合同。

## 4. 本轮新增并已对齐的题目准备接口

### 4.1 GET `/tasks/{task_id}/question-preparation/capabilities`

用途：Q01 从后端读取事实能力，不再根据文件选择器猜测 OCR/格式支持。

当前响应关键字段：

```json
{
  "contract_version": 1,
  "operation": "question_preparation",
  "stage_sequence": [
    "validating_sources",
    "extracting_questions",
    "aligning_uploaded_materials",
    "generating_solutions",
    "aligning_rubrics",
    "preparing_programming_tests",
    "detecting_conflicts",
    "committing_question_packages"
  ],
  "source_roles": {
    "problem": {"accepted_extensions": [".pdf", ".txt", ".md"]},
    "reference_answer": {"accepted_extensions": [".pdf", ".txt", ".md"]},
    "rubric": {"accepted_extensions": [".pdf", ".txt", ".md"], "inline_text": true},
    "programming_tests": {"accepted_extensions": [".pdf", ".txt", ".md", ".json"]}
  },
  "reader": {
    "selectable_text_pdf": true,
    "ocr": false,
    "vision": false,
    "scanned_pdf": false,
    "images": false,
    "docx": false
  }
}
```

实现：

- 后端：`backend/api/tasks.py::get_question_preparation_capabilities`
- 前端 client：`frontend/app/src/api/problemSources.ts::getQuestionPreparationCapabilities`
- 前端类型：`frontend/app/src/types/problemSources.ts::QuestionPreparationCapabilities`

以后增加 OCR 时，先扩展该合同及测试，再开放文件扩展名；不得只改前端 `accept`。

### 4.2 POST `/tasks/{task_id}/question-preparation/sources/preflight`

用途：逐份校验题目、标答、评分标准或编程测试来源，返回短期、owner/task/role-bound `source_token`。

请求是 multipart，三类来源严格三选一：

- `file`
- `library_material_id`
- `inline_text`（当前只允许 `role=rubric`）

其他字段：

- `role`: `problem | reference_answer | rubric | programming_tests`
- `structure_mode`: `organized | extract_from_source`
- `extraction_hint`
- `save_to_library`

自然语言评分标准限制为 12,000 字，不能同时保存到资料库。前端调用位于 `preflightProblemSource()`。

### 4.3 POST `/tasks/{task_id}/question-preparation/jobs`

用途：用多份 `source_token` 一次完成题目结构、资料对齐、缺项生成、风险检测和原子提交。

请求：

```json
{
  "source_tokens": ["ps_..."],
  "expected_workflow_revision": 3,
  "replace_confirmed": false,
  "generation_policy": "complete_required_materials"
}
```

启动响应额外返回：

- `operation: "question_preparation"`
- `progress_contract_version: 1`
- `job_id`
- `source_count`

后端实现：

- API 与原子提交：`backend/api/tasks.py`
- 外层编排：`backend/agents/question_preparation_agent.py`
- 内部提取/生成 skill：`backend/agents/ingest_agent.py`
- 进度约束：`backend/progress/tracker.py`

### 4.4 GET `/tasks/{task_id}/state`

前端统一轮询该接口。新增/关键字段：

- `active_job_id`
- `active_operation`
- `progress.contract_version`
- `progress.job_id`
- `progress.workflow`
- `progress.stage_sequence`
- `progress.current_step`
- `progress.total_steps / completed_steps`
- `progress.stage_metrics`

Q02 必须同时核对 `active_job_id` 和 `progress.job_id`，防止缓存中的旧 Job 覆盖当前页面。阶段顺序由后端返回；未知新阶段可以显示，但进度不能倒退。

## 5. 现有后端接口与页面对应关系

### 5.1 任务与目录

| 后端接口 | 前端用途 |
|---|---|
| `POST /tasks/` | 新建任务；带 idempotency key |
| `GET /tasks/` | 工作台/历史分页筛选 |
| `POST /tasks/query/interpret` | 历史确定性/可选智能解释 |
| `GET/PUT/DELETE /tasks/{id}` | 任务读取、编辑、删除 |
| `/courses/*`、`/tags/*` | 课程/标签 exact、related、新建和维护 |
| `/materials/*` | 课程资料库、分组、任务资料选择 |

### 5.2 作答与批改

| 后端接口 | 前端用途 |
|---|---|
| `POST /tasks/{id}/parse_submissions` | 上传后立即进入作答识别进度 |
| `PUT /tasks/{id}/students/{sid}/identity` | 身份修正 |
| `PUT /tasks/{id}/students/{sid}/answers/{qid}` | 作答文本与复核状态 CAS 保存 |
| `GET/PUT /tasks/{id}/grading-setup` | 第 6 步批改设置 |
| `POST /tasks/{id}/grade` | 摘要倒计时或“立即开始”共用幂等启动 |
| `GET /tasks/{id}/result` | 批改结果、复核和正式结果数据 |
| `PUT /tasks/{id}/reviews/{sid}/{qid}` | 教师最终得分、评语与确认 |

### 5.3 最终结果与分析

| 后端接口 | 前端用途 |
|---|---|
| `GET /tasks/{id}/finalization` | 复核门禁与正式版本状态 |
| `POST /tasks/{id}/finalization/confirm` | 生成不可变 final result 版本 |
| `POST /analytics/{id}/query` | 安全自然语言分析/图表请求 |
| `GET /analytics/{id}/per_question/{qid}` | 题目统计详情 |
| `GET /tasks/{id}/artifacts` | 版本、状态和文件索引 |
| `POST /tasks/{id}/artifacts/generate` | 为当前 final result 幂等生成报告 |
| `GET /tasks/{id}/artifacts/{version}/{artifact}` | 显式版本下载，禁止静默回退旧版本 |

### 5.4 BYOK 与任务 RAG

| 后端接口 | 前端用途 |
|---|---|
| `/experts/keys`、`/experts/available`、`/experts/catalog` | 添加、列表、官方入口 |
| `/experts/select`、`/{provider}/verify`、`PUT/DELETE /{provider}` | 启停、验证、修改、删除 |
| `POST/GET/DELETE /tasks/{id}/kb...` | 第 6 步补充教材/讲义资料 |

密钥不得出现在响应、INFO 日志、持久化明文或跨 owner cache 中。

## 6. 前端已经准备好、后端仍需完成的合同

| 优先级 | 后端缺口 | 前端准备情况 |
|---|---|---|
| P0 | 结构化题目包与细粒度 rubric | UI 已按每题知识包展示；需升级数据模型 |
| P0 | PostgreSQL + 对象存储 + repository | 页面已按稳定 ID、revision、version 消费；需替换内存 store |
| P0 | OCR/vision provider abstraction | Q01/Q02 已消费 capabilities 和动态 stage sequence |
| P1 | SmartQuery 统一 schema、大班级服务端查询、语义/拼音 | 搜索条、exact/related 展示、中文 composition 已完成 |
| P1 | 结构化 issue repository、字段级 CAS、confirm-all 门禁 | 风险矩阵与连续审核 UI 已存在 |
| P1 | 持久自定义图表与异步分析 artifact | 五个结果子页和版本/stale UI 已存在 |
| P2 | 学生 owner-scoped 标签 | 学生总览目前不伪造任务标签 |
| P2 | 工作台聚合优先级、多任务 ETA | 工作台只展示后端当前可证明的值 |

## 7. “评分标准经常是 5+5”应怎样处理

这是后端题目准备质量与 schema 问题，不是前端排版问题。当前 `backend/models.py::ProblemInfo.criterion` 仍是一个字符串；`backend/agents/ingest_agent.py` 的模型提示可以输出粗粒度文本，但没有结构校验确保：

- 所有关键解题步骤被覆盖；
- 分值总和等于题目满分；
- 每个评分项引用稳定答案步骤；
- 部分正确、等价解、单位/符号/边界条件有明确处理；
- 评分项不是机械平均分配。

后端应新增：

```text
SolutionStep { step_id, order, title, content, dependencies, source, confidence }
RubricItem   { rubric_id, answer_step_ids[], points, criterion,
               partial_credit, common_errors[], source, confidence }
StructuredRubric { max_points, items[], validation }
```

必须做 Pydantic 校验和一次受控修复：`sum(items.points) == max_points`、引用 step 存在、必需步骤覆盖、空项拒绝。前端可继续使用当前每题卡片，并在后端返回结构化字段后逐步增强，不需要重做路由。

## 8. 对接时必须保持的工程约束

1. 只使用 V2；不要恢复 `backend/routers/`、`backend/correct/`、`backend/dependencies.py` 或 `backend/utils.py`。
2. 保持 Agent → Skill → Tool，Skill 通过构造参数接收 provider，不调用全局 `get_llm()`。
3. 有意义的后台工作必须接 `ProgressReporter`；外层 Job 独占 lifecycle，嵌套 skill 不得重置阶段或提前 `done`。
4. 所有写接口使用 owner 校验、workflow revision/CAS、幂等指纹和稳定错误码。
5. 同请求重复必须返回 `already_running` 或 `already_done`；不同请求并发必须拒绝或显式 supersede，不能双写。
6. HTTP/HTTPS proxy 必须在 Google SDK/LangChain import 前配置。
7. `ChartOutput` 只开放白名单 trace；禁止返回任意 Plotly JSON。
8. 前端不消费秘密、原始 provider 错误或未经脱敏的日志。
9. 后端暂不支持的能力必须通过 capabilities 返回 false，而不是让前端猜测。
10. 旧兼容 API 只有迁入同一 domain service 后才能删除。

## 9. 联调验收清单

- [ ] 同一 mutation 重放得到 `already_running/already_done`，不重复调用 provider。
- [ ] 返回早期流程页后，已完成的后续步骤仍可点击回溯。
- [ ] BYOK 配置往返后 Q01/S01 主动作能恢复，不需要刷新。
- [ ] Q02/S02/C03 后台运行时刷新页面可恢复到同一 Job。
- [ ] 进度 `completed_steps` 单调不减，完成只在数据原子提交后出现。
- [ ] 修改题目/作答/教师结果使用最新 workflow revision；旧 revision 返回 409 且不写入。
- [ ] 修改 final result 后既有分析/报告明确变 `stale`，下载不自动回退旧版。
- [ ] OCR 为 false 时图片/扫描件返回结构化不可用错误；开放后 capabilities、stage、schema 与测试同时更新。
- [ ] 多 owner 不能读取任务、课程、标签、资料、BYOK、Job 或报告。
- [ ] 真实 provider 测试不把 key、完整 prompt、学生隐私或供应商原始异常写入 INFO 日志。

## 10. 当前验证基线

- 前端：`cd frontend/app && npm run lint && npm run build`
- 后端：`pytest backend/tests`
- Q01/Q02 定向：`pytest backend/tests/test_problem_sources_contract.py backend/tests/test_q02_q03_backend_contract.py`
- 代码卫生：`git diff --check`

2026-07-28 当前基线：前端 lint/build 通过；后端全量 `242 passed, 1 skipped`；Q01/Q02 相关 `59 passed, 1 skipped`。
