# SmarTAI Figma 优先前端重构追踪清单（2026-07-11）

> 当前工作分支：`codex/figma-first-frontend-redesign`
>
> 本文件是本次从零重构可见前端的唯一执行 tracker。`docs/20260704/FRONTEND_UX_IMPLEMENTATION_TRACKER_CN.md` 仅保留旧实现历史，不再用其勾选状态判断本轮是否完成。
>
> 视觉与页面结构以 `docs/20260710/figma/` 的 17 张导出图为基准；功能、状态和边界必须同时对照 2026-07-03 计划、2026-07-04 完整设计记录及其附录原话、2026-07-10 最新纠偏基线和 2026-07-11 用户补充。
>
> R1 进入代码前的逐页决定见 `docs/20260711/R1_PAGE_DECISION_CARDS_CN.md`；Q-01 当前阶段决定与验收口径见 `docs/20260715/Q01_ADD_PROBLEMS_STAGE_DECISION_AND_ACCEPTANCE_CN.md`；S-01 至 S-04 的阶段记录位于 `docs/20260723/`；S-05、C-02、C-03、R-01、R-02 与 A-00 记录位于 `docs/20260724/`。
>
> 当前阶段：A-04 已完成正式结果学生六指标、解释性自然语言/结构化筛选、5 人分页及学生 × 题目得分矩阵，桌面/移动浏览器与前端回归完成，等待用户视觉确认；下一阶段 A-05 替换 canonical 学生详情并完成双维导航。`auto-research-stateprep-v2` 已完成并空闲；累计第八阶段 A03 后官方只读接口显示周额度剩余 31%，相对 43% 起点平均约消耗 1.5 个百分点/阶段，继续以 15%+ 为硬保留线并在 A05 后再次检查。既有等待确认状态不变。

---

## 0. 状态、证据和验收规则

### 0.1 状态

- `[ ]`：未开始。
- `[~]`：实现中，尚未完成验收。
- `[x]`：代码、真实数据/明确 fixture 边界、测试、截图和用户验收全部通过。
- `[!]`：被后端、产品决定或外部条件阻断，后面必须写明原因和恢复条件。

### 0.2 每项完成记录

每个勾选项必须补充：

```text
完成时间：YYYY-MM-DD HH:mm UTC+8
实现证据：文件/route/commit
测试证据：typecheck/build/unit/flow
视觉证据：Figma 对照截图 + desktop/mobile 截图
数据边界：真实 API / fixture / feature flag
用户验收：待确认 / 已确认（日期）
偏差说明：无 / 已确认偏差及理由
```

### 0.3 页面决策卡门禁

每个新 route 动工前必须先提交页面决策卡：

- [ ] 对应 Figma frame/node 与必须保持的结构。
- [ ] 旧对话和文档已确定的功能、状态、边界。
- [ ] 真实 API、缺失 API 和数据迁移影响。
- [ ] 仍未确定的字段、默认值、导航和危险操作。
- [ ] 主 Agent 推荐方案及最多 1–3 个需要用户回答的问题。
- [ ] 用户确认会改变数据模型、流程或页面切分的决定。

每页实现后：

- [ ] 最小视觉证据为 `1440x900` Figma/实现对照和 `390x844` 移动端检查。
- [ ] 只有页面触发不同断点或发现布局风险时，再补 `1280x800`、`430x932` 响应式截图，避免无差别重复截图消耗额度。
- [ ] 提供可点击本地 route 和主流程说明。
- [ ] 提供功能/状态覆盖表和已知缺口。
- [ ] 用户确认后才开始该批下一页；共用 token、类型和无争议基础组件可并行。

---

## 1. 参考源冻结与优先级

- [x] SRC-01 已保存并核验 17 张 Figma PNG（`2880x1800`，对应 `1440x900` frame）。完成时间：2026-07-11 10:02 UTC+8。
- [x] SRC-02 已记录 17 个 Figma node id 与目标 route。完成时间：2026-07-11 10:02 UTC+8。
- [x] SRC-03 已确认 `codex/frontend-ux-docs` 与当前分支均基于提交 `66ca40e`，可直接读取旧结果页完整代码。完成时间：2026-07-11。
- [x] SRC-04 已保存用户提供的旧结果页局部截图：`docs/20260711/references/legacy-results-page-partial.png`。完成时间：2026-07-11。
- [ ] SRC-05 为旧实现关键 route 截取完整桌面/移动基线，不能只依赖局部截图。
- [x] SRC-06 已为本轮重点 frame 建立“Figma 固定结构 / 文档功能 / 最新用户覆盖”冲突表。完成时间：2026-07-11；见 2.1。
- [x] SRC-07 用户确认页面清单、结果页信息架构和第一批实施范围；页面命名与具体 route 由主 Agent 在保持后端简洁、无语义冲突的前提下统一确定。完成时间：2026-07-11 16:00 UTC+8。

### 1.1 `codex/frontend-ux-docs` 旧结果代码审计

该分支与当前分支在审计时均指向 `66ca40e`，以下不是根据局部截图猜测：

- [x] CODE-01 `frontend/app/src/components/tasks/ResultsLayout.tsx` 已定义总览、按题分析、可视化、学生详情、题目详情五种结果上下文。完成：2026-07-11。
- [x] CODE-02 `frontend/app/src/routes/tasks/TaskResultsPage.tsx` 已有 overview/questions/charts 三个视图、班级/学生/题目统计、自然语言摘要、自然语言学生筛选和自然语言图表请求。完成：2026-07-11。
- [x] CODE-03 `frontend/app/src/components/tasks/ResultsReviewPanel.tsx` 已有复核指标、学生 x 题目热力矩阵、低置信/专家分歧/分数异常队列和复核后生成流程外壳。完成：2026-07-11。
- [x] CODE-04 `frontend/app/src/routes/tasks/TaskStudentDetailPage.tsx` 已有学生下拉、上一位/下一位、学生全部题目长视图和跳转单题全班分析。完成：2026-07-11。
- [x] CODE-05 `frontend/app/src/routes/tasks/TaskQuestionDetailPage.tsx` 已有题干、评分标准、题目统计、易错点、题目下拉/上一题/下一题和学生互跳。完成：2026-07-11。
- [x] CODE-06 当前 `TaskQuestionDetailPage` 会在题目详情下方铺开每名学生完整答案；与最新要求冲突，必须改成学生摘要 + 精确跳转。完成：2026-07-11。
- [x] CODE-07 当前 `ResultsLayout` 使用横向五块大 tab，`AppShell` 使用固定全局左侧栏；只借鉴信息架构，不保留可见布局。完成：2026-07-11。
- [x] CODE-08 当前图表预览用普通 div 模拟，scatter 也显示为柱状缩略；必须换成真实图表组件。完成：2026-07-11。
- [x] CODE-09 当前复核确认、最终分数/评语和分析导出仍有禁用“待接入”控件；新 UI 只有在真实后端契约完成后才开放。完成：2026-07-11。

可复用边界：`buildResultsModel`、汇总类型、统计 helper、React Query hooks、Smart analytics API client、互跳语义和教师批注 mutation。默认替换：页面壳、固定侧栏、横向大 tab、长页组织、卡片嵌套、用户可见开发说明和伪图表。

参考优先级：

1. 用户最新确认。
2. `docs/20260710/FRONTEND_REDESIGN_RESET_BASELINE_CN.md` 的持续更新内容。
3. Figma 17 帧的视觉、层级、间距和已画页面骨架。
4. `docs/20260704/FRONTEND_UX_FULL_DESIGN_RECORD_CN.md`，尤其附录 A 的用户原话。
5. `docs/20260703/FRONTEND_UX_REFACTOR_PLAN_CN.md` 的功能与 API 边界。
6. 旧代码只复用 API、类型、状态、统计定义和有价值交互，不复用被否定的可见布局。

---

## 2. 已确认或待确认的核心产品决定

| ID | 决定 | 状态 | 备注 |
|---|---|---|---|
| D-01 | 全局桌面结构使用 Figma 顶部导航，删除固定全局左侧栏 | 已确认 | 最终结果区域允许使用局部左侧导航。 |
| D-02 | 顶栏当前项在导航文字本身加粗/加克制选中底，删除独立页面状态胶囊 | 已确认 | 任务阶段放任务上下文栏。 |
| D-03 | `历史任务` 保持顶部独立入口；工作台展示统计、少量待处理任务和洞察 | 已确认 | 中文主名称 `工作台`，英文 `Workspace`；文案统一进入 i18n，后续可低成本调整。 |
| D-04 | 用户名菜单包含账户设置、模型与 BYOK、退出登录 | 已确认 | 模型可用摘要位于用户名左侧。 |
| D-05 | 新建任务删除教学班/分组字段，使用固定学期、可选课程和灵活标签 | 已确认 | 教学班需求用自定义标签表达。 |
| D-06 | 历史任务支持标签、学期、课程、状态、未完成等结构化与自然语言筛选 | 已确认 | 课程是系统标签。 |
| D-07 | 添加题目支持上传/课程资料库，并支持“已按题整理/从原文提取” | 已确认 | 原文提取需要章节/题号等说明输入。 |
| D-08 | 学生和题目是两个互不干扰的筛选/导航维度 | 已确认 | 左右切学生，上下切题目。 |
| D-09 | 学生详情同时支持“全部题目长视图”和“单题切换视图” | 已确认 | 进入来源决定默认视图。 |
| D-10 | 正式结果拆成总览、题目分析、学生分析、可视化分析、报告与下载五个独立子页 | 已确认 | `报告与下载` 是结果工作区局部侧栏第五项。 |
| D-11 | Figma 16 不足以承载最终结果，只保留其视觉语言和完成/下载状态 | 已确认 | 新结果 shell 参考旧代码信息架构。 |
| D-12 | 学期选项始终包含下一学期，最早从 `2025-2026 秋季学期` 开始 | 已确认 | 月份映射只服务默认选择，不要求达到学校教务校历精度。 |

### 2.1 最新要求与 Figma 的覆盖/冲突表

| Figma frame | 保留 | 最新覆盖与新增 |
|---|---|---|
| 01 Dashboard | 顶部导航、统计摘要、少量任务表、单一新建 CTA、留白节奏 | 改名 `工作台 / Workspace`；历史任务保持独立顶栏；增加真实模型/BYOK 摘要；删除右上页面状态胶囊；任务不显示全部历史。 |
| 02 History | 网盘式表格、任务阶段与下一步 | 增加固定学期、课程系统标签、自定义标签、未完成/需处理筛选和自然语言筛选。 |
| 03 New Task | 单页、最小字段、创建后进入下一页 | `课程/分组` 改为固定学期 + 可空课程 + 标签；删除教学班/分组；课程/标签使用智能匹配与显式新建。 |
| 04 Add Problems | 上传优先、资料库来源、识别摘要、单一开始 CTA | 新增 `已按题整理 / 从原文提取`；原文提取增加章节/题号说明和候选确认。 |
| 08 Bulk Material Import | 两种文档结构选择的交互语言 | 继续用于资料导入；其结构选择能力同时复用到题目来源，但两个页面业务对象不同。 |
| 14 Results Overview | 复核指标、热力图、复核队列、精确入口 | 明确为教师确认前 `/review`，增加结构化/自然语言筛选和真实复核门禁。 |
| 15 Review Detail | 学生作答、AI理由、教师最终结果层、双维概念 | 重做导航位置；学生/题目独立智能筛选；方向键；全部题目/单题两种学生视图。 |
| 16 Analysis Export Finalized | 完成状态、摘要图表、下载/过期语义和视觉语言 | 不能继续作为单页终点；扩展为正式结果 shell + 总览/题目/学生/可视化/报告多页。 |
| 17 Recoverable Errors | BYOK、限流、解析失败及恢复动作 | 作为跨页状态组件规格，不做同时展示多种错误的真实页面；BYOK 入口连接真实用户隔离配置。 |

统一覆盖规则：所有 frame 删除中英混排、旧术语、过量彩色 pill、重复状态胶囊和用户可见开发说明；新增页面必须沿用同一 Figma token、版心、标题层级、控件高度、表格与留白节奏。

### 2.2 双语产品命名表

以下是 R0 默认产品词汇。中文界面只显示中文，英文界面只显示英文，不在同一控件中混排；所有名称必须使用 i18n key，后续修改名称不需要改 route 或业务代码。

