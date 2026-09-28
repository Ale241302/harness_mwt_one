# Agent Note: the harness connects the SICOP MCP for every user

Status: implemented

[English](2026-09-28-sicop-mcp-connection.md) | 中文

## Problem

每个 `dsh` 启动时都带有 MWT.ONE 的 MCP 服务器，因为网关的按用户补丁会插入它（`mcp-mwt`，`serverName: mwt`）。第二个数据源 SICOP——以 MCP 服务器形式暴露的哥斯达黎加公共采购开放数据——可在 `https://sicop.vlinte.work/mcp` 访问，无需认证。Owner 要求在智能体和技能中查询它，而 Agents 面板此前只提供 MWT.ONE MCP 一个开关。

## Decision

- 网关配置新增 `sicopUrl`，取自 `SICOP_MCP_URL`，默认 `https://sicop.vlinte.work/mcp`。`renderPatch` 为每个用户插入 `mcp-sicop` 条目（`serverName: sicop`，streamable-http，无请求头），因此 SICOP 默认对任何智能体或技能可用。将 `SICOP_MCP_URL` 置空则不再插入该条目。`GET /healthz` 报告 `sicopConfigured`。
- 仅当至少存在一个请求头时，`renderEntry` 才输出 `headers:` 块，因为空的 `headers:` 会被解析为 `null`，而 MCP 客户端 schema 期望一个字典。
- 智能体目录新增 `sicopMcp`（默认 `true`），贯穿持久化记录、服务类型、`createAgent`/`saveAgent`/`agentDetail` 远程方法以及 Agents 面板复选框，与 `mwtMcp` 保持一致。复选框文案在西班牙语、英语和中文中由 locale 拥有。
- 共享技能 `skills-shared/sicop-contratacion-publica/SKILL.md` 说明 SICOP 的工具集、计量层级与货币规则，以及响应信封（`nivel_medicion`、`cobertura_cruce`、`moneda`、`caveats`）。由于网关在角色目录旁挂载 `SKILLS_SHARED_ROOT`，它覆盖所有角色。
- 共享智能体预设 `agents-shared/sicop-analyst/`（`preset.yml` + `agent.cordis.yml`，含 persona、文件/搜索/web/skill 行）播种一个“Analista SICOP”智能体。`PRESET_CURATION` 为它分配 `sicop-contratacion-publica` 技能。`seedSharedAgents` 在每次实例启动时重新同步共享预设，因此该智能体也能到达由更早部署配置的 owner，而不仅是新 owner。
- `docs/endpoints.md`（及其中文配对）列出公开的 SICOP 端点。

## Alternatives considered

**让 `sicopMcp`（及 `mwtMcp`）按智能体过滤 MCP 工具。** harness 全局挂载 MCP 工具；faberloom 智能体不携带运行时工具过滤，要实现该开关需要新的组合接缝，并会改变已上线的 MWT.ONE 行为。两个开关保持为按智能体存储的元数据，与今天的 `mwtMcp` 完全相同。

**像 MWT.ONE 那样对 SICOP 认证。** SICOP 是公共只读服务器，没有身份概念：发送按用户请求头会暗示一种服务器并不执行的授权。

**在 `renderPatch` 中硬编码 SICOP URL。** 部署需要在不重建的情况下指向预发或本地 SICOP，因此该 URL 是由 `.env` 可改的、经校验的 `Config` 值。

## Consequences

- 任何用户的智能体和技能都能在无需按用户配置的情况下调用 `mcp__sicop__*` 工具（`sicop_ficha_proveedor`、`sicop_mercado_familia`、`sicop_producto_historia` 等）。
- `sicop-contratacion-publica` 技能与“Analista SICOP”智能体会在下次启动时出现在每个 owner 的 Skills 和 Agentes 面板中；新 owner 无需手动步骤即可同时获得两者。
- 为整个部署关闭 SICOP 只需将 `SICOP_MCP_URL` 置空；没有按用户开关，符合“任何用户都可使用”的需求。
- Agents 面板在 MWT.ONE 开关旁显示“Connect to the SICOP MCP”开关。它按智能体记录预期访问权限，但不会在运行时限制工具，这与 `mwtMcp` 当前的局限相同。

## Testing

`packages/faberloom/agents/tests/agents.spec.ts` 断言 `sicopMcp` 默认为开且独立于 `mwtMcp` 切换。`packages/faberloom/view/tests/workspace-board.spec.ts` 断言 `saveAgent` 转发 `sicopMcp`。Host 与 Client 类型检查通过，`ui-faberloom` 注册测试通过，`verify-skills-catalog` 接受新的共享技能。
