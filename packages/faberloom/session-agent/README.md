---
description: "Native product Space session composition (ctx.faberloomSessionAgent): a Space session runs as its responsible agent's persona, tool plane, and skills, and a message that opens with @Name runs its turn on that catalog agent's route."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-session-agent

English | [中文](README.zh.md)

## Summary

The session composition service (`ctx.faberloomSessionAgent`) runs a Space session as its responsible agent: it installs the agent's persona, tool mask, and skills directive, and publishes its route (provider, model, and the reference naming its API key). A session outside a Space keeps the deployment composition; composition runs in the awaited `agent/created` window, before the first turn. The same service resolves the session's readable **Space scope**: its own Space, every sub-Space below it, and the Spaces the user granted in this session. A message that opens with `@Name` runs that turn on the named catalog agent's route, and the next turn without a mention returns to the session's own route.

When `role` belongs to `restrictedRoles` (default `client_b2b`) and `productOnly` is not false, the shared deployment key is limited to product work. A Space without a responsible agent composes a product persona with the MWT.ONE, SICOP, and mail tools instead of keeping the deployment composition; every composed session is restricted to `allowedToolPrefixes`; and an `llm/stream` guard refuses a personal request before the provider is called. The guard decides by intent: a work-domain vocabulary short-circuits the obvious turn, and every other one goes to a small classifier call on the session's own route, so a paraphrase, another language, or a dialect is understood instead of refused. A credential the account stored itself in the writable credential store (the seam reports `file`) is that account's own key and is never limited — but only when its value differs from every key the deployment supplies. The guard fingerprints each deployment value at construction, so an account that saves a copy of the shared key keeps the policy, and a request routed to another provider is classified by the same rule instead of being trusted for its route name. The refusal is one visible assistant text block, and `tools/pre-execute` denies product-external tools while the session stays on the shared key.

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

The same per-agent listeners serve the iteration chat's deterministic router (§9.7). When `faberloomBoard` is mounted, the first step of a turn reads the instruction `applyIterationInstruction` from the board: an instruction the panel attached to a live attempt is written to that attempt's draft and answered in the log by the host itself, with the user's message, the reply, and the step that contains them — the step then enters with no messages, so the turn closes without a model call. Any sentence the router does not own, a chat with no attachment, and a failed write all delegate to the agent unchanged. The reply declares `faberloom`/`iteration-router` as its producer, so no reader mistakes it for a model answer.

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
- **Foreign-Space access is refused at the file tools.** `read`, `read_image`, `write`, `edit`, `glob`, `grep`, `bash`, and `pwsh` are checked against the readable folders; a path under a Space outside the scope is denied with the `faberloom_spaces_open_read` instruction, and shell commands are scanned token by token for an absolute or relative folder spelling. After a grant, reads reopen the subtree while `write`, `edit`, and shell commands against it remain refused, so the grant stays read-only even in a full-access session. Shell syntax is not interpreted, so an obfuscated command can still reach the same user-owned file; the scope is authorization and discovery, not an operating-system isolation boundary.
- **The shared-key policy judges intent.** A restricted role's first human turn short-circuits as work when it names a work domain (MWT.ONE, SICOP, mail, expediente, PF/OC/SAP, purchasing and sales, the footwear catalog, contracting, and the like) or continues an earlier work turn with a short answer. Every other turn goes to a scope classifier: one small call on the session's own route, capped by `scopeTimeoutMs`, that answers whether the message is work or personal. A personal verdict is refused before the provider call; an unavailable or unusable classifier follows `scopeFallback` (`allow` by default, `refuse` for a deployment that prefers the stricter side). Internal calls without a session (the board classifier), auxiliary calls with a purpose, and tool continuations bypass the guard. A credential the account stored itself (source `file`) whose value is not one the deployment supplies is its own key and is never limited.
- **The own-key test is a value comparison, not a route name.** Every request resolves its credential reference and compares the SHA-256 fingerprint against the values the deployment supplied at launch for `sharedCredentialRefs`. A reference outside that list is not assumed to belong to the account; it follows the same test. The fingerprints are process memory and are never logged or persisted, so a deployment that rotates its key after launch is recognized by source only until the process restarts.
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
