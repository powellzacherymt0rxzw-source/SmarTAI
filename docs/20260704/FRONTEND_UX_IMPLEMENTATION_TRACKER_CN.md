# SmarTAI 新前端体验实现追踪清单（2026-07-04）

> 目标：在 `codex/frontend-ux-docs` 分支上，严格依据用户对话、记忆、项目文档、Figma/Canva 设计稿和 2026-07-04 设计记录，推进新前端体验代码落地。
> 规则：每完成一项就把 `[ ]` 改为 `[x]`，并填写大致完成时间。时间使用 `YYYY-MM-DD HH:mm`，默认时区 `Asia/Shanghai / CST`。

---

## 0. 当前工作分支与参考资料

- 工作分支：`codex/frontend-ux-docs`
- 已合入基线：`main` 的 README 部署链接更新提交
- 主要文档：
  - `docs/20260703/FRONTEND_UX_REFACTOR_PLAN_CN.md`
  - `docs/20260704/FRONTEND_UX_FULL_DESIGN_RECORD_CN.md`
  - `docs/20260620/PROJECT_STATUS_AND_ROADMAP_CN.md`
  - `docs/20260620/GO_TO_MARKET_AND_OPS_CN.md`
  - `docs/TASK_WORKFLOW_REFACTOR_CN.md`
- Figma 主参考：
  - URL: `https://www.figma.com/design/64TupCQCKXkiT5uxeQY0iH`
  - File key: `64TupCQCKXkiT5uxeQY0iH`
  - Page: `Full interface mockups`
  - 用途：作为页面布局、信息层级、工作流节奏、表格/进度/热力图/错误恢复面板的主参考。

---

## 1. 多 Agent 分工

### Agent A：信息架构与路由审计

- Agent nickname: Hegel
- Agent id: `019f2acf-d41e-75e3-9120-d6053e1bd297`
- 范围：
  - `frontend/app/src/routes`
  - `frontend/app/src/components/tasks`
  - `frontend/app/src/components/layout`
  - 17 个目标界面与现有路由映射
- 产出：
  - 哪些页面直接重构
  - 哪些页面需要新增 route/component
  - 第一批页面实现优先级

### Agent B：设计系统与组件审计

- Agent nickname: Russell
- Agent id: `019f2acf-d4a5-7402-9ae0-48eb8199c521`
- 范围：
  - `frontend/app/src/styles/globals.css`
  - `frontend/app/src/components/ui`
  - `frontend/app/src/components/layout`
  - 现有 route className 与视觉模式
- 产出：
  - Figma 方向与现有 UI 差距
  - UI primitives 改造建议
  - 减少彩色 pill 的实现规则

### Agent C：数据/API/状态审计

- Agent nickname: Parfit
- Agent id: `019f2acf-d53a-7523-8021-cf689dc0c15e`
- 范围：
  - `frontend/app/src/api/tasks.ts`
  - `frontend/app/src/api/hooks/tasks.ts`
  - `frontend/app/src/hooks/useTaskProgress.ts`
  - `frontend/app/src/types/task.ts`
  - `frontend/app/src/types/progress.ts`
  - `frontend/app/src/routes/tasks`
- 产出：
  - 现有状态机与新体验状态机差距
  - 可前端派生 / 需 mock / 需后端 API 的边界
  - 第一批实现风险与测试重点

### 主 Agent：整合与代码实现

- 范围：
  - 最终代码修改
  - 文件冲突控制
  - 阶段性测试
  - 文档 checklist 更新
  - 最终提交/推送

---

## 2. 总体阶段计划

### Phase 0：分支与资料对齐

- [x] P0-01 切换到 `codex/frontend-ux-docs` 分支。完成：2026-07-04 09:47。
- [x] P0-02 合入 `main` 的 README 更新，保证当前实现分支基线不落后。完成：2026-07-04 09:47。
- [x] P0-03 启动 3 个并行审计子 agent。完成：2026-07-04 09:48。
- [x] P0-04 读取并摘取子 agent 审计结论。完成：2026-07-04 10:00。
- [x] P0-05 明确第一批代码改造范围，避免一次铺太大。完成：2026-07-04 10:00。

### Phase 1：前端信息架构与基础组件

