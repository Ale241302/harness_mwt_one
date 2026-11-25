# Agent Note：实时邮件代理、线程记忆与真实附件

Status: implemented

[English](2026-11-25-live-mail-agent.md) | 中文

## 问题

实时邮件代理已经停止生成草稿，而周围代码中的三个弱点让这次故障难以被发现。

"Vigía de correo" 例程原本由 `marluvasLiveMailRoutine()` 为任何拥有 506 或 alvaro 邮箱的 admin/CEO 配置（`packages/faberloom/inbound/src/index.ts`，`isMarluvasMailbox`）。配置按名称收敛一个例程，因此 Marluvas 的 expediente 步骤替换了通用分类/起草步骤。当前启用的例程没有 `faberloom_email_draft` 调用，并写着"不要发送邮件"。最后一封机器撰写的草稿是 2026-10-30；所有者在 2026-11-23 看到的那一行，是同一封草稿被再次保存。

Marluvas 目录代理带有 `provider: anthropic`、`model: claude-sonnet-4-5`。Anthropic 账户没有余额，因此自 2026-11-19 起，每次 Marluvas 运行的每一步都失败：`400 invalid_request_error: Your credit balance is too low`。当天有 1,770 次事件执行失败；例程继续触发并继续失败。

收件接收器在信封带有 id 时以 `imap:msg:<Message-ID>` 作为一次出现的键（`inbound/src/index.ts`，`pollAccount`）。同一封邮件投递到 506 和 alejandro 会产生两次执行：存储历史中有 103 封邮件到达了两个连接。若存在起草步骤，就会产生两封草稿。

没有 watcher 读取 MCP 邮件。只存在于已挂载 MCP 邮箱中的邮件不会产生事件，因此回复例程从来看不到它，尽管草稿与发送路径已经理解它的合成 id。

扫描只看最近十五分钟内的最新二十个未读信封。大于一个轮询批次的突发、所有者已经读过的邮件，或更早的未读邮件，都留在扫描之外。

草稿没有记忆：不知道哪些邮件已回复、已丢弃或已有草稿。`deleteEmailDraft` 会提出一条 `email-skip` 课程候选，但候选未激活，实时例程也从不读取。

机器草稿只把签名作为纯文本携带，因此面板从不显示签名块，所有者的签名表也是空的。

附件只能从邮箱邮件（`attachFromUid`）或草稿自己的 Space（`attachFromSpaceFileId`）复制，而后者需要所有者确认，实时代理无法完成。保存在 MWT.ONE expediente 中的文档没有进入草稿的路径。

回复 MCP 邮件的草稿通过服务器的 `send_email` 发出，而 `mcpDraftDelivery` 的负载不携带附件。附加到此类草稿的文件会被无错误地丢弃。

## 决定

### 两个例程，两个名称

`LIVE_MAIL_ROUTINE` 保留名称 "Vigía de correo"，是回复例程：一个代理步骤完成分类，按激活的 `email-trash` 课程丢弃，否则调用一次 `faberloom_email_draft`。`marluvasExpedienteRoutine()` 以 "Operadora Marluvas" 配置，保留 triage/operate/verify 步骤和 `Operador Marluvas` 代理。

`inbound.ensureLiveMailRoutine` 与 `view.ensureBuiltinRoutines` 为每个同时拥有 IMAP 与 SMTP 的所有者配置回复例程，并额外为 Marluvas 邮箱配置操作员例程。每个例程按自己的名称收敛，互不替换。

### 每封邮件一次出现，每封回复一个账户

当信封带有 id 时，事件键为 `mail:msg:<Message-ID>`，IMAP 与 MCP 一致；没有 id 时才使用传输范围的回退键。第一个报告该邮件的邮箱或传输启动运行；事件仍携带 `mailbox`、`uid` 和 `connectionId` 供步骤读取，来自 MCP 服务器时还携带 `origin: 'mcp'` 与 `originId`。

`faberloom_email_draft` 从邮件本身解析发件账户：`To` 中第一个属于所有者 IMAP 连接的地址，其次是匹配的 `Cc` 地址，最后才是读取器的连接。发送到 506 并抄送 alejandro 的邮件，即使 watcher 报告的是 alejandro 副本，也从 506 回复。MCP 邮件没有 IMAP 账户：草稿保持 `account: null`，通过服务器自己的 `send_email` 发出，并带 `inReplyTo: { uid, folder }`，使服务器接入线程并把原邮件标记为已答复。

### MCP 邮件也像 IMAP 一样被观察

