# 前端文档审计与后端交接收口记录

> 日期：2026-07-28
> 分支：`codex/figma-first-frontend-redesign`
> 本轮范围：只核对既有产品/实施文档与当前代码，不再进行 Figma 逐帧复核

## 1. 本轮结论

- 教师端 canonical 页面与主要交互已经全部实现，没有尚未搭建的主流程页面。
- 当前可称为“教师端前端工程实现完成”；不能把 OCR、持久化、真正语义 SmartQuery、真实 provider 验收和结构化 rubric 冒充为完成。
- 旧 tracker 中仍有少量已被后续产品决定覆盖的文字。本轮已纠正：
  - C02 从 5 秒改为最终 10 秒摘要等待；
  - D-09、Figma 15、A05 删除“单题/全部”双模式，统一为单学生全题连续视图；
  - `UI-SHELL-06/07/08` 按当前共享 stepper、题号目录、矩阵和选择组件标记完成；
  - BE-AI-06/07 与 BE-PREP-01/02 按实际工程边界从“未开始”更新为“部分完成”。
- 用户本轮明确不再要求 Figma 核对，因此 QA-09 只保留为历史验收项，不计入代码完整度。

## 2. 已确认不存在的前端缺口

- 顶部八步流程、已完成阶段回溯和未来阶段门禁。
- 工作台、历史、任务创建/编辑、课程/标签、课程资料库、BYOK/账户。
- 四类题目资料上传、自然语言评分标准、能力/格式提示、统一 Job 和进度恢复。
- 风险矩阵、题号侧栏、连续题目审核、LaTeX 浏览/源码编辑。
- 作答上传/进度、学生×题目矩阵、连续作答校对与已复核状态。
- 批改设置、10 秒只读摘要、幂等启动和批改进度。
- 复核矩阵、队列、连续复核详情、教师分数/评语覆盖。
- 结果总览、题目分析、学生分析、可视化、报告与下载五个子页。
- 中文输入法门禁、学生/题目双维导航、方向键、错误恢复和安全 returnTo。

## 3. 仍需完成但不属于缺页的工作

### 3.1 后端能力

- PostgreSQL、对象存储、BYOK/RAG/artifact 持久化。
- OCR/vision/scanned PDF/image/DOCX provider abstraction。
- `SolutionStep ↔ RubricItem` 结构化合同及更细粒度评分标准生成。
- 持久 issue repository、字段级 CAS、confirm-all 后端门禁和题目资料导出。
- SmartQuery 统一 schema、真正语义/拼音、大班级全量服务端查询。
- 工作台聚合优先级、多任务并行摘要和可信 ETA。
- 持久自定义图表、异步分析 artifact 与 AI heatmap 安全 schema。
- 真实 provider 成功、quota、rate limit 和 timeout 重放。

### 3.2 外部/人工验收

- 原生 200% 缩放与 VoiceOver/NVDA。
- 空数据、单学生、单题极端 fixture 的专项视觉抽查。
- 用户最终逐页签收。Figma 对照在本轮由用户明确豁免。

以上项目不需要再搭页面；后端完成后沿现有 API/type/capability/progress 合同接入。

## 4. 新增交接文档

1. `docs/20260728/FRONTEND_BACKEND_INTEGRATION_GUIDE_CN.md`
   - 面向人阅读；说明前端完成度、route、API/type 文件、当前/缺失合同、评分标准问题和联调清单。
2. `docs/20260728/BACKEND_AGENT_IMPLEMENTATION_HANDOFF_CN.md`
   - 面向后端 AI Agent；说明保护边界、目标 schema、API、OCR、SmartQuery、repository/persistence、实施波次、测试和停手条件。

## 5. Q02 最后工程收口

- 外层 `question_preparation` Job 独占进度 lifecycle；嵌套提取不再重置八阶段合同。
- `JobProgress` v1 增加 `job_id/workflow/stage_sequence`，阶段与完成数受单调约束。
- Q02 按 active Job 和后端阶段序列恢复；未知未来 OCR 阶段不会把页面重置到第一步。
- Q01 读取后端 capabilities；当前如实支持文字型 PDF/TXT/MD、测试 JSON 和 rubric 自然语言，不声称 OCR/图片/DOCX 可用。

## 6. 验证基线

- 前端 lint/typecheck：通过（visible-scope 共扫描 72 个用户可见源码文件）。
- Vite production build：通过（939 modules transformed）。
- 后端 Q01/Q02 相关回归：`59 passed, 1 skipped`。
- 后端全量：`242 passed, 1 skipped`。
- `git diff --check`：通过。

本阶段只新增/更新合同、实现和文档；不消费真实 provider，不写入真实密钥。
