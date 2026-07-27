# C03 批改进度阶段决定与验收记录（2026-07-24）

## 1. 阶段结论

本阶段完成 C03“批改进度”独立页：教师只看真实完成题次、当前并发题次、等待题次、最近错误、事实百分比、保守 ETA 和恢复动作；可以安全离开页面，稍后从工作台或历史任务回到同一路由。

- canonical route：`/tasks/:id/grading/progress`
- Figma 文件：`64TupCQCKXkiT5uxeQY0iH`
- Figma 13 节点：`1:929`
- 本地导出：`docs/20260710/figma/13 Grading Progress 批改进度.png`
- 当前状态：代码、进度合同、错误恢复、工程检查和桌面/移动浏览器验收完成，等待用户视觉确认，因此 tracker 保持 `[~]`
- 下一阶段：R01“待复核结果总览” `/tasks/:id/review`

## 2. Figma 像素级约束

桌面 `1440×900` 最终实测：

| 元素 | 实测 |
| --- | --- |
| 标题 | `(70,105)`，宽 `1300px` |
| 主进度卡 | `(250,210)`，`940×220` |
| 队列表 | `(250,470)`，`940×234` |
| 可恢复提示 | `(250,720)`，`940×74` |

这些坐标和 Figma 13 一致。页面保留 `56%` 式大百分比、8px 进度条、后台运行胶囊、四行平面队列表和短恢复条；没有恢复旧结果页的流程卡、长消息列表、学生身份或多层卡片。根据已确认的全局导航规则，仍不实现 Figma 顶栏重复 `Grading` 状态胶囊。

## 3. 真实进度口径

1. 轮询 `GET /tasks/:id/state`，沿用 `ProgressReporter`，每 1.5 秒读取，不新建第二套 job API。
2. 总题次为 `total_students × total_questions`；若 reporter 尚未就绪，才回退 task 的事实数量。
3. 已完成直接使用 `completed_units`，并限制在 `[0,total]`。
4. 运行中按 `active` 的 `student_id + q_id` 去重，只展示数量；多专家处理同一题次不会重复计数，也不把学生身份写到页面。
5. 等待中为 `total - completed - running`，最小为零。
6. “错误信号”只统计 reporter 保留窗口里的 `level=error` 事件和 `error_detail`；它不是全量失败题次数，页面文案明确为最近信号。
7. 百分比沿用 `calculateProgressPercent`；ETA 使用 reporter 真实 `started_at`、完成量和当前时间推导，数据不足时显示“估算中/等待首个题次”，不伪造固定分钟。
8. `ProgressReporter.set_phase()` 现在首次设置阶段时写入真实 `started_at`；旧 Q02/Q03 事实阶段合同不受影响。
9. `phase=done` 但 task 仍为 `grading` 时，说明题次完成、易错点摘要仍在生成，页面显示“正在完成结果分析/即将完成”，不误跳结果。

## 4. 路由与错误恢复

- `grading` 的工作台、历史任务、任务入口和旧兼容页统一进入 C03。
- `graded` 统一进入待复核 `/tasks/:id/review`；本阶段先保留旧结果容器作为 route 兼容，下一阶段 R01 会完整替换。
- grading job 失败仍回到 C03，而不是混入 `/results`。
- error 页明确说明任务数据保留，提供“重试批改”“调整批改设置”“刷新状态”；重试继续调用幂等 `POST /tasks/:id/grade`。
- 若 error 实际来自题目或作答识别，C03 根据 `last_failed_job_id` 返回对应 canonical 恢复页，不误发批改重试。

## 5. 验收证据

### 自动检查

- C03 reporter + Q02/Q03 回归：`5 passed`。
- `npm run lint`：通过；visible-scope audit 扫描 `73` 个可见源文件。
- TypeScript：通过。
- `npm run build`：通过；Vite production build `479 modules transformed`。
- `git diff --check`：提交前通过。

### 浏览器

使用本地匿名内存 fixture：30 名匿名学生 × 11 道题，共 330 题次；184 完成、12 个去重 active、134 等待、0 错误，真实推导为 `56%`。未调用 provider、未上传用户文件、未写入持久存储。

- 桌面：`C03-grading-progress-desktop.png`；四个关键区域几何与第 2 节一致，`scrollWidth=1440`、`scrollHeight=900`。
- 移动：`C03-grading-progress-mobile.png`；`390×844` 下主卡宽 `350px`，队列按行纵排，无页面级横向溢出，完整页高 `1164px`。
- 错误恢复：独立 `T_c03error` 显示真实脱敏超时、三个动作；唯一“重试批改”真实调用 fixture 幂等 endpoint 并恢复可操作状态。
- 干净重载后桌面、移动和错误页均 `0 console errors / 0 warnings`。

PNG 只保存在 Codex 临时可视化目录，不进入产品仓库。

## 6. 下一阶段硬门

1. R01 必须直接对齐 Figma 14 `1:1009`，使用真实 result、指标、学生 × 题目热力图和优先复核队列。
2. R01 是教师确认前工作区，不能与正式 `/results` 合并；不能把低置信、专家分歧、分数异常伪装成已确认结论。
3. R01 点击单元格进入 R02 `/review/:studentId/:questionId`；学生与题目两个维度继续遵守用户已确认的独立筛选和方向键规则。

## 7. 2026-07-27 最新八步流程复验

- C03 仍属于第 6 步“执行批改”；任务处于 `grading` 或该阶段失败时，步骤 6 直接指向 `/grading/progress`，不再先绕到 C02 后依赖重定向返回。
- 错误态入口由狭义“修改专家组合”统一为“调整批改设置”，并携带 task-scoped `returnTo`；设置保存、返回以及模型与 BYOK 往返后均回到原 C03。
- C03 正常态继续只展示事实完成/运行/等待/错误信号；未增加消息流、学生身份或结果内容。R01/R02 已在后续阶段完成，本页职责不回退。
- 八步流程条在窄桌面隐藏原生粗滚动条，同时保留自动居中和横向操作能力。
- 隔离 fixture `T_c03check` 浏览器复验：30 名匿名学生 × 11 题、184 完成、12 运行、134 等待、0 错误，页面显示 `56%`；`1280×720` 下 `scrollWidth=1280`、完整页高 `829`，控制台 `0 errors / 0 warnings`。
- 最新 PNG：`20260727-c02-c03/C03-progress-latest-flow-1280x720.png` 与完整页图，仍只保存在 Codex 临时可视化目录。既有 `1440×900` / `390×844` 几何证据继续有效。
- 工程复验：C01/C03 定向合同回归 `15 passed`；visible-scope audit 扫描 `67` 个可见源文件，TypeScript、Vite production build（`930 modules transformed`）和 `git diff --check` 通过；未调用真实 provider。
