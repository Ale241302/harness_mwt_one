# Agent Note: Email composer HTML and MCP send routing

Status: implemented

English | [中文](2026-11-24-email-html-composer.zh.md)

## Problem

The mail composer was a plain `<textarea>` (`packages/client/ui-faberloom/src/client/panels.tsx`), so bold, italic, underline, colour, alignment and lists could not exist in the panel. The transport already shipped HTML: `OutgoingMail.html` is a field (`packages/faberloom/connections/src/types.ts`), `smtp.ts` builds `multipart/alternative`, and the alternative was derived from the approved plain text plus the stored signature (`connections/src/index.ts`, `signature.ts`). A draft had no HTML field (`spec.ts`), so authored formatting had nowhere to live and every send re-derived markup the owner never wrote.

Reply copied only the signature into the editor (`panels.tsx`, the `openCompose` body block), so answering mail meant retyping what the sender already wrote, even though the open message's text is loaded beside the editor.

Mail read over an MCP server was read-only in the panel: `canComposeReply = !chosenMailIsMcp` and `mcpMailActions` advertised only `markSeen`, `move`, `trash` and `restore` (`packages/faberloom/view/src/mcp-mail.ts`). That posture predates the mounted server: the Hostinger Mail MCP published tool list carries `send_email` among its 24 tools (Hostinger Agentic Mail documentation, 2026-11-20), so a reply to MCP mail can leave through the same channel it arrived on.

Two facts reduced the scope. The reading pane already renders received HTML: the client sanitizes the sender's markup and injects it into a fully sandboxed frame with its own CSP (`panels.tsx`, `safe-email.ts`). And the MCP mail reader already maps both body parts (`mcp-mail.ts`). What was missing was authored HTML in the draft, the editor that produces it, the reply quote, and the send route for MCP-origin drafts.

## Decision

### The draft carries authored HTML

`draftRecord` and `draftSnapshotRecord` carry `html: z.string().default('')`, `EmailDraftInput` accepts `html?: string` (absent preserves the stored value, the rule `attachments` and `account` already use), and `FaberLoomEmailDraft`, `EmailDraftSnapshot` and `FaberLoomEmailDraftRow` expose it. The domain version stays `1`: SQLite stores one JSON document per record (`storage-sqlite/src/index.ts`), so a defaulted field needs no DDL change and stored rows without it still parse.

`draftRevision` includes `html`; otherwise a markup-only edit would leave the approval hash unchanged and `sendDraft` would transmit markup the reviewer never saw. `sendIntentRecord` carries `htmlHash` beside `textHash` for the same reason.

### One sanitizer governs outgoing mail

`sanitizeSignatureHtml` became `sanitizeMailHtml(raw, maxChars)`, with `DRAFT_HTML_MAX_CHARS = 256_000` beside the signature ceiling. It runs when a draft is written and again when it is sent, and it keeps the policy it had: no scripts, no embedded documents, no event handlers, no script URLs. The browser's `sanitizeEmailHtml` stays what it is, the reader's guard for received mail.

### A send uses authored markup when it exists

With non-empty `html`, the sanitized markup is the `text/html` alternative and no signature is re-derived: the composer already carries the signature block, marked `data-email-signature`. Without markup, `messageHtml(text, signature)` runs unchanged, so agent-prepared drafts, Space-file mail and the model tools keep working.

### The composer is a rich editor

The body is a `contentEditable` region with a twelve-control toolbar: bold, italic, underline, colour, align left, centre, right, bulleted list, numbered list, code, quote and clear formatting. Commands run through `document.execCommand`, which Chromium, Gecko and WebKit implement for exactly these operations; each control keeps the selection by cancelling `mousedown` and takes its accessible name from the locale dictionary. Paste inserts plain text, so foreign styles and hidden markup never enter a draft.

A reply opens with the sending account's signature, an attribution line and a `<blockquote>` holding the original; a forward opens with the forwarded header, the envelope and the quoted body. The body editor emits the markup and its own `innerText` together, so both parts of the message describe the same text. Because the message body can resolve after the editor opens, the quote joins the draft once when it arrives.

### MCP mail sends through the MCP

`FaberLoomMailActions` carries `send`, derived from the server's advertised `send_email`. The panel offers reply, reply-all and forward for MCP rows, keeps the sending mailbox fixed to the one the message arrived in, and records the synthetic origin id in `originUid`. `sendEmailDraft` resolves the route from that id and, when the server advertises `send_email`, hands the approved revision to the registry's owner-action path; a server without the tool refuses and the draft stays with the panel's stated reason.

`sendDraft` gained one optional parameter, `DraftDelivery`, so the caller resolves the transport while the service keeps the approval checks, the send intent and the durable status. SMTP remains the transport for every other draft.

The model-facing policy is unchanged: `send_email` stays denied to the agent (`packages/faberloom/mcp-registry/src/policy.ts`); the owner's click is the approval, exactly as it is for `messages_move`.

## Contract details

