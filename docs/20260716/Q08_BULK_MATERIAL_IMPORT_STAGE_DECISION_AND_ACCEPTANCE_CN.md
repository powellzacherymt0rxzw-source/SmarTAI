# Q-08 批量导入资料：阶段决策、实现边界与验收记录

> 日期：2026-07-16
> 分支：`codex/figma-first-frontend-redesign`
> Figma：`08 Bulk Material Import 批量导入材料`，node `1:536`
> 标准：术语统一为“资料”；严格沿用 Figma 08 的单卡信息层级，同时满足既有文档中的真实导入、人工复核、默认不覆盖与 owner/BYOK 隔离要求。

## 1. 本阶段结论

Q-08 已完成工程实现，但在用户完成页面视觉确认前保持 `[~]`，不提前写成最终视觉验收通过。

本轮从旧长页面中彻底拆出三个独立 route：

1. `/tasks/:taskId/questions/import`：只选择导入目标、资料来源和资料结构；
2. `/tasks/:taskId/questions/import/progress/:jobId`：只显示事实进度与恢复动作；
3. `/tasks/:taskId/questions/import/review/:jobId`：只确认明确匹配、可能匹配和覆盖冲突。

题目准备总览 Q-03 只新增真实入口；评分标准、标答、测试样例子页可携带对应目标进入 Q-08。没有把上传、进度、复核和逐题编辑重新塞回一个长页面。

## 2. Figma 08 可见层约束

### 2.1 桌面基线

- 逻辑画布：`1440×900`；
- 页面标题：约 `(70,105)`，`30px`；
- 七步条：约 `y=155`；
- 主卡片：约 `(270,220,900×560)`，`10px` 圆角；
- 主卡片内按顺序只显示：导入目标、资料来源、已选来源、资料结构、主动作；
- 目标默认：`评分标准 + 标答`；
- 来源默认：`课程资料库`；
- 结构默认：`已按题整理`；
- 主按钮：右下，约 `230×40`；
- 使用少量蓝色表达选中与主动作，不添加彩色大卡、重复状态胶囊或装饰图表。

最终实现将标题旁的“返回”入口移到主卡片下方，避免破坏 Figma 标题层级；卡片上边距已按终审从 `45px` 收紧到约 `35px`。

### 2.2 移动端约束

- 标题区在窄屏改为纵向/换行；
- 选择页根页面不得横向溢出；
- 复核矩阵允许自身局部横向、纵向滚动，不能把整个页面撑宽；
- 页面仍保持一个核心判断，不在移动端追加说明长文。

## 3. 已锁定的产品默认值

- 可多选 `评分标准 / 标答 / 编程题测试样例`；默认前两项；
- 来源二选一：owner-scoped 课程资料库中的一个真实文件，或上传一个新文件；
- 上传文件可显式选择加入课程资料库，默认关闭；
- 文件结构二选一：`已按题整理 / 从原文提取`；默认前者；
- 选择“从原文提取”后才显示章节、题号、范围或自然语言线索输入框；
- 正式导入默认策略为 `missing_only`；已有教师内容默认保留；
- 覆盖已有内容必须在复核页逐候选明确勾选；
- 只有后端标记为 `exact` 且不覆盖现有内容的候选默认选中；
- `possible` 代表语义/模糊定位，始终由教师主动选择；置信度只作辅助数字，不冒充“明确匹配”。

## 4. 真实后端闭环

### 4.1 API

1. `POST /tasks/{id}/material-imports/preflight`
   - multipart；`file` 与 `library_material_id` exactly-one；
   - 解析 `criterion / reference_answer / test_cases`、结构模式、提取说明和保存资料库选项；
   - 复用 Q-01 的 PDF/TXT/Markdown 安全读取、大小/字符/估算 token 限制；
   - 只做确定性预检，不选择或调用 provider；
   - 返回 owner/task/revision 绑定的短期 `source_token`。
2. `POST /tasks/{id}/material-imports`
   - 消费 `source_token`；
   - 使用当前任务 owner 的 provider 视图；管理员不能隐式代用教师 BYOK；
   - 一次结构化模型调用生成 review plan，不修改题目字段；
   - 完整请求指纹返回 `started / already_running / plan_ready / already_done`。
