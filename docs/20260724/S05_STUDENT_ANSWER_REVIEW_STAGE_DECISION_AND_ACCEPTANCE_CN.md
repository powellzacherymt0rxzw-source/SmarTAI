# S05 单份作答校对阶段决定与验收记录（2026-07-24）

## 1. 阶段结论

本阶段最初完成 S05“单份作答校对”；2026-07-27 按用户纠正升级为“当前学生全部题目连续校对”：路由仍可深链到一道题，但不再只挂载一道题，学生与题目两个维度继续独立查找和切换，并逐题保存真实识别文本与识别提示。

- canonical route：`/tasks/:id/students/:studentId/questions/:questionId`
- Figma 文件：`64TupCQCKXkiT5uxeQY0iH`
- Figma 15 节点：`1:1188`
- 本地导出：`docs/20260710/figma/15 Review Detail 学生:题目复核详情.png`
- 当前状态：代码、真实保存合同、工程检查和桌面/移动浏览器验收完成，等待用户视觉确认，因此 tracker 保持 `[~]`
- 下一阶段：C02“批改前确认”只读汇总页；是否立即继续还需先按用户要求复核周额度和 `auto-research-stateprep-v2` 完成状态

Figma 15 同时画了学生作答、AI 理由和教师最终结果，但 S05 位于批改前作答校对阶段，不能伪造尚不存在的得分、置信度或 AI 批改结论。因此本页保留 Figma 15 的标题、流程、平面导航、大面积作答区、双列上下文和底部来源条，只展示当前阶段确实存在的题干、识别文本、flag 和来源文件。最终得分与评语仍属于 R02 复核详情。

## 2. Figma 对齐与页面结构

### 2.1 桌面

继续使用全局 `1440×900` 骨架：`70px` 顶栏、约 `(70,105)` 标题、约 `y=155` 七步流程、`1300px` 主版心、`10px` 圆角、轻边框和克制状态色。

页面自上而下只有一个主任务：

1. 学生导航独占第一行：上一位、当前学生、智能查找、下一位和 `← / →` 提示。
2. 题目搜索独占第二行，只筛当前学生的题目集合，不改变学生。
3. 左侧是可独立滚动并带说明的题号目录；右侧连续显示当前学生所有匹配题目。
4. 每题卡片依次显示题目上下文、学生识别文本、识别状态与提示、来源和保存动作；上一题/下一题只滚动定位。
5. route 中的 `questionId` 只决定首次进入锚点；点击目录或上下滚动不会建立另一套单题模式。

最终桌面 `innerWidth=document/body scrollWidth=1440`，`documentHeight=1014`；比 `900px` 视口只多 `114px`，不是把多个业务任务堆成长页。彩色只用于当前选择、真实状态和来源图标。

### 2.2 移动端

- `390×844` 下学生导航和题目导航分别纵向重排，不把两个维度挤在同一行。
- 标题和返回入口同屏完整显示。
- `innerWidth=document/body scrollWidth=390`，没有页面级横向溢出。
- 纵向高度 `1670px` 来自两个导航和真实题干/作答内容的自然堆叠，不增加桌面侧栏或横向卡片；长文本仍可在当前编辑区滚动/扩展。

## 3. 双维智能查找与导航

### 3.1 两个维度互不干扰

- 学生输入按学号、姓名匹配；题目输入按题号、题型、题干和有限的可解释别名匹配。
- 两个 query 分别保存为 `studentFilter` 与 `questionFilter`；修改或清空一维不会覆盖另一维。
- 结果列表明确标记“完全匹配”或“相关匹配”。浏览器实测输入“积分题”时：Q4（题型就是积分题）为完全匹配，Q1（题干包含积分公式）为相关匹配。
- 当前实现是确定性本地匹配，不调用 provider、不消耗模型额度，也不冒充真正语义模型。拼音、跨语言语义和大规模后端分页搜索仍是后续能力。
- 有筛选时，上/下一项在当前匹配结果中移动；无筛选时按完整学生/题目顺序移动。

### 3.2 键盘与可访问性

- `← / →` 切学生；`↑ / ↓` 切题目。
- 学生导航只出现在页面顶部；题目导航在内容顶部和底部都有，空间和状态彼此分离。
- input、textarea、select、contenteditable 或 dialog 内聚焦时不拦截方向键。实测题目搜索框内按 `↓`，URL 和当前题均不变化。
- 页面显示快捷键说明，导航、搜索框、按钮和编辑区都有明确读屏名称。

## 4. 路由闭环与上下文恢复

- S03 矩阵格现在直接进入精确 S05 route；学号和“查看”仍进入 S04 全部题目总览。
- S03 通过 `returnParams` 保存矩阵的 `q/status/sort`，从 S05 返回不会丢失原筛选。
- S04 每道题新增“校对此题”；通过 `overviewFilter` 保存 S04 题目筛选，返回时同时恢复当前题高亮和筛选。
- 在 S05 内切换学生只改变学生 path 参数，当前题目和题目筛选保持；切换题目只改变题目参数，当前学生和学生筛选保持。
- visible-scope audit 只精确允许两个受教师会话保护的 task review route；没有开放学生 portal。