当已挂载服务器发布 `account_current`、`folders_list`、`messages_list` 与 `messages_text` 时，`inbound/src/mcp.ts` 将其识别为邮箱。每个邮箱文件夹一个游标（`mcp:<server>:<resourceId>:<folder>`），记录与 IMAP 连接相同的基线、最后 UID 和扫描 UID。首次查看用 `perPage: 1` 读取邮箱顶部且不注入；之后的轮询按最新优先遍历 `messages_list`（`perPage: 100`、`sort: '-uid'`），直到出现小于等于游标的 UID，每次最多二十页，并按最旧优先注入新邮件。事件携带的 `originId` 正是 Correo 面板已解析的 `mcp-mail:<server>:<resourceId>:<folder>:<uid>` 形式。单个服务器或邮箱失败会成为自己的报告条目，其余继续运行。

`faberloom_mail_read` 与 `faberloom_email_draft` 接受该 `originId`。读取调用 `messages_text` 取正文、`messages_get` 取附件元数据；草稿用 `messages_get` 解析信封，保留 MCP 账户，并应用相同的线程守卫与 HTML 签名。MCP 邮件的 `attachFromUid` 会被拒绝，因为其附件字节不在 IMAP；回复改用 `attachFromUrl` 或 Correo 面板。

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

### 扫描以有界循环走遍邮箱

轮询按批次回答游标之上的邮件；一个满批次不会结束该次轮询，因此大于 `maxMessages` 的突发会在一趟内读完。扫描是持久审计。每次读取 `sweepUid` 之上最多 `sweepBatch`（200，1 到 1000）封邮件，无论是否已读、日期如何，并把 `sweepUid` 推进到该批的最高 UID。找不到邮件的一趟会把 `sweepUid` 重置为该循环的下限，下一轮再从那里走一遍。`hasEvent` 在注入前检查引擎的持久事件键，因此重读永不会追加同一证据。

下限是安装基线：观察器安装时邮箱已有的邮件属于历史，不会被回复。基线出现之前写入的游标没有这个下限，因此从第一封邮件走起，只注入未读邮件，跳过所有者已读的邮件。MCP 扫描读取每个邮箱最新的 `sweepBatch` 封邮件，并应用相同的 `hasEvent` 去重；达到二十页预算的 MCP 轮询把巨大缺口的较旧部分留给该窗口。

### 所有代理运行在部署模型上

12 个 home 中持久化的 428 个代理已改写为 `deepseek-official` / `deepseek-flash`，并清除 Anthropic 密钥，保留职责、技能、工具、子代理与连接。每个存储旁保留 `*.bak-agent-model-*` 备份。新代理继承部署默认值（`FABERLOOM_AGENT_PROVIDER`、`FABERLOOM_AGENT_MODEL`），目录无需固定供应商。

## 契约细节

| 字段 | 所有者 | 不变式 |
|---|---|---|
| `mail:msg:<Message-ID>` | inbound | 跨邮箱与传输每封邮件一次执行；回退键保持传输、连接与 uid 范围。 |
| `originId` | inbound, tool-faberloom | `mcp-mail:<server>:<resourceId>:<folder>:<uid>`；Correo 面板解析的正是该 id。 |
| `mail_threads` 行 | connections | 按所有者、账户和线程根索引；被回复的邮件决定是否允许新草稿。MCP 草稿的 `account` 为 null。 |
| `dismissed` | connections | 删除草稿时写入，先于所有者看到列表刷新。 |
| `sent` | connections | 仅在传输确认后写入，SMTP 与 MCP 一致。 |
| `drafts.html` | connections | 编写的标记；签名块带有 `data-email-signature`。 |
| `attachFromUrl` | tool-faberloom | 仅 HTTPS、公共主机、已声明文档媒体类型、最多 15 MB。 |
| `toolSchemaFor` | mcp-registry | 读取已挂载工具声明的 JSON 参数；未知时为 null。 |
| `sweepIntervalMs` | inbound | 至少 10 秒；每次扫描以 `sweepBatch` 循环读取邮箱，而不是固定的近期窗口。 |
| `sweepBatch` | inbound | 1 到 1000 封邮件；一趟扫描的读取预算。 |
| `hasEvent` | routines | 无副作用地读取持久 `event:<key>` 行；扫描永不重复追加证据。 |

## 考虑过的替代方案

**保留一个例程并在 Marluvas 定义中加入起草步骤。** 否决：Marluvas 代理需要 expediente 剧本，回复代理需要语气与线程规则；一个代理同时做两件事使每封邮件的 token 翻倍，并把两个故障耦合在一起。名称冲突也使部署其中一个会静默替换另一个。

**按主题和发件人去重。** 否决：两封不同邮件可能共享主题，回复链也会改变主题前缀。`Message-ID` 是邮件自身的身份。

**以每封邮件的 `Message-ID` 作为线程键。** 否决：那是被回复邮件的键，会允许同一线程出现第二封待处理草稿。根 id 加待处理草稿检查才能保证每线程一封。

