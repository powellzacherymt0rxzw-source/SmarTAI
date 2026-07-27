# R9 SmarTAI 智能能力品牌化与可视化首屏调整

> 日期：2026-07-28
>
> 状态：已完成代码、静态检查、生产构建和真实本地任务浏览器验收

## 1. 本阶段目标

- 将结果工作区的“自然语言生成更多图表”提前到所有默认图表之前，使 SmarTAI 的自然语言分析能力成为可视化页首要入口。
- 将自然语言图表、跨字段筛选、模糊匹配和模型补全等真实智能能力统一冠以 `SmarTAI`，避免产品特色被泛化成无归属的“AI”。
- 继续遵守 Figma 的克制风格：只给首要 SmarTAI 能力使用一张浅蓝强调卡、一个品牌色图标和少量高亮；默认图表保持安静，不增加多余颜色和装饰。

## 2. 设计与文案决策

### 2.1 可视化分析

- 页面顺序固定为：标题与数据范围 → 指标摘要 → `SmarTAI 自然语言生成更多图表` → 已保存的自定义图表 → 五张默认图表。
- 建议词、请求输入框、加载状态和提交按钮统一使用 SmarTAI 命名。
- 明确提示每次提交才调用模型，默认图表不消耗模型额度；本阶段没有改变 API、调用次数或图表类型白名单。

### 2.2 全站智能能力命名

以下能力统一使用 `SmarTAI 智能搜索 / 智能筛选 / 智能匹配`：

- 新建任务中的课程、标签模糊匹配；
- 历史任务自然语言筛选；
- 题目资料、学生作答、复核结果和正式结果中的跨字段筛选；
- 结果工作区的题目分析与学生分析自然语言筛选；
- SmarTAI 生成、补全、批改结果及其进度状态。

普通文件名、资料名、标签名等纯关键词查找继续显示为普通“搜索”，不把本地字符串匹配错误宣传成智能能力。

## 3. 代码范围

- `frontend/app/src/routes/tasks/results/VisualizationAnalysisPage.tsx`
- `frontend/app/src/i18n/messages.ts`
- `frontend/app/src/lib/{aiCompletionCopy,reviewOverviewCopy}.ts`
- `frontend/app/src/components/auth/AuthFrame.tsx`
- `frontend/app/src/routes/LoginPage.tsx`
- 题目准备、作答校对、复核详情与结果分析相关页面的可见文案

## 4. 验收记录

### 4.1 工程检查

- `npm run lint`：通过；visible-scope 审计扫描 72 个用户可见源文件，TypeScript 检查通过。
- `npm run build`：通过；Vite production build 共转换 938 个模块。
- `git diff --check`：通过。

### 4.2 浏览器验收

- 原指定任务 `T_81f35fb076` 已随内存后端重启消失；未伪造该任务数据。
- 使用同一教师测试账号下仍存在的正式结果任务 `T_39aca252a1`，在 `/tasks/T_39aca252a1/results/visualizations` 完成等价验收。
- DOM 与屏幕位置确认：SmarTAI 自然语言图表区标题位于 `283px`，第一组默认图表标题从 `631px` 开始，顺序正确。
- 点击“比较各题得分率与低置信题次”后，请求输入框正确更新为同一文本。
- 浏览器控制台无 error 或 warning。
- 首屏截图：`/Users/annie/.codex/visualizations/2026/07/10/019f4bff-e585-7e73-b58f-eee15957dfee/20260728-smartai-visualization-first-fold.png`。

## 5. 保持不变的边界

- 本轮仅调整前端信息层级和可见命名，不修改后端数据结构、鉴权、模型路由、额度策略或分析合同。
- “SmarTAI 智能搜索”仍使用各页面既有的本地可解释规则或已接入的查询能力；没有后端语义检索能力的地方不新增虚假承诺。
