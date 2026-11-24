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

`convertAttachments` 把一封邮件的文件转成 Markdown，好让读取方 —— 邮件面板或 `faberloom_mail_read` —— 看到文件里面的内容，而不只是文件名。自带文本的文档交给外部 `anydoc` 转换器。图片，以及本身是图片的 PDF 页面，走本地 OCR：`pdftoppm` 以 200 dpi 把扫描版 PDF 逐页栅格化，`deploy/ocr/ocr-tools.py deskew` 在页面到达时是倾斜的就先把它端正，`tesseract` 随后读取，每页带一行 `--- página N ---` 标记。词置信度中位数低于 75 的页面会在同一趟里用 RapidOCR 重读一次。每个进程都通过 `ctx.subprocess` 跑在本机，因此在 `local` 模式下文档从不离开部署，也不需要任何服务商密钥。

按约定，提取是尽力而为：缺少二进制、受保护的 PDF、超时的页面、超出大小上限的附件或页数上限，都只让该附件没有文本并给出原因 —— `ocr-disabled`、`ocr-failed`、`timeout`、`empty`、`oversized`、`unsupported`、`converter-missing` —— 邮件读取仍返回正文。图片永远不会送给本机文档转换器：`off` 把它报告为 `ocr-disabled`，只有 `hosted` 会把它发给 Parse，因为把图片交给本机转换器只会得到一次假失败。

`FABERLOOM_OCR` 选择路径：`off`（代码默认）跳过没有文本的附件，`local` 在本机用 Tesseract、RapidOCR、LibreOffice 与 Poppler 读取，`hosted` 用 `FIRECRAWL_API_KEY` 把扫描版 PDF 发给 Firecrawl Parse。图片在这个包里没有 hosted 路径：图片要么在本机读取，要么不读，所以一个不付费的部署会把每个附件都留在自己的机器上。`ANYDOC_OCR` 命名同一组模式，网关仍会转发它，因此只设置该变量的部署行为相同。上限是安全不变量，不是可调项：每个附件 25 MB、保留文本 200 KB、每次转换 20 秒、每页 Tesseract 20 秒、每页端正 20 秒、每次第二引擎批处理 90 秒、每个 PDF 180 秒、每个 PDF 10 页、每次 Office 转换 60 秒、每个 Office 文档 150 秒、生成的 PDF 50 MB。

### 倾斜或手写的页面

歪着到达的页面会丢掉大部分文本：在四张真实小票上左右各旋转 7 度之后，Tesseract 只对上了五个校验金额中的零到两个。`straighten`（`src/ocr.ts`，调用 `deploy/ocr/ocr-tools.py deskew`）在 -12 到 12 度之间搜索能把墨迹集中到最少行上的旋转角，并在识别之前重写页面；同样的小票随后五个全对。中位词置信度仍低于 75 的页面 —— 一张手写发票的手机照片是 52，而印刷页在 90 到 96 —— 会用 RapidOCR（PP-OCR over ONNX，跑在本机 CPU 上）重读，它在 Tesseract 只对上三个字段的地方对上了五个。同一份文档的页面会合并成一次调用一起升级，因为引擎每个进程都要加载模型。没有 `python3` 或没有 `/opt/ocr/py` 时两步都跳过，页面完全按 Tesseract 的读法读取，所以部署是降级而不是失败。

第二个引擎保留页面的行：中心落在同一高度的行合成一行，单元格之间用 ` | ` 连接，所以真实小票上的 `Sirloin 450 gr … 11.382` 会以 `Sirloin 450 gr | 11.382` 到达，拍照的表格保住列而不是塌成单行。印刷页用拉丁识别模型读取，它保留了默认模型丢掉的词间空格与重音符号（`Muito Work Limitada`、`Ensalada Caprese`）；中位行置信度低于 0.98 的页面继续用默认模型，因为它在手写照片上读对的字段是拉丁模型的两倍。引擎评分低于 0.85 且至少有四个字符的行会加上 `[?]` 前缀：真实照片上的手写证件号被所有实测引擎读错，这个标记让猜测不会被当成事实。

### 扫描版 Word、Excel 或 PowerPoint

内容全是图片的 `.doc`、`.docx`、`.xls`、`.xlsx`、`.ppt`、`.pptx`、`.odt`、`.ods`、`.odp` 或 `.rtf` 没有任何 anydoc 能读的文本，转换器因此返回空，过去该附件被报告为 `empty`。在 `local` 模式下，`ocrOffice`（`src/office.ts`）按原扩展名写出文件，在临时目录里运行 `libreoffice --headless --convert-to pdf`，再把生成的 PDF 交给同一套逐页 OCR。只要转换器有文本，文本仍然优先；这条路径只覆盖它读不出的文档。每次转换使用独立的 LibreOffice 配置目录，因此一趟里的两个附件不会争用同一个锁；临时目录在成功与失败时都会被删除。没有 LibreOffice 时该附件报告为 `converter-missing`；转换以非零退出、没有写出 PDF，或写出的 PDF 为空，都报告为 `ocr-failed`。

### 图片

图片没有可供转换器读取的文本，因此永远到不了 `anydoc`。在 `local` 下，`ocrImage` 把字节写入临时目录，并用 `tesseract <file> stdout -l spa+eng` 读取该文件，格式由字节本身决定，所以一个其实是 GIF 的 `.png` 也能读。在 `off` 或 `hosted` 下，附件报告 `ocr-disabled`：这个包没有任何把图片发给第三方的路径，想要读就得在本机读，否则不读。Tesseract 不是排版引擎，拍照的表格会以行返回。在一份真实采购单 150-400 dpi 的渲染图上，它把两个料号和总额都读对了，所以数字在那里不是弱点；手机拍照、手写或折页才是，上面讲的端正与第二引擎正是为此。从图片读到的料号在有人对照文档之前仍然只是线索。

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
- **Office 文档是按页面图片来读的。** 扫描版 `.docx`、`.xlsx` 或 `.pptx` 必须先由 LibreOffice 渲染成 PDF 才能进入本地 OCR，因此部署需要装 `libreoffice`，否则该附件报告为 `converter-missing`；Tesseract 返回文本而不是版式，因此表格以行到达，列的位置要由读取方重建。
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
