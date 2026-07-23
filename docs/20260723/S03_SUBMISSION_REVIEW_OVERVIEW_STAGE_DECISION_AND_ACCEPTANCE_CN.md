# S03 作答校对总览阶段决定与验收记录（2026-07-23）

## 1. 阶段结论

本阶段完成 S03“作答校对总览”，把遗留 `/upload/submissions` 长工作区替换成一个只负责发现问题和分流的学生 × 题目矩阵页。

- canonical route：`/tasks/:id/submissions`
- Figma 文件：`64TupCQCKXkiT5uxeQY0iH`
- Figma 节点：`1:740`，即 Figma 11“Submission Review 作答校对总览”
- 旧路径：`/tasks/:id/upload/submissions` 只保留状态感知兼容跳转，不再渲染遗留长页
- 当前状态：代码、工程检查和桌面/移动浏览器验收完成，等待用户视觉确认，因此 tracker 保持 `[~]`
- 后续更新：S04 已于 2026-07-23 完成；下一阶段为 S05 单份作答校对。

S03 不编辑整份作答、不展示批改配置、不启动批改，也不把所有学生答案铺在矩阵下方。矩阵单元格在 S05 建成前进入对应学生 S04 并携带 `?question=:qId`，不会指向不存在的页面或伪装单题编辑已经完成。

## 2. Figma 对齐目标

### 2.1 桌面结构

以 `1440×900` 逻辑画布为准：

| 区域 | Figma 11 目标 | S03 实渲染 |
|---|---:|---:|
| 顶栏 | 高 `70` | 共用 AppShell 高 `70` |
| 标题 | `(70,105)`，`30px` | `(70,105)`，`30px` |
| 七步流程 | `(70,155)` 起 | 当前第 3 步“作答” |
| 大号指标 | `250×90`、约 `20px` 间距 | 四张同高度圆角矩形，增加文档要求的身份异常指标 |
| 搜索/筛选 | `(70,325)` 起、独占一行 | 单一 `52px` 容器：自然语言输入 + 状态 + 排序 |
| 矩阵 | `(70,405)` 起、表头约 `42px`、行约 `52px` | 学号、姓名、逐题状态和单一查看动作 |

颜色保持克制：蓝色只用于主数据与动作，绿色表示已识别，黄色表示后端实际返回的识别标记，红色表示空白或缺失。没有页面状态胶囊、图标墙、渐变、嵌套大卡或遗留左侧栏。

Figma 只画了三张指标卡；最新文档同时要求身份异常计数，因此按同一 `250×90` 语言补第四张，而不是把身份问题藏进表格说明。该功能扩展不改变 Figma 的标题、流程、控件高度、表格密度和留白骨架。

### 2.2 移动端

- 四张指标卡重排为两列。
- 搜索、状态和排序在同一过滤卡内纵向排列。
- 矩阵保留真实列宽并在自身容器横向滚动，不压缩状态文字，不产生页面级横向溢出。
- 主动作在 footer 变为整行按钮；纵向滚动来自真实内容重排。

## 3. 真实状态与指标合同

### 3.1 单元格状态

当前 API 没有可靠的作答识别置信度字段。本阶段只根据真实 `StudentAnswerInfo` 显示：

1. `已识别`：存在非空内容且没有识别标记。
2. `待复核`：存在非空内容，且 `flag` 非空；悬停可读取后端原始标记。
3. `空白`：存在 answer 对象但内容为空。
4. `缺失`：学生在该题没有 answer 对象。

“低置信”自然语言搜索只作为“存在后端识别标记”的别名，并在页面明确提示当前没有可靠置信度数值；不根据文本长度、题型或主观规则制造低置信百分比。

### 3.2 大号事实指标

- 身份匹配：`identity_status != needs_review` 的学生数 / 全部学生数。
- 作答覆盖：非空作答单元格数 / 学生 × 题目期望单元格数。
- 待复核题次：识别标记、空白和缺失的去重单元格总数。
- 身份异常：`identity_status == needs_review` 的学生数。

分母为零时显示 `—`，不误报 `0%`。

