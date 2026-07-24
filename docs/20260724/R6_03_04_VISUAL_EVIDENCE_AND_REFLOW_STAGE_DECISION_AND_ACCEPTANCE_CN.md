# R6-03 / R6-04 视觉证据与响应式回流阶段记录

> 日期：2026-07-24  
> 分支：`codex/figma-first-frontend-redesign`  
> 状态：证据清单与工程复核完成；仍有少数需用户抽查的直接截图缺口，因此保持 `[~]`

## 1. 本阶段方法

本阶段不重新截图所有已验收页面。先核对可视化目录中的既有 PNG 尺寸和各阶段记录，只补真正缺失且当前无需模型即可复现的页面：

- `G03-new-task-r6-1440x900.png`
- `Q01-add-problems-r6-1440x900.png`
- `Q08-bulk-import-r6-1440x900.png`
- 补充风险视口：`Q01-add-problems-r6-1280x720.png`、`Q08-bulk-import-r6-1280x720.png`

PNG 位于：

`/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/`

截图使用本地教师测试账号和一次性草稿；没有上传文件或调用 provider，草稿在同一流程内删除。最终 Chromium 控制台为 `0 errors / 0 warnings`。

## 2. 17 张 Figma 基准覆盖

| Figma | canonical 实现 | 当前直接证据 | 结论 |
|---|---|---|---|
| 01 工作台 | `/` | `dashboard-data-1440x900-v2.png`、`dashboard-data-390x844.png` | 双尺寸已覆盖 |
| 02 历史任务 | `/history` | `history-data-1440x900-review.png`、`history-data-390x844-review.png` | 双尺寸已覆盖 |
| 03 新建任务 | `/tasks/new` | `G03-new-task-r6-1440x900.png`；既有移动实渲染记录 | 本轮补齐干净桌面图 |
| 04 添加题目 | `/upload/problems` | `Q01-add-problems-r6-1440x900.png`、本轮 1280 风险图；既有 390 几何检查 | 桌面与门禁补齐 |
| 05 题目识别进度 | `/problems/progress` | `q02-recognition-progress-1440x900.png` | 桌面直接覆盖；移动复用同壳回流记录 |
| 06 题目准备总览 | `/questions` | `q03-metrics-figma14-correction-1440x900.png`、`...-390x844.png` | 双尺寸已覆盖 |
| 07 题目详情 | `/questions/:qid/:section` | Q-FLOW 已真实保存/返回；没有保留独立 Q07 PNG | 用户抽查项 |
| 08 批量导入 | `/questions/import` | `Q08-bulk-import-r6-1440x900.png`、本轮 1280 风险图；390 代码/布局审计 | 本轮补齐桌面图；移动抽查项 |
| 09 课程资料库 | `/knowledge-base` | `K01-course-library-desktop.png`、`...-mobile.png` | 双尺寸已覆盖 |
| 10 添加作答 | `/submissions/upload` | `s01-submission-upload-1440x900.png`、移动图及几何记录 | 已覆盖 |
| 11 作答校对 | `/submissions` | `S03_submission_review_overview_1440x900.png`、移动图 | 已覆盖 |
| 12 批改前确认 | `/grading/preflight` | `C02-pre-grading-confirmation-desktop-viewport.png`、移动图 | 已覆盖 |
| 13 批改进度 | `/grading/progress` | `C03-grading-progress-desktop.png`、移动图 | 已覆盖 |
| 14 复核总览 | `/review` | `R01-review-overview-desktop-viewport.png`、移动图 | 已覆盖 |
| 15 复核详情 | `/review/:sid/:qid` | `R02-review-detail-desktop.png` 为 1280×720；移动 390 图 | 直接流程已覆盖；1440 用户抽查项 |
| 16 正式结果 | `/results` 五入口 | A00、A02–A07 均有桌面/移动证据；A01 有阶段实渲染记录 | 扩展工作区已覆盖，用户逐页确认仍待完成 |
| 17 错误与 BYOK | 错误态、`/settings/byok` | G06 双尺寸、History 移动错误、R5/R6 不存在任务真实检查 | 工程覆盖；最终主观视觉待确认 |

本表区分“有保存的精确 PNG”“有实渲染/流程记录但未保留精确 PNG”和“用户最终确认”，不以文件名替代真实像素尺寸，也不把工程检查冒充用户验收。

## 3. 响应式与回流证据

- 大多数页面已有 `1440×900` 与 `390×844` 直接 PNG；长内容移动图允许完整页高超过 844，但页面根宽必须等于 viewport。
- R5-07 在 `1280px` 核心 route 巡检中发现并修复工作台 42px 横向溢出；修复后六个核心 route 均无页面级溢出。
- 本轮 Q01：`1440×900` 与 `1280×720` 均无横向溢出；主上传区、来源、结构选择和单一 CTA 保持 Figma 04 层级。
- 本轮 Q08：`1440×900` 主卡完整可见；1280 下 `scrollWidth=1280`，纵向内容约 900px，属于合理纵向滚动。
- `430×932` 只在发现独立断点风险时补图；当前布局风险已由更窄的 390px 证据覆盖，因此没有机械重复截图。
- 原生浏览器 200% 缩放和 VoiceOver/NVDA 仍属于用户最终抽查，工程记录不声称代替原生辅助技术。

## 4. 视觉审计顺手修正

精确 Chromium 验收最初只出现 `/favicon.ico` 404。现已新增蓝白单色 `favicon.svg` 并在 `index.html` 声明；新会话控制台为 `0 errors / 0 warnings`。该图标只使用现有主色和白色，不增加新的装饰色或营销视觉。

## 5. 阶段结论

R6-03/04 的工程证据汇总已完成，并补齐三个高价值缺口。保持 `[~]` 的原因只有：

1. Q07、Q08 移动和 R02 1440 仍建议用户在真实数据下抽查；
2. R6-08 用户逐页视觉确认尚未完成。

下一阶段只做一次 R6-05/06/07 合并回归，完成后按用户指令停止。

