# K00 课程资料库后端：阶段决定与验收记录

> 日期：2026-07-24
> API：`/course-materials/*`
> 页面目标：为 Figma 09 `/knowledge-base` 提供真实数据合同
> 状态：后端实现与相关回归完成；K01 前端及视觉验收尚未开始

## 1. 阶段结论

旧课程资料库页面只保存浏览器元数据，并把“后端待接”暴露给教师，不能继续作为 Figma 09 的数据源。K00 先补齐独立、owner-scoped 的真实课程资料库合同；K01 才重写可见页面，避免前端再次用 fixture 或禁用按钮冒充功能。

本阶段没有新页面，因此没有用截图替代 API 验收，也没有改变 Figma 09 的布局。

## 2. 已实现能力

- 真实上传 PDF、TXT、Markdown，复用 Q01/Q08 的严格解析边界；扫描 PDF、图片、DOCX 和 OCR 仍明确不支持。
- 原始上传字节校验后立即释放；服务端仅保存解析文本和安全元数据，列表不会返回正文、owner 或 key。
- 同一教师、同一课程、同一 SHA-256 内容原子去重；返回稳定 `material_id` 和 `created`，不制造重复文件。
- 文件支持可选课程、资料分组、分类、最多 20 个规范化标签、改名、移动、筛选、分页和确定性查找。
- 分组支持可选课程、完全匹配复用、词法相近候选、显式 `force_create`、改名和删除；删除分组只把文件移到“未分组”，不删除内容。
- 文件、分组和课程引用均按教师隔离；跨教师读取、修改和删除统一返回 404，不泄露资源存在性。
- Q01/Q08 选用资料后记录真实任务引用和最近使用时间；有引用的文件默认禁止删除，教师显式确认后才可删除。删除任务会解除对应引用，避免残留引用永久锁死文件。
- 列表返回真实文件数、分组数、已解析数、被任务引用数，以及 `durable=false / ocr=false` 能力边界。

## 3. API 合同

- `GET /course-materials/`：关键词、课程、分组/未分组、分类、分页与摘要。
- `POST /course-materials/`：真实文件上传、解析、元数据和内容去重。
- `PUT /course-materials/:material_id`：改名、课程、分组、分类和标签。
- `DELETE /course-materials/:material_id`：引用保护与显式确认删除。
- `GET /course-materials/groups`：教师分组和真实文件计数。
- `POST /course-materials/groups`：完全匹配复用、相近候选确认和新建。
- `PUT /course-materials/groups/:group_id`：改名或修改课程。
- `DELETE /course-materials/groups/:group_id`：删除分组并原子移至未分组。

搜索中的 `exact / related` 是可解释、零模型消耗的确定性匹配，不冒充拼音或语义向量检索。后续若增加语义推荐，必须保留匹配类型和新建确认门。

## 4. 数据与安全边界

- `CourseMaterialStore` 和分组仍为进程内存；服务重启、多进程或部署迁移会丢失，不宣称持久化。
- 当前没有对象存储，因此不能提供原文件下载；K01 只展示和管理真实已解析资料，不放假下载按钮。
- `parse_status=ready` 只表示文本解析完成，不表示已做向量索引。
- 已解析正文可供已有 Q01/Q08 来源流程读取；全库联合检索、跨文件 RAG 和持久索引仍是后续独立后端阶段。
- 每位教师最多 50 份资料、50 个分组、20 MiB 驻留解析文本；全局进程内驻留上限保持既有 128 MiB。

## 5. 验收证据

- `backend/tests/test_k00_course_materials.py`：覆盖分组完全/相近匹配、强制新建、真实上传、内容去重、元数据搜索和修改、课程继承、格式拒绝、引用门、任务删除解除引用、分组删除移至未分组、跨 owner 非披露。
- 与 `test_problem_sources_contract.py`、`test_q08_material_imports.py` 合并回归：`25 passed`。
- 全量后端回归：`222 passed, 1 skipped`；警告均为既有 FastAPI HTTP 常量/lifespan deprecation。
- 修改文件编译检查与 `git diff --check` 通过；项目环境未安装 Ruff，因此没有伪报 Ruff 结果。
- 全部测试零 provider 调用；没有消耗模型 API 或生成 fixture 数据。

## 6. K01 硬门

K01 只能按 `docs/20260710/figma/09 Knowledge Base 课程资料库.png` 从头替换旧页：标题和动作、整行搜索、轻量分类/分组筛选、扁平文件表格、短操作弹窗；不能恢复旧页面的嵌套卡片、浏览器元数据、教师可见“后端待接”说明或伪下载。桌面和移动浏览器验收完成前，G04 保持 `[~]`。
