# Q03 / S01 / S05 工作流与连续校对纠偏阶段记录（2026-07-27）

> 分支：`codex/figma-first-frontend-redesign`
>
> 范围：题目资料总览、上传作答内部流程、学生作答连续校对、八步可达性与 Safari 输入/点击回归。

## 1. 最终产品决定

1. 顶部保持八步：`新建任务 / 上传题目 / 审核题目 / 上传作答 / 校对作答 / 执行批改 / 复核分析 / 完成`。
2. 批改/识别设置不占顶层编号；它是“上传作答”同一路由的第二个短阶段。
3. Q03 始终显示全部题目的资料矩阵，0 风险也不能用空态隐藏正常题目。
4. 题目资料审核和学生作答审核都采用同一种题目浏览：左侧题号目录，右侧全部题目连续滚动；上下题按钮只做定位。
5. 学生与题目是两个独立维度；切换学生保持题目，筛选题目保持学生。

## 2. 前端实现

### 2.1 Q03 完整资料矩阵

- 每题固定显示题目、标答、评分标准、测试样例和审核提示。
- 正常题目显示绿色“已识别”；由 AI 准备的标答/评分标准显示绿色“已生成”；非编程测试显示中性“不适用”。
- 低置信、来源冲突、解析异常等开放风险只覆盖对应状态和审核提示。
- 搜索使用 composition-safe 本地值并支持可解释别名；“积分”可命中含 `\\int`/`∫` 的题目。

### 2.2 学生作答连续校对

- canonical route 仍为 `/tasks/:id/students/:studentId/questions/:questionId`，`questionId` 只决定初始锚点。
- 当前学生的全部题目始终挂载；左栏可独立滚动、显示题号和识别状态，并随正文同步高亮。
- 每题卡片包含题目上下文、识别文本、真实提示、来源与逐题保存；保存接口和 revision/CAS 合同不变。
- Safari 学生候选项在 `mousedown` 阶段阻止失焦，修复候选先卸载后点击无效；切学生使用当前显式题目 ref，避免搜索框聚焦滚回第一题。
- 学生和题目搜索分别使用本地 draft、composition start/end 与延迟 URL commit，避免拼音残留、重复字符和联动删除。

### 2.3 上传作答内部两阶段

- 第一阶段只选择作答文件、身份匹配方式和可选名单；无文件点击 CTA 会显示明确错误。
- 第二阶段以内嵌模式复用唯一任务级批改设置表单，显示当前待识别文件，主动作是“保存设置并开始识别作答”。
- 文件草稿按 task id 保留在当前 SPA 会话，BYOK return URL 带 `phase=settings`；返回只切换同一路由内部阶段。
- 设置保存成功后立即调用现有作答解析 mutation；识别进度、作答矩阵和连续校对仍是各自独立页面。

### 2.4 步骤可达性

- `NewTaskStepper` 从 Task 状态和已持久化 job/file/count 事实推导最远可达步骤。
- 浏览早期页面不再把已完成阶段降级成 disabled。例如 `submissions_ready` 任务回到 Q03 时，“上传作答”和“校对作答”仍可点击，“执行批改”仍是未来步骤。

## 3. 后端安排

本轮不需要后端改动：

- Q03 继续消费现有 `problem_data` 与 `preparation_issues`。
- 作答连续校对继续使用 `PUT /tasks/{task_id}/students/{stu_id}/answers/{q_id}`。
- 上传作答先使用既有 `PUT /tasks/:id/grading-setup`，再使用既有 `POST /tasks/:id/parse_submissions`。
- owner 隔离、BYOK provider 校验、workflow revision/CAS、幂等与覆盖确认边界全部保留。

题目统一准备的结构化后端迁移仍只以
`docs/20260726/Q01_Q03_UNIFIED_QUESTION_PREPARATION_BACKEND_PLAN_CN.md`
第 14 节为唯一安排，避免新增第二份冲突合同。

## 4. 验收事实

- Q03 fixture：3/3 题、0 开放风险时仍显示完整矩阵。
- 中文搜索：Q03 与作答审核输入“积分”均只保留最终中文；可解释别名命中积分题。
- 学生切换：在 Q2 从 Kate 切换 Bob 后 URL 保持 `/questions/q2`；Q2 卡片与左栏当前项顶部均约 `86px`。
- 步骤恢复：`submissions_ready` 任务在 Q03 中步骤 4、5 是链接，步骤 6 保持不可点击。
- 无作答文件：点击“下一步：识别设置”显示“请先选择学生作答文件”。
- 视觉对照：
  - `20260727-q03-comparison.png`
  - `20260727-student-comparison.png`
  - 根目录 `design-qa.md`
- 工程检查：visible-scope audit 扫描 69 个可见文件，lint/TypeScript 通过；Vite production build 通过，`931 modules transformed`；`git diff --check` 通过。
- 浏览器验收未启动识别、未调用 provider、未改写用户任务数据。

## 5. 状态

代码、定向浏览器交互与联合视觉检查已完成；仍按总 tracker 规则等待用户主观确认，因此 Q03/S01/S05 保持 `[~]`，不宣称整个前端全部完成。
