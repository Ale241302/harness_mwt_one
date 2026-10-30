---
description: "FaberLoom workspace view for the browser: one Remote read of the signed-in owner's spaces, agents, board, routines, memory, and Work Flow graphs, plus create, rename, graph-edit, run, topology, export, and MCP-server writes; for maintainers of the FaberLoom panels."
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-view

English | [中文](README.zh.md)

## Summary

The workspace view is the one host capability the FaberLoom browser panels use. It exposes `faberloomView.overview()` and returns plain JSON rows, so the panels render real records instead of placeholders, and it exposes the writes those panels need, including the Work Flow graph-edit, run, topology, and export methods. Identity comes from deployment configuration, never from the call: the gateway injects the authenticated owner into this row, as it does for `tool-faberloom`, so a browser cannot request another owner's rows. Memory rows come from the agent-memory core under the same deployment identity.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this row in a composition that already carries `ctx.faberloomSpaces`, `ctx.faberloomAgents`, `ctx.faberloomBoard`, and `ctx.faberloomRoutines`, and configure `ownerId`. Configure `memoryCoreUrl`, `memoryServiceId`, `memoryUserId`, and `memoryGatewayKey` to have the overview carry the owner's memory rows; without them the memory list is empty. The browser side mounts the generated `./remote` contribution in the client API assembly and calls `ctx.remote.faberloomView.overview()`. The spaces panel adopts an existing folder as a Space's area through `adoptSpaceWorkspace(id, path)`: it registers the folder as a Workspace titled after the space (reusing one already registered at that path) and points the space at it, so the Space and the sidebar Workspace name the same directory instead of the deterministic `spaces/<ref>` area. The Email panel saves a mailbox attachment into a space's folder with `saveSpaceAttachment(id, uid, name?)`: it writes the real file under `<space dir>/correo-adjuntos/` and returns its path and byte count, so the agent's file tools work on the document rather than a browser download. It mails a file that already lives in a space's folder with `sendSpaceFileByEmail(id, path, to, subject, text)`: the path must resolve inside the folder (an escaping path is refused), and the file travels as a `multipart/mixed` attachment through the owner's SMTP row. It writes a space's context export into that folder with `exportSpaceViewToFolder(id, 'context', '', 'markdown')` (the same call writes a Work Flow's `json`/`archify` export), landing under `<space dir>/exportaciones/`. The connectivity map is a second read: `ctx.remote.faberloomView.spaceMap()` returns every Space with its agent and mirrored workspace, every agent with its skills and MCP access, the owner's mail connections, and the registered Workspaces, feeding the palette and canvas. The Work Flow editor reads `workflowOverview()` and `workflowDetail(id)` and mutates through `createWorkflow`, `saveWorkflow`, `addNode`, `updateNode`, `removeNode`, `connect`, `disconnect`, and `setWorkflowStatus`; it lists executions with `workflowRuns(id)`, reads the palette from `spaceTopology()`, and exports with `exportWorkflow(id, 'json' | 'archify')`. It also reads `routineWorkflowLinks()` for the routine ↔ flow view and writes `setWorkflowConcurrency(id, cap | null)`; a `trigger.schedule` node carries its cadence, timezone, window, days, and business-day skip in its config. The Compartir surface adds `shareSpace`, `shareWorkflow`, `resourceShares`, and `revokeShareGrant`, which the Workflows panel drives with an email + permissions table. Starting points and portability add `workflowTemplates`, `createWorkflowFromTemplate`, and `importWorkflow`; the panel's Plantillas gallery uses a template and imports portable JSON, and `exportWorkflow(id, 'json')` returns that same portable format. The dispatcher's liveness is a further read: `executionHealth()` returns each routine's last run and status, failures, review backlog, waiting, retries, and sooner wait deadline, plus aggregate counters. The Skills panel installs a whole harness, a folder or a `.zip`, through `installHarness(source, replace?)`, which routes to `ctx.skillInstall.installHarness`: the installer recognises each part by the directory the convention gives it and writes skills, preset agents, always-on rules, commands, scripts, hooks, and MCP server configurations into the user's own Harness home, so the block that asks which scope a skill belongs to is gone and a harness is global for that user alone; `skillInstalls()` lists the marked installs the skill provider reads back, and `uninstallSkill(name, destination)` removes one through the installer, which removes only a directory carrying the install marker. The Settings page manages the owner's MCP servers through `mcpServers()`, `saveMcpServer(input)`, `removeMcpServer(name)`, and `probeMcpServer(input)`: the read projects each server's transport, enabled and mounted state, and credential entry names with whether the credential seam holds a value (never a value or a reference), every write reaches `ctx.faberloomMcpRegistry` as the deployment-supplied owner, and the test mounts one candidate in an isolated scope before it is saved, returning the tools it published or a named failure with every supplied secret redacted.

The Files panel reads one level of a Space's area with `spaceFiles(id, path)`: the path is workspace-relative, an escaping path is refused, hidden entries are listed, and directories sort first. A click on a file calls `openSpaceFile(id, path)`, which hands it to the operating system's associated application; the Web, which has no native opener, reports that instead of opening it.

The Mesa's external effects are reads and writes the owner's identity scopes, never the browser's. `boardEffectStatus(id)` returns the reservation, the durable intention to emit, the visible alerts, whether a dispatched effect still awaits reconciliation, and the declaration the board holds for the action type: whether an adapter serves it, whether that adapter declares the destination idempotent, and whether it can be asked about the destination (W-21, §9.8). It also says whether this reader may close the item administratively, which the board re-applies when the command runs. `boardEffectAlerts()` lists the tenant's alerts newest first with each item's title resolved. `boardEffectPolicy()` names the action types the board accepts and the reversal window it resolved for each, so the panel keeps no list of its own. `boardApproveWithExecution(id, input)` accepts the approval, the reservation, and the intention in one command; `boardEffectRevert`, `boardEffectRetry`, `boardEffectReconcile`, `boardEffectProbe`, and `boardEffectAdminClose` carry the decisions a delegated, failed, unknown, or closed item takes, and each returns the refreshed detail. `boardEffectProbe` asks the destination and returns the effect after the board settled the answer it got: `CONFIRMADO`, `FALLIDO`, or `DESCONOCIDO` in `executionOutcome`, where an unanswered probe leaves the item in its unknown state. A `probe` of false means no adapter of that action type declares a probe, nothing was asked, and the panel keeps the operator's answers. The signature reads and writes — `boardSignatureStatus(actionType)`, `boardSignatures()`, `boardSignatureIssue(input)`, and `boardSignatureRevoke(id)` — act for the deployment's owner and tenant, so a client cannot sign for another identity.

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

Nothing. The `faberloomView` methods are browser capabilities: they register no tools, inject no prompt text, and write no session events.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: the service never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Writes cover the panel actions, not every product operation.** The namespace creates and renames spaces and agents, deactivates agents, creates and reviews board items, creates and toggles routines, and records memory statements; board revision submission, model policy, and routine step editing stay out until their screens land.
- **An unknown effect outcome is retried only where the destination dedupes.** `boardEffectStatus` reports the adapter's `idempotent` declaration, so the Mesa enables Retry when the board would accept it (W-21) and keeps it shut otherwise; a destination that cannot dedupe is settled through `boardEffectProbe` or the operator's answer.
- **A destination that declares no probe cannot be asked.** `boardEffectProbe` writes nothing and returns a projection whose `probe` is false when the action type's adapter omits `probe`, so the Mesa offers the operator's three outcomes and says the destination cannot be consulted. Which destinations can answer is a deployment's adapter decision, not a product one.
- **Memory writes go through the pipeline.** `remember` appends one statement to the agent-memory conversation inlet; the server distils L0 into L1 asynchronously, so the new row can appear after the next read. Reads stay read-only.
- **Change events.** The browser refreshes on the harness's forwarded session-activity event, on mount, and after every write; a dedicated change event waits for a forwarded-event allowlist entry.
- **The connectivity map is read-only.** `spaceMap` reports links; it does not create or mutate Spaces, agents, connections, or workspaces.
- **A workspace install shows in the install records, not in the skills table.** `skills()` enumerates the role catalog, the shared catalog, and `$DSH_HOME/skills`; a workspace install lands under `<workspace>/.dsh/skills`, which the mounted skill provider discovers live and the installer's markers record, but `skills()` does not enumerate it. Reading the workspace root into that table waits for the registry read.
- **The MCP-server page lives in the Settings shell.** The four MCP-server methods project `ctx.faberloomMcpRegistry`, resolved lazily so a deployment without it keeps every other panel working; the settings page that calls them (in `dsh-client-ui-faberloom`) registers into `settings.section`, so a deployment that does not mount the Settings shell shows no page. A saved server cannot be retested from its reference: `probeMcpServer` takes a full candidate, so the page tests one before saving and the owner re-enters the values to test again.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The actor is derived from configuration, not from arguments, because the Remote boundary has no ambient caller identity. `./remote` is generated by the Typert build; rerun `pnpm run build:lib:host` after changing a method name or signature.

</details>

**Runtime invariant:** No companion is published. The service holds no derived state: every read resolves the mounted services at call time and returns a fresh projection, so there is no owned relation that could diverge.
