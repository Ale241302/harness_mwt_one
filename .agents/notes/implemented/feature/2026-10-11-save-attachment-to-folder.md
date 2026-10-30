# Agent Note: Save a mailbox attachment into a Space's folder

Status: implemented

English | [中文](2026-10-11-save-attachment-to-folder.zh.md)

## Problem

The Email panel listed a message's attachments and downloaded one through a browser blob (`link.download`), so the file landed in the browser's or the operating system's download directory — outside the workspace the agent reads and edits. The model tool `faberloom_mail_attachment` already writes the real file, but into the **session** cwd (`correo-adjuntos/`), which is not the Space the user is working in when the mailbox is the entry point. A user reading a purchase order in the Email panel had no way to place it in the client's Space folder.

## Decision

`faberloom-view` gains the Remote `saveSpaceAttachment(spaceId, uid, name?)`. It reads the message through `ctx.get('faberloomInbound').readEmail(actor.id, uid)`, filters to the named attachment when one is given (every attachment otherwise), resolves the destination through `resolveSpaceDir` — the Workspace the Space mirrors, or the deterministic `<DSH_HOME>/spaces/<ref>` area — and writes each file under `<space dir>/correo-adjuntos/<name>`, the same directory convention the model tool uses. It returns the written `{ name, path, bytes }` list, and an empty list when the inbound service is absent, the UID is not a positive integer, or no attachment matches.

The Email panel's attachment field gains a destination **Space select** (the owner's Spaces from the shared overview) and a **"Save to folder"** action per attachment. The action calls `saveAttachmentToSpace(spaceId, uid, name)` and reports the resulting path; it is disabled until a Space is chosen. The existing download action stays, so a user who wants the file locally can still take it.

## Alternatives considered

**Reuse the browser download and let the picker copy it in.** Rejected: it needs a second manual step and the agent cannot act on a file that only exists in Downloads.

**Write through the existing model tool.** Rejected: a tool runs inside an agent session with its own cwd; the panel has no session, and the destination is the Space the user chose.

**Store the attachment as a Space file record (`attachFile`).** Rejected for this action: `attachFile` is the Space's own record store, listed in the Files panel but not on disk, so the agent's file tools cannot read it.

**Ask for the Space in a modal.** Rejected: the attachment field already carries the message context, so an inline select keeps the action one click and needs no extra dialog.

## Consequences

An email attachment can be placed directly in a Space's folder, where the agent's file tools, the sidebar conversation, and the user all see the same file. The destination is explicit, so a file is never written into an unintended Space. Attachments are copied, not moved, so the mailbox keeps its copy. The "expediente MWT.ONE → folder" direction is not covered here: it goes through `faberloom_mwt_call` and stays deferred until its panel action lands.

## Testing

`packages/faberloom/view/tests/save-space-attachment.spec.ts` covers writing one named attachment into the Space folder, writing every attachment when no name is given, an unknown name writing nothing, and the absent inbound service writing nothing. The `ui-faberloom` panel suite renders the Email panel over the stubbed view for its existing actions; the new action is covered by the host test above and the locale gate.
