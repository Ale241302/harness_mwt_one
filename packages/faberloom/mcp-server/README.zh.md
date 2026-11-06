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
    publicationRepo: /data/usuarios/<id>/knowledge
```

端点默认监听 **unix socket**，因此一个容器服务多个 owner 也不会冲突；也可以改用回环 `port`，开发与测试用的就是它。只有 `enabled` 为真时才会监听。`publicationRepo` 指定发布读取器服务的本地 Git 工作树；为空时，除非挂载了发布服务，否则不发布 `faberloom_publication_read`。FaberLoom bundle 中的 `faberloom-publication` 行从 `FABERLOOM_PUBLICATION_*` 读取仓库与 S3/MinIO 端点、bucket、region、凭据与保留期；没有仓库时不挂载，读取器回退到本地 Git。

### 客户端与令牌

owner 在 **Conexiones → Servidor MCP** 创建令牌并把密钥交给另一个智能体；面板只显示一次，此后只列出指纹。请求以 `Authorization: Bearer <token>` 认证；未知、已撤销或属于其他 owner 的令牌返回 401。令牌记录创建面板当时使用的公司，因此外部智能体只能读写该公司的条目；没有公司的令牌只能读写没有公司的条目。令牌还可以为它的提案指定一个空间；这种令牌必须以 `faberloom_proposal_submit` 作为唯一 scope，并在每次使用时重新校验 owner 是否仍能读取该空间，成员资格丢失后停止。`spaceId: null` 是字段出现之前写入的、覆盖整个 home 的旧令牌。scope 列表收窄工具面孔（`null` 为 owner 的全部面孔）；存储列表中已退役的 scope 保留可用但被忽略，未知工具则在认证时拒绝。令牌存在产品自己的域里，因此按指纹撤销即可停掉该客户端，而无需触碰 harness。

**本地 OAuth 与工作引用。** 同一端点也是本地授权服务器。`GET /.well-known/oauth-authorization-server` 发布 issuer、MCP resource、S256 方法与 scopes。`GET /authorize` 校验本地客户端 `faberloom-local`、精确 loopback redirect、S256 PKCE、resource/受众，以及绝不把提案工具与其它工具混合的 scope 集；随后渲染命名空间与全部 scope 的等待页，页面没有批准控件。已登录的产品面板列出待处理请求，并通过视图批准或拒绝；决定存在后，`GET /authorize/status` 以一次性授权码或 `access_denied` 重定向。`POST /token` 把授权码（PKCE、精确 redirect/resource、五分钟寿命）换成有效期一小时的令牌，以及绑定连接、空间与修订的工作引用。该令牌的每次调用都必须发送 `x-faberloom-work-reference`；服务器重新校验引用的连接、owner、空间与当前成员资格，因此两个对话各自保留目标，进程中没有全局活动空间。撤销引用或令牌会切断调用，即使客户端保留引用。以 `faberloom_publication_read` 为 scope 的读取令牌只能读取其引用固定的修订；提案令牌不能读取，读取令牌也不能提案（CON-02）。公共 `/mcp` bridge 现在转发该头：网关把它加入排队请求，桌面端把同一引用交给同一校验。每个 owner 与客户端最多保留 `maxPendingAuthorizations`（默认 5）个未过期请求；再次 `/authorize` 会以 429 拒绝，直到其中一个被决定或过期。

### 端点回答什么

`initialize`、`ping`、`tools/list` 与 `tools/call`；通知以 202 接受且无正文。协议故障以 JSON-RPC 错误作答（`-32700`、`-32600`、`-32601`、`-32602`），而不是静默挂起。

这些工具以 owner 身份行事，并使用面板所用的同一批操作：

- `faberloom_overview`、`faberloom_routines`、`faberloom_executions`；
- `faberloom_teachings`、`faberloom_teaching_record`、`faberloom_teaching_revoke`；
- `faberloom_routine_run`，它经由例程引擎，因此遵守同一套自主权守卫：记录效果的步骤仍然需要有效授权；
- `faberloom_mirror_export`，把本 home 的产品行与技能文件作为唯一一份带版本的传输文档返回，以及 `faberloom_mirror_apply`，把一份文档应用回来。两者都要求 `faberloom-mirror` 行；没有该行的进程会以可读错误拒绝；
- `faberloom_proposal_submit`，接收一份知识提案（`archivo`、`versionBase`、`cambio`、`motivo`、`evidencia`、`claveCliente`、`title`），并以 `{ recibida: true, id }` 作答。它绝不批准：条目以 `PENDIENTE_CRITERIO` 进入 Mesa，重复的客户端键携带不同内容时返回 `PROPOSAL_CONFLICT`。它可以是令牌唯一被授权的工具。
- `faberloom_publication_read`，读取其工作引用固定提交上的一个仓库相对文件，并以 `{ revision, path, bytes, sha256, text }` 作答。挂载发布服务时，它读取不可变的 MinIO 对象并校验摘要；否则读取本地 Git 工作树。它从不接受调用方提供的修订或分支，拒绝逃逸工作树的路径，文件上限 1 MiB。当 `publicationRepo` 提供发布时，该连接上的提案必须以同一修订作为 `versionBase`；其它基础返回 `PROPOSAL_BASE_MISMATCH`。
- `faberloom_publication_publish`，发布一份已批准的知识提案：把批准的 diff 应用到配置的 Git 工作树，把提交后的字节以对象锁保留上传到 `publications/<commit>/<path>`，并只激活一次。它拒绝不是已批准 `propuesta-conocimiento` 的条目；同一批准的重复调用返回同一回执。只有挂载且就绪的 `ctx.faberloomPublication` 才会发布该工具。

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
- **OAuth 需要 loopback TCP 监听。** 只有服务器配置了 `port` 时才存在授权页与 `/token`；默认 Unix socket 没有浏览器可访问的 origin，会回答 `oauth_unavailable`。
- **引用围栏本地 Git 读取，而不是空间修订。** `faberloom_publication_read` 返回工作引用固定的提交，并拒绝分支或调用方提供的修订。挂载发布服务时，该提交是不可变的 MinIO 对象；未挂载时读取本地 Git 工作树。引用仍然只记录空间修订：之后空间变化不会拒绝看板调用。
- **旧令牌保留全部面孔。** `scopes: null` 的记录（包括 scope 字段出现之前写入的令牌）可以调用所有工具；只有新签发的受限令牌才会收窄，而提案令牌始终独占。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

`dispatch` 是纯函数：它接收已解析的消息与工具宿主并返回状态和正文，因此协议无需 socket 即可测试。传输测试绑定真实端点并通过 HTTP 驱动它，这正是端到端证明认证与守卫的方式。Windows 上的 Node 无法把任意文件系统路径绑定为 socket，这就是 `port` 存在的原因。

</details>

**运行时不变式：** 不发布 companion。该服务自身的持久状态是 `faberloom_mcp` 中的一张令牌表；其他所有答案都在调用时从 owner 的服务推导。
