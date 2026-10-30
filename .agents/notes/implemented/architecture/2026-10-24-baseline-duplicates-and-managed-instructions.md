# Agent Note: Baseline rows, shared instructions, and the Client B2B write scope

Status: implemented

English | [中文](2026-10-24-baseline-duplicates-and-managed-instructions.zh.md)

## Problem

Five product gaps remained after the provider-key vault shipped:

1. The Agents panel listed every deployment baseline two or three times, and the Spaces panel showed same-title rows with no way to tell them apart. Both installations of one account seed the same catalogue and mirror their product rows, so a home received the peer's baseline under a second id; the mirror also carried the agent copies each home materializes from console shares.
2. The MWT MCP resolved callers to another identity. The gateway sent `X-MWT-Gateway-Key` from `MWT_MCP_GATEWAY_KEY`, while the MCP container held a different value, so the middleware refused the propagated identity and fell back to the service token.
3. `client_b2b` was derived read-only whenever the console sent no actions. Those accounts are the product's customers; the role lock removed their write controls even though owning a Space always allowed writes.
4. Routines created on the web never reached the desktop. The mirror plugin was mounted but off: the desktop sign-in wrote the console token and nothing that enables the mirror, and the mirror also required an internal credential the desktop could not obtain.
5. A hand edit to `AGENTS.md` disappeared on the next projection. The projection rewrote the whole instruction file, so operator notes had no durable place.

## Decision

**A deployment baseline is one row per name, owned locally.** `faberloom-defaults` collapses the seeded baseline before each pass: only rows with `seeded` and an empty owner are grouped, a row holding a stored provider key wins the keeper, the keeper absorbs every skill and connected agent of the group, and the others are removed. An agent the user created with the same name is never touched. The mirror does not carry those rows, nor the `share:` copies, because each home seeds or imports its own; carrying them is what produced the duplicates. The owner's edits of a baseline agent travel by name instead, through the mirror's virtual `baseline` table ([baseline agents and skills travel](../feature/2026-10-27-baseline-agents-and-skills-travel.md)).

**A mirrored Space with a foreign Workspace id is re-anchored, not counted.** `adoptOrphanWorkspaces` treats a `workspaceId` the local registry does not hold as unbound, so the local folder is adopted by the existing Space of the same title instead of a new one. Same-title Spaces over genuinely different folders stay distinct, and the panel appends the folder name when a title repeats.

**The console token is the mirror credential.** The route already validates the bearer token against `POST /portal/me/`; it now checks the internal key only when the caller presents one. The desktop sign-in writes `FABERLOOM_MIRROR_ENABLED=1` and `FABERLOOM_MIRROR_OWNER`, keeps `FABERLOOM_MIRROR_KEY` optional, and signs out by clearing all four names.

**Client B2B writes in its own scope.** `deriveReadOnly` keeps `viewer` as the only role that is read-only without an explicit `permissions.read_only`; an explicit flag or a console action list still decides. Product guards (seeded agents, foreign Spaces, sharing) keep the customer out of the deployment's catalog.

**The projection owns a marked block.** `renderInstructions` wraps its output in `<!-- faberloom:begin -->` and `<!-- faberloom:end -->`, and `mergeInstructions` replaces that block in place. A previous full projection is replaced whole; any other file keeps its text and receives the block after it.

**A duplicate Space is folded, not hidden.** `FaberLoomSpaces.merge` moves the duplicate's memory and files onto the keeper, unions members, exclusions, sources, context, prompt, and agent, and deletes the duplicate row. `FaberLoomContext.reassign` and `FaberLoomSessionShares.reassign` first move the curated entries and transcripts, because those rows name the duplicate's id. `mergeDuplicateSpaces` picks the **oldest row, then the lowest id**: both homes compute the same keeper from the same `createdAt`, so the two sides converge instead of each keeping its own. A keeper bound to the opaque `spaces/fw_*` area is re-bound to the real folder of the same title, and the Spaces panel shows the folder beside a repeated title.

**A shared transcript is one file per Session.** The `faberloom_session_shares` domain uses the JSON backend's `per-record` layout: a `single` document rewrote and re-parsed every transcript on each capture, and a real catalog reached 117 MB, which drove the Desktop host heap to its 4 GB ceiling. The backend bootstraps the existing whole-unit file into one document per row on the first open.

