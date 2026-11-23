# Agent Note: a draft links its Space from the conversation and carries real documents

Status: implemented

English | [中文](2026-11-23-draft-space-gesture-and-real-attachments.zh.md)

## Problem

The draft editor carried a Space link the owner never asked for there. A draft built from a supplier thread showed `Vincular a email_docker` between the revision selector and the send row, while the same gesture already belongs to the floating conversation that holds the draft chat. The revision control sat above the body, so the two related actions, choose a revision and restore it, were separated from Enviar and Insertar firma.

The drafts themselves were also incomplete. A reply that answered a shipment thread said `La factura comercial se las hago llegar por aparte` and carried nothing, even though the thread held the invoice. `faberloom_email_draft` had no attachment arguments at all, and `emailDraftWithAi` told the agent to return only the body, so the Host persisted the text without any document. The draft agent could copy an attachment only through `faberloom_email_draft_update`, but its seed never told it where the documents were.

## Decision

### The Space gesture belongs to the conversation

The Email panel no longer renders the draft Space suggestion. When the owner opens the draft chat in the float, the panel publishes the draft and its suggestion to the same card the mail chat already uses, and the card offers the explicit gesture there. `FaberLoomDraftSpaceSuggestion` now carries the draft revision it describes, so the card links through `draftAttachToSpace` with a revision read at click time: an agent edit made while the card was visible is never overwritten by a stale confirmation.

### The revision control sits in the send row

`Revisión del borrador`, its select, and `Restaurar revisión` moved into the email toolbar beside Enviar, the attachment button, and Insertar firma. The select keeps its accessible name, and the restore button uses the same filled style as Enviar because restoring a stored revision is a deliberate write, not a footnote. The toolbar wraps on narrow widths so the row keeps its order without overflowing.

### A draft carries the document the email promises

`faberloom_email_draft` accepts the same mail-attachment arguments as the update tool, so a draft can be born with the invoice instead of being edited afterwards. `faberloom_email_draft_update` also accepts `attachFromSpaceFileId`, and copies bytes only from a file that belongs to the draft's own Space.

`buildDraftSeed` now returns the seed and the documents it found while reading the thread. The seed names each document with its exact `uid`, `connectionId`, `mailbox`, and name under `<untrusted-attachment-sources>`, and lists the draft's Space files under `<untrusted-space-files>`. `emailDraftWithAi` stores the text first, then asks the same restricted draft session to attach what the email needs, reading the draft again at the end. A failed attach turn keeps the stored text.

The draft instructions now forbid the two dishonest shortcuts: claiming a document is attached when the stored draft does not list it, and promising to send one separately when its source is in the seed.

## Alternatives considered

**Keep the Space control in the editor and also in the float.** Rejected: two confirmations for one write, and the editor is where the owner reviews text, not where a conversation moves to a Space.

**Let the model return the attachment plan as text for the Host to parse.** Rejected: a private markup protocol in model output is invisible to the model's own tooling and fails silently when the wording drifts.

**Attach every document of the origin message automatically.** Rejected: a reply that quotes a thread with unrelated files would send them. The agent decides, and the owner still approves the exact revision.

**Read the Space workspace as plain files.** Deferred: the draft agent has no filesystem tools, and a path read would need the workspace root confinement those tools already own. Space files cover the attached documents now.

## Consequences

A reply whose thread holds documents costs one extra model turn, and only when the seed found a document. The draft history then holds an `initial` revision with the text and an `agent` revision with the attachment, so a restore returns the exact combination that was reviewed.

The float card needs the draft idle long enough to read it; a draft deleted meanwhile keeps the card without a write. A draft with no matching Space still offers `Crear Space` only after its second durable revision, as before.

## Testing

`vitest run packages/faberloom/view packages/faberloom/tool-faberloom` covers a draft created with the invoice copied from a message, a Space file copied only from the draft's own Space, a foreign file refused, the attach turn naming `pedido.pdf`, and no attach turn when the thread holds no document. `vitest run packages/client/ui-faberloom` covers the panel and the remote surface, and `tsc -b tsconfig.client.json` and `tsc -b tsconfig.host.json` pass.
