---
description: "The native skill installer: recognise a skill folder, install it into the workspace or user skills root, and remove it again, for users and maintainers distributing skills."
kind: "package-reference"
---

# @deepseek-ai/dsh-skill-install

English | [中文](README.zh.md)

## Summary

`dsh-skill-install` turns a folder the user points at into a loaded skill. It recognises whether the folder is one skill directory, a directory of skill directories, or neither, and states which rule failed when it is neither. Before writing anything it asks the human whether the skill belongs to the current workspace or to their user account, through the existing `ctx.userQuestions` seam. Installed skills land in the exact directories `@deepseek-ai/dsh-skill-filesystem` scans, so the provider's watcher makes them loadable without a restart; an unchanged repeat install is reported instead of copied again, and only a marked install can be removed. The same plugin installs a whole harness, one folder or one `.zip`, into the user's own Harness home: its skills, agents, always-on rules, commands, scripts, hooks, and MCP server configurations.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose this plugin wherever a user should be able to install a skill by pointing at a folder. It provides `ctx.skillInstall` and registers the `install_skill` and `uninstall_skill` tools. It needs `ctx.tools`; the `ctx.userQuestions` seam is optional, and without it a caller must name the destination explicitly.

### Detecting a folder

`detect` accepts a single skill directory, a directory of skill directories, or reports exactly why the folder is not one. A folder holding `SKILL.md` is one skill; otherwise each immediate subdirectory holding `SKILL.md` is a candidate. The acceptance rules mirror the filesystem provider, so an accepted folder is one the provider loads.

```json
{ "kind": "found", "source": "/work/skills", "skills": [{ "name": "greet", "description": "Greets the team", "directory": "/work/skills/greet" }], "refused": [] }
```

### Installing a knowledge base

A folder that holds neither a `SKILL.md` of its own nor installable subdirectories is inspected once more as a knowledge base: `skills/` contributes its catalog and `agents/` contributes its agents, and either half alone is enough. A preset folder inside `agents/` (a directory holding `preset.yml`) is copied whole; a single Markdown agent with front matter becomes a preset whose `persona` prefix is the file body, because the product's agent registry holds `name` and `responsibility` and no prompt. The agents are always written under the user's own Harness home — `<dshHome>/.agent-presets/<id>/`, the layout the deployment seeds and the preset discovery reads — so installing a knowledge base is "global for that user" whatever skill scope was chosen.

```json
{ "status": "installed", "source": "/work/kb-contabilidad", "destination": "global", "root": "/home/u/.dsh/skills", "outcomes": [{ "name": "conciliacion", "status": "installed" }], "agents": [{ "name": "contable-jefe", "status": "installed" }], "agentsRoot": "/home/u/.dsh/.agent-presets" }
```

### Installing a whole harness

A team's harness installs as one call: `installHarness` recognises each part by the directory the convention gives it and writes it into the user's own Harness home, which every session of every Workspace and Space already reads. `skills/`, `skills-shared/`, and each role of `skills-catalog/` become skills; `agents/` and `agents-shared/` become preset agents; the harness's own `AGENTS.md` and its `rules/*.md` become always-on rules inside a managed block of the home's `AGENTS.md`, the user-level instructions the first request of every session carries; and `commands/`, `scripts/`, `hooks/`, and `mcp-configs/` are copied whole with their destination reported. A rule directory's subdirectories are copied and named by path in the block instead of being activated, so a harness that groups rules by language does not switch every language on. `source` may also name a `.zip`, which is expanded into a temporary directory the call removes once it is done.

```json
{ "status": "installed", "source": "/work/ECC", "root": "/work/ECC", "parts": [{ "kind": "skills", "status": "installed", "count": 292, "target": "/home/u/.dsh/skills" }, { "kind": "rules", "status": "installed", "count": 3, "target": "/home/u/.dsh/AGENTS.md" }], "outcomes": [{ "name": "architect", "status": "installed" }] }
```

### Choosing a scope

The two destinations are the current workspace (`<projectRoot>/.dsh/skills`, source `project-dsh`) and the user account (`<dshHome>/skills`, source `user-dsh`). When the caller omits the destination, `install_skill` asks the human through `ctx.userQuestions` with exactly those two choices. A workspace destination needs a session working directory; a global destination never does.

```json
{ "source": "~/skills/greet", "destination": "workspace", "replace": false }
```

### Installing, repeating, and removing

A first install copies the whole skill directory, assets included, and writes a `.dsh-skill-install.json` marker beside `SKILL.md` holding the source folder and the installed `SKILL.md` digest. Installing the same content again is reported as already installed and writes nothing; changed content is skipped unless `replace` is set. `uninstall_skill` removes only a directory that carries the marker, so a hand-authored skill of the same name is never deleted.

