# Agent Note: One native skill-install path, shipped enabled

Status: implemented

English | [中文](2026-10-13-one-native-skill-install-path.zh.md)

## Problem

Two code paths installed a skill folder. The native installer (`packages/skill/skill-install`) recognised a folder, asked the destination through `ctx.userQuestions`, copied it into the roots `@deepseek-ai/dsh-skill-filesystem` scans, marked the copy, and exposed `install_skill`/`uninstall_skill` as model tools — but the base bundle shipped its row `disabled: true`, so the tools never reached a request and the generated tool catalog omitted them. The older FaberLoom-admin path (`packages/faberloom/view`, surfaced by the Skills panel in `packages/client/ui-faberloom`) copied the same folders into the same roots with its own validation, its own `faberloom_skill_installs` storage domain, its own refusal vocabulary, and a model tool of its own. The two disagreed on roots, on origin, and on what a repeat install means, and the second one duplicated the first's validation and copy logic inside a product panel.

## Decision

**The native installer is the one path, and it ships enabled where the model can see it.** `packages/bundle/base` mounts `@deepseek-ai/dsh-skill-install` without `disabled`, and each shipped agent preset (`standard`, `cordis`, `ptc`) mounts it inside an entry-local `isolate` realm so its two tools register into that preset's layer rather than the process-global one. `packages/bundle/web-app` disables the base row exactly as it disables `tool-skill`, so the Web composition's global tool layer stays empty, and `packages/bundle/faberloom-app` re-enables the base row because the Skills panel's `ctx.skillInstall` is a host-plane service. `install_skill` and `uninstall_skill` are therefore in every shipped profile's model-visible tool list and in `docs/tool-catalog.md`. This supersedes the earlier choice to mirror `skill-badge` and ship the row disabled because enabling it changes every recorded request's tool list; the recorded expectations were re-recorded in the same change instead ([consequences](#consequences)).

**The FaberLoom-admin surface routes through `ctx.skillInstall`.** `FaberLoomViewService` reads the service with `ctx.get('skillInstall')` and delegates: `installSkill()` is `install({ source, destination, cwd, replace })`, `skillInstalls()` is `list(cwd)`, and `uninstallSkill()` is `uninstall({ name, destination, cwd })` followed by a fresh `list`. The panel and `faberloom_skill_install` keep their existing Remote names and report fields, so the browser and the untouchable tool package are unchanged. [The harness-install note](2026-10-16-one-harness-install-path.md) later replaced the panel's own control with a harness install and deleted `skillInstallTargets()`, which had made the destination a question; `installSkill()` stays, because `faberloom_skill_install` still routes through it.

**The view keeps only its own policy, not installation logic.** Two guards stay view-local because they are FaberLoom identity and workspace policy, not folder handling: a read-only identity is refused, and a source outside the resolved workspace root is refused. Everything else — source detection, candidate validation, the directory copy, the `.dsh-skill-install.json` marker, idempotence, and removal — belongs to the installer. `packages/faberloom/view/src/spec.ts`, the `faberloom_skill_installs` domain, the install key, the copy helpers, and the install-domain close effect are deleted; `storageDomain` leaves the view's `inject` list along with the package, dependency, and tsconfig references.

**The marker is the install record; the panel is a view over the records.** `skillInstalls()` reads the installer's markers under the global root and, when a workspace resolves, the workspace root, and `uninstallSkill` removes only a directory carrying a marker. The per-identity ledger is gone: a marker records where a skill came from and when, and the roots are deployment-scoped, so two users of one deployment see the marked installs under the roots rather than their own rows.

**No legacy ledger row can exist.** The `faberloom_skill_installs` domain was introduced after the newest `deploy-*` and `faberloom-*` tags, so no released or deployed artifact ever wrote a row; the next feature landed the native installer and this decision, making the ledger an in-tree dead end. There is therefore nothing to migrate, and the domain declaration is deleted rather than read once and converted.

## Alternatives considered

**Keep the row disabled and enable it only in product overlays.** Rejected: it leaves the tools out of the generated catalog and out of every recorded tool list, so the feature stays invisible to the model in the shipped profiles while the code claims it is available — the state the README already had to explain away.

**Keep the new tool names and drop the older panel tool.** Rejected: `faberloom_skill_install` is the product's model-facing install surface and the panel calls the same Remote method; removing either is a user-visible regression the consolidation can avoid by mapping the native report into the existing fields.

**Move the FaberLoom ledger into the installer as a second durable record.** Rejected: the installer's marker already holds the source, destination, instant, and digest beside the skill, and a parallel table would have to be kept consistent with directories the loader can change underneath it.

**Route the copy through `ctx.fs`.** Rejected, for the reason [the install-and-MCP note](2026-10-12-install-a-skill-and-an-mcp-server.md) records: the copy carries binary assets in a directory tree and `ctx.fs` has no directory copy.

## Consequences

The tools are visible in every recorded request of the shipped headless profile and the shipped presets, so the snapshot sidecars (`tool-schemas.expected.json`), the CLI and Web tool-list goldens, and the tool catalog were re-recorded in this change with the two new schema entries; the session fixtures themselves are normalized fixed points and were not rewritten. A test-only composition that deliberately reduces its catalog (the `pwsh`/`fs-glob-sampling`/`sdk-minimal` patches) now disables the row alongside `tool-skill`, so it keeps its enumerated set.

The panel loses its per-identity install list and its leader-row uninstall: it now shows every marked install under the roots and removes one through the installer, which refuses a directory with no marker. This is observable in a multi-user deployment and is the cost of one record.

An install copies the whole source directory, so a `.shared-by` publisher marker travels with the copy where the old view stripped it. The marker records origin, not configuration, and the panel's remove still works because removal follows the install marker rather than the publisher marker.

The view's refusal vocabulary is coarser than the installer's: a source that is not a directory, is empty, or holds no `SKILL.md` all read as "not a skill", and unreadable or missing front matter reads as a missing or illegal name, reusing the panel's existing copy. The workspace containment check stays, so `outside-workspace` remains reachable.

## Testing

The installer's real-composition spec boots the skill registry and provider over temp roots; `packages/faberloom/view/tests/install-skill.spec.ts` boots the real installer and asserts the panel's reports, the copied directories, the marker, and removal; and the headless snapshot lane replays the shipped profile with the two new schema entries plus the authored `skill-install` and `skill-uninstall` scenarios, where the model calls `install_skill` and `uninstall_skill` against a temporary harness home so the refused folder, the copied destination, and the post-uninstall catalog withdrawal are pinned end to end.
