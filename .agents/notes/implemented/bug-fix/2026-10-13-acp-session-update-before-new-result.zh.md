# Agent Note: the ACP bridge publishes a session only after its result

Status: implemented

[English](2026-10-13-acp-session-update-before-new-result.md) | 中文

## 问题

`AcpSession.newSession` 在发现会话的配置选项之前就把记录写入了桥接层的存活会话映射，因此当 `session/new` 响应尚未写出时映射项已经存在；`resumeSession` 对 `session/resume` 也是如此。`LlmRuntime.registerConfigurableProviders` 在其目录提交时同步发出 `llm/adapters-updated`，而随产品发布的 `llm-pi-ai` 插件会在启动时提交一个休眠的可配置提供方目录。该事件会让桥接层对映射中的每个记录调用 `topologyChanged()` 并推送一次 `config_option_update`。因此，落在激活窗口内的提交会为一个客户端尚未收到的 `sessionId` 发送会话级更新。

这是一个竞态，而非稳定漂移：它在一次冷启动、整文件并发的 ACP 快照运行中于四个场景出现，在十五次隔离的串行运行中出现零次，而禁用 `llm-pi-ai` 后每次整文件并发运行都不再出现。线上症状是客户端收到了一个它无法寻址的会话的 `session/update`——在该结果到达之前，针对该 id 的任何 `session/prompt`、`session/set_config_option` 或 `session/close` 都会失败。过早写入映射的影响不止这一次更新：映射成员身份是桥接层唯一的“客户端已知该会话”声明，因此 `session/event` 路由、`requireSession`、权限应答器以及 `session/list` 过滤都会把一个尚未公布的会话当作已知会话。

## 决策

`newSession` 与 `resumeSession` 只在 `record.configOptions()` 结算之后、紧邻返回结果之前，才把记录插入 `sessions`。结果本身已经携带这些已结算的选项，因此被读取吸收的拓扑提交会随响应送达，而不再作为提前更新发送；不会有状态丢失。失败路径去掉了 `sessions.delete`，因为记录在结果之前永不会被公布。

## 考虑过的替代方案

**在会话仍处于激活状态时守卫 `topologyChanged()`。** 否决。它只修补一个症状，却让映射项本身仍然错误：记录会在整个激活期间保持被映射，因此 `session/event` 路由、`requireSession`、权限应答器与列表过滤仍会把一个尚未公布的会话当作可寻址的会话。它还需要一个由全局监听器查询的第二个激活标志，而该标志必须在真正的“客户端已知”边界——处理器返回之后、桥接层无法观测到的传输写入——处清除；因此无论清除过早（重新打开竞态）还是过晚（抑制合法的后续拓扑更新）都会出错。移动插入点让映射成员身份在单一提交点即意味着“客户端已被告知”。

**在 `packages/llm` 中改变发出时机。** 否决，因为归属方不对。`registerConfigurableProviders` 在提交时发布同步拓扑事件对它自己的注册表而言是正确的；缺陷在于桥接层对一个尚未公布的会话采取了行动。把发出改为异步会掩盖同类过早公布问题，并改变一个无关包的契约。

## 后果

- 客户端绝不会在该会话的 `session/new` 或 `session/resume` 结果之前收到该会话的 `session/update`。
- 配置选项读取观测到的拓扑提交会被折叠进返回的 `configOptions`；读取之后落地的提交不会被单独推送，这与任何在响应前后落地的提交一致——下一次拓扑变更会将其带出。
- 每个会话现在只有一个公布点，因此每个映射读取方都与客户端已知的信息保持一致。

## 测试

`packages/acp/acp/tests/bridge.spec.ts` 保持配置选项读取开启，提交一个可配置提供方目录，使 `llm/adapters-updated` 落在该窗口内，并扣住持久性屏障使结果无法写出，然后通过已连接的 SDK 客户端断言在结果之前没有任何 `config_option_update` 到达。第二个测试对同一发出方驱动六个并发激活。两者在修复前的插入顺序下都失败，修复后通过。