3. `GET /tasks/{id}/material-imports/{job_id}`
   - owner-scoped 返回 `running / ready / applied / error`；
   - 返回事实步骤、候选、冲突摘要和当前 workflow revision；
   - 不伪造页数、ETA 或识别数量。
4. `POST /tasks/{id}/material-imports/{job_id}/apply`
   - 接收已确认候选、显式覆盖候选和 expected revision；
   - 在 `TaskStore` 同一把锁内完成一次 CAS；
   - 未接受、未知、非编程题测试样例和未获覆盖授权的冲突不会写入。

### 4.2 安全与可追溯性

- 模型只生成候选；失败时保留原题目，脱敏 provider 异常并允许同来源重试；
- plan 过期时原子解除 task 中的旧指针，同 token 可安全重启，不形成永久 404；
- 导入内容写入后整题保持 `edited`，逐资料槽位保存：job、candidate、来源类型、文件名、资料库 ID、来源位置/片段、置信度、`exact/possible`、原因、确认状态和时间；
- 教师在 Q-05/Q-06/Q-07 编辑或确认某一槽位时，只更新该槽位 provenance，不误确认同题其他导入项；
- draft、plan、课程资料和 task 当前仍是有 TTL/配额的进程内存实现，不冒充数据库或对象存储。

## 5. 前端状态与恢复

- 选择页真实执行 `preflight -> start`；
- `ready` 自动进入复核，`running` 进入进度，`already_done` 返回题目总览；
- 进度错误提供“重新选择资料”，不要求老师在无效页面反复刷新；
- 复核页必须同时拿到任务原数据和 plan 才允许应用，确保能比较候选与现有内容；
- 复核选择偏离默认值后启用离开保护；应用成功才放行；
- `stale_revision / workflow_busy / plan_superseded / plan expired` 不继续使用旧计划，明确返回重新选择与匹配；
- Q-03 与 Q-05/Q-06/Q-07 的入口均指向真实 route，不放死按钮。

## 6. 工程验收证据

- Q-08 后端契约：`10 passed`；
- 后端全量：`160 passed, 1 skipped, 9 warnings`；唯一 skip 为当前本地可选 PDF 依赖边界，warnings 为既有 FastAPI deprecated 常量/事件提示；
- 前端 `npm run lint`：通过；包含 visible-scope audit 与 `tsc --noEmit`；
- visible-scope audit：扫描 `62` 个用户可见源文件，通过；
- Vite production build：`456 modules transformed`，通过；
- `git diff --check`：通过；
- 两轮只读终审的 P1 已修：过期 plan、逐槽位 provenance、`exact/possible`、task 加载门禁、复核离开保护、CAS 恢复入口、390px 标题布局与 Figma 卡片纵向锚点。

### 6.1 本轮未取得的浏览器证据

用户已授权 Playwright Chromium 验收，但本轮隔离 `8001` 服务与 Chromium 启动均被当前 Codex 本机授权/使用额度拒绝；不得绕过该限制。现有 `5173/8000` 未被停止或改写，且没有为截图调用真实模型、修改用户任务或伪造 PNG。

因此本阶段没有新增 `q08-*.png`，并保持“工程完成、等待用户视觉确认”。用户可低成本打开：

```text
http://localhost:5173/tasks/T_24fbab3cba/questions/import
```

若该任务仍为 `problems_ready`，即可检查 Figma 08 选择页；若任务 ID 已变化，可从任一题目准备总览点击“批量导入资料”。

## 7. 明确保留到后续的边界

- Q-09 AI 补全缺失资料没有实现、没有路由冒充或隐藏调用；
- 资料库分组、一次选择多文件/整库、DOCX、图片、扫描件、手写 OCR 没有实现；
- 正式测试脚本字段与下载没有实现；
- 课程资料、draft、plan、任务和逐槽 provenance 还未迁移 PostgreSQL/对象存储；
- 当前一次模型调用会在既有限额内匹配本次任务；更大文件的分块检索、向量召回与可取消队列属于后端后续阶段。

## 8. 下一阶段门

1. 用户确认 Q-08 选择页与 Figma 08 的视觉关系；
2. 若只涉及间距、字号或中英文文案，按小 diff 调整，不重做合同；
3. 视觉确认后将 Q-08 从 `[~]` 更新为 `[x]`；
4. 下一代码阶段才进入 Q-09，继续使用独立 route、预览生成范围、不覆盖教师内容的同一标准。
