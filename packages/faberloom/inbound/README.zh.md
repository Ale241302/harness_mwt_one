---
description: "原生产品入站接收器（ctx.faberloomInbound）：轮询 owner 在 Conexiones 中配置的 IMAP 邮箱，把新邮件转换为例程事件，且不触碰其邮件；面向前端 Rutinas（例程）模块的用户与维护者。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-inbound

[English](README.md) | 中文

## 概述

本包把 owner 的邮箱与其例程连接成闭环。owner 在 Conexiones 中配置 IMAP 连接；接收器按定时器轮询它，读取自其游标以来到达的邮件信封，并把每一封交给例程引擎 —— 在那里，`email` 触发器与主题匹配的已激活例程会开始一次运行。无需任何人打开面板，也无需任何邮件服务器回调我们。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在存在 `ctx.faberloomRoutines`、`ctx.faberloomConnections` 与 `ctx.storageDomain` 的位置挂载这一行：

```yaml
- id: faberloom-inbound
  config:
    ownerId: usuario@ejemplo.com
    enabled: true
    intervalMs: 300000
    mailbox: INBOX
```

`enabled` 默认为关闭，`intervalMs` 默认为五分钟，`mailbox` 默认为 `INBOX`，每趟最多读取二十封邮件。第一趟查找**未读**邮件；之后的趟按该连接已存游标之上的 UID 请求，因此旧邮箱不会被重放。

接收器通过 `ctx.faberloomConnections.imap()` 读取 owner 的凭据 —— 那是唯一会返回已存密钥的访问器，专为这个宿主侧消费者而存在。浏览器仍读取连接列表，它从不返回密钥。

### 一趟做什么

1. 解析 owner 的邮箱连接；缺失或不可用会被报告，而不是抛出。
2. 读取新邮件的信封（`Message-ID`、`From`、`Subject`、`Date`）。
3. 把每一封作为 `email` 事件交给 `ingest`，并记录读取到的最高 UID。
4. 报告读取了什么、启动了哪些运行，以及邮箱返回的任何失败。

幂等属于引擎，而不属于轮询器：事件键在有 `Message-ID` 时用它，否则用邮箱 UID，因此重读同一封邮件永不重复启动同一次运行。

接收器从不写入邮箱。它不标记已读、不移动、也不删除邮件：owner 自己的邮件客户端保持其原有状态。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有直接影响。`ctx.faberloomInbound` 不注册工具、不写提示文本；到达模型的是它启动的每次运行的步骤轮次，其在案件上下文中以 JSON 收到该事件（`mailbox`、`uid`、`from`、`date`、`receivedAt`）。

#### Token 影响

直接消耗为零。每次启动的运行的代价等于其步骤的代价。

#### KV 缓存影响

与实时请求无关：轮询器从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **只有信封，没有正文。** 一趟只取头字段；传输编码、multipart 与附件尚未解码，因此需要邮件正文的步骤目前无法从事件中读到它。
- **仅隐式 TLS 与明文 IMAP。** STARTTLS 协商尚未实现；连接的 `secure` 标记决定是连接即 TLS 还是明文连接。
- **一趟是读取，不是订阅。** 目前有意不做 `IDLE`（服务器推送），因此一封邮件最多等一个间隔。新邮件通过轮询发现。
- **每个 owner 一个邮箱。** 接收器读取第一个可用 IMAP 连接；在多个连接间选择留待后续。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

客户端是带字面量感知缓冲的标记命令子集：FETCH 响应以 `* n FETCH (UID n BODY[…]{size}` 开头，随后是恰好 `size` 字节的头。它通过基于 `node:net` 的假 IMAP 服务器做了端到端测试，这也证明这一趟不依赖真实服务商。

</details>

**运行时不变式：** 不发布 companion。接收器自身的持久状态是每个连接一个游标，位于 `faberloom_inbound`；每个调度决定都从该游标与邮箱推导。
