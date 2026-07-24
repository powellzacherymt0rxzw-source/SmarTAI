# R5-08 遗留可见 UI 与死 route 清理：阶段决定与验收记录

> 日期：2026-07-24
> 范围：被 Q/S/C/R/A 新页面替代的旧任务上传、结果与题目详情可见层
> 状态：清理、工程检查及真实兼容深链验收完成

## 1. 审计结论

当前 canonical route 已全部使用逐页重构后的页面，但代码仍保留三套被用户明确否定的可见实现：

- `TaskUploadPage.tsx` 把上传、识别、题目总览、单题资料、作答矩阵和批改确认堆在同一个约 1,874 行长页。
- `TaskResultsPage.tsx` 与 `TaskQuestionDetailPage.tsx` 保留旧结果横向 tab、卡片堆叠和题目下铺全体学生答案的结构。
- `/tasks/:taskId/upload/:kind` 通配 route 仍可把任意旧书签送回 `TaskUploadPage`，因此旧 UI 虽无正常入口，仍然可见。

## 2. 清理决定

- 保留具体 canonical route：`/upload/problems` 使用 Q01；`/upload/submissions` 使用状态感知兼容跳转。
- 通配 `/upload/:kind` 改用 `TaskEntryRedirect`。旧书签先读取真实任务状态，再进入当前新版页面，不猜测 `kind`。
- 删除三套旧 route 页面以及只被它们使用的上传、进度、复核、旧步骤条、Card/WorkflowSection 等 17 个可见组件文件。
- 结果统计与复核仍复用的纯模型逻辑从 `ResultsLayout.tsx` 移到无 JSX 的 `resultsModel.ts`；没有保留旧结果导航壳。
- `taskFlow.ts` 删除不再被任何 route 使用的旧五步导航、状态卡和下一步文案，只保留任务 destination、运行态判断和时间格式化。
- 后端 API、任务状态、结果统计口径和 canonical route 均不改变。

## 3. 工程证据

- `npm run lint`：通过；visible-scope 从 85 个降为 68 个用户可见源文件。
- `npm run build`：通过，`924 modules transformed`；旧 `TaskUploadPage`、`TaskResultsPage`、`TaskQuestionDetailPage` 不再产生 chunk。
- 本阶段净删除约 6,400 行旧可见实现；`resultsModel` 继续独立生成约 `3.87 kB` chunk。
- `git diff --check`：通过。
- 后端未修改，因此不重复运行全量后端测试。

## 4. 真实浏览器验收

- 使用本地 `tester01` 教师账号创建一个临时草稿任务。
- canonical 创建结果为 `/tasks/T_…/upload/problems`，显示新版“添加题目文件”单任务页。
- 直接访问旧通配深链 `/tasks/T_…/upload/legacy`，实际 URL 自动替换为 `/tasks/T_…/upload/problems`。
- 新标签页 DOM 显示新版 Q01，控制台 `error/warn = 0`，没有 Vite/React Router 错误层。
- 临时任务已通过历史任务页删除，最终恢复 0 个任务，不向测试数据留下垃圾记录。
- 大量文件删除时旧标签页曾记录一组 Vite HMR DOM 错误；按调试规范在新标签页重新加载后为 0，证明它来自热更新瞬间而非最终 bundle。

## 5. 明确边界

- 旧 route 兼容只保证回到真实当前阶段，不保证保留旧页面中的局部锚点或查询参数。
- 文档中的旧文件名继续作为历史审计证据，不改写历史事实；当前代码不再包含这些可见实现。
- 这一步不代表所有 route 都已完成最终中英文、键盘、焦点和视觉终验；后续分别进入 R5-06、R5-07 与 R6。
