# Q-09 AI 补全缺失资料：阶段决策与验收记录（2026-07-19）

> 分支：`codex/figma-first-frontend-redesign`
>
> 阶段状态：实现、工程回归与本地浏览器验收完成，等待用户视觉确认后由 `[~]` 归档为 `[x]`。
>
> 本阶段不启动 Q-10、S-01 或课程资料库重构。

## 1. 页面定位与 Figma 边界

Q-09 是旧文档明确要求、但 17 张 Figma 图没有单独画出的补充工作流。它不是 Figma `09 Knowledge Base 课程资料库`，不得占用该图或把课程资料库改名实现。

新增页面继续复用已冻结的 Figma 视觉语言：

- Figma 08：约 `900px` 的居中单卡选择/确认结构；
- Figma 05：约 `800×430` 的独立事实进度卡；
- Figma 06：题目准备矩阵优先、完成后回到矩阵；
- Figma 07：逐题资料槽位与“AI 生成、待确认”的状态语义；
- Figma 17：零模型/BYOK 门禁与可恢复错误动作。

颜色继续克制使用蓝、青绿、灰和必要的红色错误态；不增加装饰插图、大面积渐变或与页面无关的彩色 pill。

## 2. 冻结的产品决策

### 2.1 路由与单页职责

| 页面 | Route | 唯一职责 |
| --- | --- | --- |
| 范围确认 | `/tasks/:id/questions/ai-complete` | 列出当前真正缺失的题目资料槽位，教师勾选后确认一次 |
| 事实进度 | `/tasks/:id/questions/ai-complete/progress/:jobId` | 显示真实步骤、最近事件、后台离开和恢复动作 |
| 完成去向 | `/tasks/:id/questions` | 刷新 Q-03 矩阵；逐槽进入 Q-05～Q-07 查看、编辑和确认 |

不增加“生成后再应用”的第二次确认页。教师已经在生成前确认精确范围；生成任务只写入执行时仍为空的槽位，并统一标记为待确认，之后在已有逐题短页完成内容复核。

### 2.2 生成范围

本阶段真实支持：

- 评分标准 `criterion`；
- 标答 `reference_answer`；
- 仅编程题的示例正确代码 `solution_code`；
- 仅编程题的结构化测试样例 `test_cases`。

`solution_code` 是真实后端字段，可在逐题详情编辑和确认，但本阶段不执行代码。正式测试脚本仍没有可信字段和消费方，因此不制造假入口或把示例代码冒充可执行脚本。

### 2.3 安全默认与状态语义

- 预检是确定性的零 provider 调用；页面先显示题目数、缺失槽位数和逐项矩阵。
- 写入策略固定为 `missing_only`，不提供覆盖开关。
- 教师确认后只进行一次结构化模型调用；结果规范化后在 TaskStore 单锁中进行一次 CAS 写回。
- 如果教师在模型运行期间补好了某一槽位，该槽位被跳过，不覆盖新内容。
- AI 写入逐槽保存 `ai_generated` provenance，并进入 `pending`；教师编辑后为 `edited`，明确确认后为 `confirmed`。
- 题干复核状态与评分标准/标答/代码/测试样例状态解耦。确认资料槽位不会顺带把题干标为已确认，反之亦然。
- 同一指纹幂等返回现有/已完成任务；不同范围遇到已有运行任务时返回该任务的 `job_id`，前端进入现有进度页，不启动第二次 provider 调用。
- stale revision 或未知目标会重新拉取预检并要求教师按最新缺失范围重新确认。
- 失败保留现有题目值，错误信息脱敏；任务和 job 均按 owner 隔离，并受 TTL、数量和内存额度约束。

## 3. API 与数据实现

新增 API：

- `GET /tasks/{task_id}/ai-completions/preflight`
- `POST /tasks/{task_id}/ai-completions/confirm`
- `GET /tasks/{task_id}/ai-completions/{job_id}`

新增或扩展的数据能力：

- `ProblemInfo.solution_code`；
- `ProblemInfo.ai_completion_provenance`；
- 任务级 Q-09 运行、完成、失败、重试与幂等字段；
- owner-scoped、TTL 和容量受限的 `AICompletionStore`；
- `IngestAgent` 的结构化缺失资料生成入口，继续通过构造函数接收 provider，并上报子步骤进度。

