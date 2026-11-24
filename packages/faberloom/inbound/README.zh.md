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

`enabled` 默认为关闭，`intervalMs` 默认为五分钟，`mailbox` 默认为 `INBOX`，每趟**每个账户**最多读取二十封邮件。账户的第一趟查找**未读**邮件；之后的趟按该账户已存游标之上的 UID 请求，因此旧邮箱不会被重放。

接收器通过 `ctx.faberloomConnections.imap()` 读取 owner 的凭据 —— 那是唯一会返回已存密钥的访问器，专为这个宿主侧消费者而存在。浏览器仍读取连接列表，它从不返回密钥。

### 取一封邮件指向的资源

`fetchPublicResource` 是这个包为邮件携带的地址准备的守卫：下载链接，或读取方要绘制的图片。它解析主机名，当任一应答是私有、回环、链路本地、多播或保留地址时拒绝请求，用原始 `Host` 与 TLS 名称把连接钉在已检查的地址上，每次重定向都重复整套检查，并为整条链路限定时间与字节。`tool-faberloom` 用它实现 `faberloom_mail_download`；`view` 用它实现 `emailImage`。它从包根导出，因为两个消费者都面向邮件，且谁都不能依赖另一个。

### 读进附件内部

`convertAttachments` 把一封邮件的文件转成 Markdown，好让读取方 —— 邮件面板或 `faberloom_mail_read` —— 看到文件里面的内容，而不只是文件名。自带文本的文档交给外部 `anydoc` 转换器。图片，以及本身是图片的 PDF 页面，走本地 OCR：`tesseract` 从 stdin 读取一张图片，`pdftoppm` 以 200 dpi 把扫描版 PDF 逐页栅格化，再把每一页交回 Tesseract，每页带一行 `--- página N ---` 标记。两个二进制都通过 `ctx.subprocess` 跑在本机，因此文档从不离开部署，也不需要任何服务商密钥。

按约定，提取是尽力而为：缺少二进制、受保护的 PDF、超时的页面、超出大小上限的附件或页数上限，都只让该附件没有文本并给出原因 —— `ocr-disabled`、`ocr-failed`、`timeout`、`empty`、`oversized`、`unsupported`、`converter-missing` —— 邮件读取仍返回正文。图片永远不会送给转换器：没有本地 OCR 时它被报告为 `ocr-disabled`，因为把图片交给文档转换器只会得到一次假失败。

`FABERLOOM_OCR` 选择路径：`off`（代码默认）跳过没有文本的附件，`local` 在本机读取，`hosted` 用 `FIRECRAWL_API_KEY` 把 PDF 发给 Firecrawl Parse。`ANYDOC_OCR` 命名同一组模式，网关仍在转发它，因此只设该变量的部署得到相同行为。上限是安全不变量而非可调项：每个附件 25 MB、保留 200 KB 文本、每次转换 20 秒、每个 OCR 页面 20 秒、每个 PDF 90 秒、每个 PDF 10 页。

### 两个账户

一趟会读取 owner 保存的**每一个** IMAP 连接，各自持有游标。某个账户失败只报告该账户，其余照常运行：报告带有 `accounts` 数组和合并的 `error`，失败既不会中断这一趟，也不会掩盖可用的邮箱。失败账户的游标不前进，下一趟恰好重试它漏掉的内容；重读是安全的，因为事件键带有连接和邮件标识，引擎会去重重复项。

### 一趟做什么

1. 解析每一个 IMAP 连接；缺失或不可用按账户报告，而不是抛出。
2. 读取新邮件的信封（`Message-ID`、`From`、`Subject`、`Date`），每账户每趟最多 `maxMessages` 封。
3. 把每一封作为 `email` 事件交给 `ingest`，并记录读取到的最高 UID。
4. 报告每个账户读取了什么、启动了哪些运行，以及邮箱返回的所有失败。

幂等属于引擎，而不属于轮询器：事件键在有 `Message-ID` 时用它，否则用邮箱 UID，因此重读同一封邮件永不重复启动同一次运行。

镜像到 VPS 的桌面端（`FABERLOOM_MIRROR_ENABLED=1`，平台不是 `web`）读取与 VPS 相同的邮箱，而执行不会在两者之间传递。VPS 负责可在云端运行的例程由邮件触发的运行，因此桌面端以 `skipCloudReady` 摄取，只启动其步骤需要 PC 的例程；同一封邮件永远不会在两边运行同一个例程。

接收器从不写入邮箱。它不标记已读、不移动、也不删除邮件：owner 自己的邮件客户端保持其原有状态。`markSeen` 与 `moveToTrash` 在服务中以 E1 拒绝（`WRITE_NOT_APPROVED`）存在，而不是静默空操作，因此尝试修改邮箱的调用方会看到拒绝，服务器保持逐字节不变。

`searchMailbox(ownerId, query, limit?, connectionId?)` 以最新在前的方式，在同一个邮箱上回答来自聊天的查询，并报告自己的覆盖范围。它优先使用服务器的 `UID SEARCH`；当服务器拒绝 UTF-8 字符集时，回退为在最近信封中匹配 `From`/`Subject`，此时结果给出 `complete: false` 以及 `scanned` 和 `total`，而不是把窗口当成整个邮箱。它与轮询器同样只读，且从不推进接收器的游标，因此搜索不会让触发器漏掉任何邮件。模型通过 `faberloom_mail_search` 工具触达它，该工具把账户写入每一行并重复覆盖范围警告。

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
- **本地 OCR 只覆盖 PDF 与位图。** 扫描版 Word 或 Excel 仍不转换：没有东西把它的页面渲染成图片。Tesseract 返回文本而不是版式，因此表格以行到达，列的位置要由读取方重建。
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
