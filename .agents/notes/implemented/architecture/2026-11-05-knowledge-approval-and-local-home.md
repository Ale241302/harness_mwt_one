# Agent Note: Knowledge approvals carry revision-bound evidence, and a local home starts without a console account

Status: implemented

English | [中文](2026-11-05-knowledge-approval-and-local-home.zh.md)

## Problem

An `APROBADO` row was only a state. `approve()` checked the caller's row, revision, and hash, then wrote the state and an audit event; nothing distinguished that transition from a row the mirror copied, a backup restored, or a hand edited row. The mirror carries the `faberloom_board.items` table between the web home and the Desktop, so the peer's approval arrived as this home's approval even though no person here had seen the bytes. The same gap covered import and any future writer that upserted a row without calling `approve()` (PROP-09).

The Desktop also refused to boot without a console account. `reconcileBackend` returned before `backend.start()` when `readIdentity()` found nothing, so a new installation could not create a Workspace, Spaces, or subspaces without signing in to a remote service the local harness does not need (BASE-01, D08).

## Decision

**Every approval carries evidence bound to the approved revision.** `approve()` and `approveWithEdits()` write `approvalEvidence` with `source: 'human-session'`, the authenticated actor, the commit instant, and the version and hash the caller named. The operation also requires `writer.kind === 'human'`: the view marks a writable session, while the tool and MCP paths leave the field absent (agent) and are refused with `HUMAN_ACTION_REQUIRED`, so the model cannot approve the proposal it wrote. `verifiedItemsTable` wraps the items table, so every read, update, and put observes the evidence: an `APROBADO` row whose evidence is absent, names another source, or no longer matches the current version or hash reads as `PENDIENTE_CRITERIO` with `stale: true` and `staleReason: APPROVAL_UNVERIFIED`. A legacy row with `state: null` and `status: 'approved'` faces the same rule. The panel translates that reason instead of printing the code, and the existing revalidate action clears the stale flag before a new approval. Rows approved before the field existed have no evidence and ask for one revalidation after the upgrade; that one-time cost is the price of not being able to distinguish them from a replicated row.

**The mirror carries board work, never its verdict.** `stripReplicatedDecision` rewrites `APROBADO`, `EJECUTADO`, `DESCARTADO`, and `SUSTITUIDO` to `PENDIENTE_CRITERIO` with `staleReason: REPLICATED_DECISION` both when a home reads a row for transfer and when it applies one. The title, severity, artifact, doubts, and assignment still travel; each home decides on its own bytes.

**A local installation owns its identity and its mode.** `resolveHomeSelection` resolves the mode from the launched backend, refuses `DSH_DESKTOP_MODE` when it contradicts that backend, records `desktop-mode.json` as evidence of what ran, resolves junctions and mapped drives before checking, and rejects a home inside OneDrive (including `OneDrive - <tenant>`), Dropbox, Google Drive, or a network share with `DSH_DESKTOP_HOME_SYNCED`. `ensureLocalIdentity` writes `local-identity.json` with a random owner id and refuses to mint a new one when the document exists but is unreadable, because a new id would orphan every row the previous owner held; it never touches `desktop-identity.json`, which is what applies the remote patch and turns the mirror on. `writeLocalIdentityPatch` renders `desktop-local.patch.yml` with that id as the product owner and no console shares row, leaving `.env` untouched. `reconcileBackend` boots the Host with that local patch, sets `FABERLOOM_MIRROR_ENABLED=0` and an empty `CONSOLA_TOKEN` above the home layer, and skips console-token renewal and MCP provisioning, so a home that once signed in does not keep mirroring in local mode.

## Alternatives considered

**Trusting the event log.** The replicated row carries its peer's `approve` event, so the log cannot distinguish a local decision from a copied one. Only evidence written and verified by this home's service can.

**Requiring `human: true` in the request.** A flag is a claim by the caller; the model can send it. The evidence is bound to the revision and written by the operation that commits the decision.

**Keeping legacy approvals as they are.** A row with `state: APROBADO` and no evidence is indistinguishable from a mirrored row, so preserving it would preserve the hole. The plan's PROP-09 asks for one exact human action per approval, not for grandfathering.

**Storing the selected mode as a chooser.** The environment still decides the backend; the file only records what ran. A stored value that could switch the backend would revive the chooser the Desktop removed.

**Deriving the local owner id from the machine or the console email.** A machine name is not stable across clones and an email is a remote identity. The random id belongs to the home and survives restarts.

## Consequences

A copied, restored, or hand-edited approval no longer authorizes knowledge; it reads as pending and needs one local decision. Existing approved rows need that decision once after the upgrade. In `on` mode the remote session remains the authority and the local backup carries no evidence, so the mirror still treats its rows as work rather than verdicts.

A fresh Desktop installation boots the local Host, creates its Workspace and Spaces without a console account, and keeps its identity across restarts. A home inside a synchronized folder fails at launch with a stable code instead of losing writes to a sync client.

## Verification

- `packages/faberloom/board/tests/knowledge-approval.spec.ts`: matching evidence reads approved; a different version, hash, source, actor, or instant is refused; a raw row with `APROBADO` and no evidence reads pending and can be revalidated and approved; the same row with evidence stays approved; an agent writer is refused with `HUMAN_ACTION_REQUIRED`; a legacy `status: 'approved'` row is demoted (HAR-05).
- `packages/faberloom/mirror/tests/document.spec.ts`: a decided board row leaves the home as pending, a document that still carries the decision is demoted again on apply, and a legacy `status: 'approved'` row without `state` is treated as a decision.
- `apps/desktop/tests/home-selection.spec.ts`: first launch records `local`, restart reuses it, an explicit contradiction fails, synchronized, tenant-branded, and network homes are refused, the local identity is stable and separate from the remote identity, an unreadable document is refused instead of rotated, and the local patch names that id without a console shares row.
- `scripts/faberloom-portable/check-plan.spec.ts`: the registry rejects a missing case, an unknown wave, an out-of-catalog owner, a stale plan digest, and a demonstrated case without an existing test.
