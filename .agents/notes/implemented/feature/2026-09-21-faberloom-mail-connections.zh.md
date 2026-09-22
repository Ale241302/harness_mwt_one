# Agent Note: FaberLoom 邮件连接以所有者身份收发

Status: implemented

[English](2026-09-21-faberloom-mail-connections.md) | 中文

## 问题

Conexiones 此前只能保存 IMAP 邮箱和备份目标：所有者可以通过邮件触发例程事件，但助手既无法回答"在我的收件箱里找这封邮件"，也无法"以我的身份发送这条消息"。发送同时是一种外部副作用，而计划将其保留给实时授权（grant），因此发送路径必须经过自治（autonomy）检查，而不能从任意聊天回合直接发出。

## 决策

邮件按方向各作为一种连接类型，落在现有的产品服务内，不新建包。

`packages/faberloom/connections` 新增 `smtp` 连接类型和 `src/smtp.ts`——一个零依赖的 SMTP 客户端，遵循与 IMAP 探测相同的策略：`EHLO`、可选 `STARTTLS`、`AUTH LOGIN`，然后是带 dot-stuffing 和生成 `Message-ID` 的 `MAIL FROM`/`RCPT TO`/`DATA`。非 ASCII 头部按 RFC 2047 base64 编码，正文以 base64 发送，确保任何中继都保留 UTF-8。`probe()` 通过真实登录并直接退出来检查 SMTP 行；`smtp(ownerId, id?)` 仅向宿主侧消费者返回存储的凭据；`sendMail(ownerId, mail, connectionId?)` 通过主要（或首个完整的）SMTP 行投递。`primary` 标志现在按类型生效：一个主要邮箱供接收器读取，一个主要 SMTP 行用于外发邮件，二者互不清除。

`packages/faberloom/inbound` 新增 `searchMailbox(ownerId, query, limit?, connectionId?)`，以最新在前的方式回答来自聊天的邮箱查询。它优先使用服务器的 `UID SEARCH CHARSET UTF-8 TEXT`，当服务器拒绝该字符集时，回退为在最近信封中匹配 `From`/`Subject`。它从不推进接收器的游标，也从不触碰邮箱标志，因此搜索不会让触发器漏掉任何邮件。

`packages/faberloom/tool-faberloom` 注册两个模型工具：`faberloom_mail_search`（只读信封）和 `faberloom_mail_send`——后者经过现有的 `authorize` 软守卫，动作为 `mail.send`，因此聊天发起的发送需要与例程副作用相同的实时授权。Conexiones 面板现在可以按常用端口（465/587/25）编辑 SMTP 行、运行相同的自动测试，并在（重新标注为"高级"的）FaberLoom 令牌区上方展示新的 MWT.ONE 区块——身份、当前公司，以及按 `mcp__<server>__<tool>` 注册分组的已连接外部 MCP 服务器及其工具。

## 已考虑的替代方案

- **新建一个与 `faberloom/inbound` 对称的 outbound 包。** 否决：发送端只是同一凭据表上的一个客户端加一个访问器，整个包（清单、tsconfig、profile 行、README）并不能带来 connections 服务尚未提供的隔离。真正重要的对称性——像 IMAP 一样探测、像轮询器一样只读——落在两个客户端模块中。
- **引入邮件库依赖（如 nodemailer）。** 否决，理由与现有 IMAP 客户端一致：本仓库已经因为同样的原因（宿主中没有客户端库）用原始 socket 实现 IMAP，而发送部分只需要纯文本子集。
- **用户在聊天中刚提出要求时不经授权直接发送。** 否决：自治模型无论渠道如何都区分"准备"与"发送"，且授权 UI 已支持任意动作字符串；错误信息会明确指出需要授权的动作。

## 后果

- 探测或发送失败时会报告服务器自己的应答（超时、`535`、socket 错误）；测试没有任何模拟成分，且探测绝不发送消息。
- 外发邮件不需要模型可见的凭据：浏览器永远收不到密钥，工具通过 connections 服务在宿主侧解析它。
- `AUTH LOGIN` 和纯文本正文是整个 SMTP 范围；附件、HTML 和 OAuth 提供商被推迟，并记录在 connections 的 README 中。
- MWT.ONE 区块在调用时读取实时工具注册表，因此未挂载 MCP 客户端的部署会显示空状态，而不是伪造的服务器列表。
