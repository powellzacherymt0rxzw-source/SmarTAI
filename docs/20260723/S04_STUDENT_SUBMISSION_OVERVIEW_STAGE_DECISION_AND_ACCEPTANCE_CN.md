# S04 学生作答总览阶段决定与验收记录（2026-07-23）

## 1. 阶段结论

本阶段完成 S04“学生作答总览”：从 S03 学生 × 题目矩阵进入一名学生，确认身份、查看全题作答、快速切换学生/题目并按题目语义或真实识别状态筛选。

- canonical route：`/tasks/:id/students/:studentId`
- Figma 文件：`64TupCQCKXkiT5uxeQY0iH`
- 可见基线：Figma 11 节点 `1:740` 的指标、筛选和矩阵语言
- 当前状态：代码、真实身份修正 API、工程检查和桌面/移动浏览器验收完成，等待用户视觉确认，因此 tracker 保持 `[~]`
- 后续更新：S05 单份作答校对已于 2026-07-24 完成工程与浏览器验收；当前下一阶段为 C02 批改前确认

Figma 没有单独画 S04，旧文档又明确要求把“矩阵总览、单个学生全部作答、单个学生单道题编辑”拆成不同页面。因此本页不复制旧长工作区，也不把 S05 的编辑器、双维搜索和方向键全部提前堆入；它只完成一个学生的身份与整份作答总览。

## 2. Figma 对齐与页面结构

### 2.1 桌面

继续使用 Figma 11 的 `1440×900` 骨架：

| 区域 | 目标 |
|---|---|
| 顶栏/标题/流程 | 共用 `70px` 顶栏，标题约 `(70,105)`，七步流程约 `(70,155)`，当前第 3 步“作答” |
| 大号指标 | 四张 `90px` 高圆角矩形：身份、覆盖、待复核题次、来源文件 |
| 学生导航 | 单一 `52px` 平面栏：上一位、学生直选、下一位、题目定位、身份修正 |
| 题目筛选 | 独占一行 `48px` 搜索框，保持用户对 Q03 的最新视觉纠正 |
| 全部作答 | 单一平面列表；每题只显示题号/题型/简短题干、真实状态和完整识别内容 |

主题色和状态色与 S03 一致；身份修正默认收起，展开后是独立浅黄短表单，不混入答案列表。桌面 `1440×900` 首屏可见四张指标、学生导航、独占搜索行以及前三题开头；继续滚动仅因为真实答案需要完整展示，符合“文件内容本身多时允许滚动”的例外。

### 2.2 移动端

- 标题保持完整，不与“返回作答矩阵”重叠。
- 四张指标两列重排，事实值与说明分两行，避免省略关键状态。
- 上一位/下一位同一行；学生、题目和身份修正各自整行。
- 页面 `innerWidth=document/body scrollWidth=390`，没有页面级横向溢出。
- 题目列表继续纵向展开，不用横向小卡压缩长答案。

## 3. 页面职责与交互

### 3.1 学生与题目导航

- 学生选择器显示 `学号 · 姓名`；上一位/下一位按钮同时显示相邻学生姓名并提供完整读屏名称。
- 题目选择器可定位任意题；从 S03 单元格进入时携带 `?question=:qId`，S04 会高亮并滚动到该题。
- 切换学生时保留题目定位和题目筛选参数，两个维度不会互相清空。
- S05 已实现聚焦单题编辑、学生/题目双智能选择器以及左右/上下方向键；S04 每题现提供真实“校对此题”入口，但仍不内嵌 S05 编辑器。

### 3.2 题目智能筛选

当前学生固定不变，筛选支持：

- 题号、题型、题干关键词。
- 已识别作答内容关键词。
- `缺失 / 空白 / 未作答`。
- `待复核 / 异常 / 低置信`；“低置信”仍只映射到真实 `flag`，不伪造置信度值。
- `已识别 / 正常`。

规则在浏览器本地确定性执行并显示解释，零 provider 调用；输入“积分题”实测只保留 Q4，当前学生路径不变。

## 4. 真实身份修正合同

新增：

```text
PUT /tasks/{task_id}/students/{stu_id}/identity
```

请求包含：

- `expected_workflow_revision`
- `student_id`
- `student_name`

安全与一致性：

