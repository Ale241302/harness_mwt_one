---
description: "Native product Space session composition (ctx.faberloomSessionAgent): a Space session runs as its responsible agent's persona, tool plane, and skills, and a message that opens with @Name runs its turn on that catalog agent's route."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-session-agent

English | [中文](README.zh.md)

## Summary

The session composition service (`ctx.faberloomSessionAgent`) runs a Space session as its responsible agent: it installs the agent's persona, tool mask, and skills directive, and publishes its route (provider, model, and the reference naming its API key). A session outside a Space keeps the deployment composition; composition runs in the awaited `agent/created` window, before the first turn. The same service resolves the session's readable **Space scope**: its own Space, every sub-Space below it, and the Spaces the user granted in this session. A message that opens with `@Name` runs that turn on the named catalog agent's route, and the next turn without a mention returns to the session's own route.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row where `ctx.agents`, `ctx.faberloomSpaces`, `ctx.faberloomAgents`, `ctx.faberloomAgentPlane`, and the workspace registry are present, and set `ownerId`, `role`, `companyId`, and `readOnly` to the acting identity. The service registers `ctx.faberloomSessionAgent`, resolves each session's Space agent from its working directory, and installs the composition on that agent's scope through `agent.ctx.inject`. It applies to agents listed at mount and to every `agent/created`; a composition is disposed with its agent. The same service publishes the agent's model route through `routeFor(agent)`: a provider, model, and the credential reference derived from the agent id, present only when the agent declares both a provider and a model and stores an API key. A session controller reads it through `ctx.get('faberloomSessionAgent')`, uses it as the session's default route below any explicit selection, and authenticates that route with the agent's own key rather than the deployment connection.

Every Space session also gets a `faberloom:space-scope` prompt section: the current Space, every readable sub-Space, and any granted Space, each with its absolute folder, memory, curated context, agents, skills, harness artifacts (`AGENTS.md`, `.agents/`, `.claude/`), and the top-level entries of the folder. The text is rebuilt at the first step of each turn and is unchanged when the product state is unchanged, so the prompt prefix stays stable. A sibling, ancestor, or unrelated Space is listed by title only under “Otros Spaces”; reading it requires the user to approve `faberloom_spaces_open_read`, which records one `faberloom/space-read-grant` session event. The grant is durable for that session, adds the Space subtree to the scope, and never widens the writable sandbox root.

For every live agent the service also registers a per-turn `@Name` route. It reads the mention from the messages a step claims (the request waterfall itself carries none), applies the named agent's provider, model, and credential reference to that turn's request alone, and restores the session's own route on the next turn without a mention. A mention wins over the session's own route for that turn, including the Space agent's route a composed session starts from. The `@` picker inserts `@Name` followed by a space, and the name must match a catalog agent's exact name; an unknown name, a missing catalog or plane, or an agent without all of a provider, a model, and a key leaves the request untouched, so a mention never fails a turn.

-----

<a id="model-experience"></a>
## Model Experience

### Session composition

#### What the model sees

A Space session's request carries the responsible agent's persona as the `deployment:persona-prefix` section, the Space owner's directive as a `faberloom:space-directive` section when the record sets one, a short `faberloom:session-agent` directive listing the agent's skills, the `faberloom:space-scope` section describing its readable subtree, and a tool set with the disabled sources' tools removed. A session outside a Space sees the deployment composition unchanged.

#### Token effect

One persona section, one scope section, and, when the agent declares skills, one short directive per request of that session; the scope is capped by `maxScopeChars` (default 24,000 characters) and `maxScopeSpaces` (default 40 Spaces). The removed tools also drop their schemas from the request.

#### KV Cache effect

Prefix-stable while the scope is unchanged: the composition installs once before the first turn, and the per-turn refresh replaces the section text only when the Space tree, its records, or its harness files actually differ. A read grant or a new sub-Space starts a new section text and can invalidate reuse from the scope section onward.

### Per-turn `@Name` route

#### What the model sees

