# SmarTAI

> 面向高校理工科课程的 AI 智能作业批改平台。一门课程 + 一份作业 + 一批学生作答，几分钟完成初评；多 AI 协同评审，结果可追溯、可复核、可发布。

## 在线 Demo

🔗 **当前主版本在线体验**：[https://smartai-course.pages.dev](https://smartai-course.pages.dev)

🔗 **测试账号**：等待邀请发放

---

## 本地运行（开发与测试）

### 当前代码状态

当前项目由三部分组成：

- **FastAPI 后端**：`backend/`，提供认证、课程、作业、提交、批改、成绩、知识库和模型配置等 API。
- **Vite React 前端**：`frontend/app/`，为管理员、教师和学生提供各自的工作区。
- **持久化层**：SQLAlchemy + Alembic 管理 SQLite / PostgreSQL，本地文件系统和 S3 兼容对象存储负责上传文件。

### 环境分工

- **后端使用 Python 3.11 或 3.12**：FastAPI、LLM、RAG、SymPy、数据库迁移等依赖都在 Python 环境中运行。
- **React 前端使用 Node.js 20 + npm**：依赖由 `frontend/app/package-lock.json` 锁定，不需要安装任何 Python 前端包。
- **本地默认轻量模式**：SQLite 数据库位于 `data/smartai.db`，上传文件位于 `data/uploads/`。

### 准备后端 Python 环境

可以使用 Conda 创建并激活专用环境：

```bash
conda create -n smartai python=3.11
conda activate smartai
```

也可以使用标准虚拟环境：

```bash
python -m venv .venv
```

激活后请使用 `python` / `pip`，避免与系统 Python 混淆。

### 安装后端依赖

在仓库根目录执行：

```bash
python -m pip install --upgrade pip
pip install -r render-requirements.txt
```

从示例创建本地配置：

```bash
cp .env.example .env
```

Windows PowerShell 使用：

```powershell
Copy-Item .env.example .env
```

首次运行前应用数据库迁移：

```bash
alembic upgrade head
```

### 创建第一个管理员

公开注册默认关闭。首次启动前，先在仓库根目录创建管理员：

```bash
python scripts/create_admin.py admin --email admin@example.com
```

命令会交互式读取至少 10 个字符的密码。管理员登录后可以创建用户或发放邀请码。

本地联调需要一批测试账号时，可以生成被 Git 忽略的凭据文件：

```bash
python scripts/generate_test_users.py
```

### 启动后端

在仓库根目录执行：

```bash
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

后端服务监听 `8000` 端口：

- 健康检查：`http://localhost:8000/health`
- 就绪检查：`http://localhost:8000/ready`
- OpenAPI 文档：`http://localhost:8000/docs`

### 启动 React 前端

在另一终端中执行：

```bash
cd frontend/app
npm ci
npm run dev
```

浏览器打开：

```text
http://localhost:5173
```

React 前端默认连接 `http://localhost:8000`。如需指定其他后端，在 `frontend/app/.env` 中设置：

```dotenv
VITE_SMARTAI_BACKEND_URL=http://localhost:8000
```

修改后需要重启 `npm run dev` 或重新构建前端。

### 运行测试

后端测试（在仓库根目录执行）：

```bash
pip install pytest pytest-asyncio
python -m pytest backend/tests -q
```

前端检查（在 `frontend/app/` 执行）：

```bash
npm run audit:scope
npm run typecheck
npm test
npm run build
```

---

## 部署到公网

仓库已经附带后端 Render 部署配置，当前推荐组合是：

- **后端**：Render Web Service，配置文件为 `backend/render.yaml`
- **前端**：Cloudflare Pages，构建根目录为 `frontend/app`
- **数据库**：PostgreSQL
- **文件存储**：S3 兼容对象存储

后端生产启动命令会先应用迁移，再启动 FastAPI：

```bash
alembic upgrade head && uvicorn backend.main:app --host 0.0.0.0 --port $PORT
```

React 静态前端的构建配置：

```text
Root directory: frontend/app
Build command: npm ci && npm run build
Build output directory: dist
VITE_SMARTAI_BACKEND_URL=https://your-backend.example.com
```

后端生产环境至少需要正确配置：

- `SMARTAI_DATABASE_HEAVY=ON` 与 `SMARTAI_DATABASE_URL_HEAVY`
- `SMARTAI_STORAGE_BACKEND=object` 与 `SMARTAI_STORAGE_S3_*`
- `SMARTAI_PROVIDER_ENCRYPTION_KEY` 与 JWT 签名密钥
- `SMARTAI_REFRESH_COOKIE_SECURE=true`
- `SMARTAI_REFRESH_COOKIE_SAMESITE=none`
- `FRONTEND_URLS`（填写真实前端域名，不带结尾 `/`）

生产环境应设置 `SMARTAI_DATABASE_AUTO_CREATE=false`，由 `alembic upgrade head` 管理数据库结构。部署完成后访问 `/ready`，可以同时确认数据库和存储是否可用。

---

## 这是什么

SmarTAI 把“建课、布置、提交、批改、复核、发布”串成一条完整链路：

```text
管理员建账号  →  教师建课 + 布置作业  →  学生提交答案  →  AI 多专家协同评分  →  教师复核 + 发布成绩
  用户/邀请码       题目 + 评分标准         在线作答/文件       独立评分 + 分歧识别        调分/评语/正式发布
```

教师不需要写代码，也不需要把模型密钥交给平台统一保管。建好课程和作业，学生直接提交；批改完成后，教师先处理需要关注的结果，再把确认过的成绩发布给学生。

---

## 特色功能

### 🎯 多 AI 协同评分（核心亮点）

不是“一键调一次 GPT”。SmarTAI 允许用户**同时配置多家 LLM**（Gemini / OpenAI / Anthropic / 智谱 GLM），让不同模型对同一份答案独立判断，再结合分数差异、置信度和异常状态决定是否需要人工复核。

- **真并行调用** —— 多家 AI 可以同时执行，避免简单串行等待
- **原始判断可追溯** —— AI 分数、评语和批改状态分别保存，不只留下一个最终数字
- **分歧主动暴露** —— 低置信度或专家意见分歧会进入人工复核队列
- **单点失败不拖垮整批** —— 单题失败会记录为待处理结果，教师可以单独查看和处理

### 📐 四种题型，四套批改方法

不同题型里，LLM 容易犯的错完全不同。SmarTAI 按题型选择对应工具和评分流程：

| 题型 | 处理方法 |
| --- | --- |
| **概念题** | 知识检索 + 结构化评分 + 依据说明 |
| **计算题** | SymPy 数值/符号验证 + LLM 步骤评分 |
| **编程题** | Python 沙箱运行测试用例 + LLM 代码评价 |
| **证明题/推理题** | 分步骤分析 + 知识检索 + 长答案处理 |

> 程序“跑起来对不对”和计算“验算能不能通过”尽量交给确定性工具；LLM 负责理解过程与表达。这比只让模型凭感觉看答案更可靠。

### 🔑 BYOK（自带 API Key）

用户自己配置 API Key，token 费用走自己的模型账号。凭据写入数据库前使用服务端主密钥加密，接口返回时始终脱敏。

- 国内可配置智谱 GLM
- 海外可配置 OpenAI / Gemini / Anthropic
- 至少配置一家即可批改；配置多家后可进行多专家协同
- 每个账号只加载自己的 provider 配置，不与其他用户混用

### 👤 全程人工可控

AI 是助手，不是最终裁判。关键节点都保留人工控制：

- ✏️ 作业发布前修改题目、顺序和评分标准
- ✏️ 学生修正答案时创建不可变的新修订，不覆盖历史提交
- ✏️ 教师修改分数、补充评语，并保留 AI 原始结果
- ✏️ 成绩不会自动对学生公开，必须由教师确认并发布

### 📚 课程、作业与三角色工作区

系统不再把所有内容堆在一张“任务列表”里，而是按真实教学关系组织：

- **管理员** —— 管理用户、邀请码和系统状态
- **教师** —— 创建课程、管理学生、发布作业、启动批改、复核并发布成绩
- **学生** —— 查看已选课程和已发布作业，提交答案，只查看正式发布的成绩
- **权限跟着资源走** —— 课程、作业、提交和成绩都有明确归属，越权访问由后端拒绝

### ⚡ 持久化批改 + 不可变修订

- **批改运行可恢复** —— 运行状态保存在数据库中，后台工作器通过租约领取任务
- **提交历史不被覆盖** —— 学生每次更正生成新 revision，批改锁定具体版本
- **同一作业避免重复开跑** —— 数据库约束阻止冲突的排队或运行中批改
- **发布结果有明确版本** —— 学生看到的是教师选择并发布的那次批改结果

### 📡 清晰的批改状态与复核队列

跑批时不再只有一个“加载中”：

- 批改运行区分排队、运行、完成、失败和发布状态
- 教师可以查看已完成数量、结果列表和异常信息
- 低置信度、专家分歧或执行失败的题目集中进入复核队列
- 单题处理完成后，再由教师决定整次成绩何时对学生可见

### 🛡️ 可信的评分质量

三层防护降低 AI 评错带来的影响：

1. **置信度（confidence）** —— 低于阈值的结果需要人工关注
2. **多专家相互校验** —— 模型意见明显分歧时显式标记，不用平均分掩盖问题
3. **教师最终确认** —— 分数和评语可复核，发布权始终在教师手中

---

## 适合谁用

- 高校**理工科课程**的任课教师 / 助教 / 课程负责人
- 希望把课程、作业、提交和成绩放在同一条工作流里管理
- 作业题型涵盖**概念、计算、编程、证明、推理**
- 希望**留下批改痕迹**，而不是只得到一个不透明的最终分数
- 需要先人工复核，再把正式成绩发布给学生

---

## 一份典型工作流

> 场景：30 人 × 10 道题的“算法分析”作业，混合概念 + 计算 + 编程 + 证明。

```text
[课前]   管理员创建教师和学生账号，或发放对应角色的邀请码
[10:00] 教师创建课程 → 添加学生 → 新建作业和 10 道题 → 配置评分标准
[10:10] 教师发布作业，学生在自己的课程页查看题目并陆续提交
[截止后] 教师检查提交情况 → 选择模型专家 → 启动一次持久化批改运行
[批改中] 后台逐份处理最新提交修订 → 保存逐题分数、评语、置信度和异常状态
[完成后] 教师打开复核队列 → 调整需要处理的分数和评语
[发布时] 教师发布本次批改 → 学生在“我的成绩”中看到正式结果
```

整个过程里，学生提交、AI 初评、教师修订和最终发布各自保留边界。谁提交了什么、哪次批改使用了哪个修订、最终发布了什么，都能沿数据链路查清楚。

---

## 当前能力边界（坦诚版）

| 已经能做 | 暂时还不行 |
| --- | --- |
| 管理员 / 教师 / 学生三角色权限 | 多学校、多院系的复杂组织层级 |
| 课程、选课、作业、提交、批改、发布闭环 | 学期排课、考勤等完整教务系统能力 |
| 多 AI 协同 + 人工复核队列 | 完全无人值守地自动发布成绩 |
| 概念 / 计算 / 编程 / 证明题批改工具 | 自动从任意题面生成可靠的编程测试用例 |
| 结构化答案和文件提交 + 不可变修订 | 通用手写图片 OCR 的稳定识别 |
| Python 沙箱 | C / C++ / Java 等多语言沙箱 |
| 逐题统计与教师复核 | 自然语言班级分析和完整成绩导出 |
| SQLite / PostgreSQL + 本地 / 对象存储 | 离线客户端与跨设备本地同步 |

---

## 设计哲学

**LLM 评分不应该是黑盒，成绩也不应该绕过教师直接发布。**

- 你能看到每道题的 AI 分数、评语、置信度和处理状态
- 你知道这次批改对应学生的哪一版提交，而不是被后续修改悄悄覆盖
- 你可以修改分数、补充教师评语，并保留原始 AI 判断
- 学生只看到教师已经确认并发布的结果

如果你正在评估批改类工具，可以先问几个问题：

1. 它能把课程、作业、提交和成绩的关系讲清楚吗？
2. 它能保留 AI 判分依据和学生提交历史吗？
3. AI 评错时，教师能否集中复核并留下修订记录？
4. 成绩是否必须经过教师确认才会对学生可见？

希望 SmarTAI 能让你的批改工作 —— 至少 —— 比今天少花几个小时，同时不牺牲教师对成绩的最终控制。
