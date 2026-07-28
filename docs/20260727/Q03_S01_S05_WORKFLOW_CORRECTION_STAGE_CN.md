# Q03 / S01 / S05 / C01 工作流纠偏阶段记录（2026-07-27）

> **最新覆盖：** 用户随后确认“上传作答”只负责文件与身份识别，批改模型/评分策略移到第 6“执行批改”；校对页增加可持久化“已复核”，C02 自动开始摘要于 2026-07-28 调整为 10 秒。本文件中“上传作答内部两阶段”和“先保存设置再识别”的内容仅保留为历史。最新决定与合同见 `docs/20260727/S01_S05_C01_C02_SUBMISSION_TO_GRADING_REALIGNMENT_STAGE_CN.md`。

> 分支：`codex/figma-first-frontend-redesign`
>
> 范围：题目资料矩阵、上传作答内部流程、学生作答连续校对、批改设置与补充任务资料、八步可达性和 Safari 回归。

## 1. 最终产品决定

1. 顶部保持八步：`新建任务 / 上传题目 / 审核题目 / 上传作答 / 校对作答 / 执行批改 / 复核批改 / 结果分析`。
2. （已被同日最新决定覆盖）本阶段一度把批改/识别设置放入“上传作答”同一路由的第二个短阶段；现已移到第 6“执行批改”。
3. Q03 始终显示全部题目的资料矩阵，0 风险也不能用空态隐藏正常题目。
4. 题目资料审核和学生作答审核采用同一种题目浏览：左侧题号目录，右侧全部题目连续滚动；上下题按钮只做定位。
5. 学生与题目是两个独立维度；切换学生保持题目，筛选题目保持学生。
6. 学生校对只保留一个 URL 和一个页面实现：`/tasks/:id/students/:studentId?question=:questionId`。旧 `/questions/:questionId` route 和旧学生总览组件直接删除，不做重定向。
7. 作答正常状态只在题号旁显示绿色“已识别”；异常时同一位置换成橙色“需复核/低置信”或红色“作答空/未识别”，不再提供独立“识别状态与提示”输入区。
8. C01 只突出模型、补充任务资料、严格度和部分分；语气、长度、语言、采样、阈值、纠错建议与教师备注归入高级设置。

## 2. 前端实现

### 2.1 Q03 完整资料矩阵

- 每题固定显示题目、标答、评分标准、测试样例和审核提示。
- 正常题目显示绿色“已识别”；由 AI 准备的标答/评分标准显示绿色“已生成”；非编程测试显示中性“不适用”。
- 低置信、来源冲突、解析异常等开放风险只覆盖对应状态和审核提示。
- 0 开放风险仍展示完整矩阵，不再以“没有需要处理的风险”空态代替表格。
- 搜索使用 composition-safe 本地值并支持可解释别名；“积分”可命中含 `\\int`/`∫` 的题目。
- 文档末端增加最后一题优先判断，修复 Safari 高视口点击第 3 题后正文已到第 3 题、左栏仍高亮第 2 题的问题。

### 2.2 学生作答统一连续校对

- canonical route 为 `/tasks/:id/students/:studentId?question=:questionId`；query 只决定初始锚点和矩阵深链。
- S03 的学生 ID、题目单元格、行尾“查看”和 footer 全部生成同一种 canonical URL。
- 当前学生的全部题目始终挂载；左栏可独立滚动、显示题号和状态，并随正文同步高亮。
- 页面保留旧学生总览中有价值的身份状态、作答覆盖、待复核题次和来源文件四项摘要，同时使用连续题目卡和左栏定位。
- 题目只读并渲染 LaTeX；学生作答浏览态渲染 LaTeX，点击“修改”后才显示原始源码，保存后恢复渲染。
- 删除单独的 flag/提示文本框；保存只修改识别作答正文，保留后端已有 flag 事实。
- 方向键说明放在题目搜索框正下方：输入框聚焦时只编辑文本；退出输入框后左右切学生、上下切题目。
- 选择另一名学生后滚动到页面绝对顶部，确保新学生姓名和两维导航立即可见；题目 query 保持不变。
- 学生身份纠正继续使用原有真实接口；不为合并页面复制第二套 mutation。

### 2.3 上传作答内部两阶段（历史方案，已覆盖）

- 第一阶段只选择作答文件、身份匹配方式和可选名单；无文件点击 CTA 会显示明确错误。
- 第二阶段以内嵌模式复用唯一任务级批改设置表单，显示当前待识别文件，主动作是“保存设置并开始识别作答”。
- 文件草稿按 task id 保留在当前 SPA 会话，BYOK return URL 带 `phase=settings`；返回只切换同一路由内部阶段。
- 设置保存成功后立即调用现有作答解析 mutation；识别进度、作答矩阵和连续校对仍是各自独立页面。

