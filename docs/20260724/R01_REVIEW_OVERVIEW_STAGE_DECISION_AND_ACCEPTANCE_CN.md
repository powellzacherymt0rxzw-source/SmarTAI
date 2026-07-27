# R01 结果总览与复核热力图：阶段决定与验收记录

> 日期：2026-07-24（UTC+8）
>
> 分支：`codex/figma-first-frontend-redesign`
>
> canonical route：`/tasks/:taskId/review`
>
> Figma：`14 Results Overview 结果总览与复核热力图`，node `1:1009`

## 1. 页面职责与决定

R01 只回答三个问题：本次结果整体如何、哪些学生 × 题目有复核信号、下一项应进入哪里复核。旧 `TaskResultsPage` 的结果导航、知识库状态、分析图表和长内容不再出现在 `/review`。

- 使用真实 `GET /tasks/:id`、`GET /tasks/:id/result` 与 `GET /tasks/:id/teacher_comments`。
- 四个指标为平均得分率、低置信题次、专家分歧大、已批注；没有把“存在教师批注”冒充成“教师已确认复核”。
- 复核信号只来自真实置信度、`requires_human_review`、`review_reasons` 与专家分数差；矩阵没有硬编码演示状态。
- 支持学生/题目文本、低置信、专家分歧、待复核、已批注及“低于 N 分”的本地可解释筛选；不调用 provider、不消耗模型额度，也不冒充完整语义模型。
- 每个矩阵格和队列项都链接到 `/tasks/:id/review/:studentId/:questionId`；R02 已替换为专门的学生/题目双维详情。R01 的当前筛选地址通过受限 `returnTo` 带入详情，返回时不会丢失复核上下文。
- R01 交付时后端尚无 `review_confirmed / finalized` 生命周期，因此当时没有开放伪确认按钮；A00 已补齐真实门禁与版本合同，现在剩余必审项清零后显示“确认复核完成”，确认后进入 `/results`，但仍不会伪造分析/导出已生成。

## 2. Figma 对照

1440×900 实渲染的关键坐标：

| 区域 | Figma | 实现 |
|---|---:|---:|
| 标题 | `(70,105)` | `(70,105)` |
| 四张指标卡 | x=`70/340/610/880`，y=`205`，`250×90` | 完全一致 |
| 智能筛选行 | `(70,320,1300×48)` | `(70,319,1300×48)` |
| 热力图 | `(70,395,820×308)` | 完全一致 |
| 复核队列 | `(920,395,438×308)` | 完全一致 |

按用户最新覆盖规则保留中文顶栏、模型状态入口和用户名菜单，删除 Figma 右上的重复任务状态胶囊；颜色比原稿克制。队列固定展示最优先 4 项，其余通过矩阵和筛选进入，避免页面增长。

## 3. 功能与状态验收

| 场景 | 行为 |
|---|---|
| `grading` 任务误入 R01 | 返回 C03 `/grading/progress` |
| 尚未到达复核阶段的任务误入 | 走统一 canonical destination |
| `review_confirmed / generating_analysis / finalized` 回看 | 保留 R01 真实热力图和队列，只读显示“查看最终结果”，不重复提交复核完成 |
| 结果加载/失败/为空 | 独立可行动状态，不展示伪数据 |
| 有复核信号 | 按真实优先级排列队列，主按钮进入第一项 |
| 无复核信号 | 显示事实空队列，仍可查看任一结果 |
| 教师批注 | 显示“批注”，不等同正式复核完成 |
| 大量学生或题目 | `308px` 矩阵内部双向滚动，页面骨架不无限增长 |
| 移动端 | 指标 2×2；矩阵局部横向滚动；整页无横向溢出 |

## 4. 工程与浏览器证据

- `npm run lint`：visible-scope audit、TypeScript 通过。
- `npm run build`：Vite production build 通过，`482 modules transformed`。
- 桌面截图：`R01-review-overview-desktop-viewport.png`。
- 移动截图：`R01-review-overview-mobile.png`。
- 桌面 `clientWidth=scrollWidth=1440`、`scrollHeight=900`；移动 `clientWidth=scrollWidth=390`，矩阵内部 `clientWidth=348 / scrollWidth=804`。
- 主按钮真实进入 `/tasks/T_r01visual/review/PB20111622/q2` 并成功渲染学生详情回落页。
- 验收使用匿名本地 fixture，只读取任务/结果/批注，不调用模型、不修改用户任务。

## 5. 明确未完成边界

- R01 不提供教师最终分数修改、复核确认、结果版本冻结、分析生成或导出。
- “已批注”只是教师留下非空批注的题次数；不是正式复核完成数。
- 真正 provider 语义筛选、拼音匹配与大数据服务端分页未实现。
- R02 已完成学生/题目两个互不干扰的智能导航、左右/上下键与单题/长视图；本阶段继续保留其独立页面职责。
- A00 已新增 owner-scoped、revision/CAS、幂等的任务级复核确认、正式结果版本和 artifact stale 状态；真实分析生成与下载仍由 A06/A07 完成。

当前状态：代码、工程和浏览器验收完成，等待用户视觉确认，故 tracker 保持 `[~]`，不写成用户已验收。

## 6. R02 后续接入更新（2026-07-24）

R02 已新增真实逐格教师覆盖层并替换详情回落页，因此 R01 第四项现在展示 `review_status=confirmed` 的“已复核”数量；已确认格显示“已确认”，普通教师批注仍只显示“批注”。所有得分率开始消费 `teacher_score ?? AI score`，同时保留 AI 原始记录。任务级 `finalized`、结果版本和分析/导出状态仍未建立，本更新不改变 R01 是“正式完成前工作区”的边界。详细合同与证据见 `R02_REVIEW_DETAIL_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。

## 7. 2026-07-27 八步回溯与筛选复验

- 统一以 `getTaskReachableStep` 判断页面可达性：完成态从第 8 步回点第 5“校对作答”、第 6“执行批改”和第 7“复核分析”均保留在所选页面，不再被各页旧守卫强制送回 `/results`。
- 已进入后续阶段的第 5 步详情保持题目、作答、左侧题号和双维导航可见，但身份与作答编辑只读，避免历史回看改写已批改输入；详情页底部主按钮进入第 6 步，返回作答矩阵降为次操作。
- R01 中文搜索增加 composition 门禁，草稿与已应用条件分离，并把条件写入 URL；清空、刷新、进入 R02 再返回均保持可解释状态，不调用 provider。
- R01 在正式完成后继续显示真实指标、热力图和复核队列；主动作变为“查看最终结果”，不再次调用复核确认 mutation。
- 隔离完成态 fixture `T_r01r02check` 浏览器回归依次验证 `/submissions`、学生作答详情、`/grading/preflight`、`/review` 和 `/grading/progress`；最终进度页显示 `48/48`、`100%` 历史快照，控制台 `0 errors`。
- 最新证据：`20260727-r01-r02/S05-completed-history-and-next-stage.png`、`C02-completed-history.png`、`R01-completed-history.png`；PNG 只保存在 Codex 临时可视化目录。`npm run lint`（visible-scope 67 文件 + TypeScript）通过，未触发真实 provider。
