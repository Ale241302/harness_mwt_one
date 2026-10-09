# Agent Note: 代理能力平面

Status: implemented

[English](2026-10-08-agent-capability-plane.md) | 中文

## Problem

某个目录代理声明了它可以使用哪些来源——`mwtMcp`、`sicopMcp`、`webAccess`——以及它可以咨询哪些代理（`subagents`），但这些标志只是声明性的。`faberloom_spaces_ask` 以父级合并后的工具面启动子代理，因此 `sicopMcp` 关闭的代理仍会通过一次委托咨询收到 `mcp__sicop__*`；同一批标志也从不触及会话。声明与被执行的能力平面并不一致。

## Decision

新增包 `@deepseek-ai/dsh-faberloom-agent-plane` 及主机服务 `ctx.faberloomAgentPlane`。`resolve(agent, sources)` 把标志转换为 `ToolRestriction`：代理无权使用的来源会精确拒绝该来源发布的已注册工具名，空掩码则被省略，因此调用方绝不会传入 `restrict({})` 这类空操作。同一次调用还携带代理的 persona、模型路由与技能。`allowsSubagent(agent, targetAgentId)` 回答调用方侧允许名单，其中空名单表示不限制。`enforceSources`（默认 `true`）把标志转换为强制执行；部署可以关闭它以让所有标志保持声明性。

`tool-faberloom` 把实时注册表——`ctx.tools.schemas()` 按 `mcp__<server>__` 前缀与开放网络名称 `web_search`/`web_fetch` 拆分——分组为平面读取的来源。`faberloom_spaces_ask` 解析负责代理的平面，并把 `toolFilter` 与 `persona` 传给子代理启动，且在 provider 支持时以代理的 provider 与 model 附加 `agentOptions`。工具掩码是强制性的：当平面需要掩码而 provider 未声明 `toolFilter` 能力时，会显式失败，而不是悄悄放宽子代理的平面。faberloom bundle 挂载该服务。`faberloom_spaces_ask` 也强制调用方一侧：其工作目录是被某个 Space 镜像的已注册工作区的会话，携带该 Space 的负责代理；若该代理未列出目标，则在子代理启动前拒绝这次咨询。

## Alternatives considered

**在核心工具运行时按名称前缀强制执行。** 否决：`ToolRestriction` 仅掩码确切的已注册名称，而平面只列出实时注册表发布的名称，因此 `restrict()` 绝不会因未知工具而失败。

**把 `agent.tools` 作为全局允许掩码应用。** 否决：`agent.tools` 是由 `faberloomAgents.executeTool` 强制执行的可执行工具允许名单；把它变成全局允许会剥离代理合法持有的技能与 MCP 工具。

**让标志保持声明性。** 否决：要求是缺少某来源的代理不得触达它，而标签无法满足这一点。

## Consequences

代理无权使用的来源绝不会触达其被委托的子代理，且掩码是确定性的（`deny` 去重并排序）。该服务在 `tool-faberloom` 中是可选的（`ctx.get`），因此未挂载它的组合保持此前行为，且空间快照夹具保持不变，因为其组合既不挂载平面也不挂载 MCP 工具。调用方侧的 `subagents` 强制执行会读取咨询代理的允许名单；咨询代理是拥有调用方会话工作目录的那个 Space 代理，通过工作区注册表解析。工作目录不是被某个 Space 镜像的工作区的会话不携带身份，因此不受限制；解析到目标自身的调用方被允许。

测试覆盖 `resolve`（按来源掩码、空掩码、声明性模式、并集）、`allowsSubagent`、注册表分组（`toolSourcesOf`）以及启动字段构造器（`planeStartFields`），包括 provider 无法强制执行所需掩码时的显式失败。当平面被挂载时，`faberloom_spaces_ask` 携带掩码、persona 与路由，并在无法强制执行时显式失败。
