# G06A 模型与 BYOK 后端：阶段决定与验收记录

> 日期：2026-07-24
> API：`/experts/*`
> 状态：实现及后端回归完成；G06B 可见页已于同日接入

## 1. 为什么先拆后端阶段

旧 `/settings/byok` 页面表面上有添加、启停和删除，但后端没有可信验证时间，也不能在不让前端重新拿到旧 key 的情况下修改现有配置。若直接美化旧页面，会把“已启用”继续误写成“可用/在线”，并让修改操作退化成重复添加。

G06A 因此先建立真实合同，再让 G06B 只消费事实。

## 2. 新增合同

- `GET /experts/catalog`：返回 Gemini、OpenAI、Zhipu、Anthropic 固定 HTTPS 官方文档、密钥控制台和用量入口。
- `PUT /experts/{provider_id}`：修改 model、display name、官方 base URL、并发与 RPM；`api_key` 留空时由后端保留旧密钥。
- `POST /experts/{provider_id}/verify`：教师主动点击后发送一次最小测试请求，最多等待 30 秒。
- `GET /experts/available` 新增 `verification_status / last_checked_at / verified_at / verification_error_code`，同时继续固定返回 `api_key: "***"`。

## 3. 修改与并发安全

- 只允许当前 owner 修改自己的 entry；共享池和其他 owner 均不可修改、验证或删除。
- model 改变会改变 public provider ID；迁移在 registry 锁内原子完成。
- 如果目标 provider ID 已存在，返回结构化 409，不覆盖另一把 key。
- 修改任意配置后验证状态重置为 `unverified`。
- 验证开始后若配置被修改或替换，provider 对象 CAS 不再允许旧请求把新配置标为已验证，而是返回 `expert_verification_stale`。
- provider base URL 仍只允许既有 OpenAI/Zhipu 官方 host/path 白名单，用户 URL 不进入 catalog。

## 4. 验证语义与隐私

- 验证提示固定为 `Reply with exactly OK.`，不包含任务、题目、学生或教师资料。
- 成功只记录验证时间；失败只记录稳定错误码：认证失败、模型不存在、限流、超时、连接失败或通用 provider 错误。
- API 响应与日志都不返回供应商原始异常文本或 key。
- `enabled` 仍只表示教师开启该配置；只有 `verification_status=verified` 才表示最近一次显式测试成功。
- 平台共享模型标为 `platform_managed`，不冒充当前用户已验证。

## 5. 官方外链边界

- OpenAI：Platform docs、API keys、Usage。
- Gemini：Google AI for Developers、AI Studio API keys、AI Studio Usage。
- Anthropic：Claude Platform API keys、Usage 和官方文档。
- Zhipu：BigModel 官方文档、API keys 与官方控制台。
- SmarTAI 只提供新窗口外链，不读取或推断任何供应商余额、token 或费用。

## 6. 测试证据

- `backend/tests/test_expert_registry_isolation.py`：最终 `16 passed`。
- 后端全量：`225 passed, 1 skipped, 18 warnings`。
- 覆盖 owner 隔离、共享只读、key 省略保留、模型 ID 原子迁移、验证成功/失败脱敏、官方链接认证/HTTPS 白名单及现有任务批改回归。
- 最终 CAS 修正后再次运行定向 16 项；未调用真实 provider。
- `git diff --check` 在提交前执行。

## 7. 后续状态

- key、验证状态和时间仍为进程内存；重启丢失，尚无加密数据库/密钥管理服务。
- 验证请求会真实消耗用户 provider 的一次最小调用，G06B 必须在按钮旁明确说明且绝不自动触发。
- G06B 已实现 Figma 风格摘要矩阵、添加/编辑弹窗、验证/启停/删除、官方外链、中英文、任务 `returnTo` 和桌面/移动验收；见 `G06B_MODELS_BYOK_FIGMA_STAGE_DECISION_AND_ACCEPTANCE_CN.md`。