| 中文 | English | 使用位置 |
|---|---|---|
| 工作台 | Workspace | 顶部一级导航、首页标题 |
| 新建任务 | New Task | 顶部一级导航、创建页 |
| 历史任务 | History | 顶部一级导航、任务归档页 |
| 课程资料库 | Course Library | 顶部一级导航、来源选择 |
| 模型 x/y 可用 | x/y Models Available | 用户名左侧紧凑入口 |
| 账户设置 | Account Settings | 用户菜单、设置页 |
| 模型与 BYOK | Models & BYOK | 用户菜单、BYOK 页 |
| 退出登录 | Sign Out | 用户菜单 |
| 添加题目 | Add Problems | 题目来源步骤 |
| 题目识别 | Problem Recognition | 识别进度步骤 |
| 题目准备 | Question Preparation | 题目总览及子页 |
| 添加学生作答 | Add Submissions | 作答来源步骤 |
| 作答校对 | Submission Review | 作答总览及子页 |
| 批改设置 | Grading Setup | 批改配置步骤 |
| 批改前确认 | Pre-grading Review | 只读确认步骤 |
| 批改进度 | Grading Progress | 运行进度步骤 |
| 待复核结果 | Results Review | 教师确认前工作区 |
| 复核详情 | Review Detail | 单学生、单题复核页 |
| 最终结果与分析 | Results & Insights | 正式结果工作区 |
| 总览 | Overview | 结果局部导航 |
| 题目分析 | Question Analysis | 结果局部导航 |
| 学生分析 | Student Analysis | 结果局部导航 |
| 可视化分析 | Visual Analytics | 结果局部导航 |
| 报告与下载 | Reports & Downloads | 结果局部导航 |
| 春季学期 | Spring Term | 学期选择器 |
| 夏季学期 | Summer Term | 学期选择器 |
| 秋季学期 | Fall Term | 学期选择器 |
| 冬季学期 | Winter Term | 学期选择器 |

英文使用 `Term` 而不是 `Semester`，以避免四季学期与通常一年两学期的语义冲突。

---

## 3. 后端与数据基础（不得用前端假完成）

### 3.1 任务元数据、学期、课程和标签

- [~] BE-META-01 为 Task 增加 `semester_id` 或稳定学期枚举字段。工程完成：2026-07-15；字段、创建/更新校验、历史查询和 New Task 固定选择器均已接入，当前仍随 `TaskStore` 保存在内存，等待 R1-D 用户验收。
- [~] BE-META-02 明确春/夏/秋/冬季学期与月份、学年命名和“下一学期”算法。工程完成：2026-07-15；共用算法从 `2025-2026 秋季学期` 起，按秋 8–11、冬 12–2、春 3–5、夏 6–7 生成至当前学期的下一学期，History 与 New Task 不再维护两套实现。
- [~] BE-META-03 为 Task 增加可空 `course_id`。工程完成：2026-07-15；真实课程 ID、owner 校验、历史筛选和 New Task 写入均已接入，存储仍为内存，等待 R1-D 用户验收。
- [~] BE-META-04 为 Task 增加用户标签关系；教学班、项目组等不建立固定字段。工程完成：2026-07-15；Task 已支持 `tag_ids`，写入时校验 owner 并去重，New Task 已支持真实标签多选/新建，等待 R1-D 用户验收。
- [~] BE-META-04a 用户标签保存名称、规范化名称和克制色值；重命名/删除标签不删除任务。进展：2026-07-13 17:34 UTC+8；已实现 owner-scoped 标签 API、NFKC + 大小写归一唯一性、7 色受限调色板、引用数、重命名/换色/解除关联及安全删除，当前仍为内存存储，等待用户阶段验收。
- [!] BE-META-05 课程与标签按用户隔离并持久化，重启不丢失。阻断：2026-07-13 17:34 UTC+8；owner 隔离已实现，但 Task/Course/Tag 仍使用进程内存，重启会丢失；需 PostgreSQL/repository 迁移后才能完成。
- [~] BE-META-06 提供课程/标签分页搜索、完全匹配、模糊匹配、语义候选和新建前二次查重。工程进展：2026-07-16；owner-scoped 分页搜索、NFKC/casefold 精确匹配、确定性词法相近候选、结构化 409 和“仍然新建”已完成；BYOK 已按 owner 隔离并有安全限额，但拼音与真实语义模型匹配仍未完成，不会伪装为已支持。
- [~] BE-META-07 课程填写后自动生成课程系统标签，不与同名用户标签重复。工程完成：2026-07-15；Task 只保存真实 `course_id`，History 以课程系统标签展示，不复制同名用户标签；等待 R1-D 用户验收。
- [~] BE-META-08 任务列表支持按学期、课程、标签、状态、是否未完成、更新时间筛选排序。进展：2026-07-24；真实 `/tasks/` 查询已支持分页、全部新增结果状态、这些过滤项及名称/阶段/需处理等排序；`unfinished=true` 现在只排除真实 `finalized`。存储仍为内存，故保持 `[~]`。
- [~] BE-META-09 智能筛选返回结构化条件、排序、解释和真实对象 ID，不直接执行任意 SQL。进展：2026-07-16；确定性解释器始终可用并只输出白名单查询条件，Agent -> Skill -> Tool -> Provider 可选路径已接入但默认关闭；用户 BYOK 隔离及进程内按用户每日 provider-call/估算 token 硬限额已完成，仍待多进程持久限额、审计与真实语义契约成熟后再开放共享模型路径。

#### 3.1.1 History 阶段后端边界记录

- `GET /tasks/` 无查询参数时继续返回旧字典响应，避免破坏现有调用；带任一 History 查询参数时返回 `items / total / page / page_size / available_facets / facets` 分页结构。
- `POST /tasks/query/interpret` 位于动态 `/{task_id}` route 之前；确定性解析不依赖 key，LLM 只可从共享默认 provider 候选中选择且默认关闭，解析结果仍需由普通 `GET /tasks/` 执行。
- `graded` 只表示“结果已生成、等待教师复核”，不表示正式完成；A00 后由 `review_confirmed / generating_analysis / finalized` 继续表达正式生命周期。
- 标签、任务元数据、智能查询限额计数均为进程内存；本阶段适合本地/隔离测试，不满足重启保留、多进程一致性或生产数据持久化要求。

#### 3.1.2 New Task 阶段后端边界记录

- `GET /courses/search` 与 `GET /tags/search` 只返回当前教师有权限的真实对象；响应按 `exact / related` 分组并带稳定分数与原因码。
- `POST /courses/`、`POST /tags/` 精确重复时复用原对象；相近项返回 `409 similar_items`，只有显式 `force_create` 才继续创建。当前相近判断是确定性词法匹配，不是拼音或 LLM 语义能力。
- `POST /tasks/` 要求非空任务名并支持 owner-scoped `Idempotency-Key`；同 key/同 payload 返回原任务，不同 payload 返回 409，并发双击只创建一次。
- Course/Tag/Task 和幂等索引仍为进程内存。课程/标签先通过各自资源 API 创建，再由 task 引用真实 ID；任务写入本身一致，但不宣称三个 API 已有跨资源数据库事务。

### 3.2 Task 状态与工作台

- [~] BE-STATE-01 补充 `graded_pending_review`、`review_confirmed`、`analysis_generating`、`finalized`、`stale` 等真实状态。工程完成：2026-07-24 05:52 UTC+8；沿用 `graded` 表示待复核，新增 `review_confirmed / generating_analysis / finalized`，并将 `not_generated / generating / ready / stale` 作为独立 artifact 状态；仍为内存存储，等待持久化和用户验收。
- [ ] BE-STATE-02 工作台 API 返回需要处理、运行中、待复核、待导出和最近完成的优先级信息。
- [ ] BE-STATE-03 支持多任务并行进度、ETA 和可恢复错误摘要。
- [~] BE-STATE-04 正式完成任务默认进入最终结果与分析 `/results`；待复核任务进入 `/review`。工程完成：`graded → /review`，`review_confirmed / generating_analysis / finalized → /results`；工作台、历史任务和 task entry 使用同一 destination，等待用户验收。

### 3.3 BYOK 与模型信息

- [~] BE-BYOK-01 专家 registry 与 key 按用户隔离。工程完成：2026-07-16；单一进程中 shared/owner 存储与可见视图已分离，教师有任一 BYOK 时不再混用 shared pool，同 provider/model 可分 owner 存储；仍为进程内存且未持久化，故保持 `[~]`。
- [~] BE-BYOK-02 返回 provider、model、enabled、验证状态、最近验证时间和可安全展示的限制信息。进展：2026-07-16；provider/model/enabled/scope/editable/限流配置已脱敏返回，但尚无真实连通性验证与最近验证时间，不得把 enabled 写成 available/online。
- [~] BE-BYOK-03 不返回 key 原文；前端只显示掩码、状态和修改/删除动作。工程完成：2026-07-16；API 固定返回 `***`，base URL 只返回脱敏 origin，shared 配置只读，异常和日志不记录 key；完整 BYOK 页双语与交互验收属 G-06，故保持 `[~]`。
- [ ] BE-BYOK-04 配置官方 provider 控制台/用量页面链接白名单，前端新窗口打开并标明外部网站。
- [ ] BE-BYOK-05 若供应商没有用量 API，不伪造余额、token 或费用。

### 3.4 智能查询、复核和分析

- [ ] BE-AI-01 统一 SmartQuery schema：`filters / sort / chart_request / explanation / matched_ids`。
- [ ] BE-AI-02 覆盖历史、题目、作答、复核、学生分析、题目分析和可视化页面。
- [ ] BE-AI-03 学生与题目筛选分别维护，不因一维查询清空另一维选择。
- [ ] BE-AI-04 查询覆盖全量或服务端聚合数据，不只取前 50 名学生。
- [~] BE-AI-05 保存教师 final result overlay、复核状态、审计信息和版本。进展：2026-07-24；R02 逐格覆盖与 A00 任务级 `final_result_version/fingerprint/updated_by/dirty`、不可变快照和 stale 规则均已完成；仍为进程内存且缺数据库事务/持久审计，因此保持 `[~]`。
- [ ] BE-AI-06 教师确认后生成正式分析/报告；之后修改 final result 会使产物标记 stale。
- [ ] BE-AI-07 扩展安全 ChartOutput；heatmap 使用明确 `x/y/z` schema，不开放任意 Plotly JSON。

### 3.5 题目原文提取

- [~] BE-PROBLEM-01 题目来源保存上传文件或真实 owner-scoped 课程资料库对象引用。工程完成：2026-07-16；当前支持单文件与稳定 `material_id`，服务端 owner/task token 与隔离契约已通过；持久化与多文件集合待 G-04，故保持 `[~]`。
- [~] BE-PROBLEM-02 保存来源模式 `organized / extract_from_source`。工程完成：2026-07-16；模式进入预检草稿、正式请求、任务结果与幂等指纹。
- [~] BE-PROBLEM-03 保存章节、页码、题号和自然语言提取说明。工程完成：2026-07-16；原始说明随预检与正式结果保留，不在输入时调用模型。
- [~] BE-PROBLEM-04 返回已匹配、可能匹配、未找到的候选与可解释原因。工程完成：2026-07-16；预检为零 provider 调用的确定性题号解析，正式识别才允许当前教师已配置且已启用的 provider 解释说明。
- [~] BE-PROBLEM-05 教师确认歧义候选后再正式写入 problem 数据；来源、模式、说明和确认候选共同参与任务 mutation 幂等判定。工程完成：2026-07-16；revision/CAS、覆盖确认、过期 token、失败保留旧数据、缓存/进度清理与批注竞态回归已通过。等待用户视觉确认，故保持 `[~]`。

---

## 4. 设计系统与全局产品壳

- [x] UI-SHELL-01 提取 Figma 色彩、字号、间距、边框、圆角和控件高度 token。完成：2026-07-13 16:29 UTC+8；Figma 01 的 `#F8FAFC/#FFFFFF/#D9E0E9/#111827/#64748B/#2563EB`、70px 顶栏、1300px 版心及字体 fallback 已写入全局壳，并随工作台通过桌面/移动截图验收。
- [x] UI-SHELL-02 建立轻量顶部导航：工作台/新建任务/历史任务/课程资料库。完成：2026-07-13 16:29 UTC+8；桌面顶栏和移动抽屉使用同一导航配置，旧固定全局侧栏已从 `AppShell` 删除并通过交互验收。
- [x] UI-SHELL-03 顶栏选中项只在入口本身表达，不显示重复页面胶囊。完成：2026-07-13 16:29 UTC+8；当前项使用字重、主色和克制浅底，用户确认按该标准继续后归档完成。
- [x] UI-SHELL-04 用户名左侧显示紧凑模型配置入口；点击打开模型摘要。完成：2026-07-13 16:29 UTC+8；接入真实 `useExperts()`，只显示 provider/model/enabled 和已配置且启用数，加载、失败、空状态与重试均已验证；enabled 不代表供应商实时在线验证。
- [x] UI-SHELL-05 用户名菜单包含账户设置、模型与 BYOK、退出登录。完成：2026-07-13 16:29 UTC+8；`/settings/account`、`/settings/byok` 与旧路径兼容重定向已建立，退出/会话失效会清空用户态 Query cache，菜单交互已验证。
- [~] UI-SHELL-06 建立任务上下文栏：返回、任务名、当前阶段、保存状态、阶段门禁。Q-01 已在标题同一行提供可见任务名/返回入口，并修正非草稿题目阶段的 gate/回链；其他任务页仍需随各自阶段统一，故本项保持 `[~]`。
- [ ] UI-SHELL-07 建立局部侧栏/局部 tabs 组件，只供复杂工作区使用，不恢复全局固定侧栏。
- [ ] UI-SHELL-08 建立智能选择器、标签选择器、SmartQueryBar、对象导航器、图表容器等共用组件。
- [x] UI-SHELL-09 中文/英文分别完整显示，不混排；所有本阶段新文案进入 i18n。完成：2026-07-13 16:29 UTC+8；产品壳与工作台文案已全部进入 i18n，并同步更新 `<html lang>`；其他页面继续按各自阶段验收。
- [x] UI-SHELL-10 本阶段顶栏与下拉支持键盘、焦点、缩放和移动端折叠。完成：2026-07-13 16:29 UTC+8；顶栏、弹出菜单和移动抽屉支持 focus-visible、Escape、点击外部关闭、焦点返回及滚动锁；尚未创建的局部侧栏/筛选器不计入本项。

