# S05 / R01 矩阵与待处理队列统一阶段记录

日期：2026-07-27
分支：`codex/figma-first-frontend-redesign`

## 1. 本阶段目标

本阶段按用户最新确认，把第 5 步“校对作答”和第 7 步“复核批改”收敛为同一套密集任务工作区：左侧为可横向扩展的“学生 × 题目”矩阵，右侧为较窄的待处理队列，底部统一放置详情入口与阶段主动作。第 7 步的唯一可见命名由“复核分析”改为“复核批改”；第 8 步继续使用“结果分析”。

对应 canonical route：

- S05：`/tasks/:taskId/submissions`
- R01：`/tasks/:taskId/review`
- S05 详情：`/tasks/:taskId/students/:studentId?question=:questionId`
- R02 批改详情：`/tasks/:taskId/review/:studentId/:questionId`

## 2. 共用布局与几何约束

- 两页共用 `MatrixQueueWorkspace`，桌面比例为 `minmax(0, 1fr) + 280px`，间距 `16px`；在当前 1280px 可视区域中，矩阵约 `918px`，队列 `280px`，不产生页面级横向滚动。
- 矩阵列宽统一为：学号 `136px`、姓名 `116px`、每道题 `60px`、操作 `72px`。题目继续增加时只在矩阵内部横向滚动，约 10 道题仍可在常见桌面宽度中紧凑展示。
- 矩阵与队列均为 `330px` 高并各自滚动；队列不再只截取前四项。
- 每行固定显示“学号 / 姓名”两个独立表头与末列“查看”，避免把身份信息挤成一段不可扫描文字。
- R01 的“查看批改详情”与“确认复核完成”移到矩阵工作区下方右侧；次按钮在左、主按钮在右。已完成任务保持只读，并将主动作替换为“查看最终结果”。

## 3. 状态语义

矩阵使用占满单元格的克制色块与图标，不再依赖会挤占题目列宽的长文字；完整含义仍通过 `aria-label`、屏幕阅读器文本和悬浮 `title` 提供。

| 状态 | 颜色 / 图标 | S05 含义 | R01 含义 |
| --- | --- | --- | --- |
| 正常 | 绿色底 + 对钩 | 已识别 | 无额外复核标记 |
| 已复核 | 蓝色底 + 圆圈对钩 | 教师已复核 | 教师已确认复核 |
| 警告 | 橙色底 + 三角感叹号 | 低置信或需关注 | 低置信 |
| 错误 | 红色底 + 圆圈叉 | 空白、缺失或身份异常 | 专家分歧或后端复核标记 |
| 备注 | 天蓝底 +评语图标 | — | 已有教师评语、尚未确认 |

所有状态格与队列项均进入同一 canonical 详情页。右侧队列仅列出实际需要处理的学生/题目；没有异常时显示单一空态，不伪造风险。

## 4. 实现范围

- 新增共用组件：
  - `frontend/app/src/components/tasks/MatrixQueueWorkspace.tsx`
  - `frontend/app/src/components/tasks/MatrixStatusCell.tsx`
- 重构：
  - `frontend/app/src/routes/tasks/SubmissionReviewOverviewPage.tsx`
  - `frontend/app/src/routes/tasks/ReviewOverviewPage.tsx`
- 同步中英文命名与按钮文案：
  - `frontend/app/src/i18n/messages.ts`
  - `frontend/app/src/lib/reviewOverviewCopy.ts`
  - `frontend/app/src/routes/tasks/GradingPreflightPage.tsx`
  - `frontend/app/src/routes/tasks/GradingProgressPage.tsx`

本阶段没有新增后端 API、没有调用 provider、没有修改用户任务数据。矩阵继续读取现有 owner-scoped 作答、批改结果、教师批注与复核状态。

## 5. 验收证据

- R01 真实已完成任务：`T_39aca252a1`；学号/姓名/三道题/查看列完整，4 行均有详情入口，状态格具有可访问名称。
- S05 同一任务：4 名学生 × 3 道题，正常与已复核两种状态实际渲染；底部“查看作答详情 / 进入批改设置”与 R01 页脚同构。
- 两页均无页面级横向溢出；题目扩展时由矩阵内部承担滚动。
- 视觉证据：
  - `R01-review-matrix-comparison.jpg`（用户标注参考与当前实现并排对照）
  - `R01-review-matrix-aligned-full.jpg`
  - `S05-submission-matrix-aligned.jpg`
  - 位于 Codex 临时可视化目录 `019f4bff-e585-7e73-b58f-eee15957dfee/`。
- `npm run lint` 通过（可见范围审计 + TypeScript）。
- `npm run build` 通过（Vite production build，`937 modules transformed`）。
- 浏览器 DOM 验证：S05 共 4 行且每行都有“查看”；12 个状态格均具有完整 `aria-label`；页面无横向溢出。
- S05 与 R01 分别在干净浏览器标签页复验，控制台均为 `0 errors / 0 warnings`。

## 6. 当前边界

- 真实大班级与 10+ 题目仍建议由用户在实际数据上做一次横向滚动手感抽查；当前布局已预留内部滚动和 60px 题目列，不需要为验收伪造任务。
- 低置信、冲突与身份异常的具体来源继续以现有后端事实字段为准；前端不从文本猜测风险。
- 用户逐页主观签收仍未完成，因此总 tracker 保持 `[~]`，不宣称整个前端已经最终验收。
