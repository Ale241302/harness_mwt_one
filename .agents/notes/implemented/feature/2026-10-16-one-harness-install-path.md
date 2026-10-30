# Agent Note: A harness installs as one folder or archive, and the Skills panel has one install path

Status: implemented

English | [中文](2026-10-16-one-harness-install-path.zh.md)

## Problem

The Skills panel offered a card that installed *skills*: pick a folder, choose the current workspace or the global root, replace or skip, install. It could not install anything else a team's harness actually carries — its agents, its always-on rules, its commands and scripts — and the two-scope choice made the panel ask a question the user answered the same way every time. The product's own knowledge-base path already recognised a folder holding `skills/` and `agents/`; a folder holding `rules/`, `commands/`, or a `.zip` of all of it was not installable at all, and a harness whose rules are grouped by language had no way to say "these are reference groups" rather than "turn every language on".

## Decision

**One harness install writes every part into the user's own Harness home.** `SkillInstallService.installHarness({ source, replace })` recognises each part by the directory the convention gives it and writes it into the root the product already reads that kind from: `skills/`, `skills-shared/`, and each role of `skills-catalog/` become skills; `agents/` and `agents-shared/` become presets under `<dshHome>/.agent-presets`; the harness's own `AGENTS.md` and the Markdown at the top of `rules/` and `.agents/rules/` become always-on rules inside a managed block of `<dshHome>/AGENTS.md`; `commands/`, `scripts/`, `hooks/`, and `mcp-configs/` are copied whole; and a rule directory's subdirectories are copied and named by installed path in the block instead of being activated. Duplicate skill names and agent ids across roots install once, from the first root in convention order.

**The destination question is gone, and the block it belonged to is gone with it.** A harness is that user's setup rather than project content, so every part is global for that user and the panel never asks where it goes. `FaberLoomViewService.skillInstallTargets` and its type were deleted as the last consumers of that choice; `installSkill` stays because the product's model-facing tool still routes through it. `installHarness(source, replace?)` is the panel's path, and the panel's control is replaced rather than extended: `SkillInstallBlock` is deleted and `HarnessInstallBlock` takes its place.

**A `.zip` is a harness too, and its entry names are validated before anything is written.** `source` may name an archive, expanded into a temporary directory the install removes in a `finally`; an entry that is absolute, drive-qualified, or walks up with `..` refuses the whole archive instead of being skipped, because such an archive is malformed or hostile and half-expanding it would hide that. The expansion runs on `fflate`, so no platform needs a `tar`.

**The rule block is managed, not appended.** Instalment writes between `<!-- faberloom-harness:begin -->` and `<!-- faberloom-harness:end -->`: a reinstall replaces that region and leaves every other line of the user's own instructions file untouched. A block whose closing mark is missing runs to the end of the file, and a lone closing mark is removed without taking the text before it.

**The native picker gains one file chooser, not a second seam.** `DirectoryPickerNativeCapability` carries `pickFile` beside `pick`, and the Win32 child takes its mode as `DSH_DIALOG_KIND`: one `IFileOpenDialog` conversation with `FOS_PICKFOLDERS` set or clear. The capability stays one object per service, so a composition that can show the directory chooser can show this one, and the browsing backend refuses the verb as it already refuses `pick`.

**Every projected scope carries the two knowledge tools as rules.** The harness projection writes a `## Reglas por defecto del ámbito` section from `DEFAULT_SCOPE_RULES`: consult the project's `graphify-out/` graph through the `graphify` skill before reading code, keep it current after a change, and draw architecture and flows with the `archify` skill instead of describing them in prose alone. A folder projected for the first time therefore reaches for its graph without anybody writing that rule by hand.

## Alternatives considered

**Keep `installSkill` as the panel's path and add a second button for a harness.** Rejected: the harness path is a superset (a single skill folder and a knowledge base are both harnesses of one part), so two paths would maintain two refusal vocabularies for one decision, which is the duplication the earlier consolidation note removed.

**Add the file chooser as a `files` capability kind of the picker seam.** Rejected: the seam exposes one capability object per service, so a backend serving `files` could no longer serve `pick`, and the desktop composes exactly one native backend. Extending the native capability keeps one backend serving both verbs of the same dialog.

**Expand the archive through a child process (`tar`, or PowerShell's `Expand-Archive`).** Rejected: the repository's native-command boundary exists for platform choosers and openers, and an archive is plain data — `fflate` reads it in process on every platform, with the entry-name check in the same module as the write.

**Copy a rule group's files into the instructions block as well as by path.** Rejected: a harness that groups rules by language carries every language, and activating them all would put Angular and C++ guidance in the same request. Naming the groups keeps them reachable without turning them on.

**Write the harness's own `AGENTS.md` into the home's instructions unconditionally.** Rejected: only a folder that already carries a recognised part is treated as a harness, so pointing the installer at an ordinary project folder cannot silently adopt that project's instructions as the user's own.

## Consequences

The panel's install control changes shape: it picks a folder or an archive, installs once, and reports one line per part with its count, status, and destination, plus the name of any candidate the installer refused. The recorded installs remain listed under the roots and one can still be removed, so the earlier note's "one record per install" behavior is unchanged.

`skillInstallTargets` leaves the view's Remote surface, so any other consumer of that method stops compiling; `installHarness` joins it in the generated client, the API catalog, and the generated subsystem pages.

A harness install writes into the user's home from a path the caller names, without the workspace confinement the two-scope skill install applies. The confinement was never a boundary against the user, who owns both ends, but a deployment that exposes this Remote to a browser should read the operator's own chooser as what confines it, which the package README records.

`hooks/` and `mcp-configs/` land in the home with their destination reported and nothing wiring them: the product reads hooks from each CLI's own settings and MCP servers from its own registry. A harness that expects the installer to activate them is asking for a mechanism the product does not have.

## Testing

`packages/skill/skill-install/tests/harness.spec.ts` builds one folder carrying every part plus the candidates the detector must refuse, installs it into a temporary home, and asserts the roots, the install markers, the agent presets, the copied parts, the managed block, idempotence, replacement, and the user's own text surviving outside the block; it also builds real archives with `fflate` for the wrapped-root, flat, unreadable, and escaping-entry cases, and asserts through the booted plugin that the extraction directory is gone afterwards.

`packages/faberloom/view/tests/install-skill.spec.ts` boots the real installer and asserts the view's per-part report, each whole-call refusal, and the read-only refusal; `packages/faberloom/view/tests/prepare-harness.spec.ts` pins the projection report the panel button returns.

`packages/client/ui-faberloom/tests/harness-install.client.spec.tsx` drives the control: picking a folder and an archive, a cancelled pick, every localized refusal and part status, the refused-candidate line, a transport failure, and the capped install list with its removal.

`packages/host/directory-picker-native/tests/native-picker.spec.ts` covers `pickNativeFile` on all four platform paths, `win32-dialog-logic.spec.ts` and `win32-dialog.spec.ts` pin the file dialog's flags and protocol, and `directory-picker.host.spec.ts` covers the `pickFile` Remote including its refusal under a browsing composition.

`packages/faberloom/harness-projection/tests/harness-projection.spec.ts` asserts every default rule reaches a projected scope's instructions, in order, including a scope that registers no record at all.