## 5. 真实保存合同

沿用并收紧：

```text
PUT /tasks/{task_id}/students/{stu_id}/answers/{q_id}
```

S05 请求增加 `expected_workflow_revision`：

1. 当前用户必须是 task owner 或 admin。
2. 活跃工作流返回 `task_workflow_busy`。
3. S05 发送页面读取时的 revision；并发变化返回 `task_workflow_changed`，不静默覆盖另一标签页。
4. 已有作答使用 copy-on-write + `TaskStore.update_workflow_cas` 更新 content/flag。
5. 缺失矩阵格允许教师补录，但只可为 `problem_data` 中真实存在的 q_id 创建记录；题号和题型从任务题目复制，不信任前端伪造元数据。
6. INFO 日志只记录 task 和执行教师，不记录学生 ID、姓名、题号、来源文件或识别文本。
7. 返回新的 `workflow_revision`；前端立即把作答与 revision 合并进 task cache，再失效刷新 query，连续“保存并到下一题”不会复用旧 revision。
8. `expected_workflow_revision` 暂为可选，只为尚未移除的旧上传预览保持兼容；canonical S05 始终发送它。

前端只在 `submissions_ready` 展示 S05；其他状态使用统一 `getTaskDestination` 返回真实阶段。本页只改识别内容和 flag，不改学生身份、分数、评语或最终结果。

## 6. 自动与浏览器验收

### 6.1 自动检查

- S05 保存合同 + 活跃工作流回归：`7 passed, 2 warnings`；warnings 为 FastAPI 既有 lifespan deprecation。
- `npm run lint`：通过；visible-scope audit 扫描 `71` 个可见源文件。
- TypeScript：通过。
- Vite production build：通过，`475 modules transformed`。
- `git diff --check`：通过。

### 6.2 浏览器检查

验收使用本地匿名内存 fixture `T_s05_visual`：4 名学生、5 道题，覆盖正常、flag 和缺失矩阵格。fixture 没有上传用户文件、调用真实 provider 或写入持久存储。

- 桌面：`S05_student_answer_review_1440x900.png`
  - 标题、流程、分离的双维导航、作答编辑区、题干/flag、来源和保存区均进入首屏；底部重复题目导航只需短滚动。
  - `innerWidth=document/body scrollWidth=1440`，`documentHeight=1014`。
- 移动：`S05_student_answer_review_390x844.png`
  - 两个导航分别纵排，标题完整；`innerWidth=document/body scrollWidth=390`。
- 匹配：`积分题` 返回 Q4 完全匹配和 Q1 相关匹配；学生 `PB2025002` 完全匹配，同时保留题目筛选。
- 键盘：搜索框聚焦时 `↓` 不跳页；退出输入框后 `→` 从 Kate/Bob 维度切到 Lin，`↓` 从 Q4 切到 Q5。
- 保存：匿名 Bob/Q4 文本真实保存，toast 出现，保存按钮恢复禁用；后端 query 刷新后仍显示教师校正文本。
- 控制台：`0 errors / 0 warnings`；无可见 dialog/overlay。

视觉 PNG 只保存在 Codex 临时可视化目录，不进入产品仓库。

## 7. 已知边界与下一阶段门

1. 当前 API 没有逐页坐标、原 PDF 页码和可靠识别置信度，S05 如实说明，不以 flag 伪造百分比。
2. OCR/vision、在线 PDF 原文定位和手写批注仍未实现。
3. 学生/题目的“智能”目前是可解释本地规则；真正语义匹配必须在 owner/BYOK、硬调用限额和后端分页合同成熟后再接。
4. TaskStore 仍为进程内存；本阶段 revision/CAS 解决单进程并发覆盖，不代表已经持久化。
5. C02 必须只汇总题目、资料、作答、模型和风险，不能变成第二套配置表单；所有修改链接返回对应独立页面。
6. 在继续 C02 前先重新读取周额度和 `auto-research-stateprep-v2` 状态；必须给该项目保留足够完成额度，并额外保留至少约 15% 周额度。

## 8. 2026-07-27 连续审核与 Safari 回归纠正

- 页面改为 Q03 同型的左侧题号目录 + 右侧全部题目连续长视图；目录固定在全局顶栏下方 `86px`，题多时目录自身滚动，不遮挡正文。
- 从矩阵进入 Q2 时，Q2 卡片标题、状态和上一题/下一题完整露出；切换学生后仍保持 Q2，不再因搜索框聚焦滚回 Q1。
- 学生候选项使用 `mousedown` 保护，解决 Safari `blur` 先于 `click` 导致无法切换学生的问题。
- 题目搜索与学生搜索都改为 composition-safe 本地 draft；实测中文“积分”只生成最终中文 URL 条件并命中 Q1，不出现拼音残留或中文联动删除。
- API 不变：仍逐题调用现有 CAS 更新接口；本轮无后端迁移，无 provider 调用。
