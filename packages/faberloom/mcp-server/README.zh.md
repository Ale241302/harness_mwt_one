---
description: "原生产品 MCP 服务器（ctx.faberloomMcpServer）：FaberLoom 自己的服务端面孔，让另一个 AI 通过 MCP Streamable HTTP、用 owner 创建并撤销的令牌读取和管理其工作；面向前端 Conexiones（连接）模块的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-mcp-server

[English](README.md) | 中文

## 概述

计划让 FaberLoom 站在 MCP 的两侧：既是 MWT.ONE 控制台的客户端，也是其他 AI 连接的服务器。本包就是服务端面孔。harness 提供 MCP 客户端与 resources，但没有服务器，因此协议、传输与身份都在这里：MCP Streamable HTTP 端点之上的 JSON-RPC 2.0、每个客户端一个 bearer 令牌，以及经由产品服务作答的每一次调用。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 owner 的产品服务存在的位置挂载这一行，并带上身份与传输：

```yaml
- id: faberloom-mcp-server
  config:
    ownerId: usuario@ejemplo.com
    enabled: true
    socketPath: /data/users/<id>/faberloom-mcp.sock
```

端点默认监听 **unix socket**，因此一个容器服务多个 owner 也不会冲突；也可以改用回环 `port`，开发与测试用的就是它。只有 `enabled` 为真时才会监听。

### 客户端与令牌

owner 在 **Conexiones → Servidor MCP** 创建令牌并交给另一个智能体。请求以 `Authorization: Bearer <token>` 认证；未知或已撤销的令牌返回 401，属于其他 owner 的令牌即使本进程能读到也会被拒绝。令牌存在产品自己的域里，因此撤销一个令牌即可停掉该客户端，而无需触碰 harness。

### 端点回答什么

`initialize`、`ping`、`tools/list` 与 `tools/call`；通知以 202 接受且无正文。协议故障以 JSON-RPC 错误作答（`-32700`、`-32600`、`-32601`、`-32602`），而不是静默挂起。

这些工具以 owner 身份行事，并使用面板所用的同一批操作：

- `faberloom_overview`、`faberloom_routines`、`faberloom_executions`；
- `faberloom_teachings`、`faberloom_teaching_record`、`faberloom_teaching_revoke`；
- `faberloom_routine_run`，它经由例程引擎，因此遵守同一套自主权守卫：记录效果的步骤仍然需要有效授权。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

本身没有：`ctx.faberloomMcpServer` 不注册工具、不写提示文本。外部模型看到的是上面的工具目录，结果 JSON 与面板读到的一致，因此外部智能体与产品界面不会对同一个案件产生分歧。

#### Token 影响

每次请求的额外 token 为零。每次调用转发到产品服务，代价就是它们的代价：读取免费，运行例程的代价等于其步骤的代价。

#### KV 缓存影响

与实时请求无关：端点从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **dsh 必须在运行，其 socket 才存在。** 部署中的网关会在收到 MCP 请求时用 owner 上次登录时保存的身份启动其 harness；没有保存身份的部署会回答 503。每 owner 常驻进程是 E8 的工作。
- **每次 HTTP 调用一个请求，无流式。** 传输只回一个 JSON 正文，不实现 server-sent events，因此长时间工作不会流式返回给客户端；通知会被接受，但不会推送任何东西。
- **七个工具，以读为主。** 目录覆盖计划的发现需求；空间、代理与看板的写入推迟到各自的守卫语义确定之后。
- **没有按工具的权限范围。** 每个令牌都携带 owner 的全部面孔。把令牌收窄到工具子集留待后续。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

`dispatch` 是纯函数：它接收已解析的消息与工具宿主并返回状态和正文，因此协议无需 socket 即可测试。传输测试绑定真实端点并通过 HTTP 驱动它，这正是端到端证明认证与守卫的方式。Windows 上的 Node 无法把任意文件系统路径绑定为 socket，这就是 `port` 存在的原因。

</details>

**运行时不变式：** 不发布 companion。该服务自身的持久状态是 `faberloom_mcp` 中的一张令牌表；其他所有答案都在调用时从 owner 的服务推导。
