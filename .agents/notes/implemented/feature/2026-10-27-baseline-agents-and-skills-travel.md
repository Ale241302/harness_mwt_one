# Agent Note: Baseline agents and skills travel between homes and across the deployment

Status: implemented

English | [中文](2026-10-27-baseline-agents-and-skills-travel.zh.md)

## Problem

An owner changed the provider, the model, and the mail connections of `Operador Marluvas` on the web, and the desktop kept the old values; an edit on the desktop never reached the web either. Four causes stacked up.

The mirror keeps the deployment baseline agents (`seeded`, no owner) local ([baseline duplicates](../architecture/2026-10-24-baseline-duplicates-and-managed-instructions.md)): every home seeds them under its own ids, so carrying them by id duplicated every name. That rule also kept every owner edit of those agents in the home where it was made.

Both homes of one owner held 79 agents for 41 names: an earlier mirror carried each home's baseline to the other as unseeded, ownerless rows, and those copies travelled as ordinary agents.

The mirror's row journal lived only in memory. After a desktop restart every row that differed between the homes read as a first sync, and the first-sync rule keeps the local value and pushes it, so a change made on the web while the desktop was down was overwritten by the stale desktop row. This affected every mirrored domain, not only agents.

A baseline agent or a catalogue skill edited by an Admin/CEO changed only that Admin's home, while the product promises that the global catalogue is edited by Admin/CEO and seen by everyone.

## Decision

**The owner's settings of a baseline agent travel by name.** The mirror store answers for a virtual `baseline` table of `faberloom_agents` (`packages/faberloom/mirror/src/baseline.ts`), keyed by agent name. Reading it projects each local baseline row to its owner-editable fields (responsibility, skills, tools, provider, model, internet, MWT and SICOP access, mail connections, policy, lessons, active) with connected agents named; writing it patches the local row of that name and binds the connected agents to local ids. The `agents` rows of the baseline still stay local. Because the table is read and written through the same table surface as every row, the row journal decides the direction exactly as it does elsewhere. A peer's tombstone never removes a baseline agent, and a name the home has not seeded is ignored until the seeder creates it.

**The provider key travels with the settings, between the owner's own homes.** The store preloads each baseline agent's key from the credential seam under `agentCredentialRef(id)`, the projection carries it, and a write stores it in the receiving home's seam and updates `hasApiKey`/`apiKeyTail`; the key never enters the `agents` row. A seam that cannot answer leaves the keys out of that cycle and reports it.

**The journal survives a restart.** The mirror writes it to `mirror-journal.json` beside `mirror-status.json` after each guarded cycle and reads it once before the first cycle of a process. A journal recorded for another owner or gateway, or one that does not parse, is ignored.

**The copies of the other home's baseline are removed.** `faberloom-defaults` removes an unseeded, ownerless agent whose name and responsibility equal a baseline agent of the home and whose `originRef` is not a console share. An ownerless agent created with the same name but its own responsibility stays.

**Admin/CEO edits of baseline agents are the deployment's edition.** Where the deployment sets `globalAgentsFile` (the gateway uses `/data/shared/faberloom-global-agents.json` on the volume every user home shares), `faberloom-defaults` runs a pass every `globalAgentsIntervalMs` (`packages/faberloom/defaults/src/global.ts`). A privileged home whose baseline agent changed since its last pass publishes the settings and key with the next revision; every home applies an edition newer than the revision it holds. The first pass of a home records what it holds and publishes nothing. Mail connections stay out of the edition, since they name each user's mailboxes. Non-privileged owners already cannot edit a baseline agent, so the edition is imposed on them. A desktop receives the edition through its mirror, because its web home applies it and the `baseline` table carries it.

**Admin/CEO edits of catalogue skills are the deployment's edition.** With `globalSkillsRoot` set (the gateway uses `/data/shared/skills`), an Admin/CEO saving a role, shared, or already-global skill writes it there and removes the editor's own copy of that name; removing it restores the catalogue version for everyone. Rows report `origin: 'global'` and `editsGlobally`, and the dialog says that saving applies to every user. The gateway lists the global root right after the owner's own skills in the `faberloom-role` provider, and the web side of the mirror offers the global bundles to the desktop, with the owner's own bundle of a name winning. A member's edit of a catalogue skill stays a personal copy.

## Alternatives considered

Carrying the baseline `agents` rows by id and reconciling them by name, as the mirror does for routines, would rewrite the ids Spaces, sessions, and stored keys already reference in each home.

Keeping keys out of the mirror would leave a provider switch broken on the other home until the owner pasted the key again; the owner chose that the key travels between their own homes.

Respecting each member's own provider choice against an Admin edition was rejected by the owner: the global catalogue is imposed, and a member who wants a variant duplicates the agent as their own.

## Consequences

The first cycle after this change has no saved journal, so where the two homes differ the desktop's value wins once; an owner re-applies an edit made on the web before the upgrade.

An Admin's key published with an edition is stored in every home's credential seam and used by every user's copy of that agent; a non-privileged owner cannot reveal it.

A desktop receives deployment-wide agent and skill editions only through its web home, so a desktop whose mirror is off keeps the catalogue it seeded.

## Verification

- `packages/faberloom/mirror/tests/baseline.spec.ts`: an edited baseline agent travels by name between two homes with different ids, connected agents bind to local ids, the key lands in the receiving seam and not in the row, the receiving projection equals the sent one; tombstones and unseeded names change nothing; the key-holding then oldest row answers for a name; a failing seam reports and the settings still travel.
- `packages/faberloom/mirror/tests/sync.spec.ts`: a change the peer made while the process was down lands from the saved journal instead of being kept as a first-sync conflict; an unreadable journal, another owner's journal, and malformed entries start empty; the web side offers global skill bundles with the owner's bundle winning.
- `packages/faberloom/defaults/tests/defaults.spec.ts`: the copies of another home's baseline are removed while own, owned, shared, and unrelated agents stay; the deployment-wide pass runs only with `globalAgentsFile` and survives an unwritable path.
- `packages/faberloom/defaults/tests/global.spec.ts`: an Admin edit publishes and is imposed on another home with its key and local partner ids while each home keeps its mailboxes; a member change is never published and the next edition replaces it; a malformed shared file reads as empty.
- `packages/faberloom/view/tests/workspace-board.spec.ts`: an Admin edit of a catalogue skill becomes the global edition and removes the Admin's old copy, a member edit stays personal, and removing the edition restores the catalogue version.
