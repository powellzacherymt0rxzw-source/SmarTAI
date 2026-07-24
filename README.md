# SmarTAI

[![CI](https://github.com/SmarTAI-2025/SmarTAI/actions/workflows/ci.yml/badge.svg)](https://github.com/SmarTAI-2025/SmarTAI/actions/workflows/ci.yml)

SmarTAI 是面向课程作业场景的 AI 辅助批改系统。项目以课程、作业、提交、批改运行和成绩为核心数据模型，为管理员、教师和学生提供相互隔离的工作区，并保留教师复核与成绩发布环节。

在线演示：[https://smartai-course.pages.dev](https://smartai-course.pages.dev)

## 当前能力

- 管理员：管理用户、创建邀请码、查看系统状态。
- 教师：创建课程并管理选课学生，编辑和发布作业，查看提交，启动批改，处理人工复核队列并发布成绩。
- 学生：查看已选课程和已发布作业，在线提交结构化答案或上传文件，查看教师已发布的成绩。
- AI 批改：支持 Gemini、OpenAI、Anthropic 和智谱等模型配置，可按用户保存 BYOK（Bring Your Own Key）凭据。
- 知识库：教师可维护个人知识文档，并为作业选择用于检索的资料。
- 数据持久化：本地开发使用 SQLite 和本地文件存储，生产环境可切换到 PostgreSQL 和 S3 兼容对象存储。
- 可追踪批改：提交修订是不可变版本；批改运行、逐题结果、AI 评语、教师复核和发布状态分别保存。

## 业务流程

1. 管理员创建用户或发放邀请码。
2. 教师创建课程、添加学生并创建作业与题目。
3. 教师将作业发布后，学生提交答案；再次修改会生成新的提交修订。
4. 教师启动批改运行，后台工作器从数据库领取并处理任务。
5. 低置信度、模型意见分歧或执行失败的结果进入人工复核队列。
6. 教师可调整分数和评语，确认后发布整次批改运行。
7. 学生只能看到已经发布的结果，不会看到草稿分数或模型调用信息。

## 技术架构

| 层级 | 技术 |
| --- | --- |
| 前端 | React 19、TypeScript、Vite 8、Tailwind CSS 4、TanStack Query |
| 后端 | FastAPI、Pydantic、Uvicorn |
| 数据库 | SQLAlchemy 2、Alembic、SQLite / PostgreSQL |
| 文件存储 | 本地文件系统 / S3 兼容对象存储 |
| AI 与检索 | LangChain provider adapters、BM25、SymPy、多模型批改 |
| 测试 | Pytest、Vitest、Testing Library、Playwright |

当前前端唯一入口位于 `frontend/app/`。

## 仓库结构

```text
SmarTAI/
├── backend/
│   ├── api/                 # FastAPI 路由
│   ├── auth/                # JWT、刷新会话与测试账号导入
│   ├── db/                  # ORM、仓储与 Alembic migrations
│   ├── services/            # 课程、提交、批改等业务服务
│   ├── knowledge/           # 个人知识库
│   ├── llm/                 # 模型 provider 与专家注册表
│   ├── storage/             # 本地及对象存储实现
│   ├── tests/               # 后端测试
│   └── main.py              # FastAPI 应用入口
├── frontend/app/            # React/Vite 应用
├── scripts/                 # 管理员、测试用户和开发数据库工具
├── .github/workflows/ci.yml # CI 配置
├── .env.example             # 后端环境变量示例
├── alembic.ini              # 数据库迁移配置
└── render-requirements.txt  # 后端部署依赖
```

## 快速开始

### 环境要求

- Python 3.11 或 3.12
- Node.js 20
- npm

以下命令均从仓库根目录开始执行。

### 1. 安装后端依赖

```bash
python -m venv .venv
```

激活虚拟环境：

```bash
# macOS / Linux
source .venv/bin/activate

# Windows PowerShell
.venv\Scripts\Activate.ps1
```

安装依赖并创建本地配置：

```bash
python -m pip install --upgrade pip
pip install -r render-requirements.txt
cp .env.example .env
```

Windows PowerShell 可使用：

```powershell
Copy-Item .env.example .env
```

默认配置使用 `data/smartai.db` 和 `data/uploads/`，适合单机开发。首次启动前建议显式执行迁移：

```bash
alembic upgrade head
```

### 2. 创建管理员

```bash
python scripts/create_admin.py admin --email admin@example.com
```

命令会交互式读取密码，密码长度至少为 10 个字符。也可以通过 `SMARTAI_BOOTSTRAP_ADMIN_PASSWORD` 临时传入密码，但不要将密码写入仓库。

如需批量生成仅供本地测试的账号：

```bash
python scripts/generate_test_users.py
```

生成的凭据保存在被 Git 忽略的 `data/test_users.json`。后端启动时会在 `SMARTAI_SEED_TEST_USERS=true` 的情况下导入这些账号。

### 3. 启动后端

```bash
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

- 健康检查：`http://localhost:8000/health`
- 就绪检查：`http://localhost:8000/ready`
- OpenAPI 文档：`http://localhost:8000/docs`

### 4. 启动前端

打开另一个终端：

```bash
cd frontend/app
npm ci
npm run dev
```

浏览器访问 `http://localhost:5173`。前端默认连接 `http://localhost:8000`；需要覆盖时，在 `frontend/app/.env` 中设置：

```dotenv
VITE_SMARTAI_BACKEND_URL=http://localhost:8000
```

修改该变量后需要重启开发服务器或重新构建前端。

## 环境配置

后端从仓库根目录的 `.env` 和进程环境变量读取配置。常用变量如下：

| 变量 | 用途 | 本地默认/示例 |
| --- | --- | --- |
| `SMARTAI_DATABASE_HEAVY` | `OFF` 使用 SQLite，`ON` 使用 PostgreSQL | `OFF` |
| `SMARTAI_DATABASE_URL_LIGHT` | SQLite SQLAlchemy URL | `sqlite:///data/smartai.db` |
| `SMARTAI_DATABASE_URL_HEAVY` | PostgreSQL SQLAlchemy URL | `postgresql+psycopg://...` |
| `SMARTAI_DATABASE_AUTO_CREATE` | 启动时自动建表；生产环境应关闭并使用 Alembic | `true` |
| `SMARTAI_STORAGE_BACKEND` | `local` 或 `object` | `local` |
| `SMARTAI_STORAGE_ROOT` | 本地上传目录 | `data/uploads` |
| `SMARTAI_STORAGE_S3_*` | S3 兼容存储的 endpoint、bucket、region 和凭据 | 空 |
| `SMARTAI_REQUIRE_AUTH` | 是否强制保护 API | `true`（示例配置） |
| `SMARTAI_REGISTRATION_CLOSED` | 是否关闭公开注册 | `true` |
| `SMARTAI_PROVIDER_ENCRYPTION_KEY` | 加密持久化的用户 BYOK 凭据 | 必须自行设置 |
| `SMARTAI_JWT_SECRET` | JWT 签名密钥；生产环境必须替换 | 必须自行设置 |
| `FRONTEND_URLS` | 允许跨域访问后端的前端源，逗号分隔 | 本地 Vite 地址 |

配置模型也兼容部署模板使用的 `JWT_SECRET`。新建本地配置时建议沿用 `.env.example` 中的 `SMARTAI_JWT_SECRET`。

生产环境使用跨站刷新 Cookie 时，还需要设置：

```dotenv
SMARTAI_REFRESH_COOKIE_SECURE=true
SMARTAI_REFRESH_COOKIE_SAMESITE=none
```

`FRONTEND_URLS` 必须包含实际部署的前端 origin，例如：

```dotenv
FRONTEND_URLS=https://smartai-course.pages.dev
```

不要在 URL 末尾添加 `/`。

## 数据库与迁移

本地 SQLite：

```dotenv
SMARTAI_DATABASE_HEAVY=OFF
SMARTAI_DATABASE_URL_LIGHT=sqlite:///data/smartai.db
```

生产 PostgreSQL：

```dotenv
SMARTAI_DATABASE_HEAVY=ON
SMARTAI_DATABASE_URL_HEAVY=postgresql+psycopg://USER:PASSWORD@HOST:5432/DBNAME
SMARTAI_DATABASE_AUTO_CREATE=false
```

应用数据库迁移：

```bash
alembic upgrade head
```

仅在确定要清空本地开发数据时，可重建 `data/` 下的 SQLite 数据库：

```bash
python scripts/reset_development_database.py
```

该命令不会删除上传文件，并会拒绝默认范围之外的数据库路径。

## 认证与模型凭据

- 系统角色为 `admin`、`teacher`、`student`。
- 登录成功后，前端使用短期 JWT access token；refresh token 通过可轮换的 HttpOnly Cookie 管理。
- 示例配置默认关闭公开注册。新用户应由管理员直接创建，或使用管理员生成的邀请码注册。
- 用户可在“专家配置”页面保存自己的模型 API Key。凭据写入数据库前会使用 `SMARTAI_PROVIDER_ENCRYPTION_KEY` 加密。
- 至少配置一个可用模型 provider 后才能执行真实 AI 批改。不要提交 `.env`、测试账号文件或 API Key。

## API

主要 API 分组：

| 路径 | 内容 |
| --- | --- |
| `/auth` | 登录、注册、刷新与退出 |
| `/admin` | 用户、邀请码与系统管理 |
| `/users` | 当前用户相关操作 |
| `/courses` | 课程与选课关系 |
| `/assignments` | 作业、题目、发布状态与知识库选择 |
| `/submissions` | 学生提交及不可变修订 |
| `/grading-runs` | 批改运行、状态与发布 |
| `/results` | 成绩、统计与人工复核 |
| `/knowledge` | 个人知识文档 |
| `/experts` | BYOK 模型配置 |

以运行中的 `/docs` 为完整接口契约。

## 测试与 CI

后端完整测试：

```bash
pip install pytest pytest-asyncio
python -m pytest backend/tests -q
```

前端检查：

```bash
cd frontend/app
npm ci
npm run audit:scope
npm run typecheck
npm test
npm run build
```

端到端测试需要 Playwright Chromium 和一个可用的本地后端：

```bash
cd frontend/app
npx playwright install chromium
npm run e2e
```

GitHub Actions 在 `.github/workflows/ci.yml` 中执行四类任务：

- SQLite 后端测试
- PostgreSQL 集成测试与迁移往返验证
- 前端范围审计、类型检查、单元测试和生产构建
- Playwright 端到端测试

## 部署

### 后端：Render

仓库包含 `backend/render.yaml`。生产启动命令为：

```bash
alembic upgrade head && uvicorn backend.main:app --host 0.0.0.0 --port $PORT
```

生产部署应使用 PostgreSQL、S3 兼容对象存储，并通过平台 Secret 管理数据库、存储、JWT 和加密密钥。部署后用 `/ready` 同时检查数据库与存储可用性。

### 前端：Cloudflare Pages

推荐构建配置：

```text
Root directory: frontend/app
Build command: npm ci && npm run build
Build output directory: dist
```

构建环境变量：

```dotenv
VITE_SMARTAI_BACKEND_URL=https://your-backend.example.com
```

同时将前端正式域名加入后端的 `FRONTEND_URLS`。

## 当前边界

- AI 批改依赖外部模型服务，响应时间、费用和可用性受所选 provider 影响。
- SQLite 与本地文件存储适合单机开发；多实例生产部署应使用 PostgreSQL 和对象存储。
- 公开注册默认关闭，首次部署必须先创建管理员，再通过用户管理或邀请码完成账号初始化。
- 成绩发布是显式操作；批改完成不等于学生立即可见，教师必须先处理必要复核并发布批改运行。