A turn whose latest user message opens with `@Name` carries no new prompt section: its request runs on that catalog agent's provider and model and authenticates with that agent's key reference, and the turn's replies are generated by that agent's model. The turn after it carries no mention and runs on the session's own route again. The name lives in the user message text that is logged anyway; no route or selection record is added.

#### Token effect

No per-turn token cost: the mention changes the route, not the request content.

#### KV Cache effect

The mentioned turn is a different model route, so its prefix is not shared with the session's own route. The next turn without a mention restores the session's route and its prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The model route needs a provider, a model, and a key.** An agent missing any of the three publishes no route, so its session keeps the deployment default. The route's credential reference names the agent's key in the credential seam and is derived at request time from the agent id; it never carries the key value, and it is never written to the session log. A mention of such an agent is ignored the same way.
- **The mention route restores from process memory.** The loop logs every request it sends, so the mentioned turn's header is that agent's route; the service remembers the session's own route from before the mention and reapplies it on the next turn without one. That memory is process-local: after a resume, the session's own route is the last logged header, so a session whose last request was a mention keeps that agent's route until another mention replaces it. A name that matches no catalog agent, or an agent without a complete keyed route, changes nothing.
- **Resolution needs the workspace mirror.** A session whose working directory is not a registered workspace mirrored by a Space carries no composition, which is the correct default for a plain session. The mention route does not need the mirror: it reads the catalog and the agent plane directly.
- **A Space session started before its workspace is registered is not composed.** The workspace must exist when the session is created; the Spaces panel registers it when the Space is opened.
- **The scope follows the Space tree, not the filesystem.** A sub-Space is in scope because its record names the current Space as `parentId`; a folder nested inside another Space's folder without that record is not a sub-Space. The Spaces panel repairs the hierarchy on load for folders created before `parentId` existed.
- **A read grant is session state, not a new product permission.** It records that this session may read a Space the actor could already read; the spaces service still refuses a Space the identity cannot read. The grant is one log-only event, so it survives a resume and is replayed before the first request; it does not change the Space's members or sharing.
- **Foreign-Space reads are refused at the file tools.** `read`, `read_image`, `write`, `edit`, `glob`, `grep`, `bash`, and `pwsh` are checked against the readable folders; a path under a Space outside the scope is denied with the `faberloom_spaces_open_read` instruction, and shell commands are scanned token by token for an absolute or relative folder spelling. Shell syntax is not interpreted, so an obfuscated command can still reach the same user-owned file; the scope is authorization and discovery, not an operating-system isolation boundary.
- **The scope is read at the first step of each turn.** A Space created or renamed during a turn appears in the scope the next turn, not in the same turn.

No invariant companion is published because the service's unit specs already assert the composition matrix and the disposal.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The persona shadows `deployment:persona-prefix` the same way a child composition does, so a Space session reads as its agent without a new prompt slot. The tool mask reuses `ctx.faberloomAgentPlane`, so the workspace session and a delegated child enforce one plane. The resolution chain (working directory → workspace → Space → agent) is the same the `spaces_ask` caller check uses.

The per-turn route lives on two agent-scoped listeners: `agent/pre-step` captures the claimed messages' mention before the step opens, and `agent/request` (registered `prepend`, so outermost) applies the route after the rest of the chain resolved the session's own. The mention cannot be read inside `agent/request` alone because the loop commits the claimed batch to the log only after that waterfall. Because the loop logs the header the request used — the reconstructability rule for model-visible input — the mentioned route becomes the next turn's seed; the listener therefore restores the pre-mention route it captured. Pass named agents through `faberloomAgents` and `faberloomAgentPlane`; the mention adds no new service.

The keyed live smoke (`tests/routing-live.e2e.ts`) runs three turns against real origins and self-skips without the credential each needs: a catalog agent's own key against OpenAI (`OPENAI_API_KEY`), an agent without a key keeping the deployment DeepSeek route, and a keyed agent's own key against DeepSeek (`DEEPSEEK_API_KEY`). The OpenAI account in this checkout has no credits, so that turn ends with the provider's own credit-exhaustion body as the typed `QUOTA` outcome; that answer is the passing result, because its message names the provider and could only have come from OpenAI.

</details>
