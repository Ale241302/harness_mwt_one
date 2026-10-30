# Agent Note: Mail a Space file as an attachment

Status: implemented

[English](2026-10-11-mail-space-file.md) | 中文

## Problem

Email 撰写器只能发送纯文本正文：`OutgoingMail` 仅携带 `from`、`to`、`subject` 与 `text`，`buildMessage` 只产出一个 `text/plain; base64` 部分。在撰写器里选择文件只是把文件名追加到正文（“Adjuntos: …”），收件人收不到任何文件。想把已存在于某个 Space 文件夹中的文档（刚保存的采购订单、生成的 proforma）发出的用户无从附加。

## Decision

两个层面承载该能力。

- **线协议。** `faberloom-connections` 新增 `OutgoingAttachment`（`name`、`mediaType`、`contentBase64`）与可选的 `OutgoingMail.attachments`。`buildMessage` 在无附件时保持 `text/plain; base64` 不变，否则产出 `multipart/mixed` 正文：先是文本部分，随后每个附件一个部分，带 `Content-Type: <mediaType>; name="…"`、`Content-Transfer-Encoding: base64` 与 `Content-Disposition: attachment`。非可打印 ASCII 的文件名以 RFC 2231 的 `filename*=UTF-8''…` 参数承载；名称中的引号与换行会被替换，避免破坏头部。`sendSmtp` 不变：它对 `buildMessage` 的产物做点填充并写出。
- **面板动作。** `faberloom-view` 新增 Remote `sendSpaceFileByEmail(id, path, to, subject, text)`。它经 `resolveSpaceDir` 解析该 Space 文件夹，并**拒绝逃逸该文件夹的路径**（`resolve` 必须落在文件夹根或其下），读取文件后调用 `connections.sendMail(actor.id, { to, subject, text, attachments: [{ name: basename(path), mediaType: 'application/octet-stream', contentBase64 }] })`。Email 撰写器新增目标 Space 选择器、文件路径输入与 **“发送 Space 文件”** 动作，调用它并报告得到的 `Message-ID`。

## Alternatives considered

**直接附加浏览器选中的文件。** 本动作否决：面板需要读取用户本地文件并把它经线传输，而产品的要点是文件已存在于 agent 所工作的 Space。（`onFiles` 仍是浏览器侧的能力，且仍只记录文件名。）

**按扩展名推断媒体类型。** 否决：SMTP 层不应携带媒体类型表；`application/octet-stream` 始终有效，收件人客户端仍能看到真实文件名。后续可由知道类型的调用方显式传入。

**在 view 侧而非 connections 服务构造 MIME 消息。** 否决：消息构造应与其写出的 SMTP 会话相邻，且现有 `buildMessage` 是测试可断言线上的唯一位置。

**允许主机上任意绝对路径。** 否决：面板动作不得邮寄主机上的任意文件；文件夹包含性检查即是强制点。

## Consequences

Space 文件可作为真实附件邮寄，且带附件的消息现在是任何邮件客户端都能读取的合法 multipart 文档。目标 Space 之外的路径会以明确错误被拒绝，因此该动作无法外泄用户未放入那里的文件。附件被读入内存并 base64 编码，故超大文件受调用方约束；大小上限待有消费者需要时再加。

## Testing

`packages/faberloom/connections/tests/connections.spec.ts` 通过假 SMTP 服务器发送一封带一个附件的邮件，并断言线上包含 `multipart/mixed`、boundary、`application/pdf` 部分头、`attachment; filename="proforma.pdf"` 处置与 base64 载荷。`packages/faberloom/view/tests/send-space-file-by-email.spec.ts` 覆盖：邮寄 Space 文件、拒绝逃逸路径、拒绝空收件人列表、以及未挂载邮件连接时拒绝。
