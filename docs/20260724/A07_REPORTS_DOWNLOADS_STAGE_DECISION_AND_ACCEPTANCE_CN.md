# A07 报告与下载：阶段决定与验收记录

> 日期：2026-07-24  
> Route：`/tasks/:id/results/reports`  
> 视觉基线：Figma 16 正式结果工作区、Figma 14 大号指标卡与既定克制配色  
> 状态：实现、版本合同、工程检查及桌面/移动浏览器验收完成，等待用户视觉确认

## 1. 页面与真实产物

A07 已完全替换“报告尚未生成”占位页。页面只处理正式结果版本的文件生成、状态和下载，不重复题目、学生或图表分析内容。

当前版本生成以下五种真实文件：

1. 成绩表 CSV：使用教师最终分，含总分、得分率和逐题分数，带 UTF-8 BOM 便于表格软件读取。
2. 学情报告 Markdown：确定性汇总学生数、题目数、平均/中位得分率、及格率、逐题表现和学生成绩；明确不包含 AI 自动推断的教学结论。
3. 发布版标答 Markdown：按题汇总题干、评分标准和参考答案。
4. 发布版标答 LaTeX：同一内容的可编译 `ctexart` 源文件；原始题目资料放入安全 verbatim 区域。
5. 正式结果 JSON：包含 schema、任务、版本、确认时间、生成时间、指纹和完整不可变结果快照。

“下载全部 ZIP”由后端真实打包上述五项并附 `manifest.json`；单项下载与 ZIP 都在 HTTP 响应中携带明确 result version，不使用前端伪文件。

## 2. 版本、幂等与历史安全

- 后端新增 `GradingJob.result_artifacts`，仅保存按正式版本索引的 manifest 元数据；文件字节每次从不可变 snapshot 确定性重建，不再保存一份可漂移的学生结果副本。
- 生成指纹绑定正式结果 fingerprint、artifact schema 与任务名；相同版本重复请求返回 `already_done / unchanged=true`，不会制造重复副本，也不调用模型。
- 当前版本生成成功后才将任务更新为 `finalized`，并把 `analysis_status=ready`、`analysis_result_version` 和 `analysis_generated_at` 绑定到同一版本。
- 新正式版本产生后，旧 manifest 仍留在原版本；索引将其明确标为“旧版本 / historical”。当前版本没有文件时绝不回退下载旧版。
- 历史 ZIP 只能从折叠的历史区主动选择，并在下载前再次确认“不会替代当前版本”。后端下载 URL 也必须显式携带版本号。
- 所有索引、生成和下载 API 均执行 task owner/admin 检查；不能跨教师读取文件。

## 3. 页面结构

- 顶部四张独立指标卡：当前正式版本、文件状态、可下载文件数、生成时间。
- 未生成时只显示一个短生成门；列明五种产物且强调零 provider。
- 已生成时显示单一“下载全部 ZIP”主操作和五行文件表；每行仅保留图标、用途、格式、大小、版本与下载。
- 历史版本默认折叠，避免长页和误操作；当前无历史时显示简洁空状态。
- 从可视化等深页面切换局部导航时会回到页首，修复 SPA 保留旧 scroll position 导致新页面从中段开始的问题。
- Reports 页面独立懒加载；结果工作区主 chunk 没有因 A07 增长。

## 4. API 合同

- `GET /tasks/:id/artifacts`：零生成地列出当前/历史版本、状态、生成时间与文件 metadata。
- `POST /tasks/:id/artifacts/generate`：以 `expected_workflow_revision` 做 CAS；仅针对最新、已确认且非 dirty 的正式结果同步生成 manifest。
- `GET /tasks/:id/artifacts/:version/:artifact_id`：显式版本的单项下载；`artifact_id=bundle` 返回 ZIP。
- 下载时重建内容并校验 SHA-256 与 manifest；不一致时返回明确冲突，不静默下载。
- 当前仍是项目既有的进程内 Task/JobStore；服务重启会丢失正式版本和 manifest。A07 没有冒充 PostgreSQL/对象存储持久化。

## 5. 工程与浏览器证据

- 后端 A00/A07/tasks 合并定向回归：`24 passed, 2 warnings`；警告仅为既有 FastAPI lifespan deprecation。
- A07 单独合同覆盖：生成、幂等、教师最终分 CSV、真实 ZIP、五项文件、owner 隔离、未生成 409、v2 后 v1 historical 和禁止当前版回退。
- `npm run lint`：通过；81 个可见源文件审计通过，TypeScript 无错误。
- `npm run build`：通过；`939 modules transformed`。`ReportsDownloadsPage` 独立 chunk `15.02 kB`（gzip `5.30 kB`），结果工作区主 chunk `104.62 kB`（gzip `27.10 kB`）。
- `git diff --check`：通过。
- 桌面：`A07-reports-downloads-desktop.png`（1440×900），页面 `innerWidth/scrollWidth=1440/1440`，完整高约 1028px。
- 移动：`A07-reports-downloads-mobile.png`（390×844），页面 `innerWidth/scrollWidth=390/390`，完整高约 1257px，切页后 `scrollY=0`。
- 浏览器实测未生成 → 点击生成 → 5 个文件/ZIP ready；单项与 ZIP 下载均无错误提示。fixture 匿名、未调用 provider。
- 浏览器插件出现的 Statsig 外网超时来自 Codex 插件遥测，不是 SmarTAI 控制台或应用请求错误。

## 6. 阶段边界与下一门

A00-A07 的正式结果工作区五个入口已经工程闭环。后续不继续在 A07 叠加 AI 长报告、文件预览器或分享发布；下一步应先读取官方周额度，再选择最有价值的全流程 QA/遗留可见 UI 清理阶段。任何数据库、对象存储、后台长任务与 AI 叙事报告都应单独建立后端阶段和真实进度合同。

