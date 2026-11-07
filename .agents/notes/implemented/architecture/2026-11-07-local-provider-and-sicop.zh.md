# Agent Note：本地提供方向导、显式 SICOP 探测与可重开组合的本地任务

Status: implemented

[English](2026-11-07-local-provider-and-sicop.md) | 中文

## 问题

本地 profile 没有明确区分 SICOP 是已配置还是实际可达。SICOP 客户端从环境挂载，因此 URL 看起来像可用性，即使服务器已关闭；提供方 key 与 SICOP 共用同一屏幕，却没有说明二者独立。首次运行提供方对话框要求输入 key，但没有说明保存 key 既不会测试网络也不会测试提供方。本地任务路径——提案、上下文、记忆——没有在模型会话之外重读的重新启动测试。

## 决策

**SICOP 有两个状态，只有探测能从一个跨到另一个。** `faberloomView.sicopStatus` 读取 `SICOP_MCP_URL` 并只报告 `configured`，不触碰网络。`faberloomView.probeSicop` 通过 `ctx.faberloomMcpRegistry.probe` 挂载隔离 MCP 客户端、列出工具并销毁。探测输入只带 URL，不带提供方 key、header 或共享秘密。连接页显示 URL，说明已配置不等于可用，并提供 **测试 SICOP**；失败显示命名原因，绝不阻塞启动或本地行。

**提供方向导说明自身限制。** 首次运行 DeepSeek 对话框现在说明保存 key 不测试网络或提供方；第一次模型请求才会。key 仍只通过 `credentials.set`；本地身份 patch 只记录环境名（`DEEPSEEK_API_KEY`），测试确认值不出现。

**没有提供方或 MWT 时本地任务在重开组合后仍存在。** 测试提交知识提案、批准、创建上下文条目并写入 Space 记忆，然后销毁组合，并从同一内存介质上的新组合读取同样的行。这是模拟重启；未实测磁盘持久性。读取者是服务，不是模型会话。该测试不挂载 SICOP；任务不依赖它。

## 考虑过的替代方案

**挂载时自动探测 SICOP。** 已配置的 URL 仍只是启动事实，不可达服务器会增加启动请求与重试面。显式按钮保持已配置与可用分离。

**把提供方 key 用于 SICOP。** SICOP 是公共的且不携带身份；复用模型凭据会耦合两个独立能力，并有把 key 泄露进探测的风险。探测不发送凭据。

**SICOP 故障时隐藏。** 隐藏失败看起来像可用。卡片保留端点并命名失败，让用户知道要修什么。

**把已保存的提供方 key 当作推理可用证明。** key 是只写凭据，不是网络测试。对话框直接说明，而不声称就绪。

## 后果

连接页区分未配置、已配置但未探测、可达并列出工具、以及命名失败。SICOP 失败后本地产品仍可用。提供方 key 绝不出现在本地 patch 或 SICOP 探测中。本轮未实测真实 SICOP：没有授权访问，测试使用 registry stub 或假端点，外部依赖报告为未证明。

## 验证

- `packages/faberloom/view/tests/mcp-servers.spec.ts`：未探测的已配置状态；通过隔离客户端探测；探测调用中无 `API_KEY`；命名失败；未配置；无 registry。
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx`：已配置/未探测文案、显式探测、可达工具、失败不阻塞面板。
- `packages/client/ui-settings-models/tests/onboarding-dialog.client.spec.tsx`：key 步骤同时渲染无网络提示。
- `packages/faberloom/board/tests/local-task.spec.ts`：提案、批准、上下文与 Space 记忆在同一内存介质上重开组合后保留（模拟重启；未实测磁盘持久性），并在模型会话之外重读。
- `apps/desktop/tests/identity.spec.ts`：本地 patch 保留提供方环境名而非其值。
