---
description: "原生 MCP 服务器注册表（ctx.faberloomMcpRegistry）：按 owner 持久化的 MCP 服务器配置、经凭据接缝存储的 header/env 密钥、隔离的连接探测，以及为每个已启用服务器建立的进程级挂载。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-mcp-registry

[English](README.md) | 中文

## 概述

MCP 注册表发布 `ctx.faberloomMcpRegistry`：用户 MCP 服务器的持久化配置、证明其可用的探测，以及让已启用服务器的工具无需重启即可用的进程级挂载。`save` 把每个 header 或环境变量值写入 `ctx.credentials`，只保留其名称与引用；`probe` 在隔离作用域内连接、列出工具并始终关闭；`remove` 卸载服务器并删除其凭据。任何返回或存储的字段都不携带密钥值。

## 目录

- [使用此包](#use-this-package)
- [传输与密钥](#transports-and-secrets)
- [探测](#the-probe)
- [挂载](#mounting)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在已具备 `ctx.storageDomain` 与 `ctx.tools` 的组合中挂载此行；携带密钥的服务器还需要凭据接缝 `ctx.credentials`。该服务打开 `faberloom_mcp_registry` 域、注册 `ctx.faberloomMcpRegistry`，并暴露 `list(ownerId)`、`save(ownerId, input)`、`remove(ownerId, name)` 与 `probe(input)`。记录按 owner 与服务器名各一条。`probeTimeoutMs` 限定单次探测（默认 `10000`）；`toolCallTimeoutMs` 限定已挂载服务器上的单次工具调用（默认 `60000`）。

-----

<a id="transports-and-secrets"></a>
## 传输与密钥

一条已保存的服务器记录包含其传输、非密钥条目名称及其值所在引用、启用标志与时间戳。

| 传输 | 字段 |
|---|---|
| `stdio` | `command`、`args`、`cwd` |
| `streamable-http` | 绝对 HTTP(S) `url` |

每个 `env` 与 `headers` 值都是密钥。`save` 把每个值写入凭据接缝，引用为 `mcpSecretCredentialRef(ownerId, name, entryName)`，记录中只保留 `{ name, credentialRef }`，因此值永不离开主机，任何读取——list、save 或 probe——都无法返回它。省略 `env` 或 `headers` 保留已保存条目；显式空表清除它们并删除其已存凭据。未挂载接缝的组合会拒绝携带密钥的保存，且已保存条目在接缝持有值之前读取为 `present: false`。

-----

<a id="the-probe"></a>
## 探测

`probe(input)` 在保存前证明某个候选服务器可用。它在注册表 fiber 之下的隔离作用域内挂载 MCP 客户端、等待连接、列出其注册的 `mcp__<name>__` 工具，并始终销毁该作用域，因此探测不会在全局注册表中留下任何工具。它返回 `{ ok: true, tools }` 或 `{ ok: false, failure, detail }`，其中 `failure` 为 `unreachable`、`bad-credential` 或 `protocol`，`detail` 携带来自服务器的最深消息，并把每个提供的密钥替换为 `[redacted]`。探测受 `probeTimeoutMs` 限定；从不响应的服务器报告 `unreachable`。

-----

<a id="mounting"></a>
## 挂载

已启用的服务器通过 `ctx.plugin(dsh-mcp-client, config)` 在进程内挂载——与 `dsh-acp` 为每个会话挂载时所用的机制相同，只是位于注册表自身的作用域而非代理作用域。`save` 先卸载旧客户端再挂载新客户端，`remove` 先卸载再删除，已禁用服务器从不挂载。工具属于全局工具注册表，代理循环在每次请求时重新装配：已在运行的会话在下一次请求中即可见到 `mcp__<name>__<tool>`，无需重启；已在途的请求则不会。加载时 `apply` 挂载每条已启用记录并记录任何无法挂载者，因此已保存服务器从启动起即可用于每个工作区与 Space。注册表 fiber 的销毁会销毁所有挂载。

-----

<a id="model-experience"></a>
## 模型体验

### 已挂载服务器的工具

#### 模型看到的内容

此包本身不提供任何内容。它不注册工具、提示区段或会话事件；当某个已启用服务器被挂载时，`dsh-mcp-client` 拥有 `mcp__<serverName>__<tool>` 模式与服务器的字面说明，而此包只决定该客户端是否被挂载。

#### Token 影响

直接消耗为零。挂载服务器会把 MCP 客户端的工具模式与被归属的说明加入请求；卸载则移除它们。此包不贡献自己的文本。

#### KV 缓存效果

当挂载在请求之间新增服务器时为追加式，当挂载改变工具列表时为替换式：下一次请求从工具区段起的 prefix 发生变化。保存、移除或禁用会改变已挂载集合，并可能从该点起使复用失效；若无变化，此包保留已可复用的 prefix。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **再次探测需要再次提供值。** `probe` 接收完整候选，因此重新测试一个已保存的服务器意味着再次提供其凭据值；只持有引用的调用方无法重测，这也是不提供按名探测工具的原因。
- **挂载是进程级的。** 记录按 owner 分区，但一个进程对每个服务器名只持有一个客户端。多 owner 部署若启用两个同名服务器，后者的挂载会显式失败，并将其行报告为未挂载，直到后续保存或启动重试。
- **挂载失败保留其行。** `save` 在挂载前先提交记录，因此挂载失败（缺少凭据，或全局命名空间重复）的服务器仍会列出、报告 `mounted: false`，并在下次启动时重试。
- **`probe` 不写入、也不读取接缝。** 候选值必须随 `probe` 输入传入，因此探测已保存服务器意味着重新输入其值；只知道引用的调用方无法在没有这些值的情况下探测。

不发布 invariant 配套组件，因为本包的单元规格已断言往返、带引用的接缝写入、针对真实端点的探测结论，以及挂载/卸载转换。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

引用由 `MCP_SECRET_REF_PREFIX` 加 `ownerId`、`serverName` 与 `entryName` 的大写十六进制 UTF-8 编码组成，用 `_` 分隔。十六进制不含 `_`，因此该编码是单射的，结果始终是合法的 POSIX 环境变量名。记录存储该引用，因此读取时通过 `ctx.credentials.describe` 报告值的存续状态，而无需解析它。

</details>