```json
{ "status": "installed", "source": "/work/skills/greet", "destination": "workspace", "root": "/work/.dsh/skills", "outcomes": [{ "name": "greet", "status": "installed" }] }
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The observable behavior is covered in [Use this package](#use-this-package); this section explains the roots the installer writes through and the marker that makes an install reversible.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin: publishes `ctx.skillInstall`, registers both tools, and asks the scope question |
| [`src/detect.ts`](src/detect.ts) | Folder detection and its rejection reasons, reusing the provider's front-matter parser |
| [`src/harness.ts`](src/harness.ts) | Harness detection per part, the managed rule block, and the per-part install |
| [`src/archive.ts`](src/archive.ts) | `.zip` expansion and the entry-name validation that keeps it inside its root |
| [`src/install.ts`](src/install.ts) | Scope-root resolution, the directory copy, the install marker, and removal |
| [`src/types.ts`](src/types.ts) | Consumer-facing types: scopes, detection verdicts, reports, and the service |
| — | No runtime invariant companion is published; the installer owns no independent lifecycle stream, and the filesystem it writes to is owned by `@deepseek-ai/dsh-skill-filesystem`. |

### The two scanned roots

[`projectSkillRoot`](../skill-filesystem/src/index.ts) and [`userSkillRoot`](../skill-filesystem/src/index.ts) are imported from the provider rather than re-derived, so an install targets exactly the directories the provider scans. The workspace root is the nearest `.git` ancestor of the session working directory, the same project root the provider resolves.

### The install marker

Every installed skill carries `.dsh-skill-install.json` holding the source folder, the destination, the install instant, and the sha256 of the installed `SKILL.md`. The digest makes a repeat install a reported no-op; the marker's presence is what lets an uninstall delete the directory. A directory without a readable marker is reported as not an install and left untouched.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the installer to the provider whose roots it writes through and the subsystem that owns discovery.

- [Skill subsystem reference](../../../docs/subsystems/skills.md) — the registry, provider contract, local discovery priority, and the catalog and tool.
- [skill-filesystem package](../skill-filesystem/README.md) — the scanned roots and the watcher that makes an install loadable.
- [Skill group map](../README.md) — the registry, providers, and loader this installer feeds.

-----

<a id="model-experience"></a>
## Model Experience

### Tool definitions

#### What the model sees

The model sees the `install_skill` and `uninstall_skill` parameter schemas: a required `source` folder, an optional `destination` of `workspace` or `global`, and an optional `replace` flag. The generated tool catalog lists both under `@deepseek-ai/dsh-skill-install`.

#### Token effect

Fixed schema cost on every request where the tools are visible.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from these schemas.

### Tool-call history and result

#### What the model sees

The model's arguments remain in the assistant tool-call. Each result is one JSON object with a `status`, the resolved `source`, the chosen `destination` and `root`, and one outcome per candidate; `invalid`, `refused`, and `cancelled` carry a `reason`. The human's scope answer is not model context: only the resolved destination appears.

#### Token effect

Arguments and the result JSON are data-dependent retained tokens; there is no token cost while waiting for the human.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the installer is a poor fit. They are current package constraints, not a UI backlog.

- **The scope question is authored host-side in English** — the `ctx.userQuestions` seam carries no locale, so a localised question needs a presentation intent in `@deepseek-ai/dsh-user-questions` and a renderer in `@deepseek-ai/dsh-client-ui-user-questions`; the browser row for the install result carries the localised scope and outcome copy.
- **A workspace install writes into the user's repository** — the workspace root is `<projectRoot>/.dsh/skills`, so the installed skill is version-controlled with the project unless the user ignores it.
- **The installer writes through Node filesystem calls, not the sandboxed `ctx.fs`** — a global install outside the workspace is not confined by the sandbox policy; the caller's own permissions decide.
- **Only the two built-in scopes exist** - a shared, per-role, or remote skills root is not an install destination.
- **Agents install into the user's home, never into the workspace** - a knowledge base's `agents/` reaches `<dshHome>/.agent-presets`, which is the only root the preset discovery reads; the skill scope the caller chose does not move them.
- **A Markdown agent becomes a persona and nothing more** - the generated composition mounts the persona and the instructions row and names no toolset, so a knowledge base that needs particular tools ships a preset folder instead of a Markdown agent.
- **A harness installs from a path the caller names, and only the caller's own chooser confines it** - `installHarness` writes under `<dshHome>` whatever folder or archive it is handed, without the workspace confinement the two-scope skill install applies, because a harness is that user's setup rather than project content.
- **`hooks/` and `mcp-configs/` are copied, not wired** - the product reads hooks from each CLI's own settings and MCP servers from its own registry, so those two parts land in the home and are reported with their destination instead of being activated.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The installer ships enabled in the base bundle and in the `standard`, `cordis`, and `ptc` agent presets, so `install_skill` and `uninstall_skill` appear in every recorded tool list and in the generated tool catalog. This supersedes the earlier choice to ship the row disabled alongside `skill-badge`; [the consolidation note](../../../.agents/notes/implemented/feature/2026-10-13-one-native-skill-install-path.md) records why the recorded expectations were re-recorded instead.

</details>
