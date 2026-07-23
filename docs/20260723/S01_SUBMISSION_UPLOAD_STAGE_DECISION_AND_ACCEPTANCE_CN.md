# S01 添加学生作答阶段决定与验收记录（2026-07-23）

## 1. 阶段结论

本阶段只完成 S01“添加学生作答”，不把上传、识别进度、矩阵校对和单份作答塞回同一长页。

- canonical route：`/tasks/:id/submissions/upload`
- 可见设计基线：`docs/20260710/figma/10 Submission Upload 添加学生作答.png`
- Figma 文件：`64TupCQCKXkiT5uxeQY0iH`
- Figma 节点：`1:679`
- 当前状态：代码、合同、工程和浏览器验收完成，等待用户视觉确认，因此 tracker 保持 `[~]`
- 下一阶段：S02 `/tasks/:id/submissions/progress`

后续更新：S02 已于 2026-07-23 完成独立重写。成功启动识别及 `already_running` 现在进入 `/tasks/:id/submissions/progress`；只有 S03 尚未实现，识别完成状态暂时进入现有 `/tasks/:id/upload/submissions` 兼容工作区。该过渡连接不代表遗留页面已通过本轮视觉验收。

## 2. Figma 对齐目标

### 2.1 桌面结构

以 `1440×900` 逻辑画布为基准：

| 区域 | Figma 目标 | 本阶段实现 |
|---|---:|---:|
| 顶栏 | 高 `70` | 共用 AppShell 高 `70` |
| 标题 | `(70,105)`，`30px` | 实渲染 `(70,105)`，`30px` |
| 七步流程 | 起始约 `y=155` | 共用 `NewTaskStepper`，当前第 3 步“作答” |
| 上传区 | `(270,230,900×230)` | `max-width:900px; height:230px` |
| 身份匹配 | `(270,500,900×145)` | `900px` 单卡，三项轻量胶囊 |
| 识别设置 | `(270,675,900×74)` | `900px` 单行设置卡 |
| 主按钮 | `(990,780,180×40)` | `180×40`，右对齐 |

颜色保持克制：只把当前步骤、上传图标、选中匹配方式和主要按钮使用主题蓝色；没有增加红圈式重复页面标签，也没有恢复遗留侧栏或嵌套长卡。

### 2.2 与 Figma 的有意差异

Figma 文案包含“图片”，但当前后端没有 OCR/vision ingestion。为了不误导教师，页面显示：

- 可复制文字 PDF
- TXT / Markdown / RST / CSV
- ZIP / RAR / 7z / TAR 及常见 tar 压缩变体
- `OCR 增强：暂不可用`

图片、扫描 PDF 和手写作答不在本阶段能力内。颜色可少于 Figma，但尺寸、层级、留白和单焦点结构仍以 Figma 10 为准。

## 3. 真实功能合同

### 3.1 上传来源与安全限制

- 单次上传上限 `50 MiB`。
- 压缩包最多 `500` 个文件、解压后总计最多 `100 MiB`、单成员最多 `5 MiB`。
- 压缩包路径经过安全校验；不接受目录穿越、空包、损坏包或未支持的二进制成员。
- PDF 只走已有可复制文本提取；不声称 OCR。
- 所有错误在 API 边界映射成脱敏、可恢复的用户消息。

### 3.2 三种身份匹配

| 模式 | 行为 | 未匹配处理 |
|---|---|---|
| 按文件名识别 | 优先从每份文件名取学号/姓名，再用文内信息补充 | 标记待复核 |
| 导入名单 | CSV/TSV/TXT 必须包含学号与姓名；模型只提取候选，服务端做规范化精确匹配 | 非唯一或无匹配进入待复核 |
| 手动校正 | 仍解析答案内容，但不自动认定学生身份 | 所有作答进入待复核 |

名单最多 `1 MiB`、`5000` 行。整份名单不进入 LLM prompt，既节约 token，也减少学生信息外发；后端只保存解析结果需要的身份状态，不写入 API key。

### 3.3 识别模型与门禁

- 必须先保存 C01 批改设置。
- 默认继承 C01 的 primary provider。
- 教师可在 S01 单独选择当前已启用且 owner-visible 的识别 provider。
- 后端再次验证 provider 归属和启用状态；前端选项不是安全边界。
- 本阶段浏览器验收使用内存 fixture provider，只检查 UI 和门禁，未触发远端模型调用。