**只把签名存进草稿文本。** 否决：面板渲染 HTML，纯文本签名无法携带粗体、分隔线或 mailto 链接。标记可防止编辑器叠加第二个签名块。

**让主机自己调用 MWT MCP 取文档。** 本次否决：代理已经持有 MWT 工具返回的签名 URL，工具只需抓取公共 HTTPS 字节。主机 MWT 客户端会重复凭据与权限路径。

**MCP 发送静默失败或省略文件。** 否决：所有者批准的是带附件的邮件。拒绝会说明限制并保留草稿。

## 验证

1. `packages/faberloom/routines/tests/equality.spec.ts` 断言 Marluvas 定义在存储规范化形状下保持相等，并保留目录代理名称。
2. `packages/faberloom/inbound/tests/inbound.spec.ts` 将回复例程与 Marluvas 操作员配置为两个独立的活动例程；允许列表之外只保留回复例程；两个邮箱读取同一 `Message-ID` 时只启动一次执行；完整批次不会结束轮询；首次查看固定基线；扫描已读与未读邮件且不重复证据；为无基线游标排队未读积压；扫描读取失败时不移动游标。
3. `packages/faberloom/inbound/tests/mcp.spec.ts` 观察仅存在于 MCP 服务器的邮箱：首次基线、分页轮询、跨两个服务器的 `mail:msg:` 去重、扫描窗口，以及单个服务器或邮箱失败不影响其余。
4. `packages/faberloom/routines/tests/routines.spec.ts` 无副作用地回答 `hasEvent`，并保持所有者范围。
5. `packages/faberloom/connections/tests/mail-threads.spec.ts` 按邮箱往返线程状态，通过投递桩标记 `sent`，并在丢弃时标记 `dismissed`。
6. `packages/faberloom/connections/tests/signature.spec.ts` 断言签名标记、段落回退和无签名正文。
7. `packages/faberloom/tool-faberloom/tests/draft-tools.spec.ts` 从 `To` 邮箱回复，拒绝 `sent`/`dismissed`/待处理，复制另一 Space 的文件，复制签名 URL 并拒绝私有主机。
8. `packages/faberloom/tool-faberloom/tests/mcp-mail-tools.spec.ts` 按 `originId` 读取并起草 MCP 邮件，保持 `account: null`，应用线程守卫，拒绝 `attachFromUid`，并保持 IMAP 路径不变。
9. `packages/faberloom/view/tests/mcp-send.spec.ts` 在未声明列表时拒绝丢弃附件，按声明的条目字段映射，并在 `inReplyTo` 中指名被回复的邮件。
10. `tsc -b tsconfig.host.json` 与 `tsconfig.client.json` 干净；connections、inbound、routines、tool-faberloom、mcp-registry 与 view 的重点测试套件为绿。
11. VPS 实测：只存在于 MCP 邮箱的邮件产生了 `originUid` 为 `mcp-mail:...`、`account: null` 的草稿；提到 PF 2513-2026 的回复产生了从 506@ 发出、通过 `attachFromUrl` 携带真实 220,573 字节 PDF 的草稿；扫描状态按循环推进，没有十五分钟窗口。

## 后果

- 实时回复代理现在运行在部署的 DeepSeek 模型上。未来 Anthropic 余额问题不再使它停止，供应商切换是配置变更。
- 删除草稿立即表示"不要回复这封邮件"；`email-skip` 课程候选仍会记录该模式以供未来邮件使用。
- 回复现在可以携带 expediente 文档而无需人工上传，但由模型判断邮件是否提到引用。指令禁止在未提及时进行任何 MWT 查询。
- MCP `send_email` schema 决定附件能否发出；面板得到明确的拒绝，绝不会静默丢弃。
- MCP 邮件现在会启动回复例程。只存在于 MCP 服务器的邮箱无需 IMAP 行即可被观察，其草稿通过该服务器发出。
- 扫描以有界循环读取每封邮件，而不是十五分钟窗口；没有基线的既有游标先排空未读积压，并放过已读历史。长期邮箱每次扫描支付一批信封读取，而不是每封邮件一次全量扫描。
- MWT.ONE 的 `documento_descargar` 必须先返回 HTTPS 控制台链接，`attachFromUrl` 才能复制 expediente 文档：它原来的 MinIO 预签名 URL 是 HTTP，且存储键被遮蔽成 `***`。该修复位于 MWT.ONE MCP 服务器，不在本仓库。
- MCP 轮询每次最多二十页，MCP 扫描审计最新 `sweepBatch` 窗口而不是走遍整个邮箱；大于该窗口的缺口由后续轮询恢复。
