# Agent Note：本地模式是组合，不是隐藏错误路径

Status: implemented

[English](2026-11-06-local-composition-without-mwt.md) | 中文

## 问题

批次 2.1 为本地 home 提供了自己的 owner id 并强制关闭 mirror，但组合仍然挂载部署行。只要继承的 `MWT_MCP_URL` 与凭据可解析，`renderProductMcpEntries` 就挂载 MWT；FaberLoom 的 URL 与 gateway key 可解析时也挂载。本地身份 patch 省略了 `faberloom-shares` 行，但省略 patch 行并不会禁用 bundle 中挂载该服务的行。`credentials-console`、`faberloom-checks-mwt`、`faberloom-mirror`、`faberloom-session-shares`、`faberloom-inbound` 与 MCP bridge 仍然挂载，因此即使 home 是本地，它们也能注册工具、重试并访问部署。

## 决策

**本地模式在渲染产品 MCP 行之前选定。** `resolveProductMcpServers` 接受 `remote` 或 `local`。在 `local` 下只返回公共 SICOP；即使所有变量都可解析，也绝不渲染 MWT 与部署 FaberLoom 服务器。

**本地 patch 从净化后的环境生成。** `localProductEnvironment` 移除 `MWT_*`、`CONSOLA_*`、`FABERLOOM_MCP_URL`、`FABERLOOM_GATEWAY_KEY`、`FABERLOOM_GATEWAY_URL`、`FABERLOOM_LLM_PROXY_URL` 与 mirror 名称。provider key 与 `SICOP_MCP_URL` 保留。`writeLocalIdentityPatch` 以 `local: true` 渲染：本地 MCP 服务器保留 loopback socket，但得到 `bridge: false` 与空的 gateway/console base，并按 id 禁用 `credentials-console`、`faberloom-checks-mwt`、`faberloom-mirror`、`faberloom-shares`、`faberloom-session-shares`、`faberloom-inbound` 与 `faberloom-publication`。

**Bundle 为 CLI 门控同样的行。** `packages/bundle/faberloom-app/cordis.patch.yml` 在 `FABERLOOM_LOCAL=1` 时禁用这些行，MCP server 行的 bridge 开关也读同一值。带 `FABERLOOM_LOCAL=1` 的 CLI 启动组合本地 profile；无需单独 profile 复制本地行。

**Desktop host 应用最后一层 overlay。** `apps/desktop-host/config/desktop-local.patch.yml` 禁用同样的行并关闭 bridge。`desktopComposition` 在 `FABERLOOM_LOCAL=1` 时把它追加在 profile、desktop patch 与身份 patch 之后，因此身份 patch 早于本变更的 home 也无法重新启用部署行。`main.ts` 设置 `FABERLOOM_LOCAL=1` 并把净化环境传给子进程。

**本地产品行保留。** Mesa、上下文、记忆、routines、workflows、defaults、view、session agent、skills 与 loopback MCP 端点仍挂载。SICOP 是唯一产品 MCP 服务器；provider key 不变。

## 考虑过的替代方案

**隐藏行或捕获错误。** 已挂载的服务仍会注册工具、重试并访问部署。验收衡量的是缺席，不是沉默。

**只从身份 patch 移除行。** 省略 patch 行不会禁用 bundle 行，后续身份 patch 还能重新加回。Bundle 门控与最后一层 overlay 让缺席成为组合事实。

**单独的本地 profile。** 它会复制每个本地行并与远程 profile 漂移。同一 bundle 加显式本地模式只保留一份定义。

**从 `.env` 清除变量。** 曾登录的 home 必须保留凭据以便之后登录；删除会强制重新登录并可能丢失设备授权。本地 patch 选择忽略它们。

## 后果

本地启动没有 MWT 或部署 FaberLoom MCP 客户端，没有 credential console、checks、mirror、bridge、shares、session sync、inbound mail 或 publication 服务。它保留 SICOP、本地产品服务与 loopback MCP 端点。远程启动不变。撤销后的完整断开与数据保留证据仍属于 5.3 的 LIFE-01；本笔记覆盖 2.2 的组合切片。

## 验证

- `apps/desktop/tests/local-composition.spec.ts`：真实 Desktop profile（base、web、faberloom）、desktop overlay、本地身份 patch 与 host 最后一层 overlay；没有 `mwt`/`faberloom` MCP 客户端，远程行禁用，本地行启用，bridge 关闭。远程对照保留 `mwt`/`faberloom`。
- `apps/desktop/tests/local-network.spec.ts`：带合成凭据的假 MWT 端点；本地模式下启动、等待与重启观察到零请求。
- `apps/desktop/tests/identity.spec.ts`：本地 patch 丢弃每个部署变量并输出禁用行；`localProductEnvironment` 只保留 provider 与 SICOP。
- `apps/desktop/tests/product-mcp.spec.ts`：所有远程变量存在时，本地模式只返回 SICOP。