## 4. 智能筛选与分流

- 学生维度：学号、姓名子串匹配。
- 题目维度：`Q2`、`第 2 题`、题型或题干关键词；筛到题目时学生维度保持不变。
- 状态维度：全部、含待复核、含缺失、身份待复核。
- 排序：学号、姓名、异常优先。
- 自然语言规则：支持“缺失”“待复核”“低置信”“身份异常”等明确意图，并显示当前解释与一键清空。
- 成本边界：S03 使用可解释的本地确定性规则，不调用 provider、不消耗 BYOK 或共享模型额度；更复杂语义 SmartQuery 留待统一后端合同。

点击学号或“查看”进入 S04；点击题目单元格进入同一学生并携带题目上下文。这样学生和题目两个维度不会互相清空，S05 落地后可把单元格目的地精确替换为单题校对页。

## 5. 路由与阶段门

- `submissions_ready` 的工作台、历史任务、canonical task entry、S02 完成跳转和 S01 `already_done` 全部统一到 `/tasks/:id/submissions`。
- `draft / extracting_problems / problems_ready / parsing_submissions / grading / graded / error` 继续由同一个 `getTaskDestination` 返回真实阶段，S03 不显示过期数据。
- 旧 `/tasks/:id/upload/submissions` 位于泛化 `/upload/:kind` route 之前并交给 `TaskEntryRedirect`，旧书签不会再挂载遗留 `TaskUploadPage`。
- 空学生或空题目显示短恢复态，可回到 S01 重新添加作答。

## 6. 代码范围

- 页面：`frontend/app/src/routes/tasks/SubmissionReviewOverviewPage.tsx`
- 可复用确定性选择器与事实统计：`frontend/app/src/lib/submissionReview.ts`
- lazy route 与旧路径兼容：`frontend/app/src/main.tsx`
- 全局阶段目的地：`frontend/app/src/lib/taskFlow.ts`
- S01/S02 完成连接：`AddSubmissionsPage.tsx`、`SubmissionRecognitionProgressPage.tsx`
- 中英双语：`frontend/app/src/i18n/messages.ts`

本阶段没有修改后端模型或持久化，也没有复用遗留 `SubmissionReviewMatrix` 的可见布局。

## 7. 验收证据

### 7.1 自动检查

- `npm run lint`：通过；visible-scope audit 扫描 `69` 个可见源文件。
- TypeScript：通过。
- Vite production build：通过，`470 modules transformed`。
- `git diff --check`：通过。

### 7.2 浏览器检查

验收使用本地匿名固定 fixture `T_s03_visual`：4 名学生、5 道题，覆盖正常、识别标记、空白、缺失和身份待复核。fixture 只由临时本地 API 返回，没有上传用户文件、调用真实 provider 或改写真实 TaskStore。

- 桌面：`S03_submission_review_overview_1440x900.png`
  - 标题、七步流程、四张大号指标、独占过滤行、`42px` 表头和 `52px` 数据行均在首屏。
  - 主体保持大面积空白，没有恢复旧长页。
- 移动：`S03_submission_review_overview_390x844.png`
  - 指标两列、筛选纵排、矩阵内部横向滚动。
- 交互：输入 `Q4 缺失` 后只返回该题空白/缺失的两名学生；清空后恢复完整矩阵。
- 控制台：`0 errors / 0 warnings`。

视觉证据保存在 Codex 临时可视化目录，不进入产品仓库。

## 8. 已知边界与下一阶段

1. S04 负责单个学生的身份摘要、身份修正和全部题目长视图；S03 不追加编辑器。
2. S05 才负责学生 × 题目的聚焦校对、双维搜索和键盘方向切换；当前单元格只把题目上下文传给 S04。
3. 后续更新：S04 已补齐真实身份修正 endpoint，使用 owner 校验、`submissions_ready` 状态门、NFKC/casefold 重复学号检查和 workflow CAS；S03 仍只负责分流，不内嵌身份表单。
4. OCR/vision、持久数据库、真正语义 SmartQuery 和可靠逐格置信度仍未实现，不在本阶段宣称支持。
