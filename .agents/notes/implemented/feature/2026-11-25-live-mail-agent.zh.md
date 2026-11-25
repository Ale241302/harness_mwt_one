# Agent Note：实时邮件代理、线程记忆与真实附件

Status: implemented

[English](2026-11-25-live-mail-agent.md) | 中文

## 问题

实时邮件代理已经停止生成草稿，而周围代码中的三个弱点让这次故障难以被发现。

"Vigía de correo" 例程原本由 `marluvasLiveMailRoutine()` 为任何拥有 506 或 alvaro 邮箱的 admin/CEO 配置（`packages/faberloom/inbound/src/index.ts`，`isMarluvasMailbox`）。配置按名称收敛一个例程，因此 Marluvas 的 expediente 步骤替换了通用分类/起草步骤。当前启用的例程没有 `faberloom_email_draft` 调用，并写着"不要发送邮件"。最后一封机器撰写的草稿是 2026-10-30；所有者在 2026-11-23 看到的那一行，是同一封草稿被再次保存。

Marluvas 目录代理带有 `provider: anthropic`、`model: claude-sonnet-4-5`。Anthropic 账户没有余额，因此自 2026-11-19 起，每次 Marluvas 运行的每一步都失败：`400 invalid_request_error: Your credit balance is too low`。当天有 1,770 次事件执行失败；例程继续触发并继续失败。

收件接收器以 `imap:<connection>:<Message-ID>` 作为一次出现的键（`inbound/src/index.ts`，`pollAccount`）。同一封邮件投递到 506 和 alejandro 会产生两次执行：存储历史中有 103 封邮件到达了两个连接。若存在起草步骤，就会产生两封草稿。

草稿没有记忆：不知道哪些邮件已回复、已丢弃或已有草稿。`deleteEmailDraft` 会提出一条 `email-skip` 课程候选，但候选未激活，实时例程也从不读取。

机器草稿只把签名作为纯文本携带，因此面板从不显示签名块，所有者的签名表也是空的。

附件只能从邮箱邮件（`attachFromUid`）或草稿自己的 Space（`attachFromSpaceFileId`）复制，而后者需要所有者确认，实时代理无法完成。保存在 MWT.ONE expediente 中的文档没有进入草稿的路径。

回复 MCP 邮件的草稿通过服务器的 `send_email` 发出，而 `mcpDraftDelivery` 的负载不携带附件。附加到此类草稿的文件会被无错误地丢弃。

## 决定

### 两个例程，两个名称

`LIVE_MAIL_ROUTINE` 保留名称 "Vigía de correo"，是回复例程：一个代理步骤完成分类，按激活的 `email-trash` 课程丢弃，否则调用一次 `faberloom_email_draft`。`marluvasExpedienteRoutine()` 以 "Operadora Marluvas" 配置，保留 triage/operate/verify 步骤和 `Operador Marluvas` 代理。

`inbound.ensureLiveMailRoutine` 与 `view.ensureBuiltinRoutines` 为每个同时拥有 IMAP 与 SMTP 的所有者配置回复例程，并额外为 Marluvas 邮箱配置操作员例程。每个例程按自己的名称收敛，互不替换。

### 每封邮件一次出现，每封回复一个账户

当信封带有 id 时，事件键为 `imap:msg:<Message-ID>`；没有 id 时才使用连接范围的回退键。第一个报告该邮件的邮箱启动运行；事件仍携带 `mailbox`、`uid` 和 `connectionId` 供步骤读取。

`faberloom_email_draft` 从邮件本身解析发件账户：`To` 中第一个属于所有者 IMAP 连接的地址，其次是匹配的 `Cc` 地址，最后才是读取器的连接。发送到 506 并抄送 alejandro 的邮件，即使 watcher 报告的是 alejandro 副本，也从 506 回复。

### 线程记住 drafted、sent 与 dismissed