### 4.1 R1-A 共用产品壳验证记录

- [x] R1A-CODE-01 `npm run typecheck` 通过。完成：2026-07-12 06:25 UTC+8。
- [x] R1A-CODE-02 `npm run lint` 通过；课程资料库的已批准英文名称使用精确白名单，不放开其他课程管理能力。完成：2026-07-12 06:25 UTC+8。
- [x] R1A-CODE-03 Vite 生产构建到 `/private/tmp/smartai-r1-a-vite-build` 通过，最终转换 426 个模块。完成：2026-07-12 06:33 UTC+8。
- [x] R1A-CODE-04 兼容 route 已建立：`/dashboard -> /`、`/settings -> /settings/account`、`/experts -> /settings/byok`。完成：2026-07-12 06:25 UTC+8。
- [x] R1A-CODE-05 未登录深链会保存目标位置，登录成功后安全恢复；退出、会话过期和错误角色会清除 token 与全部用户态 Query cache。完成：2026-07-12 06:25 UTC+8。
- [x] R1A-QA-01 `1440x900` 与 `390x844` 浏览器截图、真实交互和用户验收完成。完成：2026-07-13 16:29 UTC+8；Playwright 使用后端明确支持的隔离 demo 教师 `tester01` 会话完成空数据与 4 个真实内存草稿任务两种状态。已验证顶栏四个主入口、模型菜单、用户名菜单（账户设置/模型与 BYOK/退出登录）、移动抽屉、工作台任务/模型入口和控制台；最终 `npm run lint`、`tsc --noEmit`、Vite production build、`git diff --check` 均通过。截图：`dashboard-empty-1440x900.png`、`dashboard-data-1440x900-v2.png`、`dashboard-data-390x844.png`，位于本任务 Codex 临时可视化目录。用户于 2026-07-13 明确要求“按照这个标准继续推进下一阶段”，本阶段据此归档验收。
- [x] R1A-QA-02 原截图工具阻断已解除，不再阻塞页面验收。解决：2026-07-13 15:40 UTC+8；用户明确授权 Playwright CLI 启动本地 Chromium 与写入临时 PNG，桌面/移动截图成功。原生 `screencapture` 也已证明 Screen Recording 权限正常；Codex Swift helper 的 `SwiftBridging` 冲突定位为 Command Line Tools 遗留 `module.modulemap`，属于可单独修复的本机工具链问题，不再作为前端验收阻断项。

---

## 5. 全局页面

### G-01 工作台（Figma 01 覆盖修改）

- [x] G01-01 页面名称确认为 `工作台 / Workspace`，不再使用“任务总览/任务驾驶舱”。完成时间：2026-07-11 16:00 UTC+8；这是命名决定完成，不代表页面代码完成。
- [x] G01-02 首屏显示有意义的真实计数：运行中、需要继续、已生成结果、当前可用模型配置。完成：2026-07-13 16:29 UTC+8；加载/失败时显示 `—` 和明确状态，不把未返回数据误报为 0。
- [x] G01-03 任务区最多显示 4 个行动型任务，排序为异常/需继续 -> 后台处理 -> 已生成结果 -> 最近更新；移动端最多显示 3 个。完成：2026-07-13 16:29 UTC+8；使用真实 `TaskLite`，没有硬编码 Figma 样例数据。
- [x] G01-04 顶栏 `历史任务` 作为桌面全量入口，不增加被否定的第二个桌面入口；移动端顶栏折叠进抽屉后，任务区提供轻量 `历史任务` 链接。完成：2026-07-13 16:29 UTC+8。
- [x] G01-05 展示真实 `enabled / total` 模型数量，模型菜单和提醒区最多显示两个 provider/model，统一进入 `/settings/byok`；不显示 key、余额或伪造用量。完成：2026-07-13 16:29 UTC+8。
- [x] G01-06 近期提醒只汇总需要继续、后台处理中、已生成结果和模型配置状态，并提供最多三个行动入口。完成：2026-07-13 16:29 UTC+8。
- [x] G01-07 已按 Figma 01 重写为 1290px 内容、四张 250x90 无图标指标卡、1090x218 四行任务表、单一 150x40 CTA 和 1290x170 提醒区；旧 `StatTile/Card/SectionHeader/EmptyState/TaskProgressMini` 视觉层均未复用。完成：2026-07-13 16:29 UTC+8。
- [x] G01-08 用户验收桌面首屏无需滚动即可理解主要状态。完成：2026-07-13 16:29 UTC+8；用户确认按该标准进入下一阶段。

### 5.1 G-01 工作台实现与验收记录

- [x] G01-CODE-01 从零重写工作台视觉层，只保留 API、React Query、路由与任务状态逻辑。完成：2026-07-13 15:53 UTC+8。
- [x] G01-CODE-02 有活跃任务时任务列表每 3 秒刷新真实状态；作答识别按学生文件数计算进度，批改按学生 x 题目计算；后端缺少可靠开始时间时 ETA 显示“估算中”而不伪造。完成：2026-07-13 15:53 UTC+8。
- [x] G01-CODE-03 桌面/移动只挂载当前断点布局，避免隐藏 DOM 重复观察同一任务进度；空态/错误态补齐 table row/cell 与 `aria-busy/status`。完成：2026-07-13 15:53 UTC+8。
- [x] G01-QA-01 `npm run lint`、`tsc --noEmit`、Vite production build 到 `/private/tmp/smartai-dashboard-final-vite-build`、`git diff --check` 通过。完成：2026-07-13 15:53 UTC+8。
- [x] G01-QA-02 Figma 01、1440x900 有/无数据、390x844 和中英文布局已检查并获用户确认。完成：2026-07-13 16:29 UTC+8。

### 5.2 G-01 阶段归档记录

- 完成时间：2026-07-13 16:29 UTC+8。
- 实现证据：`frontend/app/src/routes/DashboardPage.tsx`、`frontend/app/src/components/layout/`、route `/`；阶段提交主题为 `feat(frontend): rebuild dashboard from Figma`。
- 测试证据：`npm run lint`、`tsc --noEmit`、Vite production build、`git diff --check` 通过；Playwright 验证桌面/移动导航、模型菜单、用户菜单和移动抽屉。
- 视觉证据：对照 `docs/20260710/figma/01 Dashboard 任务驾驶舱.png`；实现截图 `dashboard-empty-1440x900.png`、`dashboard-data-1440x900-v2.png`、`dashboard-data-390x844.png` 位于本任务 Codex 临时可视化目录。
- 数据边界：任务、进度和模型状态使用真实 owner-scoped API；截图中的 4 条任务是隔离 demo 用户的真实内存草稿，不是前端硬编码；后端未提供可靠 ETA 时显示“估算中”。
- 用户验收：已确认，2026-07-13；用户要求“按照这个标准继续推进下一阶段”。
- 偏差说明：按用户覆盖规则使用 `工作台 / Workspace`；删除 Figma 右上重复页面胶囊；颜色比 Figma 更克制；不伪造课程、标签、低置信数量或模型用量。

### G-02 历史任务（Figma 02 扩展）

- [~] G02-01 网盘式表格显示任务、学期、课程、标签、阶段、进度/ETA、更新时间、待处理和下一步。工程进展：2026-07-13 17:34 UTC+8；Figma 02 可见层已从头重写，桌面 6 列表格将学期/课程/标签收在任务列；后端没有可信 ETA 时统一显示 `—`，需处理当前使用真实布尔标记而非伪造数量。等待用户阶段验收。
- [~] G02-02 课程作为系统标签显示；支持用户添加/删除自定义标签。工程进展：2026-07-13 17:34 UTC+8；课程和自定义标签视觉区分并可点击筛选，自定义标签写入真实 owner-scoped API，当前存储仍为内存。等待用户阶段验收。
- [~] G02-02a 参考 Overleaf 的轻量标签管理：从已有标签选择、快速新建、重命名、换色、从任务移除；颜色使用受限低饱和调色板，不恢复满屏彩色 pill。工程进展：2026-07-13 17:34 UTC+8；已有标签搜索、创建、重命名、7 色换色、关联/移除、引用数和删除影响确认均已接入，等待用户阶段验收。
- [~] G02-03 支持学期、课程、标签、状态、未完成、需处理筛选。工程进展：2026-07-13 17:34 UTC+8；所有条件由服务端按 owner 执行；`未完成` 暂按现有批改流水线解释，不能等同“尚未正式 finalized”。等待用户阶段验收。
- [~] G02-04 支持任务名/标签关键词搜索和更新时间/名称/阶段排序。工程进展：2026-07-13 17:34 UTC+8；关键词查询和 9 种更新时间/创建时间/名称/需处理/阶段排序已接入真实分页 API，等待用户阶段验收。
- [~] G02-05 支持自然语言智能筛选并将结果转成可见筛选条件。工程进展：2026-07-16；确定性自然语言解析、条件 chips、歧义和逐项清除已实现；用户 BYOK 隔离及进程内按用户每日 provider-call/估算 token 硬限额已完成，可选 LLM 路径仍默认关闭，待多进程持久限额、审计与真实语义契约成熟后再开放。等待用户阶段验收。
- [~] G02-06 过滤器可清空，URL/返回导航可恢复筛选状态。工程进展：2026-07-13 17:34 UTC+8；关键词、结构化条件、排序、页码与页大小写入 URL；清除智能条件可恢复执行前的手动条件，等待用户阶段验收。
- [~] G02-07 大量任务使用分页或虚拟列表，不一次渲染全部。工程进展：2026-07-13 17:34 UTC+8；服务端分页默认 25，支持 25/50/100，32 条真实内存任务数据态已验证，等待用户阶段验收。
- [~] G02-08 点击任务进入真实当前阶段；正式完成进入最终结果与分析。工程进展更新：2026-07-24；统一 destination 已覆盖新增结果状态，`graded` 进入 `/review`，`review_confirmed / generating_analysis / finalized` 进入 `/results`；等待用户阶段验收。

### 5.3 G-02 阶段实现与工程验收记录

- 状态：实现与工程验收完成；用户于 2026-07-15 明确要求继续下一阶段，G-02 阶段门据此归档并进入 G-03。
- 实现证据：`frontend/app/src/routes/HistoryPage.tsx`、`frontend/app/src/components/history/`、`frontend/app/src/api/{tasks,tags}.ts`、`backend/api/{tasks,tags}.py`、`backend/{agents,skills,tools}/history_query_*`，route `/history`。
- 接口证据：真实任务分页/筛选/排序、标签 CRUD/关联、URL 状态与确定性智能筛选均已连接；测试数据只由隔离本地教师的真实内存 API 提供，前端没有硬编码 Figma 样例。
- 测试证据：History/task/registry 目标后端测试共 `32 passed`；`npm run lint`、`npm run typecheck`、Vite production build 和 `git diff --check` 通过。
- 视觉证据：对照 `docs/20260710/figma/02 History 网盘式任务列表.png`；`1440x900` 数据态截图 `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/history-data-1440x900-review.png`；`390x844` 数据态截图 `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/history-data-390x844-review.png`；桌面空态截图 `/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/history-empty-1440x900.png`。移动端 `documentElement.scrollWidth === clientWidth`，无页面级横向溢出。
- 浏览器边界：本轮前段已用真实 32 条任务数据验证表格、分页/筛选呈现和部分真实交互；后段因本地浏览器自动化权限被系统限制，少数交互无法在最终代码上逐项重跑，相关写入和查询仍由契约测试覆盖。该限制不写成“完整浏览器流程已全部通过”。
- 数据边界：Task/Course/Tag/正式结果版本/智能查询限额仍为进程内存；LLM 智能查询默认关闭；已具备 `finalized` 状态但尚无持久 artifact；无可靠 ETA 时显示 `—`。
- 独立终审：无 P0/P1；两个已知 P2 为移动端结构化筛选条使用局部横向滚动，以及 `page_size=100` 且大量任务同时运行时逐行 progress 轮询可能放大请求，后续应合并为列表级批量进度或共享轮询。
- 用户验收：2026-07-15 用户明确要求按 Figma 标准继续下一阶段；以该指令作为进入 G-03 的阶段授权。
- 偏差说明：为了容纳真实筛选，Figma 单行筛选区扩为两行；桌面将学期、课程、标签收在任务主列以保持 1080px 网盘式主体；移动端保留同一行语义而不是改成卡片瀑布流；颜色比原稿克制。

