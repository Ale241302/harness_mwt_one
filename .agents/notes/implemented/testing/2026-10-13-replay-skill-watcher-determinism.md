# Agent Note: replay pins the skill watcher off so skill-install scenarios are host-independent

Status: implemented

English | [中文](2026-10-13-replay-skill-watcher-determinism.zh.md)

## Problem

The `skill-install` and `skill-uninstall` headless scenarios install a skill and, for the second, remove it again inside one run, then compare the persisted session. The skill catalog reaches the model as a `user/message` appended at a step boundary; `@deepseek-ai/dsh-tool-skill` computes it from `ctx.skills.snapshot(...)`, which reads the current catalog but serves the registry's cached copy until the filesystem provider's watcher invalidates it. Chokidar finishes its `awaitWriteFinish` stability window on an asynchronous timer, so whether the newly installed `greet` directory is visible at the next step's boundary depends on host watcher timing, not on the installer.

The fixtures pinned that catalog message. A host whose watcher observed the change before the next step passed; a host whose watcher observed it a step later, or not within the short run at all, failed with a missing catalog `user/message`. The scenario therefore encoded one host's watcher latency, which is exactly the cross-platform failure the fixture policy forbids.

## Decision

`snapshots/session/text-turn/cordis.snapshot.yml`, the replay and refresh patch shared by the ordinary headless composition, composes `@deepseek-ai/dsh-skill-filesystem` with `watch: false`. Replay and refresh never observe a catalog change at a step boundary, so the two scenarios' committed fixtures drop the catalog `user/message` rows; their `sourceEventSeqs` references and `{{message:N}}` tokens are renumbered to the surviving records. Live recording (`snapshots/session/text-turn/cordis.yml`) keeps the watcher on. The web scaffold already pins the same row off for the same reason.

The installer's external effect stays asserted independently. `verifySkillInstallEffect` in `snapshots/session/headless.snapshot.ts` reads the filesystem after the run: `skill-install` must leave the `greet` directory carrying its `.dsh-skill-install.json` marker with `name: greet` and `destination: global`, `skill-uninstall` must leave no `greet` directory, and both must never create the refused `not-a-skill` directory. That oracle is what these scenarios prove. The catalog message was an artifact of watcher timing, not a behavior the installer owns.

## Testing

The same `DSH_SNAPSHOT=refresh` pass over the corpus re-recorded request-header sidecars whose pinned tool declarations predated the shipped `install_skill` and `uninstall_skill` tools (`advanced`, `both`, `ptc`, `ptc-node-*`, `ptc-python`, `ptc-image`, `ptc-workspace-context`, `mcp-empty-ptc`, `mcp-resources-ptc`) and the space agent-plane fields (`mwtMcp`, `sicopMcp`, `webAccess`) the `space-*` pins lacked, plus the two child `tool-schemas.1.expected.json` files under `snapshots/sdk/subagent-*`. It also advanced two session fixtures: `cordis-inspect-jsdoc` no longer lists a `ToolResult` catalog entry, and `space-cross-reference` renders its curated rule with the value's own trailing period (`…de Sondel..`). The refreshed lane then passes with only the `pwsh`-platform scenarios skipped.

## Alternatives considered

- **Keep the catalog message and give the watcher more time.** Rejected: no provider or scenario knob makes an asynchronous filesystem event land before a fixed step boundary; a longer step narrows the race without removing it.
- **Make `install_skill` invalidate the skill registry synchronously.** Rejected as a product change outside a fixture fix: `skill-filesystem` exposes `observeHostMutation`, but `dsh-skill-install` writes through raw `node:fs` and emits no `fs/observed`, so wiring that touches `packages/skill/skill-install` and needs its own coverage.
- **Record the fixture on one host and accept the other host's failure.** Rejected: the snapshot lane is a required macOS/Linux gate, and a fixture that encodes one host's watcher latency is the defect being fixed.

## Consequences

- Replay no longer exercises a mid-run catalog refresh. Watcher-driven re-publication stays covered by `packages/skill/skill-filesystem/tests/skill-filesystem-watcher.spec.ts` and `packages/skill/tool-skill/tests/tool-skill.spec.ts`.
- A future scenario that needs the catalog to change mid-run must own a composition that re-enables the watcher, instead of relying on the shared replay patch.