| Field | Owner | Invariant |
|---|---|---|
| `drafts.html` | connections | Sanitized on every write; empty means the alternative is derived from text and signature at send. |
| `drafts.text` | connections | Plain-text part of the exact message; equals the editor's text when HTML is authored. |
| `revision` | connections | Covers `html`; a markup edit without a new save cannot be sent. |
| `send_intents.htmlHash` | connections | Hash of the approved markup. |
| `data-email-signature` | client | Exactly one signature block per draft; replaced, never stacked, when the sender account changes. |
| `FaberLoomMailActions.send` | view | True only when the mounted server advertises `send_email`. |
| `originUid` | connections | Synthetic MCP id or IMAP uid; the view parses it to choose the send channel. |

## Alternatives considered

**Markdown-style toolbar over the textarea.** It would need no new storage and no sanitizer, but it cannot express colour or alignment, and every recipient would read literal asterisks in clients that keep the plain-text part. Rejected: it does not meet the requested formatting set.

**Store only HTML and derive text.** One body instead of two, but the plain-text part is what every non-HTML client, the AI draft agent and the model tools read (`view/src/index.ts`), and deriving it loses the owner's exact line breaks. Rejected: text stays authoritative for reading, HTML for rendering.

**Sanitize only in the browser.** The client already has a DOM-based sanitizer, and it is the component that produces the markup. Rejected as the sole guard: the host is the enforcement point for what leaves the account, and a Remote caller that is not this composer could otherwise post markup straight to the send path.

**Send MCP-origin drafts through the account's SMTP connection.** It needs no MCP capability, but it would send from a different identity than the mailbox the message arrived in, which is the outcome the owner asked to avoid. Rejected.

**Keep MCP mail read-only.** The smallest change, and the previous shipped behavior. Rejected by the owner: the reply is the feature, and the mounted server advertises the tool.

**Use a maintained rich-text editor (ProseMirror, Tiptap, Lexical).** It would bring a schema, undo history and paste rules no one here wants to maintain by hand, but it also brings a large dependency into a single-bundle client plugin whose formatting set is fixed at twelve controls, and it would take ownership of the body state the draft model must stay authoritative for. Rejected for this command set; revisit if the toolbar grows tables, inline images or collaborative editing.

## Verification

1. `packages/faberloom/connections/tests/draft-html.spec.ts` pins the round-trip through storage, the markup-only revision change, the preserved markup on an update that omits it, the ceiling refusal at the exact limit, the plain-text derivation from markup and the restore path.
2. `packages/faberloom/connections/tests/send-intents.spec.ts` asserts the authored elements in the `text/html` part of the wire message, that the signature is not appended twice, the approved `htmlHash`, and the caller-supplied transport receiving the approved message while the SMTP fake stays untouched.
3. The signature tests still pin the derived alternative for a draft without markup.
4. `packages/client/ui-faberloom/tests/registration.client.spec.tsx` opens a reply from an IMAP row and from an MCP row and asserts the signature, the attribution, the quoted text, the `<blockquote>` and the empty first line the caret lands on; it also asserts that an MCP server without `send_email` disables the send and states why, and that one with it keeps the send available.
5. `packages/client/ui-faberloom/tests/email-body-editor.client.spec.tsx` drives every toolbar command, the colour picker, plain-text paste, file paste, signature replacement, the prop reload and the caret placed on the first line, at 100 % statement, branch, function and line coverage of the editor.
6. `packages/faberloom/view/tests/mcp-send.spec.ts` asserts the MCP tool call with the mailbox, envelope, text and markup, the refusal for a server without the tool, the reported status of a rejected send, and the untouched SMTP path for a draft with no MCP origin.
7. The mcp-registry policy specs still deny `send_email` to the model.
8. `tsc -b tsconfig.host.json` and `tsc -b tsconfig.client.json` are green; `verify-client-ui-i18n` reports every source locale-owned.

## Consequences

The composer now produces markup the owner authored, and the alternative that leaves the account is that markup rather than a rendering of the plain text. A draft without markup keeps the previous signature-derived behavior, so the agent, Space-file and tool paths did not change shape.

The cost is a second body to keep coherent: `text` and `html` travel together, the revision covers both, and any caller that writes only text leaves `html` untouched by design. The editor's output is engine-specific (`<b>` versus `<span style="font-weight:…">`), so the sent markup is not byte-stable across browsers, and the incoming-markup path is judged by a different sanitizer than the outgoing one: markup that survives the host and not the reader looks correct when sent and plain when opened.

`document.execCommand` is obsolete in the specification even though every shipped engine implements it; the command table lives in one module so a `Range`-based replacement has one place to land. The MCP `send_email` input schema is read at runtime, so a server that renames or reshapes it turns a send into a refusal rather than a silent drop, and threading headers stay out until a server declares them.

Pasting a table large enough to pass the body ceiling is refused at save with the editor keeping its content, so the owner trims instead of losing it.

A quoted message can be wider than the card in one dimension only: the compose card holds one explicit `minmax(0, 1fr)` column, because an implicit `auto` track sizes to the longest quoted line and pushed the whole editor past the pane, where the card's `overflow: hidden` clipped it with no horizontal scroll. The quote carries no fixed text colour, so the panel's own muted token applies in either theme while recipients keep their client's body colour.
