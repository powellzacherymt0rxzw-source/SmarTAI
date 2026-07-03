# SmarTAI Legacy Reflex Frontend

> 旧 Reflex 前端，当前保留为回退和对照路径。新的教师端 React 前端在
> [app/](app/)；React 前端不需要 `smartai` Conda 环境。

## 架构

- **Reflex** 0.6+ — 纯 Python 写、编译为 React + Next.js
- **设计系统**：Radix UI（indigo + slate），见 [smartai_v2/theme.py](smartai_v2/theme.py)
- **状态**：Reflex `State` 类 + `LocalStorage`（auth token 持久化）
- **API**：httpx 异步客户端，统一在 [smartai_v2/api/](smartai_v2/api/)
- **路由**：Reflex `@rx.page(route="/...")` 装饰器

## 启动

旧 Reflex 前端需要先进入仓库约定的 `smartai` Conda 环境：

```bash
conda activate smartai
cd frontend
pip install -r requirements.txt
reflex run
```

默认端口：
- Frontend (Next.js)：`http://localhost:3000`
- Reflex backend：`http://localhost:8001`
- 调用的 SmarTAI FastAPI 后端：`http://localhost:8000`（在 [smartai_v2/config.py](smartai_v2/config.py) 配置）

## 文件指南

| 路径 | 作用 |
|---|---|
| 项目根 [docs/20260620/PROJECT_STATUS_AND_ROADMAP_CN.md](../docs/20260620/PROJECT_STATUS_AND_ROADMAP_CN.md) | 当前项目状态与优先级 |
| [docs/](docs/) | 8 篇按层次递进的中文模块文档 |
| [STAGE_0_DESIGN.md](STAGE_0_DESIGN.md) | Stage 0 详细设计与决策依据 |
| [BACKEND_STUB_ENDPOINTS.md](BACKEND_STUB_ENDPOINTS.md) | 后端待实现接口契约（auth/users/courses 等） |
| [rxconfig.py](rxconfig.py) | Reflex 应用配置 |
| [smartai_v2/smartai_v2.py](smartai_v2/smartai_v2.py) | 应用入口、路由注册 |
| [smartai_v2/theme.py](smartai_v2/theme.py) | 设计系统 token |
| [smartai_v2/api/](smartai_v2/api/) | 后端 HTTP 客户端 |
| [smartai_v2/state/](smartai_v2/state/) | Reflex 状态类 |
| [smartai_v2/components/](smartai_v2/components/) | 共享组件 |
| [smartai_v2/pages/](smartai_v2/pages/) | 路由页面 |

## 部署

详见上层 [ARCHITECTURE_AND_DEPLOYMENT.md](../ARCHITECTURE_AND_DEPLOYMENT.md) 第 5 节，Reflex 部署到 Render 或 Reflex Cloud。
