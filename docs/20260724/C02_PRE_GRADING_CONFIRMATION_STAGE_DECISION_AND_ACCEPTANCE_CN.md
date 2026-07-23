# C02 批改前确认阶段决定与验收记录（2026-07-24）

## 1. 阶段结论

本阶段完成 C02“批改前确认”的独立只读页面：教师在触发有成本的批改任务前，一屏复核真实题目/学生覆盖、任务级专家组合、评分策略和风险；所有修改返回已有专精页面，不在这里复制表单。

- canonical route：`/tasks/:id/grading/preflight`
- Figma 文件：`64TupCQCKXkiT5uxeQY0iH`
- Figma 12 节点：`1:855`
- 本地导出：`docs/20260710/figma/12 Pre-Grading Confirmation 批改前确认.png`
- 当前状态：代码、真实启动链、工程检查和桌面/移动浏览器验收完成，等待用户视觉确认，因此 tracker 保持 `[~]`
- 下一阶段：C03“批改进度”独立页

## 2. Figma 像素级约束

桌面 `1440×900` 实测几何与 Figma 12 对齐：

| 元素 | 实测 |
| --- | --- |
| 标题 | `(70, 105)` |
| 主内容 | `x=170`，宽 `1100px` |
| 任务摘要 | `y=219`，`1100×130` |
| 专家组合 | `y=379`，`1100×135` |
| 评分策略 | `y=544`，`1100×135` |
| 风险短条 | `y=709`，`1100×62` |
| 开始按钮 | `right=1270`，`y=793`，`180×40` |

保留 Figma 的大留白、单层圆角卡、少量蓝/绿/黄状态色和七步流程。根据用户已经确认的全局导航规则，未实现 Figma 顶栏内重复的 `Ready to grade` 页面状态胶囊；真实模型摘要和用户名菜单仍位于全局顶栏右侧。

## 3. 数据与交互边界

1. 任务摘要来自 `GET /tasks/:id`：题目数、学生数、评分标准、标答和编程题测试样例覆盖率，不伪造页数、置信度或 ETA。
2. 专家组合和策略来自 `GET /tasks/:id/grading-setup` 保存快照：只展示所选 provider、综合方式、严格度、部分分、低置信阈值和评语长度。
3. 覆盖率胶囊全部可点击，分别返回题目总览或作答矩阵；“修改批改设置”返回 C01。
4. 风险只依据真实缺失字段、作答 flag/空白、身份待确认及后端 `task_knowledge_empty` warning；无风险时显示通过状态。
5. 主按钮调用既有幂等合同 `POST /tasks/:id/grade`：`started / already_running` 进入 C03，`already_done` 进入结果；错误不改写任务数据。
6. 未保存任务级设置、所选 provider 不可用、readiness 阻断、题目/学生为空或状态不是 `submissions_ready` 时禁止启动，并给出可行动的原因。
7. S03 作答矩阵页底部新增明确的 C02 主入口；工作台/历史任务仍由统一 destination resolver 恢复真实状态。

## 4. 路由与阶段迁移

- `submissions_ready`：S03 → C02。
- `grading`：统一 destination 改为 `/tasks/:id/grading/progress`。
- C02 遇到已经进入 `grading` 的任务直接去 C03；其他不合法状态使用统一 `getTaskDestination` 恢复。
- 本提交为 C03 route 临时复用旧结果/进度容器，保证 C02 启动后没有 404；下一独立阶段会用 Figma 13 页面完整替换该 route。

## 5. 验收证据

### 工程

- `npm run lint`：通过；visible-scope audit 扫描 `72` 个可见源文件。
- TypeScript：通过。
- `npm run build`：通过；Vite production build `477 modules transformed`。
- `git diff --check`：提交前通过。

### 浏览器

使用本地匿名内存 fixture `T_c02visual`，含 8 道题、44 名匿名学生、2 个任务级专家及完整评分资料；未上传用户文件、未调用真实 provider、未写入持久存储。

- 桌面：`C02-pre-grading-confirmation-desktop-viewport.png`；四块主区域与按钮几何见第 2 节，`scrollWidth=1440`、`scrollHeight=900`。
- 移动：`C02-pre-grading-confirmation-mobile.png`；`390×844` 下单列重排，主卡 `x=20 / width=350`，页面无横向溢出。
- 交互：唯一“开始批改”按钮调用 fixture 幂等启动合同并进入 `/tasks/T_c02visual/grading/progress`。
- 控制台：桌面/移动均 `0 errors / 0 warnings`。

PNG 只保存在 Codex 临时可视化目录，不进入产品仓库。

## 6. 下一阶段硬门

1. C03 只显示实时进度、当前阶段、事实计数、可安全离开和失败恢复，不把 C02 摘要或旧结果页塞回来。
2. C03 必须直接对齐 Figma 13 `1:929`，并使用已有 `GET /tasks/:id/state` 与 `ProgressReporter` 数据。
3. `graded` 完成后进入 R01 `/review`，不能直接把待复核结果当作正式 `/results`。
