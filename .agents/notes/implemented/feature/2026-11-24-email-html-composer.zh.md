# Agent Note: 邮件撰写器的 HTML 与经 MCP 发送的路由

Status: implemented

[English](2026-11-24-email-html-composer.md) | 中文

## Problem

邮件撰写正文曾是普通 `<textarea>`（`packages/client/ui-faberloom/src/client/panels.tsx`），因此面板里无法存在加粗、斜体、下划线、颜色、对齐和列表。传输层早已支持 HTML：`OutgoingMail.html` 是一个字段（`packages/faberloom/connections/src/types.ts`），`smtp.ts` 会组装 `multipart/alternative`，而替代部分由已批准的纯文本加上已保存的签名推导（`connections/src/index.ts`、`signature.ts`）。草稿没有 HTML 字段（`spec.ts`），所以编写的格式无处存放，每次发送都会重新推导出所有者从未写过的标记。

回复只把签名放进编辑器（`panels.tsx` 的 `openCompose` 正文块），因此回信意味着重打对方已经写过的内容，尽管打开的那封邮件正文就加载在编辑器旁边。

经 MCP 服务器读取的邮件在面板中曾是只读的：`canComposeReply = !chosenMailIsMcp`，`mcpMailActions` 只宣告 `markSeen`、`move`、`trash` 和 `restore`（`packages/faberloom/view/src/mcp-mail.ts`）。该姿态早于当前挂载的服务器：Hostinger Mail MCP 公布的 24 个工具中包含 `send_email`（Hostinger Agentic Mail 文档，2026-11-20），所以对 MCP 邮件的回复可以经由它到达的同一条通道离开。

有两个事实缩小了范围。阅读窗格已经渲染收到的 HTML：客户端净化发件人的标记，并将其注入自带 CSP 的完全沙箱 frame（`panels.tsx`、`safe-email.ts`）。MCP 邮件读取器也已同时映射正文的两个部分（`mcp-mail.ts`）。缺少的是草稿中的编写 HTML、产生它的编辑器、回复引用，以及 MCP 来源草稿的发送路由。

## Decision

### 草稿携带编写的 HTML

`draftRecord` 与 `draftSnapshotRecord` 携带 `html: z.string().default('')`，`EmailDraftInput` 接受 `html?: string`（缺省时保留已存值，即 `attachments` 和 `account` 已使用的规则），并且 `FaberLoomEmailDraft`、`EmailDraftSnapshot` 与 `FaberLoomEmailDraftRow` 都会暴露它。领域版本保持 `1`：SQLite 每条记录存一个 JSON 文档（`storage-sqlite/src/index.ts`），所以带默认值的字段不需要改 DDL，缺少它的已存行仍能解析。

`draftRevision` 包含 `html`；否则只改标记不会改变批准哈希，`sendDraft` 就会发出审阅者从未见过的标记。`sendIntentRecord` 在 `textHash` 旁携带 `htmlHash`，理由相同。

### 出站邮件由一个净化器负责

`sanitizeSignatureHtml` 变为 `sanitizeMailHtml(raw, maxChars)`，在签名上限旁加入 `DRAFT_HTML_MAX_CHARS = 256_000`。它在写入草稿时执行一次、发送时再执行一次，并保持原有策略：无脚本、无嵌入文档、无事件处理属性、无脚本 URL。浏览器端的 `sanitizeEmailHtml` 保持原职：它是阅读器对收到邮件的守卫。

### 发送时优先使用编写的标记

当 `html` 非空时，净化后的标记就是 `text/html` 替代部分，且不再推导签名：编辑器已经携带签名块，并标记为 `data-email-signature`。当没有标记时，`messageHtml(text, signature)` 原样运行，因此代理准备的草稿、Space 文件邮件与模型工具无需改变即可继续工作。

### 编辑器是富文本编辑器

正文是一个 `contentEditable` 区域，工具栏有十二个控件：加粗、斜体、下划线、颜色、左对齐、居中、右对齐、项目符号列表、编号列表、代码、引用与清除格式。命令通过 `document.execCommand` 执行，Chromium、Gecko 与 WebKit 对这几个操作全部实现；每个控件通过取消 `mousedown` 保持选区，并从语言字典取得无障碍名称。粘贴只插入纯文本，因此外来样式与隐藏标记不会进入草稿。

回复以发件账户的签名、来源说明和承载原邮件的 `<blockquote>` 打开；转发以转发头、信封与引用的正文打开。正文编辑器同时发出标记与它自己的 `innerText`，因此邮件的两个部分描述同一段文字。由于邮件正文可能在编辑器打开之后才解析完成，引用会在到达时一次性加入草稿。

### MCP 邮件经由 MCP 发送

`FaberLoomMailActions` 携带 `send`，由服务器宣告的 `send_email` 推导。面板为 MCP 行提供回复、全部回复与转发，把发件邮箱固定为邮件到达的那个，并把合成的来源 id 记入 `originUid`。`sendEmailDraft` 从该 id 解析路由，当服务器宣告 `send_email` 时，把已批准的修订交给注册表的所有者动作路径；没有该工具的服务器会拒绝，草稿保留并在面板中说明原因。

`sendDraft` 增加了一个可选参数 `DraftDelivery`，由调用方解析传输，而服务仍持有批准检查、发送意图与持久状态。其他所有草稿仍走 SMTP。

面向模型的策略不变：`send_email` 仍对代理拒绝（`packages/faberloom/mcp-registry/src/policy.ts`）；所有者的点击就是批准，与 `messages_move` 目前的处理完全相同。

## Contract details

