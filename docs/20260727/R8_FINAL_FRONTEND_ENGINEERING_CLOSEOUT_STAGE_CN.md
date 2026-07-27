# R8 前端工程收口与最终确定性回归

> 日期：2026-07-27
>
> 状态：Figma 01–17 与讨论补充的教师主流程已有 canonical 实现；确定性工程回归完成，等待用户逐页视觉签收和外部能力验收

## 1. 收口结论

- 当前没有尚未搭建的教师主流程页面。工作台、历史、新建任务、题目与资料、作答、批改、复核、正式结果五个子页、BYOK、账户与课程资料库均有唯一或明确兼容的 canonical route。
- Figma 16 的正式结果工作区固定为顶部五个大入口：总览、题目分析、学生分析、可视化分析、报告与下载。
- A03 题目详情和 A05 学生详情共用同一题号目录、搜索语言、中文输入法门禁与上一题/下一题行为；结果工作区不再用局部导航占用左侧目录空间。
- Figma 17 的失败状态由同一分类器和恢复卡处理；不会因异常清空教师已上传资料或输入内容。
- 被新页面替代的可见旧 UI 与旧学生结果 route 已删除；后端仍保留的兼容 API 不等于旧前端页面。

## 2. 自动回归证据

### 前端

- `npm run lint`：visible-scope 审计扫描 69 个用户可见源文件，TypeScript 通过。
- `npm run build`：Vite production build 通过，`934 modules transformed`。
- `git diff --check`：通过。

### 后端

- 全量：`235 passed, 1 skipped, 22 warnings`。
- 其中定向的新建/历史/正式结果/报告/图表安全合同：`32 passed, 4 warnings`。
- warning 为 FastAPI/HTTP 状态常量的既有弃用提示，不是本轮测试失败。

### 本地浏览器

- 以下五个 route 均显示同一组顶部大入口，页面无加载失败：
  - `/tasks/T_81f35fb076/results`
  - `/tasks/T_81f35fb076/results/questions`
  - `/tasks/T_81f35fb076/results/students`
  - `/tasks/T_81f35fb076/results/visualizations`
  - `/tasks/T_81f35fb076/results/reports`
- A03 与 A05 均有题目搜索、题号目录和上一题/下一题；A05 同时保留独立学生切换。
- 不存在任务的正式结果 route 实际渲染共享恢复卡，显示友好摘要、重读/返回动作与折叠技术信息，不显示秘密或原始日志。
- 本轮控制台只有 Vite debug 与 React DevTools info，无 error/warning；没有调用真实 provider。

## 3. QA 清单收口

- QA-04 已完成：学期月份边界、课程可为空、owner-scoped 课程/标签、规范化去重、并发唯一、exact/related/歧义与强制新建均有合同测试。
- QA-06 工程侧已完成解释、清空、无匹配、中文 composition 和通用错误恢复；真正语义/拼音与超大班级服务端查询仍依赖 SmartQuery 后端能力。
- QA-07 已覆盖图表类型白名单、正式结果版本、产物幂等/历史版本、真实单项与 ZIP 下载，以及既有浏览器 PNG/打印证据；空数据与单学生/单题仍需专门 fixture 做视觉抽查，因此保持部分完成。
- QA-08 的前端与隔离安全合同已完成；真实 provider 成功/限流以及重启后持久化不是纯前端可闭环项。

## 4. 不应冒充完成的外部边界

- 真实 Gemini/OpenAI 等 provider 的低成本成功、quota 和限流回放。
- 图片、扫描件与手写 OCR；当前只支持可复制文字资料。
- PostgreSQL、对象存储以及重启后 Task/BYOK/版本化产物持久化。
- 真正语义/拼音 SmartQuery、大班级服务端筛选与学生标签数据合同。
- 原生 200% 缩放、VoiceOver/NVDA 和用户逐页 Figma 主观视觉签收。

这些边界不会再通过前端占位按钮或假状态掩盖；具备后端能力后，可沿现有 canonical route 和共享状态组件接入。