### G-03 新建任务（Figma 03 覆盖修改）

- [x] G03-01 任务名称必填。完成：2026-07-15；浏览器 required 校验与后端空白 422 双层约束；用户已授权进入下一阶段，提交 `de0750d`。
- [x] G03-02 学期使用固定选项，默认当前学期，范围遵循确认后的算法。完成：2026-07-15；2026 年 7 月默认夏季并只向后多显示 2026-2027 秋季；提交 `de0750d`。
- [x] G03-03 课程可选，使用智能可搜索/可创建 combobox。完成：2026-07-15；真实 owner-scoped API、180ms 防抖、键盘导航、选择/移除/显式新建已接入；提交 `de0750d`。
- [x] G03-04 删除教学班/分组字段。完成：2026-07-15；页面和 task payload 均没有这两个固定字段；提交 `de0750d`。
- [x] G03-05 提供可选标签，教学班等信息由标签表达。完成：2026-07-15；真实多选标签和显式新建已接入；提交 `de0750d`。
- [x] G03-06 课程填写后自动增加课程系统标签。完成：2026-07-15；通过 `course_id` 关系在 History 中展示为系统标签，不复制同名用户标签；提交 `de0750d`。
- [~] G03-07 标签完全/模糊/语义匹配和新建确认可解释。已验收边界：2026-07-15；完全匹配、确定性词法相近、新建及相似项二次确认已完成并随 `de0750d` 提交；拼音和真实语义模型匹配仍未实现，作为明确后续能力保留，因此本细项不伪造为 `[x]`，但不阻塞 G-03 阶段验收。
- [x] G03-08 页面只保留创建任务所需字段；专家/OCR 可继承并以摘要/高级设置出现。完成：2026-07-15；只保留真实模型配置摘要和 BYOK 入口，不伪造 OCR、专家选择或高级设置；提交 `de0750d`。
- [x] G03-09 创建后进入添加题目页，不在当前页继续堆上传流程。完成：2026-07-15；真实流程进入 `/tasks/:id/upload/problems`，Figma 04/Q-01 未混入本页；提交 `de0750d`。

### 5.4 G-03 阶段实现与工程验收记录

- 状态：实现、工程验收、真实浏览器创建流程和用户阶段授权均已完成；提交 `de0750d` 已推送。用户于 2026-07-15 明确要求严格按同一标准继续下一阶段，以该指令归档 G-03 阶段验收并进入 Q-01。
- Figma 约束：对照 `03 New Task 新建任务.png`；桌面实测标题 `(70,105)`、步骤条 `(70,155)`、卡片 `(270,220,900×510)`、名称 `(320,284,800×44)`、学期/课程 `(320/740,374,380×44)`、标签 `(320,464,800×44)`、模型摘要 `(320,535,800×56)`、主按钮 `(980,760,180×40)`；删除 `Draft` 胶囊，颜色只使用既有中性色与主蓝。卡片内部为空态坐标锁定的流式布局，课程/标签内容增高时后续区域自然下移。
- 实现证据：`frontend/app/src/routes/NewTaskPage.tsx`、`frontend/app/src/components/new-task/`、`frontend/app/src/lib/semesters.ts`、`frontend/app/src/api/{courses,tags,tasks}.ts`、`backend/api/{courses,tags,tasks}.py`、`backend/tools/catalog_matching.py`，route `/tasks/new`。
- 测试证据：`backend/tests/test_new_task_contract.py` 连同 History/Task 回归共 `38 passed`；`npm run lint`、typecheck、Vite production build、控制台 error 检查及 `git diff --check` 通过。独立终审修复旧搜索候选/创建响应竞态、确认框焦点管理及多标签重叠后复核，无剩余 P0/P1。
- 浏览器证据：本地教师测试账号完成新建真实课程、真实标签和任务，成功进入 `/tasks/T_…/upload/problems`；0/0 模型不阻止草稿创建。桌面无横向溢出；移动端页面无整体横向溢出，步骤条只在自身容器内横向滚动。
- 视觉证据：`/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/new-task-1440x900.png`、`/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/new-task-390x844.png`。
- 额度策略：Figma 坐标先锁定后一次实现；逐键只调用低成本确定性搜索；本轮只保留一张桌面、一张移动端和一轮真实创建流程，不为装饰性差异反复截图或调用模型。
- 用户阶段验收：2026-07-15 已确认进入下一阶段；中英文文案观感和极端长课程名/多标签的主观偏好仍可后续低成本调整，但不再阻塞 Q-01。
- 数据边界：Task/Course/Tag/幂等记录仍为进程内存；拼音/真实语义相似检索、PostgreSQL 持久化和跨资源事务未实现；这些边界已如实记录，不因 G-03 阶段验收而被改写。

### G-04 课程资料库、G-05 账户设置、G-06 模型与 BYOK、G-00 登录

- [ ] G04-01 课程资料库使用 Figma 09 结构，支持真实文件、资料分组、标签、搜索和跨任务选择。
- [ ] G05-01 账户设置从用户名菜单进入。
- [ ] G06-01 BYOK 页面支持添加、验证、修改、启用/停用和删除 key。
- [ ] G06-02 展示官方 provider 官网/控制台/用量页面链接。
- [ ] G06-03 Dashboard 模型摘要与 BYOK 页面使用同一真实状态源。
- [ ] G00-01 登录页后置品牌视觉，不影响主流程优先级。

---

## 6. 题目与资料流程

### Q-01 添加题目来源（Figma 04 + Figma 08 结构语言）

- [~] Q01-01 支持上传真实文件。工程完成：文本型 PDF/TXT/Markdown、点击/拖拽、5 MiB/页数/字符/token 限额和无文字 PDF 拒绝均已接入；DOCX、图片、扫描件与 OCR 不实现。等待用户视觉确认后归档。
- [~] Q01-02 支持从真实 owner-scoped 课程资料库选择来源。工程完成边界：支持一个稳定 `material_id` 文件，默认当前课程/未分类，可切本人全部范围并搜索，严格 owner 隔离；命名资料分组、多文件/全部结果联合来源随 G04 实现，页面不放假按钮。等待用户视觉确认。
- [~] Q01-03 选择 `已按题整理` 或 `从原文提取`，服务端保存 `organized / extract_from_source`。工程完成：默认 `organized`，模式进入正式请求与幂等指纹。等待用户视觉确认。
- [~] Q01-04 `从原文提取` 显示章节、题号、页码和自然语言线索输入框。工程完成：纵向流式增高且不破坏默认 Figma 900px 主列；等待用户视觉确认。
- [~] Q01-05 返回候选题号与 `已匹配 / 可能匹配 / 未找到` 摘要。工程完成：确定性预检不调用 provider，正式识别才由 AI 结合说明；等待用户视觉确认。
- [~] Q01-06 教师确认歧义候选后开始正式识别。工程完成：确认状态与勾选 ID 分离，允许明确确认后选择空数组，未知 ID 拒绝；未经确认不启动。等待用户视觉确认。
- [~] Q01-07 展示真实识别专家与 OCR 摘要。工程完成：展示当前教师可见且已配置并启用的模型配置，owner/shared 模型隔离、共享项只读、0 配置禁用原因和 BYOK 安全返回/草稿恢复已接入；enabled 不冒充实时在线验证，OCR 如实显示不可用。等待用户视觉确认。
- [~] Q01-08 页面只有一个主操作 `开始识别题目`。工程完成：单 CTA、`replace_confirmed`、stale revision/CAS、成功后 `/tasks/:id/problems/progress` 与旧流程回链已接入；等待用户视觉确认。

### 6.1 Q-01 阶段启动与验收基线（2026-07-15）

- 用户授权：2026-07-15 用户明确要求严格按照 Figma 与既定标准继续下一阶段，并要求每阶段更新文档、提交和推送；据此归档 G-03 并启动 Q-01。
- 详细决策与验收矩阵：`docs/20260715/Q01_ADD_PROBLEMS_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 坐标：逻辑画布 `1440×900`；标题 `(70,105)`；七步首节点 `(70,155,26×26)` 且 x 步长 `176`；上传区 `(270,230,900×250)`；来源区 `(270,520,900×120)`；识别摘要 `(270,665,900×88)`；主按钮 `(990,780,180×40)`。
- 保守默认：上传加入课程资料库默认关闭；主动加入时有课程归当前课程、无课程归教师“未分类”；资料库默认筛当前课程/未分类并允许切本人全部。
- 额度边界：输入与预检不调用模型；预检使用确定性解析；只有教师显式启动正式识别时才允许真实 provider 解释自然语言提示。使用本地 Figma PNG 锁坐标，只保留必要的桌面/移动截图和一轮真实主流程。
- 能力边界：本阶段不实现 DOCX、图片、扫描件或 OCR；OCR 摘要必须如实显示关闭/不支持。课程资料与来源引用当前仍允许进程内存实现，但必须是 owner-scoped 服务端真实资源，不能伪装成持久数据库或对象存储。
- 工程结果：后端全量 `145 passed, 1 skipped, 7 warnings`；唯一 skip 为当前本地环境缺 PyMuPDF（部署依赖已声明）；前端 lint/visible-scope/typecheck/build 通过（Vite `444` modules）；独立前端实渲染终审确认桌面锚点逐项匹配、移动端无页面级横向溢出且无 P0/P1；该 P0/P1 结论仅限定前端实渲染审查，后端安全终审单独记录。
- 功能终审：前后端契约、路由跳转、单文件来源、候选确认、替换 CAS、模型门禁及 Figma 04 默认结构未发现阻止本阶段提交的 P0/P1。
- 安全结果：BYOK registry 已拆分 shared/owner 视图，管理员不能隐式代用他人 BYOK；题目来源使用 owner/task token、revision/CAS、替换确认、失败保留、文件/内存配额、缓存/进度清理与脱敏错误；生产拒绝 demo token，旧全局路由仅管理员可访问。修复后独立只读安全终审未发现 Q-01 范围内遗留的可操作 P0/P1。
- 当前状态：实现与工程验收完成，等待用户视觉确认。独立终审标签页已关闭，且本地后端重启因当前执行环境额度限制未获准，所以没有落盘本阶段桌面/移动 PNG，也没有在最终代码上重放正式 provider 浏览器启动；不得把这两项写成完成或把 Q01-01 至 Q01-08 提前改为 `[x]`。

### Q-02 至 Q-09

- [~] Q02 题目识别进度独立 route，显示事实步骤、进度、最近事件、后台运行与恢复动作。工程完成：2026-07-16；不再渲染旧 `TaskUploadPage`，Figma 05 的居中 `800×430` 进度卡已落地；后端新增四项事实阶段字段，没有真实页数/ETA 时不伪造。`1440×900` PNG 与真实阶段渲染通过，等待用户视觉确认。
- [x] Q03 题目准备总览只做覆盖率、筛选、排序和分流。完成：2026-07-20；四个覆盖率指标按用户最终纠正借鉴 Figma 14 的大号圆角统计卡独占一行，搜索框另起整行，排序降为辅助控件，矩阵保持独立卡和内部滚动。`1440×900` 四题数据首屏无页面滚动，`390×844` 无页面级横向溢出；用户随后明确要求继续下一阶段，据此归档。
- [~] Q04 题干校对独立 route。工程完成边界：独立短页、单题/全部当前维度、筛选、上一/下一题、真实保存、未保存离开保护已接入；来源/版本字段随后续阶段实现。
- [~] Q05 评分标准独立 route。工程完成边界同 Q04；编辑后真实进入 `edited`，明确确认进入 `confirmed`。
- [~] Q06 标答独立 route。工程完成边界：可真实逐题保存和确认；Q08 与 Q09 均已接入带 `answer` 目标的真实入口，AI 结果逐槽待确认。
- [~] Q07 测试样例与脚本独立 route。工程完成边界：编程题可结构化编辑并真实保存，非编程题显示不适用；正式脚本/来源字段仍待后端模型。
- [~] Q08 批量导入资料保留已按题整理/从原文提取，术语统一为资料。工程完成：2026-07-16；Figma 08 单卡选择页、独立事实进度页、独立候选复核矩阵以及 `preflight -> plan -> review -> CAS apply` 真实闭环完成。默认 `missing_only`，仅 `exact` 且不覆盖现有内容的候选默认选中；`possible` 与覆盖冲突必须教师主动确认。后端全量 `160 passed, 1 skipped`，前端 lint/typecheck/build 通过；受当前 Codex 本机授权/使用额度限制，本轮未取得新的浏览器 PNG，等待用户视觉确认。
- [x] Q09 AI 补全缺失资料独立 route 与进度状态。完成：2026-07-20；范围确认、事实进度、missing-only CAS、逐槽 provenance、后台刷新和恢复路径已接入，并由 Q03 最终矩阵入口与返回状态完成浏览器闭环；用户在该最终纠正后明确要求继续下一阶段，据此归档。
- [~] Q-FLOW 真实验证上传/选择来源 -> 模式 -> 识别进度 -> 总览 -> 精确子页 -> 返回总览。进展：2026-07-19；Q02/Q03 状态门禁、精确子页、标答保存并确认、返回矩阵覆盖率更新已由 Playwright 验证；Q08 闭环由 10 个契约测试覆盖且保留无 PNG 的历史边界；Q09 范围页和 Q03 返回入口已由隔离 Playwright 验证，正式生成、失败、幂等、并发和 CAS 由 7 个契约测试覆盖。

### 6.2 Q-02 / Q-03 阶段工程与自动验收记录（2026-07-16）

- 用户纠正：截图 URL 是 Q-02，但旧路由错误渲染了同时包含上传、进度、矩阵、资料导入和单题全部槽位的长页；本轮按 reset baseline 直接拆 route，不继续美化旧长页。
- Q-02 证据：`q02-recognition-progress-1440x900.png`；真实 `current_step=organizing_structure`、`completed_steps=2/4` 显示 50%，未知/缺失分母时使用 indeterminate，不从题目数猜百分比。
- Q-03 证据：`q03-matrix-first-1440x900.png`、`q03-matrix-first-390x844.png`；移动根页面 `innerWidth=scrollWidth=bodyScrollWidth=390`，矩阵自身局部滚动。
- 功能证据：`缺标答 编程题` 从 8 题筛到 Q6；Q2 标答在独立页保存并确认后，矩阵标答覆盖率从 50% 更新为 63%；全部视图仅显示当前标答维度和当前筛选结果。
- 工程证据：前端 lint/visible-scope/typecheck、临时 production build、`git diff --check` 通过；后端全量 `150 passed, 1 skipped, 7 warnings`。
- Q02/Q03 阶段当时的阶段门：工程和自动验收完成，等待用户视觉确认；当时 Q08/Q09 均未完成。该历史记录已由下方 6.3 的 Q08 和 6.4 的 Q09 工程结果继续推进。

### 6.3 Q-08 批量导入资料阶段工程记录（2026-07-16）

- 详细决策与验收矩阵：`docs/20260716/Q08_BULK_MATERIAL_IMPORT_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 锚点：逻辑画布 `1440×900`；标题约 `(70,105)`；七步条约 `y=155`；主卡片约 `(270,220,900×560)`；目标默认评分标准+标答，来源默认课程资料库，结构默认已按题整理，主动作约 `230×40`。
- 页面拆分：`/questions/import` 只选择，`/questions/import/progress/:jobId` 只显示事实进度，`/questions/import/review/:jobId` 只确认候选与冲突；Q03/Q05-Q07 使用真实入口，不恢复旧长页。
- 后端边界：预检零 provider；正式阶段一次结构化调用只生成 plan；apply 才在 TaskStore 锁内一次 CAS 写值与逐槽 provenance。`exact` 只表示明确题号/标题，缺失或语义匹配统一为 `possible`。
- 安全结果：owner/BYOK 绑定、管理员不得隐式代用、完整指纹、默认不覆盖、显式覆盖、失败保留与重试、过期 plan 恢复、删除/状态清理、错误脱敏与中英文编程题识别完成；两轮只读终审修复后未留下已知 P0/P1。
- 工程证据：Q08 契约 `10 passed`；后端全量 `160 passed, 1 skipped, 9 warnings`；前端 visible-scope/lint/typecheck 与 Vite `456 modules` production build 通过；`git diff --check` 通过。
- 浏览器证据边界：用户已授权 Playwright，但隔离端口与 Chromium 启动被当前 Codex 本机授权/使用额度拒绝；没有调用真实模型、改写用户任务或伪造 PNG。当前阶段保持 `[~]`，等待用户从题目准备总览打开 Q08 做视觉确认。
- 真实未实现：资料分组、多文件/整库、DOCX、图片/扫描/OCR、正式测试脚本、持久数据库/对象存储以及 Q09。

