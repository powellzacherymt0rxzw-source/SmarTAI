# S02 作答识别进度阶段决定与验收记录（2026-07-23）

## 1. 阶段结论

本阶段只完成 S02“作答识别进度”，不把上传、学生×题目矩阵、身份校正和单份作答编辑合并成长页。

- canonical route：`/tasks/:id/submissions/progress`
- Figma 文件：`64TupCQCKXkiT5uxeQY0iH`
- 组合基线节点：`1:280`，即 Figma 05“题目识别进度”
- 当前状态：代码、真实进度合同、工程检查和桌面/移动浏览器验收完成，等待用户视觉确认，因此 tracker 保持 `[~]`
- 下一阶段：S03 `/tasks/:id/submissions`

Figma 没有单独画 S02。本页严格复用 Figma 05 的识别进度视觉语言，只把业务事实替换为作答文件、学生身份匹配和逐题答案切分；没有复用遗留作答工作区的长页布局。

## 2. Figma 对齐目标

### 2.1 桌面结构

以 `1440×900` 逻辑画布为准：

| 区域 | Figma 05 目标 | S02 实渲染 |
|---|---:|---:|
| 顶栏 | 高 `70` | 共用 AppShell 高 `70` |
| 标题 | `(70,105)`，`30px` | `(70,105)`，`30px` |
| 七步流程 | `(70,155)` 起 | `(70,155,1300×30)`，当前第 3 步“作答” |
| 进度主卡 | 约 `(320,235,800×430)` | `(320,230,800×430)` |
| 底部动作 | 卡片下约 `30px`，右对齐 | 两个 `40px` 高次级按钮，右对齐 |

主卡只包含：一句当前动作、真实进度、五个识别步骤、三项事实计数和最近三条事件。主题蓝只用于当前步骤和进度；绿色只用于已经完成的步骤，没有新增重复状态胶囊、侧栏、嵌套表单或用户可见开发说明。

卡片纵坐标比 Figma 05 约提前 `5px`，用于保持现有 Q02 与 S02 共用识别页的垂直节奏；标题、流程、卡片尺寸、首屏高度和底部动作关系不变。

### 2.2 移动端

- `390px` viewport 下页面 `scrollWidth=390`，无页面级横向溢出。
- 主卡为 `350×568`，步骤、事实事件区和按钮改为单列。
- 七步流程仍允许横向浏览，但会自动把当前步骤滚入可见区域；实测当前第 3 步完全可见。
- 页面总高 `955px`，纵向滚动来自真实内容重排，不横向压缩文字或隐藏核心动作。

## 3. 真实进度合同

### 3.1 事实计数

`JobProgress.stage_metrics` 新增阶段事实计数字典，本阶段写入：

- `files_total`
- `files_processed`
- `submissions_recognized`
- `identities_matched`
- `identities_needing_review`
- `answers_split`
- `parse_failures`

所有值必须是非负整数，并在并发解析时通过同一个 reporter 锁原子累加。页面不根据耗时猜 ETA、页数或剩余时间；百分比只由已处理文件数与文件总数计算，没有可靠总数时使用不确定进度状态。

### 3.2 子步骤与完成语义

进度事件依次覆盖：

1. 作答文件已接收。
2. 准备并检查文件。
3. 识别与匹配学生身份。
4. 拆分逐题作答。
5. 汇总并保存结果。

身份识别和答案切分由当前同一次逐文件模型调用共同完成，因此页面在处理期间同时标为进行中，不伪造两个不存在的串行后端阶段。只有 TaskStore 成功提交学生数据后，API worker 才把 reporter 标记为 `completed / done`，避免“页面显示完成、任务尚未提交”的竞态。

### 3.3 隐私与错误