- [x] P1-01 建立阶段状态与中文显示 helper，避免历史页中英文混排。完成：2026-07-04 09:56。
- [x] P1-02 建立轻量状态显示组件，减少彩色 pill 滥用。完成：2026-07-04 09:57。
- [x] P1-03 建立单栏页面 section / toolbar / table primitives。完成：2026-07-05 15:08；新增 `WorkflowSection`，本轮先覆盖任务上传主流程，通用 DataTable 仍待后续。
- [x] P1-04 建立 inline help / tooltip 轻量组件。完成：2026-07-05 15:08；新增 `InlineNotice` 与 `HelpTooltip`。
- [x] P1-05 全局术语初步替换：`材料` -> `资料`，`任务驾驶舱` -> `任务总览`。完成：2026-07-04 09:58。

### Phase 2：任务总览、历史任务、阶段门禁

- [x] P2-01 重构 Dashboard 为 `任务总览`，参考 Figma frame 01 的大体布局。完成：2026-07-04 09:58。
- [x] P2-02 重构 History 为网盘式任务列表，当前阶段只显示中文。完成：2026-07-04 09:59。
- [x] P2-03 实现或增强 TaskStageGate，未到阶段显示当前阶段与跳转动作。完成：2026-07-05 15:09；新增阶段规则与 `TaskStageGate`，已接入上传页。
- [x] P2-04 重新上传/覆盖危险动作给出明确确认入口。完成：2026-07-05 15:12；题目/作答重传会按已有文件、下游数据、批改状态给确认与新建任务建议。
- [x] P2-05 阶段测试：Dashboard/History/阶段门禁 typecheck。完成：2026-07-04 09:59；本批只覆盖 Dashboard/History 与状态适配层，TaskStageGate 仍待 P2-03。

### Phase 3：上传与进度体验

- [ ] P3-01 重构添加题目文件页面：上传优先、资料来源选择、BYOK 门禁。完成：
- [ ] P3-02 重构题目识别进度页：子步骤、ETA、后台运行、自动进入题目准备。完成：
- [ ] P3-03 重构添加学生作答页面：学生身份匹配、识别设置继承。完成：
- [ ] P3-04 重构作答识别进度页，与题目识别进度统一体验。完成：
- [ ] P3-05 阶段测试：上传/进度相关 typecheck + 页面渲染 smoke。完成：

### Phase 4：题目准备与资料配置

- [x] P4-01 新增或重构题目准备总览：覆盖率、资料配置状态、智能筛选入口。完成：2026-07-05 17:32；已在题目上传页识别完成态加入题目准备总览、资料配置覆盖率、关键词筛选和逐题状态表，逐槽位来源/置信度/确认状态仍需后端字段。
- [ ] P4-02 重构题目详情：题干、评分标准、标答、测试样例、测试脚本资料槽位。完成：
- [ ] P4-03 新增批量导入资料 UI 外壳：知识库文件/分组/全部库、上传并加入知识库。完成：
- [ ] P4-04 新增 AI 补全缺失资料确认摘要 UI。完成：
- [ ] P4-05 阶段测试：题目准备相关 typecheck + 页面渲染 smoke。完成：

### Phase 5：作答校对、批改前确认、结果复核

- [x] P5-01 重构作答校对总览：学生 x 题目状态表、双维度筛选。完成：2026-07-05 17:43；已加入学生 x 题目识别矩阵、学生筛选和单学生详情下钻，题目维度自然语言筛选与逐格确认状态仍需继续细化。
- [x] P5-02 重构批改前确认：专家组合、资料范围、评分策略、风险提醒。完成：2026-07-05 17:47；已加入批改前确认摘要和风险提示，per-task 专家组合、评分策略保存仍需后端 API 支持。
- [ ] P5-03 重构结果总览：置信度热力图、复核队列、确认复核完成 CTA。完成：
- [ ] P5-04 重构学生/题目复核详情：双维导航、final result overlay UI。完成：
- [ ] P5-05 新增分析/导出/正式完成 UI 外壳与 stale 提示。完成：
- [ ] P5-06 阶段测试：结果与复核相关 typecheck + 页面渲染 smoke。完成：

### Phase 6：错误恢复、BYOK 门禁、收尾测试