### 6.4 Q-09 AI 补全缺失资料阶段工程记录（2026-07-19）

- 详细决策与验收矩阵：`docs/20260719/Q09_AI_COMPLETE_MISSING_MATERIALS_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 边界：Q09 不是 Figma 09 课程资料库；选择页组合 Figma 08 的 `900×558` 单卡，进度页组合 Figma 05 的 `800×430` 事实卡，完成后回到 Figma 06 矩阵并使用 Figma 07/17 的逐槽确认与 BYOK 恢复语义。
- 页面拆分：`/questions/ai-complete` 只显示预检和精确范围；`/questions/ai-complete/progress/:jobId` 只显示事实进度；完成后失效刷新 task query 并返回 `/questions`，没有第二个 apply 页面，也没有把表单追加在 Q03 下方。
- 后端边界：预检零 provider；教师确认后一次结构化调用；TaskStore 单锁 `missing_only` CAS 只写仍为空的评分标准、标答、编程题示例正确代码和测试样例。示例代码不执行，正式测试脚本不伪造。
- 状态与恢复：AI 逐槽 provenance 为 pending/edited/confirmed，题干复核与资料确认解耦；同范围幂等、不同范围复用在途 job、stale 重新预检、后台完成/失败刷新、过期和重试均有恢复路径。
- 工程证据：Q09 定向 `7 passed`；后端全量 `167 passed, 1 skipped, 9 warnings`；前端 visible-scope/lint/typecheck 与 Vite `461 modules` production build 通过；`git diff --check` 通过；终审修复后无已知 P0/P1。
- 浏览器证据：隔离本地教师 fixture 下完成 Q09 的 `q09-ai-complete-1440x900.png`、`q09-ai-complete-390x844.png`；Q03 于 2026-07-20 按用户反馈改为 Figma 14 式大号指标卡与独占搜索行，最新证据为 `q03-metrics-figma14-correction-1440x900.png`、`q03-metrics-figma14-correction-390x844.png`。桌面 `scrollWidth=1440`、`scrollHeight=900`，移动 `innerWidth=scrollWidth=bodyScrollWidth=390`。只读取预检和页面状态，未点击生成、未调用真实模型、未改写用户任务。
- 当前状态：代码、工程与浏览器验收完成，等待用户视觉确认，故保持 `[~]`。真实未实现仍包括 OCR/DOCX、测试脚本执行、资料分组/多文件整库和持久存储。

### 6.5 C-01 批改设置阶段工程记录（2026-07-20）

- 用户授权与归档：用户在 Q03 最终视觉纠正后明确要求继续下一阶段，因此 Q03 与 Q09 返回闭环归档；C01 按默认简单、高级折叠实施。详细决定与验收矩阵见 `docs/20260720/C01_GRADING_SETUP_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 组合约束：C01 没有独立导出帧，使用 Figma 08 的 `900px` 居中单卡密度、Figma 12 的模型/策略层级和 Figma 17 的 BYOK 可恢复门禁；没有沿用旧长页，也没有新增顶栏状态胶囊。
- 真实闭环：GET 零 provider，PUT revision/CAS + 指纹幂等；正式批改只消费保存的专家子集、综合方式、任务资料范围、语言/语气/长度、多采样和低置信阈值。成功/失败 job 结果均保留严格净化、无密钥的配置快照。
- 成本与安全：默认一个专家；多专家默认置信度加权；judge 明示额外调用并报告综合进度；共享池固定单专家/单样本且经过动态 kill switch、请求日限额、估算 token 日限额包装。BYOK return 只接受明确任务路径。
- 工程证据：相关回归 `66 passed`；后端全量 `180 passed, 1 skipped, 16 warnings`；前端可见范围审计 `65` 个文件、TypeScript、Vite `466 modules` production build 与 `git diff --check` 通过；两轮终审修复后无已知 P0/P1/P2。
- 浏览器证据：`c01-grading-setup-1440x900.png` 与 `c01-grading-setup-390x844.png`；桌面 `innerWidth=scrollWidth=1440` 且 `scrollHeight=900`，移动 `innerWidth=scrollWidth=390`。未配置直达作答被拦截，双模型默认 weighted、保存进入作答、返回恢复及改回单模型均通过；未调用真实模型。
- 当前状态：代码、合同、工程与浏览器验收完成，等待用户视觉确认，故保持 `[~]`。下一阶段为 S01；C02 保持只读确认页，不成为第二套配置表单。

### 6.6 跨阶段 canonical task entry 纠偏（2026-07-20）

- 用户现场证据：从工作台或历史任务点击草稿 `T_95ee9af828` 后进入 `/tasks/T_95ee9af828/setup`，展示的是本轮 route map 已淘汰的“资料配置”长页；新版 Q01 `/tasks/:id/upload/problems` 实际已经存在，并非页面尚未开发。
- 根因：任务卡片使用的 destination resolver 仍把 `draft`/默认状态指向 `/setup`，同时 router 又把 `/tasks/:id` 静态导向 `/setup`；新建任务和 Q01-Q09 使用另一套新路由，形成两个入口真相源。
- [~] T-FLOW-01 工作台、历史任务、`/tasks/:id` 和其他“继续任务”入口已统一使用同一状态感知 resolver；`draft` 的 canonical destination 固定为 Q01，新建任务与恢复草稿不再分叉。工作台和历史任务中的 `test1` 均已实际点击验证进入 `/upload/problems`；等待用户确认。
- [~] T-FLOW-02 `/tasks/:id/setup` 现只保留为旧书签兼容入口，并与 `/tasks/:id` 一样按真实任务状态跳到当前新阶段；`error` 根据最近失败 job 与已有文件/计数事实恢复，不再返回遗留长页。13 个 destination 分支和 3 个 error gate 分支的确定性检查通过；未为验收制造真实失败任务。
- [~] T-FLOW-03 Q01 的返回动作已改为返回历史任务，不再生成指向 `/setup` 的新链接；遗留 `TaskSetupPage` 文件和可见渲染均已删除。旧 `/setup` 地址实际打开后直接进入新版 Q01，且干净标签页无控制台 error/warning；等待用户确认。
- [~] T-FLOW-04 遗留页唯一需要保留的真实能力——当前任务 KB 资料上传、列表和删除——已迁移到独立 `/tasks/:id/materials`，并由 C01“任务资料范围”提供明确入口。遗留页未接保存的“补充规则”文本框、仅浏览器本地的“个人知识库选择”和重复 BYOK 摘要未迁移；教师注意事项只以 C01 已版本化保存的真实字段为准。C01 → 任务资料 → C01 往返已实际验证，未上传或删除用户文件。
- [~] T-FLOW-QA 工程检查于 2026-07-20 15:25 UTC+8 完成：前端可见范围审计扫描 66 个文件、TypeScript、Vite production build（465 modules）和 `git diff --check` 均通过。浏览器证据为 `draft-entry-to-q01-correction-20260720.png` 与 `task-materials-entry-correction-20260720.png`（1280×720）；任务资料页 `innerWidth=document/body scrollWidth=1280`、`scrollHeight=720`，无页面级横向溢出且首屏完整。移动端未为本次跨阶段热修重复截图，继续沿用组件既有响应式约束并留待用户按需检查。

---

## 7. 作答、批改与复核流程

- [~] S01 添加学生作答独立页，支持身份匹配设置和条件性覆盖提醒。工程与浏览器验收完成：2026-07-23；Figma 10 的桌面锚点、单焦点页面、三种真实匹配方式、任务级识别模型、双层条件覆盖确认、1440×900/390×844 PNG 和相关回归均已完成，等待用户视觉确认。
- [~] S02 作答识别进度独立页。工程与浏览器验收完成：2026-07-23；Figma 05 的 `800×430` 单焦点进度卡、真实文件/身份/答案计数、后台恢复、脱敏事件、错误门禁、1440×900/390×844 PNG 和相关回归均已完成，等待用户视觉确认。
- [~] S03 作答校对总览只显示学生 x 题目矩阵、筛选和分流。工程与浏览器验收完成：2026-07-23；Figma 11 的标题/流程/指标/筛选/矩阵骨架、真实四态单元格、解释性本地筛选、canonical 路由和 1440×900/390×844 PNG 均已完成，等待用户视觉确认。
- [~] S04 学生作答总览独立页。工程与浏览器验收完成：2026-07-23；单学生四指标、上一位/下一位与直选、题目定位、解释性筛选、全部题目长视图、真实身份 CAS、1440×900/390×844 PNG 均已完成，等待用户视觉确认。
- [~] S05 单份作答校对支持学生/题目双维独立筛选。工程与浏览器验收完成：2026-07-24；Figma 15 的内容层级、分离导航、完全/相关匹配、方向键、真实答案 CAS、上下文返回和 1440×900/390×844 PNG 均已完成，等待用户视觉确认。
- [~] C01 批改配置独立页，默认简单、高级折叠。工程与浏览器验收完成：2026-07-20；独立 route、任务级无密钥配置、真实批改消费链、共享池安全边界、桌面/移动截图和保存后进入作答页均已验证；等待用户视觉确认。
- [~] C02 批改前确认只读汇总，不成为第二个配置页。工程与浏览器验收完成：2026-07-24；Figma 12 精确几何、真实任务/设置摘要、可回跳风险、幂等启动、S03 入口及双尺寸 PNG 已完成，等待用户视觉确认。
- [~] C03 批改进度独立页。工程与浏览器验收完成：2026-07-24；Figma 13 精确几何、事实题次/ETA/队列、后台恢复、错误重试、graded→review 迁移及双尺寸 PNG 已完成，等待用户视觉确认。
- [~] R01 待复核结果总览采用 Figma 14 的热力图、指标和复核队列。工程与浏览器验收完成：2026-07-24；Figma 14 精确几何、真实结果/批注、可解释筛选、短队列、精确复核入口及双尺寸 PNG 已完成，等待用户视觉确认。
- [~] R02 复核详情采用 Figma 15 的内容层级，但重做双维导航。工程与浏览器验收完成：2026-07-24；两维独立 exact/related 筛选、方向键、单题/全部题目视图、真实教师分数/评语覆盖层及 R01 回流已完成，等待用户视觉确认。