1. 只允许 task owner 或 admin；普通教师不能修改其他用户任务。
2. 只允许 `submissions_ready`，批改开始后拒绝，避免更换字典 key 后孤立既有 grade result。
3. 活跃 workflow 统一返回 `task_workflow_busy`。
4. 学号/姓名先 NFKC、首尾空白与姓名连续空白规范化；空值拒绝。
5. 学号按 casefold 检查当前任务内重复，冲突不覆盖另一名学生。
6. 使用 `expected_workflow_revision` + `TaskStore.update_workflow_cas`；并发变化返回 `task_workflow_changed`。
7. 修改学号时原位置换 key，保留作答、flag、来源文件和顺序；成功后身份标记为 `matched / manual_review`。
8. INFO 日志只记录 task 与执行教师，不记录旧/新学号或姓名。

前端 mutation 先原子更新当前 task query 的学生 key，再失效刷新 task/list/state/result；改学号后用 replace 导航到新 canonical URL，不闪现过期“学生不存在”。

## 5. 路由与产品边界

- route 位于受 `RequireTeacherSession` 保护的 `/tasks/*` 下，是教师审核学生作答，不是学生端 workspace。
- visible-scope audit 只对白名单精确 route `tasks/:taskId/students/:studentId` 放行；`/student` 仍只显示学生端未开放说明，其他 student route 继续失败。
- 非 `submissions_ready` 任务由统一 `getTaskDestination` 回到真实阶段。
- 学生不存在时显示短恢复态并返回 S03；可能原因包括身份刚被改名或旧链接过期。
- OCR/vision、持久数据库和可靠识别置信度仍未实现。

## 6. 代码范围

### 后端

- 请求模型与 endpoint：`backend/api/tasks.py`
- 合同测试：`backend/tests/test_s04_student_review.py`

### 前端

- 页面：`frontend/app/src/routes/tasks/StudentSubmissionOverviewPage.tsx`
- route/lazy loading：`frontend/app/src/main.tsx`
- API、mutation 与 task query 原子更新：`frontend/app/src/api/tasks.ts`、`frontend/app/src/api/hooks/tasks.ts`
- 类型：`frontend/app/src/types/task.ts`
- 中英双语：`frontend/app/src/i18n/messages.ts`
- 教师 route 可见范围白名单：`frontend/app/scripts/audit-visible-scope.mjs`

S03 的事实状态 helper 继续复用；没有复用遗留 `TaskUploadPage` 或旧结果详情页的可见布局。

## 7. 验收证据

### 7.1 自动检查

- S04 身份合同 + 活跃工作流回归：`12 passed, 2 warnings`；warnings 为 FastAPI 既有 lifespan deprecation。
- `npm run lint`：通过；visible-scope audit 扫描 `70` 个可见源文件。
- TypeScript：通过。
- Vite production build：通过，`471 modules transformed`。
- `git diff --check`：通过。

### 7.2 浏览器检查

匿名固定 fixture：4 名学生、5 道题；选中身份待确认的 PB2025003，覆盖已识别、缺失和 flag。没有上传用户文件、调用真实 provider 或改写真实 TaskStore。

- 桌面：`S04_student_submission_overview_1440x900.png`
  - Figma 11 式四指标、平面导航、独占搜索行和全部作答列表。
  - `innerWidth=document/body scrollWidth=1440`。
- 移动：`S04_student_submission_overview_390x844.png`
  - 完整标题、两列指标、合并的上一位/下一位、独占学生/题目/身份操作。
  - `innerWidth=document/body scrollWidth=390`。
- 真实 UI 合同：把 `PB2025003` 修正为 `PB2025003A` 后 URL 自动 replace，身份变为已匹配，5 个题目 article 和原答案保持不变。
- 筛选：输入“积分题”后只保留 Q4，学生 URL 保持不变。
- 干净页面控制台：`0 errors / 0 warnings`。

视觉证据保存在 Codex 临时可视化目录，不进入产品仓库。

## 8. S05 交付边界（2026-07-24 已完成）

S05 已继续拆页并满足以下既有硬规则：

1. 学生和题目是两个互不干扰的智能选择维度。
2. 左右键切学生、上下键切题目；输入框/文本域/select/弹窗聚焦时不拦截。
3. 顶部负责学生切换；题目切换在内容顶部和底部均可用。
4. 只编辑当前学生 × 当前题目的识别内容和 flag，不重复身份修正或整份长视图。
5. 从 S03 单元格和 S04 题目进入时保留精确上下文；从 S04“全部题目”入口返回时不丢筛选。
