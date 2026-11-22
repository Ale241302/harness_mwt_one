---
description: "原生产品连接（ctx.faberloomConnections）：由 owner 输入的每用户 IMAP、SMTP 与知识备份设置，独立于 MWT.ONE MCP；面向 FaberLoom Conexiones 模块的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-connections

[English](README.md) | 中文

## 概述

连接服务拥有 owner 为自己配置的集成：一个 IMAP 邮箱、一个 SMTP 发件服务器与一个知识备份目标。它们是 FaberLoom 自己的数据，通过 `ctx.storageDomain` 按身份存储，从不是 MWT.ONE MCP 操作。密码会被保存但绝不返回；`probe` 会真正检查配置——登录 IMAP 或 SMTP，或写入备份目标。`sendMail` 通过 owner 的 SMTP 行投递纯文本邮件，且每种类型各有一个默认行：SMTP 行的 `primary` 标志从不清除主要 IMAP 邮箱。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在存在 `ctx.storageDomain` 的组合中挂载本行。浏览器通过 `ctx.faberloomView.connections()`、`saveConnection`、`removeConnection` 与 `probeConnection` 读写它。

更新草稿时，省略的 `originUid`、`originReason` 与 `originMailbox` 会保留原值；来源、Space 或 AI 基线的变化会改变可恢复状态的哈希。`getDraft` 强制校验所有权；只有 `bindDraftSession` 写入 `agentSessionId`，且不改变 `updatedAt` 或该哈希；关联还会 CAS 校验先前的会话，并在已注入上下文时校验审阅修订。`recordDraftRevision` 对写入返回的准确草稿拍照，`listDraftRevisions` 与 `restoreDraftRevision` 维护按 owner 隔离、编号单调递增且仅追加的历史。快照保留完整消息、来源字段与附件字节；恢复会追加携带所给指令的 `restore` 修订。附件上限按解码后的字节计算，绝不使用调用方提供的 `size`，因此伪造的 `size` 无法让更大的文件绕过每文件 15 MB 与每草稿 30 MB 的限制。`updateDraft` 在存储写入链中校验所有权、草稿状态与预期哈希；`updateDraftAndRecord` 把 CAS 与准确快照的追加放入同一按草稿排序的操作链，但不会把两次表写入变成事务。恢复必须提供编辑器当前哈希，并使用同一个原子更新。`sendDraft` 在创建意图或联系 SMTP 前必须取得审阅时间戳与哈希。域 v2 可读取 v1 草稿，并把缺失的元数据规范化为 null。

可选出口策略限制连接可以访问哪些服务器。把 `FABERLOOM_EGRESS_DENY` 设为逗号分隔的主机或 `*.suffix` 模式；需要例外时再设 `FABERLOOM_EGRESS_ALLOW`。只要其中任一变量存在，策略即为默认拒绝：`imap`、`smtp`、`sendMail` 与 `probe` 会在任何套接字打开之前拒绝未获授权的主机——访问器抛出 `EGRESS_DENIED`，`probe` 返回失败结果。两个变量都不设时，服务与之前相同。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomConnections` 是供浏览器面板读取的宿主侧服务：不注册工具、不注入提示文本、不写入会话事件。

#### Token 影响

每个请求零直接 token。

#### KV 缓存影响

与实时请求无关：该服务从不触碰请求前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **密码存储在产品域中。** 目前没有字段级加密；静态保护依赖宿主卷与加密备份。托管密钥库延期。
- **仅纯文本邮件。** `sendMail` 发送 UTF-8 纯文本正文，无附件、无 HTML；multipart 邮件在合成模块需要时再实现。`AUTH LOGIN` 是唯一的认证机制；OAuth 提供方不在此列。
- **远程备份目标不在此处探测。** `probe` 会说明 rclone 目标由备份流程检查。
- **出口策略在服务加载时读取。** 修改 `FABERLOOM_EGRESS_DENY` 或 `FABERLOOM_EGRESS_ALLOW` 在下次重启后生效，而不是下一次调用。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

IMAP 探测直接通过 `node:tls`/`node:net` 说协议，因为宿主没有 IMAP 客户端；它读取问候语、发送 `LOGIN`，在带标记的回复上结束，并始终销毁套接字。

SMTP 一侧（`src/smtp.ts`）遵循同样的零依赖策略：`EHLO`、可选 `STARTTLS`、`AUTH LOGIN`，随后是发送时的 `MAIL FROM`/`RCPT TO`/`DATA`，带 dot-stuffing 与生成的 `Message-ID`。非 ASCII 头部按 RFC 2047 base64 编码，正文以 base64 发送，确保任何中继保留 UTF-8。

</details>

**Runtime invariant:** 不发布 companion。该服务不持有派生状态：每次读取都在调用时从存储域解析该 owner 的行。