### 7.1 S-01 添加学生作答阶段工程记录（2026-07-23）

- 详细决定与验收矩阵：`docs/20260723/S01_SUBMISSION_UPLOAD_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 约束：使用 Figma 10（文件 `64TupCQCKXkiT5uxeQY0iH`，节点 `1:679`）作为唯一可见基线；桌面保持标题 `(70,105)`、上传区 `(270,230,900×230)`、身份区约 `900×145`、识别设置约 `900×74`、CTA `(990,780,180×40)`，没有复用遗留上传长页。
- 页面职责：canonical route 为 `/tasks/:id/submissions/upload`；只完成“选择作答来源、身份匹配、识别模型、开始识别”一个决定。S02 已完成，识别启动后进入 `/submissions/progress`；S03 也已完成，`already_done` 与识别完成状态统一进入 `/submissions`。
- 真实能力：支持可复制文字 PDF、TXT/MD/RST/CSV，以及 ZIP/RAR/7z/TAR 压缩包；图片、扫描件、手写 OCR 未实现，页面明确显示“OCR 增强：暂不可用”，没有照抄 Figma 而虚构支持。
- 身份与隐私：文件名优先、名单确定性匹配、全部人工复核三种模式均进入真实后端合同；名单只在服务端精确匹配，整份名单不发送给模型，未唯一匹配者进入人工复核。识别 provider 必须归当前用户、已启用，默认继承 C01 主 provider 但允许本阶段覆盖。
- 幂等与替换：请求指纹包含作答文件、身份模式、名单和识别 provider；同请求返回既有状态，不同请求在已有作答时必须前端确认且后端再次校验，任务写入保持原子提交。
- 工程证据：S01、文件安全、问题来源、任务、C01 与 provider 隔离合并回归 `71 passed, 1 skipped, 13 warnings`；visible-scope audit、lint、TypeScript、Vite production build（`466 modules`）与 `git diff --check` 通过。
- 浏览器证据：`s01-submission-upload-1440x900.png`、`s01-submission-upload-390x844.png`。桌面 `innerWidth=scrollWidth=1440`、`scrollHeight=900`；移动 `innerWidth=390`、`scrollWidth=375`，无页面级横向溢出。三种身份模式均真实切换，名单模式出现名单选择器，未上传文件时主按钮正确禁用；未调用真实模型、未上传用户文件。
- 当前状态：代码、合同、工程和浏览器验收完成，等待用户视觉确认，故保持 `[~]`；不得提前宣称 S01 已获用户验收或整个作答流程完成。

### 7.2 S-02 作答识别进度阶段工程记录（2026-07-23）

- 详细决定与验收矩阵：`docs/20260723/S02_SUBMISSION_RECOGNITION_PROGRESS_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 约束：S02 无独立导出帧，按已锁定规则复用 Figma 05（文件 `64TupCQCKXkiT5uxeQY0iH`，节点 `1:280`）的识别进度语言；桌面保持标题 `(70,105)`、流程 `(70,155)`、`800×430` 居中事实卡和卡片下右对齐动作，没有复用遗留作答长页。
- 页面职责：canonical route 为 `/tasks/:id/submissions/progress`；只显示当前识别动作、事实百分比、文件/身份/答案计数、五个步骤、最近事件、后台离开和错误恢复。S01 启动后、工作台/历史任务恢复和失败 job 均使用同一 destination resolver 进入 S02。
- 真实进度：`JobProgress.stage_metrics` 提供文件总数/已处理、识别成功、身份匹配/待校正、逐题答案数和失败数；并发累加受 reporter 锁保护。身份识别和答案拆分按真实同次调用并行显示，不伪造串行阶段、页数或 ETA。
- 完成与隐私：只有 TaskStore 成功提交后才发布 `completed / done`；进度事件和普通日志不显示学生姓名、学号或单个文件名。全部失败进入 S02 可恢复错误页；OCR/vision 能力边界没有改变。
- 工程证据：相关后端回归 `48 passed, 1 skipped, 5 warnings`；visible-scope audit 扫描 `68` 个可见文件、lint、TypeScript、Vite production build（`467 modules`）与 `git diff --check` 通过。
- 浏览器证据：`s02-submission-progress-1440x900.png`、`s02-submission-progress-mobile-390x844.png`。桌面 `scrollWidth=1440`、`scrollHeight=900`、主卡 `(320,230,800×430)`；移动 `scrollWidth=390`、当前流程步骤自动滚入可见区域，无 console error/warning。点击“返回工作台”真实进入 `/`；未调用真实模型、未上传用户文件。
- 当前状态：代码、合同、工程和浏览器验收完成，等待用户视觉确认，故保持 `[~]`。S03 已实现，`submissions_ready` 已统一到 `/tasks/:id/submissions`；旧 `/upload/submissions` 只保留状态感知兼容跳转。

### 7.3 S-03 作答校对总览阶段工程记录（2026-07-23）

- 详细决定与验收矩阵：`docs/20260723/S03_SUBMISSION_REVIEW_OVERVIEW_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 约束：使用 Figma 11（文件 `64TupCQCKXkiT5uxeQY0iH`，节点 `1:740`）作为唯一可见基线；桌面保持标题 `(70,105)`、流程 `(70,155)`、`90px` 大号指标、独占 `52px` 搜索/筛选行、`42px` 表头和 `52px` 数据行。文档要求的身份异常以同语言第四张指标补充，没有恢复旧长页。
- 页面职责：canonical route 为 `/tasks/:id/submissions`；只展示事实指标、学生 × 题目矩阵、筛选/排序和进入学生详情的精确入口，不编辑整份作答、不重复 C01、不启动批改。旧 `/upload/submissions` 只做状态感知兼容跳转。
- 真实状态：单元格只使用后端实际数据区分已识别、识别标记、空白和缺失；没有可靠置信度字段，因此“低置信”只映射到已有 flag 并在页面解释，不伪造数值。
- 智能筛选：学号/姓名、Q 题号、题型/题干关键词、待复核/缺失/身份异常和三种排序均使用确定性本地规则，显示解释和清空动作，不消耗 provider 额度。输入 `Q4 缺失` 的真实浏览器检查只返回两名对应学生。
- 路由闭环：S01 `already_done`、S02 完成、工作台、历史任务和 canonical task entry 的 `submissions_ready` 全部统一到 S03。S05 完成后，矩阵单元格已改为直达 `/students/:sid/questions/:qid` 并保留矩阵筛选；学号和“查看”仍进入 S04 全题总览。
- 工程证据：visible-scope audit 扫描 `69` 个可见文件、lint、TypeScript、Vite production build（`470 modules`）与 `git diff --check` 通过。
- 浏览器证据：`S03_submission_review_overview_1440x900.png`、`S03_submission_review_overview_390x844.png`；匿名固定 fixture 覆盖正常、flag、空白、缺失和身份待复核，控制台 `0 errors / 0 warnings`，未调用真实模型或改写用户任务。
- 当前状态：代码、工程与浏览器验收完成，等待用户视觉确认，故保持 `[~]`。后续 S04 已完成身份修正和单学生全题总览，S05 已完成独立学生 × 题目聚焦编辑。

### 7.4 S-04 学生作答总览阶段工程记录（2026-07-23）

- 详细决定与验收矩阵：`docs/20260723/S04_STUDENT_SUBMISSION_OVERVIEW_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 组合约束：S04 没有独立 frame，严格复用 Figma 11 的标题/流程、`90px` 大号指标、平面导航、独占搜索行与低卡片密度；身份修正默认收起并与答案列表分离，没有恢复遗留长工作区或提前塞入 S05 编辑器。
- 页面职责：canonical route 为 `/tasks/:id/students/:studentId`；只负责一个学生的身份、作答覆盖、真实异常、来源和全部题目内容。上一位/下一位与学生直选、题目定位会保留另一个维度的查询上下文。
- 身份合同：owner + `submissions_ready` + busy gate + NFKC/casefold 重复学号检查 + expected revision/CAS；更换 key 保留答案/flag/来源和顺序，成功标记 `matched / manual_review`，INFO 日志不记录学号姓名。批改后修改明确拒绝，避免孤立 grade result。
- 智能筛选：当前学生固定，支持题号/题型/题干/作答内容及已识别/flag/空白/缺失；“低置信”只映射真实 flag。输入“积分题”实测只保留 Q4，零 provider 调用。
- route 边界：visible-scope audit 只精确放行受教师会话保护的 task review route，不开放学生 portal；`/student` 仍是未开放页，其他 student route 继续失败。
- 工程证据：身份合同与相关活跃工作流回归 `12 passed, 2 warnings`；visible-scope audit 扫描 `70` 个可见文件、lint、TypeScript、Vite production build（`471 modules`）与 `git diff --check` 通过。
- 浏览器证据：`S04_student_submission_overview_1440x900.png`、`S04_student_submission_overview_390x844.png`；身份改名后 URL replace、状态变为已匹配且 5 个答案保留，桌面/移动均无页面级横向溢出，干净页面控制台 `0 errors / 0 warnings`。
- 当前状态：代码、合同、工程和浏览器验收完成，等待用户视觉确认，故保持 `[~]`。后续 S05 已实现单学生 × 单题聚焦编辑、双维智能选择和方向键切换。

### 7.5 S-05 单份作答校对阶段工程记录（2026-07-24）

- 详细决定与验收矩阵：`docs/20260724/S05_STUDENT_ANSWER_REVIEW_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 约束：使用 Figma 15（文件 `64TupCQCKXkiT5uxeQY0iH`，节点 `1:1188`）的标题/流程、平面导航、全宽作答、双列上下文和底部来源层级；因 S05 位于批改前，不伪造其中的得分、AI 理由、页码或置信度。
- 页面职责：canonical route 为 `/tasks/:id/students/:sid/questions/:qid`；只编辑当前格的识别 content/flag。学生导航置顶，题目导航在内容顶部和底部，S03/S04 入口与返回都保留来源筛选。
- 智能与键盘：学生/题目分别保存 filter；完全/相关匹配明确区分；“积分题”实测 Q4 exact、Q1 related。左右切学生、上下切题目；输入/文本域/select/contenteditable/dialog 聚焦时不拦截。
- 保存合同：owner/busy gate、expected revision、TaskStore CAS；缺失格只能为真实 task question 创建，元数据来自服务端；INFO 日志不记录学生、题目或答案内容。
- 工程证据：S05 与活跃工作流目标回归 `7 passed, 2 warnings`；visible-scope audit 扫描 `71` 个文件、lint、TypeScript、Vite production build（`475 modules`）与 `git diff --check` 通过。
- 浏览器证据：`S05_student_answer_review_1440x900.png`、`S05_student_answer_review_390x844.png`；桌面 `scrollWidth=1440`、页面高 `1014`，移动 `scrollWidth=390`；双维筛选、输入框键盘保护、方向键切换和真实保存通过，控制台 `0 errors / 0 warnings`，未调用真实模型。
- 当前状态：代码、合同、工程和浏览器验收完成，等待用户视觉确认，故保持 `[~]`。下一阶段为 C02，只读汇总，不重复配置；继续前先执行用户要求的额度门禁。

### 7.6 C-02 批改前确认阶段工程记录（2026-07-24）

- 详细决定与验收矩阵：`docs/20260724/C02_PRE_GRADING_CONFIRMATION_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 约束：使用 Figma 12（文件 `64TupCQCKXkiT5uxeQY0iH`，节点 `1:855`）；桌面标题 `(70,105)`，四块主区域均 `x=170 / width=1100`，高度依次 `130/135/135/62px`，开始按钮 `180×40` 位于 `right=1270 / y=793`。按已确认顶栏规则删除 Figma 重复状态胶囊。
- 页面职责：canonical route `/tasks/:id/grading/preflight`；只读展示真实任务覆盖、任务级专家、综合方式、策略和风险，所有修改进入 Q03/S03/C01，不复制配置表单。
- 真实启动：沿用 `POST /tasks/:id/grade` 幂等合同；只在 `submissions_ready + configured + readiness.ready + enabled selection + 非空题目/学生` 时开放。启动进入 C03 canonical route，`grading` destination 同步修正。
- 工程证据：visible-scope audit 扫描 `72` 个文件，lint、TypeScript、Vite production build（`477 modules`）与 `git diff --check` 通过。
- 浏览器证据：`C02-pre-grading-confirmation-desktop-viewport.png`、`C02-pre-grading-confirmation-mobile.png`；桌面像素几何与 Figma 一致、`scrollHeight=900`，移动 `scrollWidth=390`；启动真实进入 `/grading/progress`，控制台 `0 errors / 0 warnings`，未调用真实 provider。
- 当前状态：代码、启动合同、工程和浏览器验收完成，等待用户视觉确认，故保持 `[~]`。下一阶段 C03 必须用 Figma 13 替换临时进度容器。