**A Space never follows itself as its parent.** `ensureSpaceWorkspace` treats `null` as no parent and refuses `parentId === id`, so a record with a null or self-referencing parent cannot recurse until the host runs out of memory. The same guard protects the parent-repair pass.

**A child Space lives inside its parent's folder.** The Workspaces sidebar nests by path prefix, so a child whose folder sits at the spaces root appears as a separate folder even when `parentId` names its parent. `ensureSpaceWorkspace` refuses to root a child when the parent folder cannot be prepared, and `repairNestedSpaceFolders` moves a child found outside its parent back inside, carrying its files, descendants, Workspace registrations, and Session attachments. The repair runs on the same overview pass as the duplicate merge.

**A Workspace binding stays local.** The mirror keeps the receiving home's `workspaceId` when a Space row arrives: a Workspace id names one registry, and writing the peer's id left the Space without a folder. Title, parentage, memory, and context still travel; each home binds the Space to its own folder and the nesting repair keeps that folder inside the parent's.

**The desktop profile carries the vault plugin from its bundle.** `@deepseek-ai/dsh-credentials-console` is a dependency of `faberloom-app` and ships in the packed set; the profile module fallback links it like every other bundle-only package. The hand-made junction under `~/.dsh/profiles/desktop/node_modules` was a development workaround, not a packaging requirement, and is removed.

## Alternatives considered

**Delete duplicate Spaces automatically.** Rejected: same-title Spaces can name different folders, and deleting one takes its memory and files with it. Prevention plus a visible folder is reversible; deletion is not.

**Carry baseline agents through the mirror and dedupe on both sides at boot.** Rejected: the mirror would resurrect a row one home had just removed, and both sides would fight over the ids. Keeping the baseline local removes the conflict at its source.

**Require the deployment's mirror key on the desktop.** Rejected: the desktop never sees that secret, so a fresh installation could not enable the mirror without an operator copying it. The console token is the real authority and is validated per request.

**Keep `client_b2b` read-only and add a separate customer role.** Rejected: the console already expresses read-only with permissions, and a new role doubles the mapping in the gateway, the desktop, and the product guards.

**Separate operator files (`AGENTS.local.md`).** Rejected: clients load `AGENTS.md` only; a pointer file would depend on every client following it, which the projection's own README says none guarantees.

## Consequences

A home now shows one row per baseline name and one Space per local folder; deleting a seeded agent still sticks, because the marker prevents re-seeding and the mirror never carries it back. A mirrored Space whose Workspace id belongs to the other home is re-anchored by title, which is a best-effort match: two different folders with the same name in the same home keep separate Spaces and the panel names their folders.

The mirror no longer needs an operator-copied secret on the desktop, so a signed-in installation starts syncing routines and Work Flows on its next cycle. Its interval stays referenced — an unref'd timer does not wake an idle Desktop host, which is why a Web change only landed when a local edit happened to tick the mirror — and a Windows rename refused by a scanner is retried before the cycle fails. The gateway still checks the internal key when a caller presents one, so a deployment that sets it keeps the extra check.

`client_b2b` accounts get the product's write controls; a console that wants them read-only sends `permissions.read_only: true`. `AGENTS.md` is now jointly owned: a projection replaces only its marked block, and a note placed outside it survives every refresh.

## Verification

- Unit: baseline collapse (keeper wins by stored key, skills merge, user rows untouched), mirror local-only rows (export and apply), optional mirror key, marked-block replacement, and the `client_b2b` read-only derivation.
- Unit: Space merge (memory and files move, the duplicate row disappears), the null/self-parent guard (the 41-test workspace suite runs without the recursive heap failure), and the per-record shared-Session layout.
- Unit: a sub-space is created inside its parent's folder, and a child found at the spaces root is moved back under its parent with its files.
- The mirror's routine and workflow name reconciliation tests stay green; routines now arrive on the desktop because sign-in enables the mirror.
- The GUI suite is green, including the Desktop-only install block, and the full `faberloom/view` suite passes 132 tests.
- Deployment: the gateway's `MWT_MCP_GATEWAY_KEY` and the MCP container's value are aligned, a mirror cycle completes with `missing: []`, and the Desktop profile resolves the vault plugin with the hand-made junction removed.