| 字段 | 归属 | 不变量 |
|---|---|---|
| `drafts.html` | connections | 每次写入都净化；为空表示发送时由文本与签名推导替代部分。 |
| `drafts.text` | connections | 精确邮件的纯文本部分；编写 HTML 时等于编辑器的文本。 |
| `revision` | connections | 覆盖 `html`；未重新保存的标记修改无法发送。 |
| `send_intents.htmlHash` | connections | 已批准标记的哈希。 |
| `data-email-signature` | client | 每份草稿恰好一个签名块；切换发件账户时替换，绝不叠加。 |
| `FaberLoomMailActions.send` | view | 仅当挂载的服务器宣告 `send_email` 时为真。 |
| `originUid` | connections | 合成的 MCP id 或 IMAP uid；视图解析它来选择发送通道。 |

## Alternatives considered

**在 textarea 上做 Markdown 式工具栏。** 它不需要新存储也不需要净化器，但无法表达颜色或对齐，而且在保留纯文本部分的客户端里，收件人读到的是字面星号。已否决：它不满足所要求的格式集合。

**只存 HTML 并推导文本。** 一个正文而不是两个，但纯文本部分是所有非 HTML 客户端、AI 草稿代理与模型工具读取的内容（`view/src/index.ts`），推导会丢失所有者的确切换行。已否决：文本仍是阅读的权威，HTML 用于渲染。

**只在浏览器端净化。** 客户端已有基于 DOM 的净化器，而且它就是产生标记的组件。作为唯一守卫已否决：主机才是账户发出内容的执行点，否则非此编辑器的 Remote 调用方可以把标记直接投到发送路径。

**把 MCP 来源的草稿经账户的 SMTP 连接发送。** 它不需要新的 MCP 能力，但会以与邮件到达的信箱不同的身份发出，也就是所有者要求避免的结果。已否决。

**让 MCP 邮件保持只读。** 改动最小，也是此前发布的行为。所有者已否决：回复就是该功能，而挂载的服务器已宣告该工具。

**使用成熟的富文本编辑器（ProseMirror、Tiptap、Lexical）。** 它会带来这里没人想手工维护的模式、撤销历史与粘贴规则，但也把一个大型依赖带进一个单 bundle 的客户端插件，而它的格式集合固定为十二个控件，并且它会让编辑器夺走草稿模型必须保持权威的正文状态。就此命令集合已否决；若工具栏扩展到表格、内联图片或协同编辑再重新考虑。

## Verification

1. `packages/faberloom/connections/tests/draft-html.spec.ts` 钉住经存储的往返、只改标记引起的修订变化、省略时保留已存标记、恰好达到上限时的拒绝、由标记推导纯文本以及恢复路径。
2. `packages/faberloom/connections/tests/send-intents.spec.ts` 断言线路消息 `text/html` 部分中编写的元素、签名不会被追加两次、已批准的 `htmlHash`，以及调用方提供的传输收到已批准消息而 SMTP 假服务器保持不变。
3. 签名测试仍钉住无标记草稿的推导替代部分。
4. `packages/client/ui-faberloom/tests/registration.client.spec.tsx` 从 IMAP 行与 MCP 行各自打开回复，断言签名、来源说明、引用文本、`<blockquote>` 以及光标所在的空行；它还断言未宣告 `send_email` 的 MCP 服务器会禁用发送并说明原因，而宣告的服务器保持发送可用。
5. `packages/client/ui-faberloom/tests/email-body-editor.client.spec.tsx` 驱动每个工具栏命令、颜色选择、纯文本粘贴、文件粘贴、签名替换、属性重载与落在首行的光标，编辑器文件达到 100 % 语句、分支、函数与行覆盖。
6. `packages/faberloom/view/tests/mcp-send.spec.ts` 断言带邮箱、信封、文本与标记的 MCP 工具调用、没有该工具时的拒绝、被拒绝发送所报告的状态，以及无 MCP 来源草稿仍走 SMTP。
7. mcp-registry 的策略测试仍对模型拒绝 `send_email`。
8. `tsc -b tsconfig.host.json` 与 `tsc -b tsconfig.client.json` 通过；`verify-client-ui-i18n` 报告每个源文件的文案均由语言字典持有。

## Consequences

编辑器现在产生所有者编写的标记，离开账户的替代部分就是那份标记，而不是纯文本的渲染结果。无标记的草稿保持此前的推导行为，因此代理、Space 文件与工具路径的形态没有改变。

代价是多了一个需要保持一致的正文：`text` 与 `html` 一起传输，修订同时覆盖两者，任何只写文本的调用方按设计不会触碰 `html`。编辑器的输出与引擎相关（`<b>` 与 `<span style="font-weight:…">` 之别），因此发出的标记不会跨浏览器字节稳定；收到的标记由另一套净化器判定：既通过主机又能被阅读器接受的标记，看起来发送正确、打开却是纯文本。

`document.execCommand` 在规范中已过时，尽管每个已发布引擎都实现了它；命令表放在单个模块里，使基于 `Range` 的替换只需落在一处。MCP 的 `send_email` 输入模式在运行时读取，若服务器改名或改变结构，发送会变成拒绝而不是静默丢弃，线程头在服务器声明之前不传递。

粘贴大到超过正文上限的表格会在保存时被拒绝，编辑器保留内容，因此所有者删减而不是丢失。

引用的邮件只会在一个方向上宽于卡片：撰写卡片持有一个显式的 `minmax(0, 1fr)` 列，因为隐式 `auto` 轨道会按最长的引用行定尺寸，把整个编辑器推出面板，随后被卡片的 `overflow: hidden` 裁掉且没有横向滚动。引用不带固定文字颜色，因此面板自身的次要文字令牌在两种主题下都适用，而收件人仍使用其客户端正文颜色。
