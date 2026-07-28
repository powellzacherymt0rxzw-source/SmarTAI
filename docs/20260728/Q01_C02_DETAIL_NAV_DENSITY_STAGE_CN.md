# Q01 / C02 / 详情导航密度阶段记录

> 日期：2026-07-28
>
> 分支：`codex/figma-first-frontend-redesign`
>
> 状态：代码、契约测试、构建与代表性桌面视觉验收完成；等待用户主观确认。

## 1. 本阶段结果

- Q01 单来源上传不再被过大的留白拉成长页：只压缩几何间距，不缩小主要字体、表单或点击区域。
- 评分标准支持“上传文件 / 自然语言描述 / 课程资料库”三种真实来源；自然语言可选择“按题描述”或“整体规则”，统一交给 SmarTAI 题目准备 Job 对齐标答步骤。
- C02 批改摘要的自动开始等待从 5 秒改为 10 秒，让教师有更充足时间浏览摘要；“立即开始批改”仍可跳过等待。
- 校对作答、复核批改、结果学生详情把当前学生统一显示为醒目的 `学号 · 姓名` 单行；上一位/下一位保持较弱层级，搜索栏弹性收窄。

## 2. 后端一次做对的合同

- `ProblemSourceDraft.source_kind` 与 provenance 增加 `inline_text`，不使用虚构上传文件混淆来源。
- preflight 要求 `file / library_material_id / inline_text` 恰好一个；文字来源仅限 rubric，不能勾选直接保存资料库。
- 前后端共同限制 12,000 字；服务端超限返回 `413` 与 `inline_rubric_character_limit_exceeded`。
- 文字内容仍生成 hash、绑定 owner/task/workflow revision，并进入现有统一 Job、幂等指纹和过期校验，不新开旁路。

## 3. 视觉约束与验收

- `1920×1080`：单题目文件页面 `documentHeight = viewportHeight = 1080`，主操作区底边 `889px`；无水平溢出。
- 同尺寸下，自然语言评分标准输入、范围选择和统一识别主操作均在首屏，输入后资料计数由 0 更新为 1。
- `1280×720` 不强行塞满首屏；保留自然滚动以避免卡片过密、字号过小或按钮难点。
- 视觉证据：
  - `/Users/annie/.codex/visualizations/2026/07/28/smartai-q01-compact-upload.png`
  - `/Users/annie/.codex/visualizations/2026/07/28/smartai-q01-natural-language-rubric.png`

## 4. 工程证据与边界

- 前端：`npm run lint`、TypeScript 与 Vite production build通过。
- 后端：`backend/tests/test_problem_sources_contract.py` 共 13 项通过，覆盖文字来源成功、角色隔离、多来源冲突与安全限制。
- 本地浏览器只上传仓库测试题目文本并填写本地评分规则；没有点击识别/批改，没有调用 provider。
- 后端重启后旧任务的学生/复核数据未保留，符合当前内存存储边界；因此三个详情导航只记录组件、类型与构建验证，不冒充带数据浏览器截图。持久化仍是后端后续工作。