### 7.7 C-03 批改进度阶段工程记录（2026-07-24）

- 详细决定与验收矩阵：`docs/20260724/C03_GRADING_PROGRESS_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 约束：使用 Figma 13（文件 `64TupCQCKXkiT5uxeQY0iH`，节点 `1:929`）；桌面主进度卡 `(250,210,940×220)`、队列表 `(250,470,940×234)`、恢复条 `(250,720,940×74)` 与原稿一致，不显示重复顶栏状态胶囊。
- 页面职责：canonical route `/tasks/:id/grading/progress`；只展示事实完成/运行/等待/错误数量、百分比、保守 ETA、后台离开和失败恢复，不混入结果内容或学生身份。
- 进度合同：completed 使用 reporter；active 按学生×题目去重；waiting 由事实差值计算；错误只称最近信号；首次 `set_phase` 写真实 `started_at`。`phase=done + task=grading` 显示结果摘要仍在完成。
- 路由闭环：`grading` 全部进入 C03，grading error 也在 C03 重试；`graded` 进入 `/review`。S02 和遗留上传页的旧结果跳转同步纠正。
- 工程证据：C03/Q02-Q03 回归 `5 passed`；visible-scope audit 扫描 `73` 个文件、lint、TypeScript、Vite production build（`479 modules`）与 `git diff --check` 通过。
- 浏览器证据：`C03-grading-progress-desktop.png`、`C03-grading-progress-mobile.png`；桌面关键坐标完全匹配 Figma，移动 `scrollWidth=390`；错误态重试通过，干净控制台 `0 errors / 0 warnings`，未调用真实 provider。
- 当前状态：代码、进度合同、工程和浏览器验收完成，等待用户视觉确认，故保持 `[~]`。下一阶段 R01 必须用 Figma 14 替换 `/review` 临时兼容容器。

### 7.8 R-01 结果总览与复核热力图阶段工程记录（2026-07-24）

- 详细决定与验收矩阵：`docs/20260724/R01_REVIEW_OVERVIEW_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 约束：使用 Figma 14（文件 `64TupCQCKXkiT5uxeQY0iH`，节点 `1:1009`）；标题 `(70,105)`、四张 `250×90` 指标卡、`1300×48` 筛选行、`820×308` 热力图和 `438×308` 队列均达到 0–1px 对照，不恢复旧结果页横向五块 tab 或长内容。
- 页面职责：canonical route `/tasks/:id/review`；只显示平均得分率、低置信、专家分歧、教师批注、学生 × 题目矩阵、4 条优先队列和进入详情的精确链接。`grading` 返回 C03，其他状态使用统一 destination。
- 真实边界：结果、置信度、专家结果、复核原因与教师批注全部来自现有 owner-scoped API；“已批注”不冒充“已复核”。R01 交付当时未开放虚假确认按钮；A00 现已用真实 review/finalized 生命周期替换该缺口。
- 智能筛选：学生/题目、低置信、专家分歧、待复核、批注及低于 N 分均为确定性本地解释规则，零 provider 调用；真正语义/拼音/服务端大数据筛选仍待后续。
- 工程证据：visible-scope audit 扫描 `74` 个文件、lint、TypeScript、Vite production build（`482 modules`）与浏览器 route 回落通过。
- 浏览器证据：`R01-review-overview-desktop-viewport.png`、`R01-review-overview-mobile.png`；桌面 `scrollWidth=1440 / scrollHeight=900`，移动 `scrollWidth=390`，矩阵内部滚动；主 CTA 真实进入精确学生/题目 URL，未调用 provider 或修改用户数据。
- 当前状态：代码、工程与浏览器验收完成，等待用户视觉确认，故保持 `[~]`。R02 将替换精确 URL 当前的兼容学生详情回落页，并完成两维独立导航和复核编辑。

### 7.9 R-02 学生/题目复核详情阶段工程记录（2026-07-24）

- 详细决定与验收矩阵：`docs/20260724/R02_REVIEW_DETAIL_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 与用户覆盖：使用 Figma 15（文件 `64TupCQCKXkiT5uxeQY0iH`，节点 `1:1188`）的标题、流程、作答、AI/教师双列和评分标准层级；按用户纠正将学生与题目导航拆成两行，修复原稿按钮挤压与底部重叠。
- 页面职责：canonical route `/tasks/:id/review/:sid/:qid`；单题只处理一格，`:qid=all` 显示当前学生全部题目长视图。R01 默认单题，未来学生分析可直达全部题目。
- 智能与键盘：学生/题目筛选分别保留在 URL；exact/related 明示；“积分题”和完整学号浏览器实测通过；左右切学生、上下切题目，编辑控件聚焦不截获。
- 真实合同：新增逐格 owner-scoped PUT，校验 graded/result/分数范围，使用 workflow revision/CAS 和完全重试幂等；教师覆盖层保留 AI 原始分/理由，并通过统一结果模型影响总览和后续统计。
- 工程证据：R02 + 问题来源合并回归 `25 passed, 1 skipped`；visible-scope audit、lint、TypeScript 与 Vite production build（`484 modules`）通过。
- 浏览器证据：`R02-review-detail-desktop.png`、`R02-review-detail-mobile.png`；教师将 Alice/Q2 确认为 8.5 后，AI 7/10 保留，R01 显示 85% 与 `1/48` 已复核；全部题目 route 显示 8 项。匿名 fixture，未调用 provider 或修改用户数据。
- 当前状态：代码、真实保存、工程与浏览器验收完成，等待用户视觉确认，故保持 `[~]`。任务级复核完成、final result 版本与 stale/分析生成状态必须在 A00 建立。

### R02 学生/题目双维导航硬规则

- [~] R02-01 学生导航与题目导航放在不同位置，不再四个按钮挤在一排。R02 真实复核页两条独立导航与浏览器验收完成，等待用户视觉确认。
- [~] R02-02 顶部左右区域负责上一位/下一位学生，并显示学号姓名。工程完成：当前项显示姓名/学号，相邻按钮显示姓名并有完整读屏语义。
- [~] R02-03 题目导航在内容顶部和底部均可用，明确显示上一题/下一题。工程完成：S05 双位置均接真实 route。
- [~] R02-04 学生选择器支持学号/姓名关键词、模糊和自然语言筛选。工程边界：学号/姓名精确和确定性相关匹配完成；真正模型语义仍未开放。
- [~] R02-05 题目选择器支持题号、题干、题型、知识点与自然语言筛选，如“积分题”。工程边界：题号/题型/题干和有限可解释别名完成；知识点模型语义仍未开放。
- [~] R02-06 两维筛选互不清空；选中学生时筛选题目，学生保持不变，反之亦然。浏览器验收完成，等待用户确认。
- [~] R02-07 多个匹配结果在下拉/局部侧栏列出，并能清空任一维筛选。工程完成：列表显示 exact/related 并分别清空。
- [~] R02-08 左右方向键切学生，上下方向键切题目；输入框、文本域、select、弹窗聚焦时不拦截按键。浏览器验收完成。
- [~] R02-09 页面明确展示快捷键提示，并保证键盘焦点与读屏语义。工程与 DOM 验收完成。
- [~] R02-10 学生详情提供 `全部题目` 长视图与 `单题` 聚焦视图切换。R02 以 `:qid=all` 与精确题号 route 提供两种模式，长内容只在全部题目模式自然滚动。
- [~] R02-11 从复核矩阵进入时默认单题视图；从学生分析进入时默认全部题目视图。R01→R02 单题已完成；`:qid=all` 已可供 A04/A05 使用，学生分析入口待相应阶段接入。

---

## 8. 正式结果与分析工作区（Figma 16 扩展为多页）

> 旧代码 `ResultsLayout.tsx`、`TaskResultsPage.tsx`、`TaskStudentDetailPage.tsx`、`TaskQuestionDetailPage.tsx` 已有总览/按题/可视化/学生详情/题目详情能力。复用数据模型、统计定义、自然语言 API hooks 和互跳语义；不复用固定全局侧栏、长页堆叠、禁用占位、卡片嵌套和伪图表。

### A-00 最终结果工作区壳

- [~] A00-01 正式完成任务默认进入 `/tasks/:id/results`。工程完成：正式结果三种状态均由统一 destination 进入 `/results`，`graded` 仍进入 `/review`；等待用户验收。
- [~] A00-02 保留全局顶部导航和任务上下文栏。工程完成：复用 70px Figma 顶栏、1300px 版心、任务名/版本和七步流程，不恢复旧全局侧栏。
- [~] A00-03 内容区使用局部左侧导航：总览、题目分析、学生分析、可视化分析、报告与下载。工程完成：五个 canonical route 均可直接访问。
- [~] A00-04 局部左侧栏只负责结果工作区切换，主内容仍是单一纵向焦点。工程完成：每个 route 只渲染一个主内容面板，无横向大 tab 和卡片套卡片。
- [~] A00-05 移动端把局部侧栏折叠为下拉或横向 tabs。工程完成：390×844 使用单一下拉，主内容无页面级横向溢出。
- [~] A00-06 所有子页显示 final result 版本、生成时间和 stale 状态。工程完成：共用版本横幅展示版本、确认时间和 artifact 状态；教师改分后保留上一版本并回到待复核，分析状态按事实变 stale。

### 8.1 A-00 最终结果生命周期与工作区壳阶段工程记录（2026-07-24）

- 详细决定与验收矩阵：`docs/20260724/A00_FINAL_RESULTS_WORKSPACE_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 约束：只调用一次 Figma 16 节点 `1:1260` 并缓存上下文；保留 1300px 内容、七步流程、浅色完成态横幅、低饱和指标卡和大留白。按用户覆盖将单页扩成局部左侧五入口，不复制旧全局侧栏或横向大 tab。
- 生命周期合同：新增 `GET /tasks/:id/finalization` 与幂等 `POST /tasks/:id/finalization/confirm`；只有低置信、后端复核标记、专家分歧或 grading failure 等真实门禁全部确认后才创建不可变版本。AI 原始值与教师覆盖同时保留。
- 版本与 stale：任务级 `final_result_version/fingerprint/dirty` 与 artifact `analysis_status/result_version` 分离；确认后改分回到 `graded`，上一版快照不删除，已有分析按事实标 stale；不会自动触发昂贵重算。
- 路由与页面：`graded → /review`；确认后进入 `/results`。五个 route 为 `/results`、`/questions`、`/students`、`/visualizations`、`/reports`；A00 只建立真实壳和事实空态，详细总览/分析按 A01-A07 继续。
- 工程证据：后端整库 `213 passed, 1 skipped`；新增回归同时锁定“已有批改结果后不可原地静默改写题干/评分资料”的版本一致性边界；visible-scope audit、TypeScript、lint、Vite production build（`481 modules`）与 `git diff --check` 通过。
- 浏览器证据：`A00-results-workspace-desktop.png`、`A00-results-workspace-mobile.png`；桌面 1440×900、移动 390×844，五个 route 均加载同一版本上下文；匿名 fixture，未调用 provider 或修改用户数据。
- 当前状态：代码、真实合同、工程和浏览器验收完成，等待用户视觉确认，故保持 `[~]`。A01 不得重新引入 R01 热力复核或旧长页，只补简洁摘要与分流。

### A-01 总览 `/tasks/:id/results`

