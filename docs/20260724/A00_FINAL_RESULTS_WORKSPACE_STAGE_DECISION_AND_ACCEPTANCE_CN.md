# A00 正式结果生命周期与工作区壳：阶段决定与验收记录

> 日期：2026-07-24（UTC+8）
>
> 分支：`codex/figma-first-frontend-redesign`
>
> canonical routes：`/tasks/:taskId/results` 及其 `questions / students / visualizations / reports` 子路由
>
> Figma：`16 Analysis Export Finalized 学情分析与正式完成`，node `1:1260`

## 1. 阶段结论

A00 已将“逐格复核”与“正式结果版本”拆成两个真实层级，并用 Figma 16 的视觉语言建立最终结果工作区。它不把尚未生成的分析、图表或下载文件冒充完成：A00 只负责复核门禁、版本冻结、过期规则、统一路由和五页壳，详细内容继续由 A01–A07 分阶段完成。

- `graded` 仍表示 AI 批改完成、等待教师复核，默认进入 `/review`。
- 所有必须复核的题次确认后，教师点击“确认复核完成”才创建 `final_result vN` 并进入 `review_confirmed`。
- `review_confirmed / generating_analysis / finalized` 默认进入 `/results`。
- `stale` 是分析/报告 artifact 状态，不是顶层 Task 状态；已确认后再次改分会回到 `graded`，但上一正式版本及其快照仍保留。
- A00 不自动发起模型调用或昂贵重算；后续阶段提供显式生成/重新生成操作。

## 2. Figma 对齐与已确认扩展

本阶段只读取并缓存一次 Figma 16 上下文和截图，随后以本地 PNG 与固定尺寸约束实现，避免重复消耗额度。

| Figma 16 | A00 实现 |
|---|---|
| 70px 顶栏、标题、七步流程 | 保留；桌面内容宽 1300px，标题从 `x=70 / y=105` 起，完成为当前步骤而非误报全部完成 |
| 浅蓝完成态横幅 | 保留；展示真实结果版本、教师确认时间与 artifact 状态，stale 时切为克制琥珀色 |
| 三块摘要与低卡片密度 | 保留为单一主内容面板和少量指标，不恢复旧 Card 套 Card |
| 单页图表/下载布局 | 按用户已确认规则扩展成局部左侧五入口：总览、题目分析、学生分析、可视化分析、报告与下载 |
| 完成与下载 CTA | 只有真实 artifact 存在后才开放；A00 对未生成内容只显示事实空态，没有伪下载按钮 |

桌面左侧栏只在结果工作区内出现，不改变全局顶栏。390×844 下折叠成单一选择器，流程条自动定位“复核 → 完成”，主内容不发生页面级横向滚动。

## 3. 后端状态、门禁与版本合同

### 3.1 状态模型

Task 新增：

- `review_confirmed / generating_analysis / finalized` 顶层状态；
- `final_result_version / fingerprint / updated_at / updated_by / dirty`；
- `analysis_status = not_generated | generating | ready | stale`；
- `analysis_result_version / generated_at / error`。

Task 的题目或学生来源被替换、重新批改成功时会清空旧正式结果和 artifact 指针。任务列表、历史筛选、Dashboard、统一 destination、结果 API 与 analytics API 均认识新增状态；`unfinished=true` 现在只排除真正的 `finalized`。

一旦已有批改结果，逐题题干与评分资料不再允许被原地静默改写；教师如需修改源数据，必须走带显式确认的替换/重新批改流程。这样正式版本快照、当前评分依据与后续分析不会悄然失配。

### 3.2 复核门禁

`GET /tasks/{task_id}/finalization` 只向 task owner 返回：

- 必须复核、已确认和剩余数量；
- 最多 20 个剩余学生/题目 ID 与可解释原因；
- 当前 workflow revision、正式版本和 artifact 新鲜度。

门禁只使用持久结果中的真实信号：置信度 `< 0.65`、`requires_human_review`、专家分歧/分差、`all_failed / quota_exhausted`。普通无风险题次不要求为了凑数逐格确认。

### 3.3 正式确认

`POST /tasks/{task_id}/finalization/confirm`：

1. owner-scoped，要求真实 grading result；分析生成中拒绝重复确认；
2. 任一必须复核项未确认时返回结构化 409；
3. 使用 `expected_workflow_revision` 做 CAS；
4. 对结果 payload 做稳定 SHA-256；完全相同重试即使携带旧 revision 也返回 `unchanged=true`；
5. 新版本在 `GradingJob.final_result_versions` 保存深拷贝快照，包含 AI 原始分/理由及教师最终覆盖；旧版本不覆写；
6. 确认只进入 `review_confirmed`，不会谎称分析或报告已经生成。

R02 的逐格编辑 API 已扩展到所有结果态。正式确认后改分只使当前结果 `dirty`、已有 artifact `stale`，随后教师重新确认才产生 v2。

## 4. 前端路由与页面职责

| Route | A00 当前职责 | 后续阶段 |
|---|---|---|
| `/results` | 共用版本上下文、班级事实规模与简洁壳 | A01 完成摘要、预览和分流 |
| `/results/questions` | 共用壳与当前题目事实清单 | A02/A03 完成总览、筛选与详情 |
| `/results/students` | 共用壳与当前学生事实清单 | A04/A05 完成总览、矩阵与详情 |
| `/results/visualizations` | 共用版本上下文与真实未生成/过期状态 | A06 生成多类有教学意义的真实图表 |
| `/results/reports` | 共用版本上下文与真实报告状态 | A07 生成、版本化并下载真实文件 |

R01 的 CTA 已连接 finalization API：有剩余项时进入精确复核详情；门禁全通过后才显示真实“确认复核完成”。确认成功直接进入新工作区。

## 5. 工程与浏览器证据

- 新契约测试：`backend/tests/test_a00_result_finalization.py`，覆盖门禁、owner 隔离、CAS、完全重试幂等、AI 原始记录保留、v1/v2 不可变快照、确认后改分和 stale，以及结果产生后的题干/评分资料锁定。
- 后端整库：`213 passed, 1 skipped`。
- 前端：visible-scope audit、`npm run lint`、TypeScript 与 Vite production build 通过，`481 modules transformed`。
- `git diff --check` 通过。
- 桌面截图：`A00-results-workspace-desktop.png`（1440×900）。
- 移动截图：`A00-results-workspace-mobile.png`（390×844）。
- 浏览器 DOM 验证五个 canonical route 均使用同一正式版本上下文；截图使用匿名本地 fixture，未调用真实 provider，也未修改用户任务。

## 6. 明确边界与下一阶段门

- TaskStore、JobStore、正式版本快照和 artifact 状态仍为进程内存；重启会丢失，不满足生产审计或多进程一致性。迁移 PostgreSQL/对象存储前保持 `[~]`。
- A00 没有生成分析、图表、成绩表、PDF、LaTeX 或 Markdown；这些能力必须在后续阶段有真实生成合同和文件后才开放下载。
- 当前版本快照保存在 GradingJob 内；数据库迁移时应以 `(task_id, version)` 唯一键、事务写 Task 指针与 snapshot，并把 artifact 单独版本化。
- A01 只补正式结果简洁总览：少量关键指标、少量题目/学生/图表预览和明确分流，不复制 R01 热力图、R02 编辑器或旧长结果页。

当前状态：代码、真实合同、工程与桌面/移动浏览器验收完成，等待用户视觉确认，故 tracker 保持 `[~]`。