### 3.4 幂等与覆盖

请求指纹同时包含：

- 作答文件内容
- 身份匹配模式
- 名单内容（若使用）
- 作答识别 provider id

同一请求复用 `already_running` / `already_done`；不同请求遇到在途任务或已有作答时不会静默覆盖。已有作答时，前端在点击 CTA 时确认一次，后端仍要求 `replace_confirmed=true`，最终提交使用 TaskStore 锁和 pending/successful 配置快照，避免半写入。

## 4. 路由与状态纠偏

- C01 保存成功后进入 `/tasks/:id/submissions/upload`。
- 结果页重新上传作答入口进入同一 canonical route。
- task-flow resolver 在 `problems_ready + grading_setup_configured` 时进入 S01。
- `parsing_submissions` 已统一进入 S02；`submissions_ready` 暂时维持现有工作区，等 S03 建成后切换到 `/tasks/:id/submissions`。

## 5. 代码范围

### 前端

- 新页面：`frontend/app/src/routes/tasks/AddSubmissionsPage.tsx`
- 新 route 与 lazy loading：`frontend/app/src/main.tsx`
- 上传 multipart 合同与 hook：`frontend/app/src/api/`
- task 类型、状态路由与中英双语文案：`frontend/app/src/types/task.ts`、`frontend/app/src/lib/taskFlow.ts`、`frontend/app/src/i18n/messages.ts`
- C01 与结果页入口改用 canonical S01 route

### 后端

- 上传/名单解析和请求指纹：`backend/api/tasks.py`
- archive/PDF/text 安全读取：`backend/tools/file_processing.py`
- 身份候选、确定性名单匹配与复核状态：`backend/agents/ingest_agent.py`
- 原子 pending/successful 配置和覆盖门禁：`backend/state/__init__.py`
- 模型字段：`backend/models.py`
- 新合同测试：`backend/tests/test_s01_submission_upload.py`

## 6. 验收证据

### 6.1 自动检查

- S01、文件安全、问题来源、任务、C01 与 provider 隔离合并回归：`71 passed, 1 skipped, 13 warnings`
- Python compileall：通过
- TypeScript：通过
- Vite production build：通过，`466 modules transformed`
- visible-scope audit、lint 与 `git diff --check`：通过

### 6.2 浏览器检查

使用本地教师测试账号和隔离内存任务 `T_s01_visual`，没有上传用户文件、没有调用真实 provider。

- 桌面：`s01-submission-upload-1440x900.png`
  - `innerWidth=1440`
  - `scrollWidth=1440`
  - `scrollHeight=900`
  - 标题实测 `(70,105)`
  - 首屏完整显示上传、身份匹配、识别设置与 CTA
- 移动：`s01-submission-upload-390x844.png`
  - `innerWidth=390`
  - `scrollWidth=375`，小于 viewport，无页面级横向溢出
  - `scrollHeight=1004`，只需约 `160px` 的合理纵向滚动
- 交互：文件名、名单、人工复核三种模式均可切换；名单模式真实出现名单文件选择器；切回文件名模式状态正确；无文件时 CTA 禁用。

复用的 Chrome 标签页日志缓冲仍保留 dev server 切换前 `2026-07-23 13:40` 的旧 Vite 动态导入失败，因此本记录不伪造“控制台零历史错误”。本次页面随后成功加载、完成三种模式交互与双尺寸截图；production build 和自动测试作为最终代码证据。

## 7. 阶段门与下一步

S01 满足进入用户视觉确认的条件，但只有用户明确确认后才把 `[~]` 改为 `[x]`。以下要求已由后续 S02 实现并记录在 `S02_SUBMISSION_RECOGNITION_PROGRESS_STAGE_DECISION_AND_ACCEPTANCE_CN.md`：

1. 独立短页，只显示识别事实步骤、进度、最近事件、后台离开和恢复动作。
2. 没有可信页数或 ETA 时显示 `—`，不伪造百分比。
3. 成功后进入 S03 学生×题目矩阵；失败留在 S02 给出可恢复动作。
4. 完成 S02 后更新 tracker、截图、提交和推送，不把多个未验收页面合成一个阶段。

下一阶段现为 S03 作答校对总览；S01 与 S02 各自保持独立用户验收状态。
