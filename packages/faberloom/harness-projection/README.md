---
description: "Native product module (ctx.faberloomHarnessProjection) that materializes a Workspace's or Space's own harness — its agents, skills, work flows, routines, memory, and context — inside that scope's directory."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-harness-projection

English | [中文](README.zh.md)

## Summary

A Workspace or a Space is a folder. This package writes that folder's harness: the agents and skills the scope's records register, plus its work flows, routines, memory, and context, as the instruction files every client reads (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.gemini/`, `.agents/`, `.claude/`, `.kimi/`). It is the scope's harness, never the whole catalog. One manifest at `.faberloom/harness.json` records what the projection owns, so the next run retires only what it wrote before and never touches the user's own files.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition to expose `ctx.faberloomHarnessProjection`:

```yaml
- id: faberloom-harness-projection
  name: '@deepseek-ai/dsh-faberloom-harness-projection'
  config:
    enabled: true
    maxListEntries: 20
```

| Config | Meaning |
|---|---|
| `enabled` | Whether `refresh` writes a projection at all. Absent means off, so a deployment that does not want folder digests does not get them. `project`, `readUsage`, and `clean` always act. |
| `maxListEntries` | Most entries one generated list renders before it names the remainder; defaults to `20`. The generated instructions reach a model's request, so a scope with hundreds of records must not inject all of them. |

| Method | What it does |
|---|---|
| `project(scope, root)` | Writes the complete projection into an explicit directory and returns the written paths, the pruned paths, and the records included. |
| `refresh(scope)` | Resolves the scope's real directory through `ctx.workspaceRegistry` and calls `project`; `undefined` when the scope has no registered folder. |
| `readUsage(scope)` | Reads the scope's agents, skills, work flows, routines, memory, and context without writing anything. |
| `clean(root)` | Retires every path the folder's manifest declares and returns them. |

### Where the scope comes from

A scope is `{ kind: 'workspace', id, title }` or `{ kind: 'space', id, title }`. A Space resolves to the Workspace it mirrors (`spaces.workspaceId`), so both kinds write into a real folder: the Workspace's own canonical directory. A Space that mirrors no Workspace — one whose area is the deterministic `<DSH_HOME>/spaces/<ref>` directory — has no folder and `refresh` reports `undefined` rather than writing outside a scope.

### Where the usage comes from

The projection reads the product domains through `ctx.storageDomain.get(name)`, the generic `(domain, table, key)` traversal `faberloom-backup` and `faberloom-mirror` use. That traversal is the choice here over `open(spec)`: the projection addresses a scope rather than an actor, and the product services gate every read behind one, so it reads the durable records directly. A domain this process does not hold open — or a single declared table it refuses — is named in `unreadableDomains` and never read as an empty scope, because an absent domain is not an empty one.

| Generated set | Product record | Scope field |
|---|---|---|
| Agents | `faberloom_agents.agents` | `spaceId`, plus the Space's `agentId`; the catalog's `selections` and `outcomes` carry no scope and are left out |
| Skills | `faberloom_agents.agents.skills`, resolved through `ctx.skills` | inherited from the agent that declares them |
| Work flows | `faberloom_workflows.workflows` | `scope = { kind: 'space', spaceId }` |
| Routines | `faberloom_routines.routines` | `spaceId` |
| Memory | `faberloom_spaces.memory` and `faberloom_memory.teachings` | `spaceIds` / `scope = 'space'` with `spaceId`, active only |
| Context | `faberloom_context.entries` | `spaceId` |

An agent the catalog marks inactive is left out: it cannot run in the scope. A teaching scoped to an agent, a skill, a case, or globally carries no Space and is left out with the same rule.

### What it writes

The instruction document is one text written to `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.gemini/AGENTS.md`, and `.kimi/AGENTS.md`: a client reads whichever name it knows, and none of them follows a pointer to another. Each agent gets `.agents/<agente>.md`, `.claude/agents/<agente>.md`, and `.kimi/agents/<agente>.md` — frontmatter with `name` and `description`, a `model` line when the agent declares both a provider and a model, and the agent's responsibility as the instruction body, which is the persona the product installs. Each resolved skill gets `.claude/skills/<skill>/SKILL.md` and `.kimi/skills/<skill>/SKILL.md` from the skill registry's own definition. `.claude/settings.json` carries an explicit empty permission policy, so the projection never widens what the user's own configuration allows.

### Pruning

`.faberloom/harness.json` lists every path the run wrote. The next run deletes the paths the previous manifest declared and no longer writes, plus the directories one removal emptied; a manifest path that is not a plain relative path inside the scope is refused, so the file list can never reach outside the folder, and a manifest that cannot be parsed makes the run skip pruning entirely. The manifest itself is never pruned. `clean` follows the same rule for every declared path.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing at registration. `ctx.faberloomHarnessProjection` registers no tool, prompt section, or session event. Its output reaches a model only through the files of a projected folder: `AGENTS.md` and its siblings are loaded as instructions by an agent whose working directory is that folder, and each skill body travels as the folder's own `SKILL.md` when a `skill` tool call loads it.

#### Token effect

Zero tokens on every request of a session outside the projected folder. Inside it, the generated instruction document joins the request prefix like any other instruction file, bounded by `maxListEntries` per list plus its one remainder line; skills cost only what the `skill` tool loads.

#### KV Cache effect

A projection writes files and never touches a live request. In a session whose folder was just projected, the instruction prefix changes once and the cache re-warms for that one turn.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Skills are the ones the scope's agents declare, not a load history.** No product store records which skill a session loaded today: the skill registry holds the catalogs (`.dsh/skills` roots and the owner's own skills) and the session log holds a `skill` tool call or a `skill-invocation` message, but neither is scope-addressed the way the projection needs. The projection therefore carries the declared skills of the scope's agents, and reports a declared name that no provider resolves in `unresolvedSkills`. A per-scope skill-use store is TODO; that is the change that turns this set into a load history.
- **Agents are the ones the scope registers, not a call history.** `faberloom_agents.agents` carries the scope in `spaceId`, and the Space's responsible agent is the one the session composition installs automatically; `selections` and `outcomes` record model use per agent with no scope, so no call history can be filtered by scope today. An `@Name` mention resolves against the whole catalog (`faberloomSessionAgent` reads `listAgents()`), so an agent invoked only by mention from this folder is not part of the scope's set.
- **The projection is pull-only.** Nothing subscribes to `domain/changed`; a caller decides when to `refresh` (a Space save, a Workspace open). Without that caller, a folder keeps the projection of its last run.
- **A Workspace mirrored by several Spaces projects the oldest Space.** `faberloom_view` resolves that pair the same way, so both name one record; a deployment that wants choosing surfaces the conflict instead.
- **Writing needs the scope's folder to exist.** `project` writes into the path it is given and creates the directories it needs inside it; a caller that passes a path that is not a registered Workspace folder gets the projection inside that path.
- **`refresh` reports a missing referent as no folder.** A Space the open spaces domain does not hold has no folder either, so `refresh` returns `undefined` instead of throwing into the caller that just saved the Space; `project` and `readUsage` refuse it loudly.

No invariant companion is published because this service exposes no independent observation that its unit specs do not already assert.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

`src/usage.ts` owns the storage-domain traversal and the scope resolution, and validates every row it reads because the durable medium is a boundary. `src/render.ts` owns every generated file body and is pure. `src/index.ts` owns the filesystem work: write, prune from the previous manifest, write the manifest last. Agent files are named by a slug folded from the display name, with a numbered suffix when two names fold to the same slug.

</details>