### 2.4 步骤可达性

- `NewTaskStepper` 从 Task 状态和已持久化 job/file/count 事实推导最远可达步骤。
- 浏览早期页面不再把已完成阶段降级成 disabled。例如 `submissions_ready` 任务回到 Q03 时，“上传作答”和“校对作答”仍可点击，“执行批改”仍是未来步骤。

### 2.5 C01 批改设置与补充任务资料

- 删除独立 `/tasks/:id/materials` 页面、路由和旧组件；补充资料直接在 C01 内完成，避免往返两个风格不一致的长页。
- “补充任务资料”明确只指教材、讲义和背景上下文，不把已经准备好的标答/评分标准当成这里的资料。
- 同一区域可搜索 owner-scoped 课程资料库、选择已有资料、上传新资料、选择“同时加入课程资料库”、查看当前 `0–3` 份选择并逐行移除。
- 没选资料时明确显示“只使用题目、标答和评分标准”；有资料时 `knowledge_scope` 自动切到 `all_task_docs`，移除最后一份后自动回到 `none`。
- 模型、资料和策略使用同一白底、边框、圆角、字号层级；删除模型选择和资料范围之间互不一致的彩色底块。
- 评分语气移入高级设置；默认首屏只保留严格度和“允许部分分”。

## 3. 后端合同与一次做对的安排

本轮 C01 已把原任务 KB 接口扩展为唯一入口，而不是新增第二套 API：

### 3.1 `POST /tasks/{task_id}/kb`

- multipart 请求必须且只能提供 `file` 或 `library_material_id` 之一。
- 上传可带 `save_to_library=true`；资料库来源必须通过 `CourseMaterialStore.get_for_owner` 做 owner 隔离。
- 可带 `expected_workflow_revision`；过期 revision 返回稳定 `task_workflow_changed`。
- 相同 SHA 在同一任务中返回 `already_done`，不重复切片、嵌入或增加引用次数。
- `DocEntry` 持久镜像新增 `source_kind / library_material_id / saved_to_library`，供前端逐行解释来源。
- 仍保留 BYOK、禁用 shared-pool KB、5 MB/3 份/1500 chunks、TaskStore CAS 和失败回滚边界。

### 3.2 `DELETE /tasks/{task_id}/kb/{doc_id}`

- 可带 `expected_workflow_revision`；先 CAS 移除 Task 镜像，再移除 retriever 文档。
- 删除资料库来源时只解除该 material 对当前 task 的引用，不影响同任务其他资料或其他任务引用。

### 3.3 后续持久化边界

- `TaskStore / CourseMaterialStore / InMemoryTaskRetriever` 仍是进程内存；本轮不伪装成重启可恢复。
- PostgreSQL、对象存储和向量库迁移应保持本节的单入口、owner 隔离、SHA 幂等、revision/CAS 和来源元数据语义。
- Q01–Q03 结构化题目包仍只以 `docs/20260726/Q01_Q03_UNIFIED_QUESTION_PREPARATION_BACKEND_PLAN_CN.md` 为唯一迁移计划；C01 的任务 KB 合同不复制题目资料合同。

## 4. 验收事实

- 单 URL：React Router 已删除 `/students/:studentId/questions/:questionId`；旧 `StudentSubmissionOverviewPage` 已删除；矩阵所有学生/题目入口均为 `/students/:studentId?question=:qid`。
- 连续校对：Q3 点击后正文和左栏均选中第 3 题；从 Q3 切到 Kate 后 URL 保持 `question=q3`，页面回到 `scrollY=0`。
- LaTeX：题目与作答浏览态渲染；点击修改只出现原始作答源码，题目不可编辑。
- 状态：每题只保留题号旁紧凑状态，不再显示或编辑“识别状态与提示”。
- C01：浏览器截图 `20260727-grading-setup-inline-materials.png` 显示模型、内联补充资料、严格度/部分分和折叠高级设置的单一卡片层级；控制台 0 error / 0 warning。
- 后端：KB 定向合同与 RAG 测试 `16 passed`；联合 KB/课程资料/C01/S04/S05/Q03 契约 `41 passed`。
- 前端：visible-scope audit 扫描 67 个可见文件，lint/TypeScript 通过；Vite production build 通过，`930 modules transformed`；`git diff --check` 通过。
- 浏览器验收没有调用真实 provider；为布局建立的本地测试任务/假配置在提交前清理。

## 5. 状态

代码、定向浏览器交互、后端合同、文档和视觉检查已完成。按总 tracker 规则，Q03/S01/S05/C01 仍保持 `[~]` 等待用户主观确认，不宣称整个前端重构全部完成。