`mail_threads` 是 connections 域中的新表，按所有者、发件账户和线程根（`References[0]`，否则是被回复的 `Message-ID`）索引。每行存储被回复的邮件、状态、草稿和所有者的原因。

- `drafted` 阻止同一线程中的第二封待处理草稿；工具返回 `MAIL_DRAFT_EXISTS` 并指出已有草稿。
- `sent` 阻止为同一封被回复邮件再起草；线程中更新的邮件允许新草稿。
- `dismissed` 阻止同一封被回复邮件；更新的邮件仍可起草。
- `removeDraft` 在删除草稿的同一动作中写入 `dismissed`，所有者的垃圾桶手势立即生效。
- `sendDraft` 在确认发送后写入 `sent`，所有传输一致。
- `emailDraftWithAi` 写入 `drafted`，因此面板草稿也算作该线程唯一的待处理草稿。

### 签名是 HTML，不是文本

`draftHtml(text, signature)` 用正文和账户的 `signatureContent` 构建草稿的 HTML 替代部分，并用 `<div data-email-signature="auto">` 包裹签名。撰写器的标记在重新打开草稿时保持恰好一个签名块，发送时原样传输编写的标记。所有者的签名已为 506、alvaro 和主账户存储；没有存储签名的草稿仍以段落形式携带正文。

### 附件来自线程、Space 或签名 URL

`attachFromSpaceFileId` 现在接受所有者可读取的任意 Space 文件；所有者范围的读取才是边界，而不是草稿的 Space。`attachFromUrl` 复制 HTTPS 签名 URL 后的字节，`attachUrlName` 与 `attachUrlMediaType` 提供名称和类型。它拒绝非 HTTPS、私有与链路本地主机、未知媒体类型、超过 15 MB 以及非 2xx 应答。

回复例程的指令规定来源顺序：先是线程附件；仅当邮件提到 OC、SAP、PF、BL、AWB 或集装箱时，才通过 `documento_descargar` 或 `artefacto_archivo_descargar` 加 `attachFromUrl` 获取 expediente 的文档或产物；否则完全不查询 MWT。

### MCP 发送绝不丢弃文件

`mcpDraftDelivery` 读取服务器实际声明的 `send_email` schema（`FaberLoomMcpRegistry.toolSchemaFor`）。当草稿带文件且 schema 声明了 `attachments` 或 `files` 数组时，每个文件映射到声明的条目字段。若未声明，发送会被拒绝并说明原因，而不是在没有文件的情况下传输邮件。

### 五分钟头部扫描

`FaberLoomInbound` 为每个连接保留扫描时刻（`sweepIntervalMs`，默认 300 000），到期时重读最新的 20 个信封，并重新注入 `Date` 落在最近 15 分钟内的邮件。引擎对已见过的键去重，因此扫描能恢复游标跳过的邮件，而不会复活历史。

### 所有代理运行在部署模型上

12 个 home 中持久化的 428 个代理已改写为 `deepseek-official` / `deepseek-flash`，并清除 Anthropic 密钥，保留职责、技能、工具、子代理与连接。每个存储旁保留 `*.bak-agent-model-*` 备份。新代理继承部署默认值（`FABERLOOM_AGENT_PROVIDER`、`FABERLOOM_AGENT_MODEL`），目录无需固定供应商。

## 契约细节

| 字段 | 所有者 | 不变式 |
|---|---|---|
| `imap:msg:<Message-ID>` | inbound | 跨邮箱每封邮件一次执行；回退键保持连接与 uid 范围。 |
| `mail_threads` 行 | connections | 按所有者、账户和线程根索引；被回复的邮件决定是否允许新草稿。 |
| `dismissed` | connections | 删除草稿时写入，先于所有者看到列表刷新。 |
| `sent` | connections | 仅在传输确认后写入，SMTP 与 MCP 一致。 |
| `drafts.html` | connections | 编写的标记；签名块带有 `data-email-signature`。 |
| `attachFromUrl` | tool-faberloom | 仅 HTTPS、公共主机、已声明文档媒体类型、最多 15 MB。 |
| `toolSchemaFor` | mcp-registry | 读取已挂载工具声明的 JSON 参数；未知时为 null。 |
| `sweepIntervalMs` | inbound | 至少 10 秒；每次扫描只重新注入最近 15 分钟的邮件。 |