- [x] P6-01 新增可恢复错误面板：BYOK、API 超量、网络超时、解析失败。完成：2026-07-05 15:12；本轮完成前端基础分类与 `InlineNotice` 呈现，后端结构化错误字段仍待补。
- [x] P6-02 关键按钮接入 BYOK 缺失禁用与跳转提示。完成：2026-07-05 15:13；Setup 下一步、上传、开始批改已接入 enabled BYOK 专家门禁。
- [x] P6-03 全量术语检查：页面不再出现不应出现的“材料”。完成：2026-07-04 09:59；范围为 `frontend/app/src` 用户可见中文。
- [ ] P6-04 全量视觉检查：彩色 pill 占比降低，不显乱。完成：
- [x] P6-05 运行 `npm run typecheck`。完成：2026-07-04 09:59；本轮复测通过：2026-07-05 15:13。
- [x] P6-06 运行 `npm run build`。完成：2026-07-04 09:59；本轮复测通过：2026-07-05 15:14。
- [x] P6-07 启动本地 dev server 并浏览关键页面。完成：2026-07-04 10:01；本地服务为 `http://127.0.0.1:5174/`，浏览器被登录页门禁拦截，未使用真实账号。
- [ ] P6-08 截图或浏览器检查：桌面与窄屏主要页面无明显溢出。完成：
- [x] P6-09 更新本文档所有完成项时间。完成：2026-07-04 10:02。
- [x] P6-10 提交并推送实现分支。完成：2026-07-04 10:03。

---

## 3. 第一批代码改造原则

- [ ] 不一次性实现所有后端未有能力，先把前端体验结构立住。
- [ ] 后端未有 API 的能力，用清晰的 UI 外壳、禁用态、派生状态或 mock summary 表达，不伪装成已经真实可用。
- [ ] 优先改真实用户最容易感知的问题：页面杂、框嵌套、状态不明显、上传后无反馈、阶段不清楚。
- [ ] 保持每个任务并行互不影响的状态展示。
- [ ] 每阶段完成后跑一次轻量测试，避免最后集中爆雷。

---

## 4. 实时记录

- 2026-07-04 09:47：切换到 `codex/frontend-ux-docs` 并合入 `main` README 更新。
- 2026-07-04 09:48：启动 Agent A/Hegel、Agent B/Russell、Agent C/Parfit。
- 2026-07-04 09:56：新增 `taskFlow` 显示层状态 helper，真实 `TaskStatus` 仍保持后端现状。
- 2026-07-04 09:57：新增 `TaskStatusIndicator`，降低状态 pill 的视觉占比。
- 2026-07-04 09:58：Dashboard 改为 `任务总览` 队列表；History 改为当前阶段中文单语列表。
- 2026-07-04 09:59：Setup/Upload 主流程从左右栏收口为单栏；完成 typecheck 与 build。
- 2026-07-04 10:01：启动本地 Vite 服务并验证登录页门禁；完整任务页浏览需要测试账号或本地后端会话。
- 2026-07-04 10:03：提交并推送第一批实现到 `codex/frontend-ux-docs`，提交 `4459496`。
- 2026-07-05 15:05：继续第二批实现；启动 Agent A/Dalton、Agent B/Hume、Agent C/Carver 分别审计阶段/进度、BYOK/覆盖/错误、结果复核/分析边界。
- 2026-07-05 15:08：新增 `WorkflowSection`、`InlineNotice`、`HelpTooltip` 基础 UI primitive。
- 2026-07-05 15:09：新增 `TaskStageGate` 与集中阶段门禁规则，并接入上传页。
- 2026-07-05 15:12：新增 `taskActionGuards`，接入上传覆盖确认、BYOK 门禁、可恢复错误分类。
- 2026-07-05 15:13：新增 `TaskProgressFocus` 并替换上传页旧状态卡；完成 typecheck。
- 2026-07-05 15:14：完成 build；术语扫描无旧“材料/教师工作台/题目解析中/已完成”残留。
- 2026-07-05 17:22：启动 Agent A/Confucius、Agent B/Newton、Agent C/Dewey，分别审计题目准备、作答/批改前确认、视觉/术语一致性。
- 2026-07-05 17:32：新增题目准备总览 MVP：覆盖率、资料配置状态、关键词筛选、逐题状态表和单题详情校对。
- 2026-07-05 17:43：新增作答校对矩阵组件，作答页改为先看学生 x 题目状态表，再看单学生作答详情。
- 2026-07-05 17:47：新增批改前确认面板，汇总 BYOK、任务资料、题目资料配置、作答覆盖率和风险提示。
- 2026-07-05 17:51：清理中文 UI 工程词和旧术语；`npm run typecheck` 通过。