- 进度事件只使用稳定通用消息，不显示学生姓名、学号或文件名。
- 普通 INFO/ERROR 日志同样不再记录单个作答文件名；错误只保留异常类型和脱敏恢复提示。
- 全部文件失败仍进入现有 `error` 状态；S02 显示重新选择作答文件和刷新两个恢复动作。
- 本阶段不改变 OCR 边界：图片、扫描 PDF 和手写作答仍未实现 vision/OCR ingestion。

## 4. 路由与阶段门

- S01 开始识别或收到 `already_running` 后进入 S02。
- `parsing_submissions` 的工作台、历史任务、canonical task entry 和“查看进度”动作统一进入 S02。
- S02 刷新后从任务 state 与 reporter snapshot 恢复，不要求教师停留页面，也不要求手动刷新进度。
- 题目尚未就绪或作答尚未开始时，直接访问 S02 会回到真实前置阶段。
- `grading / graded` 不停留在过期进度页，进入结果区。
- 后续更新（2026-07-23）：S03 已完成；`submissions_ready` 现统一进入 canonical `/tasks/:id/submissions`，旧 `/tasks/:id/upload/submissions` 只保留状态感知兼容跳转，不再渲染遗留长工作区。

## 5. 代码范围

### 前端

- 新页面：`frontend/app/src/routes/tasks/SubmissionRecognitionProgressPage.tsx`
- route/lazy loading：`frontend/app/src/main.tsx`
- S01 启动后跳转和全局状态目的地：`AddSubmissionsPage.tsx`、`taskFlow.ts`
- 真实进度类型和中英双语文案：`types/progress.ts`、`i18n/messages.ts`
- 共用流程移动端修正：`components/new-task/NewTaskStepper.tsx`

### 后端

- 作答解析阶段指标、稳定事件和隐私日志：`backend/agents/ingest_agent.py`
- 成功提交后的最终完成事件：`backend/api/tasks.py`
- 事实指标模型与原子 reporter 方法：`backend/models.py`、`backend/progress/tracker.py`
- 新合同测试：`backend/tests/test_s02_submission_progress.py`，并扩展 S01 worker 完成语义测试。

## 6. 验收证据

### 6.1 自动检查

- 相关后端回归：`48 passed, 1 skipped, 5 warnings`
- 前端 visible-scope audit：通过，扫描 `68` 个可见源文件
- TypeScript：通过
- Vite production build：通过，`467 modules transformed`
- `git diff --check`：通过

### 6.2 浏览器检查

验收使用本地教师测试账号和临时内存任务 `T_s02_visual`。夹具只写入当前进程内存，验收后已停止服务并删除脚本；没有上传用户文件、调用真实 provider 或改写真实任务。

- 桌面：`s02-submission-progress-1440x900.png`
  - `viewport=1440×900`
  - `scrollWidth=1440`、`scrollHeight=900`
  - 主卡 `(320,230,800×430)`
  - 无可见 dialog，无 console error/warning
- 移动：`s02-submission-progress-mobile-390x844.png`
  - `viewport=390×844`
  - `scrollWidth=390`、`scrollHeight=955`
  - 主卡 `(20,230,350×568)`
  - 当前第 3 步自动滚入可见区域，无 console error/warning
- 交互：点击“返回工作台”后真实进入 `/`；“后台继续运行”的离开语义成立。

视觉证据保存于 Codex 临时可视化目录，不进入产品仓库。

## 7. 阶段门与下一步

S02 已满足用户视觉确认条件，但只有用户明确确认后才把 `[~]` 改为 `[x]`。以下 S03 门禁已于 2026-07-23 落地：

1. 默认首屏首先显示学生×题目的状态矩阵、少量大号事实指标、独占搜索/筛选行和精确分流入口。
2. 身份缺失、作答缺失或拆分异常从矩阵单元格进入专门短页，不把编辑器追加在矩阵下方。
3. 学生和题目两个维度保持独立筛选；自然语言筛选必须显示解释、匹配结果和清空动作。
4. S03 建成后，`submissions_ready` 的所有入口统一切换到 `/tasks/:id/submissions`，再删除本阶段记录的兼容目的地。