## 考虑过的替代方案

**保留一个例程并在 Marluvas 定义中加入起草步骤。** 否决：Marluvas 代理需要 expediente 剧本，回复代理需要语气与线程规则；一个代理同时做两件事使每封邮件的 token 翻倍，并把两个故障耦合在一起。名称冲突也使部署其中一个会静默替换另一个。

**按主题和发件人去重。** 否决：两封不同邮件可能共享主题，回复链也会改变主题前缀。`Message-ID` 是邮件自身的身份。

**以每封邮件的 `Message-ID` 作为线程键。** 否决：那是被回复邮件的键，会允许同一线程出现第二封待处理草稿。根 id 加待处理草稿检查才能保证每线程一封。

**只把签名存进草稿文本。** 否决：面板渲染 HTML，纯文本签名无法携带粗体、分隔线或 mailto 链接。标记可防止编辑器叠加第二个签名块。

**让主机自己调用 MWT MCP 取文档。** 本次否决：代理已经持有 MWT 工具返回的签名 URL，工具只需抓取公共 HTTPS 字节。主机 MWT 客户端会重复凭据与权限路径。

**MCP 发送静默失败或省略文件。** 否决：所有者批准的是带附件的邮件。拒绝会说明限制并保留草稿。

## 验证

1. `packages/faberloom/routines/tests/equality.spec.ts` 断言 Marluvas 定义在存储规范化形状下保持相等，并保留目录代理名称。
2. `packages/faberloom/inbound/tests/inbound.spec.ts` 将回复例程与 Marluvas 操作员配置为两个独立的活动例程；允许列表之外只保留回复例程；两个邮箱读取同一 `Message-ID` 时只启动一次执行；执行头部扫描而不重新启动已见邮件。
3. `packages/faberloom/connections/tests/mail-threads.spec.ts` 按邮箱往返线程状态，通过投递桩标记 `sent`，并在丢弃时标记 `dismissed`。
4. `packages/faberloom/connections/tests/signature.spec.ts` 断言签名标记、段落回退和无签名正文。
5. `packages/faberloom/tool-faberloom/tests/draft-tools.spec.ts` 从 `To` 邮箱回复，拒绝 `sent`/`dismissed`/待处理，复制另一 Space 的文件，复制签名 URL 并拒绝私有主机。
6. `packages/faberloom/view/tests/mcp-send.spec.ts` 在未声明列表时拒绝丢弃附件，并按声明的条目字段映射。
7. `tsc -b tsconfig.host.json` 与 `tsconfig.client.json` 干净；connections、inbound、routines、tool-faberloom、mcp-registry 与 view 的重点测试套件为绿。

## 后果

- 实时回复代理现在运行在部署的 DeepSeek 模型上。未来 Anthropic 余额问题不再使它停止，供应商切换是配置变更。
- 删除草稿立即表示"不要回复这封邮件"；`email-skip` 课程候选仍会记录该模式以供未来邮件使用。
- 回复现在可以携带 expediente 文档而无需人工上传，但由模型判断邮件是否提到引用。指令禁止在未提及时进行任何 MWT 查询。
- MCP `send_email` schema 决定附件能否发出；面板得到明确的拒绝，绝不会静默丢弃。
- MCP 邮件仍没有收件 watcher：其邮件不会启动回复例程。发送路径与草稿模型已为该来源准备好；watcher 是下一个所有者。
- 扫描仅覆盖最近 15 分钟的未读邮件。所有者在代理看到之前已读的邮件不在扫描范围内。