所有存储仍是进程内存；本阶段不宣称 PostgreSQL、对象存储或重启后恢复。

## 4. 视觉与交互验收

### 4.1 桌面范围确认页

- 视口：`1440×900`；文档和 body 的 `scrollWidth` 均为 `1440`，页面 `scrollHeight=900`。
- 标题和七步条之后只有一个约 `900×558` 的主卡片。
- 4 个缺失类型计数、精确缺失矩阵、测试样例数量、missing-only 提示和一个主 CTA 均在首屏完成。
- 缺失项较多时只让矩阵内部滚动，不把整页重新拉成长页面。
- 截图：`q09-ai-complete-1440x900.png`。

### 4.2 移动范围确认页

- 视口：`390×844`；`innerWidth=scrollWidth=bodyScrollWidth=390`，无页面级横向溢出。
- 顶栏折叠为移动结构；七步条只保留当前上下文；计数改为两列。
- 宽矩阵在自己的容器内滚动，页面纵向滚动是移动端内容自然换行的结果。
- 截图：`q09-ai-complete-390x844.png`。

### 4.3 Q-03 返回入口与矩阵优先

- 视口：`1440×900`；`scrollWidth=1440`、`scrollHeight=900`。
- 2026-07-20 根据用户视觉纠正，题干复核、评分标准、标答和测试样例改为独占一整行的 4 张 `112px` 高圆角指标卡；主百分比约 `30px`，完成度低于 50% 才使用琥珀色，其他使用主蓝/完成青绿，不给整卡铺彩色背景。
- 搜索框另起一整行并占满可用宽度；排序降为下一辅助行右侧控件，不再与覆盖率卡抢同一横向空间。
- 标题与七步条后依次显示大号覆盖率卡、独占搜索行和矩阵，4 道验收题仍在桌面首屏看全。
- 表格 footer 的 `批量导入资料`、`AI 补全缺失项`、`继续上传作答` 分别进入专门页面；没有把 AI 表单追加在矩阵下方。
- 代码与测试仍合并在既有“代码 / 测试”列，保持 Figma 06 的 7 列结构。
- 当前截图：`q03-metrics-figma14-correction-1440x900.png`、`q03-metrics-figma14-correction-390x844.png`；前者替代较紧凑的 `q09-question-matrix-entry-1440x900.png` 作为 Q03 最新视觉证据。

上述 PNG 位于 Codex 临时可视化目录：

`/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/`

浏览器验收使用隔离的本地教师 fixture，只读取预检和页面状态；没有点击正式生成按钮、没有调用真实模型，也没有改写用户现有任务。

## 5. 工程验收

- Q-09 定向后端契约：`7 passed`。
- 后端全量：`167 passed, 1 skipped, 9 warnings`。
- 前端 `npm run lint`：visible-scope、ESLint 与 `tsc --noEmit` 通过。
- Vite production build：`461 modules transformed`，通过。
- `git diff --check`：通过。
- 2026-07-20 Q03 指标卡纠正后再次通过 visible-scope、`tsc --noEmit`、Vite `461 modules` production build；桌面 `scrollHeight=900`，移动 `innerWidth=scrollWidth=bodyScrollWidth=390`。
- 两轮只读终审发现的 P1 已修复：题干/资料状态耦合、后台完成后 Q-03 不刷新、stale/different-scope 恢复缺失、Q-03 忽略 Q-08 provenance；修复后未发现遗留 P0/P1。

## 6. 明确不在本阶段的能力

- 图片、扫描件、手写 OCR 和 DOCX；
- 测试脚本生成或执行、代码沙盒；
- 多文件/整库课程资料选择和资料分组；
- PostgreSQL、对象存储和跨进程 job 恢复；
- Q-09 之外的作答、批改配置、复核和正式结果页面；
- 伪造 ETA、模型“在线”状态或生成成功率。

## 7. 阶段门

当前可标记为 `[~]`：代码、真实契约、构建、桌面/移动截图和局部返回流程均已完成；用户尚未亲自确认本阶段截图，所以不提前写成 `[x]`。

用户确认后只更新验收状态，不借机扩展页面。下一阶段必须重新依据 tracker 选定，并在动工前列出会改变数据模型或页面边界的少量问题。