- [~] A01-01 简洁展示班级关键指标、结果版本和当前分析/导出状态。工程完成：真实学生/题目数、班级平均得分率、及格率、final result 版本与 artifact 状态已接入；等待用户视觉确认。
- [~] A01-02 只预览少量题目、学生、复核结论和 1–2 张图，不显示全量长列表。工程完成：五档分数分布、最低平均得分率 3 题、低得分率优先 3 位学生和必需复核结论均使用正式结果真实数据。
- [~] A01-03 每个摘要区提供进入题目分析、学生分析、可视化或报告的明确按钮。工程完成：四个入口均指向 A00 canonical 子路由。
- [~] A01-04 提供报告下载和重新生成入口；若最终确定独立报告页则改为摘要入口。已按确定的独立报告页方案完成：本页只显示“尚未生成”事实与 `/results/reports` 入口，不放伪下载/重生成按钮。
- [~] A01-05 不重复 Figma 14 的待复核工作；复核完成后汇总最终结果供随时复看。工程完成：无热力复核队列、逐格编辑或确认 CTA，只显示已冻结版本及复核结论。

### 8.2 A-01 正式结果总览阶段工程记录（2026-07-24）

- 详细决定与验收矩阵：`docs/20260724/A01_RESULTS_OVERVIEW_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- 数据口径：教师覆盖分优先；班级平均取学生总得分率平均；及格固定 `≥60%` 且标题明示；分布、薄弱题目和低置信题次都由正式结果确定性计算，不调用模型。
- 页面边界：四指标 + 两张真实摘要图 + 3 位学生预览 + 复核/产物状态；每区明确分流，不展开全量题目/学生或伪造报告下载。
- 工程证据：visible-scope audit、TypeScript、lint、Vite production build（`481 modules`）与 `git diff --check` 通过。
- 浏览器证据：`A01-results-overview-desktop.png`（1440×900）与 `A01-results-overview-mobile.png`（390×844）；两端均无页面级横向溢出，匿名 fixture、未调用 provider。
- 当前状态：代码、真实数据口径、工程和浏览器验收完成，等待用户视觉确认，故保持 `[~]`。A02 只实现题目总览，不继续给 `/results` 加长列表。

### A-02 题目分析总览 `/tasks/:id/results/questions`

- [~] A02-01 支持题号、题干、题型、知识点、得分率、置信度、复核状态筛选排序。工程完成：结构化选择器、URL 条件、题号/题干/知识点关键词和 5 种排序已接入；知识点只消费后端真实字段，缺失时明确显示未标注。
- [~] A02-02 支持自然语言筛选并显示可编辑条件。工程完成：确定性解析题号、题型、得分率、置信度、复核、未标知识点与关键词；条件显示为可移除标签，不调用 provider 或冒充深层语义。
- [~] A02-03 每题展示作答人数、平均分/得分率、置信度、复核量、易错点摘要。工程完成：教师覆盖分优先，平均置信度归一化，正式必审门禁与确认数沿用 A00；“易错/风险摘要”只汇总真实低分、低置信和专家分歧信号。
- [~] A02-04 点击进入题目详情，不在总览下方展开全体学生详情。工程完成：每行/卡只提供 canonical `:qid` 入口，4 题分页；桌面矩阵和移动卡均无学生完整答案。

### 8.3 A-02 题目分析总览阶段工程记录（2026-07-24）

- 详细决定与验收矩阵：`docs/20260724/A02_QUESTION_ANALYSIS_OVERVIEW_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 约束：复用 A00/Figma 16 壳；指标沿用 Figma 14 的大数字圆角矩形层级；自然语言框独占一行，结构化条件另起一行；桌面单表、移动卡片，不出现页面级横向滚动。
- 筛选证据：`积分题 低置信 已复核` 被拆为 3 个可移除条件并只命中真实 Q2；移除关键词后 URL 与结果同步。知识点缺失不会由前端猜测。
- 工程证据：visible-scope audit、TypeScript、lint、Vite production build（`482 modules`）与 `git diff --check` 通过。
- 浏览器证据：`A02-question-analysis-overview-desktop.png`（1440×900）与 `A02-question-analysis-overview-mobile.png`（390×844）；两端页面宽度等于 viewport，匿名 fixture、未调用 provider。
- 当前状态：代码、真实统计、筛选/排序、工程和浏览器验收完成，等待用户视觉确认，故保持 `[~]`。A03 将替换 canonical `:qid` 的遗留详情视觉。

### A-03 题目详情 `/tasks/:id/results/questions/:qid`

- [~] A03-01 显示题干、题型、分值、评分标准、标答/测试资料来源。工程完成：四类资料分卡显示，数学内容渲染，来源只读正式结果 provenance；未提供时明确标记。
- [~] A03-02 显示作答人数、平均/中位/最高/最低分、平均置信度、复核/分歧统计。工程完成：六张 Figma 14 式圆角指标卡全部消费真实正式结果，教师最终分优先。
- [~] A03-03 显示有依据的易错点、常见解法问题与 rubric 维度总结。工程完成：只聚合重复反馈、真实评分步骤与正式复核/专家分歧，不生成虚假 AI 主题。
- [~] A03-04 支持智能筛选/直接选择题目、上一题/下一题和上下键切换。工程完成：exact/related 查找、直接选择器、顶部/底部按钮、上下键与输入焦点保护均已实渲染验证。
- [~] A03-05 只显示学生摘要与进入学生详情按钮，不纵向铺开每名学生完整答案。工程完成：只显示得分率最低的 5 位及摘要，不显示答案正文。
- [~] A03-06 从学生摘要进入学生详情时保留当前题目。工程完成：canonical 学生链接携带 `question=:qid` 和题目锚点；学生详情视觉将在 A05 替换，当前不冒充已完成。

### 8.4 A-03 题目分析详情阶段工程记录（2026-07-24）

- 详细决定与验收矩阵：`docs/20260724/A03_QUESTION_ANALYSIS_DETAIL_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- 页面边界：同一正式结果壳内只做单题完整分析；四类资料、六项指标、三类事实证据与 5 位学生摘要分区，不铺全班完整答案。
- 交互证据：`积分题` 对 Q2 显示 related，`Q3` 只显示一个 exact；Q2/Q3 上下键往返通过。A02 条件经 `return` 保留，详情内切题不丢失返回上下文。
- 成本边界：本页不调用可能在缓存缺失时触发 provider 的遗留 breakdown GET，只使用既有正式结果确定性计算。
- 工程证据：visible-scope audit 扫描 78 文件、TypeScript、lint、Vite production build（`482 modules`）与 `git diff --check` 通过。
- 浏览器证据：`A03-question-analysis-detail-desktop.png`（1440×900）与 `A03-question-analysis-detail-mobile.png`（390×844）；两端无页面级横向溢出，匿名 fixture、未调用 provider。
- 当前状态：代码、真实数据、键盘/筛选交互、工程和浏览器验收完成，等待用户视觉确认，故保持 `[~]`。下一阶段 A04 只做学生分析总览。

### A-04 学生分析总览 `/tasks/:id/results/students`

- [~] A04-01 显示全班人数、平均分、中位数、最高/最低分、及格率等概况。工程完成：六张 Figma 14 式圆角指标卡显示学生数、平均/中位/范围、及格率和含必审信号人数。
- [~] A04-02 支持学号、姓名、标签、得分率、是否及格、复核状态筛选排序。工程进展：姓名/学号、得分率、及格、置信度、复核和 5 种排序已完成；正式结果没有学生标签字段，未用任务标签冒充，标签筛选待 owner-scoped 学生标签契约。
- [~] A04-03 支持自然语言筛选并显示可编辑条件。工程完成：确定性解释姓名/学号、分数阈值、及格、低置信、复核和高/低分优先，条件可逐项移除且零 provider。
- [~] A04-04 表格显示每个学生总分/得分率、每题得分/百分比、及格状态和复核摘要。工程完成：桌面单矩阵和移动摘要卡均显示真实教师最终分；每题单元格可进入学生详情聚焦该题。
- [~] A04-05 点击进入学生详情；总览首页只预览少量学生并引导到本页。工程完成：A01 只预览 3 位，A04 每页 5 位；canonical `:sid` 分流携带当前题和返回条件，详情视觉由 A05 紧接替换。

### 8.5 A-04 学生分析总览阶段工程记录（2026-07-24）

- 详细决定与验收矩阵：`docs/20260724/A04_STUDENT_ANALYSIS_OVERVIEW_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
- Figma 约束：复用 A00/Figma 16 壳和 Figma 14 大指标/矩阵语言；自然语言框独占一行，五个结构化条件另起一行，总览不展开答案正文。
- 筛选证据：`Alice 低置信 已复核 低分优先` 被拆为 4 个可移除条件并只命中真实 Alice（1/6）；筛选和排序写入 URL，不调用 provider。
- 响应式证据：桌面矩阵约 `1058/1386px`、移动逐题行约 `286/656px`，横向滚动只发生在矩阵/卡片内部；页面本身分别保持 `1440/1440` 与 `390/390`。
- 工程证据：visible-scope audit 扫描 79 文件、TypeScript、lint、Vite production build（`483 modules`）与 `git diff --check` 通过。
- 浏览器证据：`A04-student-analysis-overview-desktop.png`（1440×900）与 `A04-student-analysis-overview-mobile.png`（390×844）；匿名 fixture、未调用 provider。
- 当前状态：代码、真实统计/筛选、工程和浏览器验收完成，等待用户视觉确认，故保持 `[~]`。下一阶段 A05 替换学生详情；学生标签字段仍是明确后端缺口。

### A-05 学生详情 `/tasks/:id/results/students/:sid`

- [ ] A05-01 支持学号/姓名智能查找学生，上一位/下一位及左右键切换。
- [ ] A05-02 支持 `全部题目` 长视图和 `单题` 聚焦视图。
- [ ] A05-03 单题模式支持题目智能筛选、上一题/下一题及上下键切换。
- [ ] A05-04 每题显示答案、得分/百分比、置信度、AI 理由、教师最终结果和复核状态。
- [ ] A05-05 提供跳转到当前题目详情的按钮并保留学生上下文。
- [ ] A05-06 两维筛选、快捷键和返回上下文遵循 R02 同一组件。

### A-06 可视化分析 `/tasks/:id/results/visualizations`

- [ ] A06-01 顶部显示及格率、平均数、中位数、最高/最低分和样本数。
- [ ] A06-02 默认图表至少覆盖分数分布、逐题得分率/复核量、学生 x 题目热力图、置信度/分歧散点等不同用途。
- [ ] A06-03 每张图说明指标、样本、筛选范围、数据版本和明细入口。
- [ ] A06-04 支持自然语言请求更多图表，生成结果走安全 schema。
- [ ] A06-05 支持保存/删除自定义图表、恢复默认图表和导出 PNG/PDF。
- [ ] A06-06 使用真实图表库；禁止把 scatter、box 等伪装成柱状缩略图。

### A-07 报告与下载 `/tasks/:id/results/reports`

- [ ] A07-01 成绩表、学情报告、发布版标答、LaTeX、Markdown 等产物显示状态、版本和生成时间。
- [ ] A07-02 支持单项下载、下载全部和按最新 final result 重新生成。
- [ ] A07-03 旧版本清楚标注，不允许悄悄下载过期报告。

---

## 9. 测试、视觉 QA 与逐阶段验收

- [ ] QA-01 每页运行 `npm run typecheck`。
- [ ] QA-02 每批运行 `npm run build`。
- [ ] QA-03 题目、作答、批改、复核、正式结果全流程测试。
- [ ] QA-04 学期边界、标签去重、课程为空、智能匹配歧义测试。
- [ ] QA-05 学生/题目双维筛选独立性和快捷键测试。
- [ ] QA-06 自然语言筛选解释、清空、无匹配、大班级、限流和错误恢复测试。
- [ ] QA-07 图表类型、数据版本、空数据、单学生/单题和导出测试。
- [ ] QA-08 BYOK 用户隔离、密钥掩码、外链和缺失门禁测试。
- [ ] QA-09 `1440x900` 逐帧对照 Figma；用户确认的扩展页按同一 token/组件检查。
- [ ] QA-10 桌面/移动、键盘、焦点、对比度、缩放、读屏和 reduced-motion 检查。
- [ ] QA-11 删除新页面替代的旧可见 UI、死 route 和用户可见开发说明。
- [ ] QA-12 用户逐页验收全部通过；在此之前不得宣称“前端已完成”或“只剩美工”。

---

## 10. 本轮产品决定确认记录

- [x] OPEN-01 顶部入口命名确认为 `工作台 / Workspace`；不再使用 `任务总览/任务驾驶舱`。确认时间：2026-07-11 16:00 UTC+8。
- [x] OPEN-02 学期最早从 `2025-2026 秋季学期` 开始，并始终允许选择当前学期之后一个学期；月份映射无需达到教务校历精度。确认时间：2026-07-11 16:00 UTC+8。
- [x] OPEN-03 正式结果局部侧栏增加独立第五项 `报告与下载 / Reports & Downloads`。确认时间：2026-07-11 16:00 UTC+8。
- [x] OPEN-04 使用“待复核 `/review`、正式完成 `/results`”两个清晰入口；具体子 route 由主 Agent 以语义单一、后端无冲突为原则统一维护。确认时间：2026-07-11 16:00 UTC+8。
