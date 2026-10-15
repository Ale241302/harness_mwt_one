---
description: "FaberLoom surface for the Web GUI: the identity tokens, the brand name, the global panels (Conversar, Mesa de trabajo, Espacios, Agentes, Rutinas, Flujos, Memoria, Conexiones), and the MCP servers page in Settings that the faberloom profile serves; for users and maintainers of the FaberLoom workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-faberloom

English | [中文](README.zh.md)

## Summary

The FaberLoom surface turns the Web shell into the FaberLoom workspace: it overrides the accent token with the FaberLoom identity, labels the sidebar brand, and registers one panel per section plus the MCP servers page in Settings. The panels read one shared overview from a declared store; Espacios and Agentes create and rename records through `ctx.remote.faberloomView`, and each write republishes the overview so all panels update at once, while the MCP page lists, tests, and removes the owner's servers through the same remote. Conversar and Flujos open the conversation and the Work Flow graph. Only the `faberloom` profile mounts it.

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this plugin where `ctx.slots`, `ctx.locale`, and `ctx.theme` are present. It then contributes:

- an accent layer through `ctx.theme.overrideTokens`, which follows light and dark;
- the `sidebar.brand.name` two-tone wordmark and the `sidebar.brand.mark` and `conversation.hero.brand.mark` isotipo occupant;
- ten `sidebar.panellist` rows over twelve `main` panels, addressed by the shared `MainPanelId` (the Chat landing and the Skills panel keep their routes without a sidebar row);
- the chat gestures: an `@` trigger source that lists the owner's active agents (a pick inserts `@name`) and a `/routine` command contribution with a popup that starts the picked routine, both fed by the workspace overview through `ctx.remote.faberloomView`;
- the Skills panel's install control: it opens the mounted directory picker, offers the current workspace or the global skills root with the resolved root of each shown, installs through `ctx.remote.faberloomView.installSkill`, and lists this identity's recorded installs with a remove action. The control appears only inside the Desktop application: a browser hides it, because there the picker would list the host's filesystem instead of the operator's own folder;
- the MCP servers page in the Settings modal: it states that a server is saved for the user alone and is available in every workspace and Space, lists the owner's installed servers with their transport and their proven state (a server reads *connected* only when it is enabled and mounted; an enabled server that did not mount reads *saved but not verified* with the redacted reason; a disabled one reads *disabled*), and which credentials are present (never a value and never the credential reference). A user may have many servers, one per purpose; each keeps its own row, state, and actions, so one server's failure never hides another, and a search field appears once more than a few are installed. It tests one candidate connection before it is saved (showing the tools it found, or the named failure — *the server did not answer*, *the credential was rejected*, *the server answered something unexpected* — with its redacted detail and the next action), refuses to save a named credential with no value (*the value is missing*) or a value with no name, installs it with every value going to the credential seam, and lets the owner edit a row in place (re-entering the saved values, which are never shown), enable or disable it, or remove it after an inline confirmation. It reaches the host registry only through `ctx.remote.faberloomView` (`mcpServers`, `saveMcpServer`, `removeMcpServer`, `probeMcpServer`), so no host registry code reaches the browser.

The sidebar foot carries only the Settings control, and this package registers nothing into `sidebar.footer.action`. The product's palettes, its interface language, and its MCP servers are chosen in the Settings modal that control opens: the palettes in the **Apariencia** (Appearance) section, the interface language in the **Idioma** (Language) section, and the MCP servers in the **Servidores MCP** (MCP servers) section.

The Spaces detail links the business space to the harness workspace: `spaceWorkspace` projects the space's conversation area (its `fw_` workdir registered as a workspace, titled after the space) and "New conversation in this space" opens a session in it, so the sidebar's workspace group and the space stay the same thing. The Work bench reviews with a note, submits new prepared revisions, moves items through the exception states (request data, fail, complete), and lists recorded effects with detail and date.

The rows group by the design's three navigation modes — `Operar` (Mesa, Espacios, Rutinas, Flujos, Correo), `Aprender` (Memoria, Contexto, Aprobaciones), and `Admin` (Agentes y Skills, Conexiones) — and carry a badge only where the live overview already counts their records; a section with no real number shows none.

The four screens whose work is one record at a time open that record in a dialog over a full-width table: the Skills detail, the work-bench task, the connection editor, and the context entry. A row click opens it, `Nueva tarea` and `+ Nueva conexión` open the same dialog on a new record, and Escape, the mask, the header close control, or the footer's `Cerrar` dismisses it. Memoria already worked that way; the other four follow it, so no detail editor shares the width with its list. A new connection opens on an empty form rather than on the last record the editor held.

Memoria's dialog also names the conversation behind a distilled line. Saving a turn stores the Session that captured it, and the dialog resolves that Session's title and offers `Abrir conversación`, which opens the Session and leaves the panel; a Session this host no longer lists reads as gone rather than offering an action that cannot run. A line recorded by hand, or captured from an email or a document, states that origin instead.

All registrations are effects on the calling plugin's fiber and disappear with it.

-----

<a id="model-experience"></a>
## Model Experience

### Panel registration

#### What the model sees

Nothing directly. The plugin contributes no tools, injects no prompt text, and writes no session events. The `@` gesture only places plain text in the draft, so what the model receives is the agent's name in the user's message; delegating to that agent is the host's `faberloom_agents_delegate` tool, and starting a routine from `/routine` is the host's execution service.

#### Token effect

Zero direct tokens on every request.

#### KV Cache effect

Independent of live requests: panel registration never touches a request prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Panel actions where the screen allows them** — Espacios creates, renames, edits the Space's agent directive, adopts an existing folder as the Space's Workspace through the mounted directory picker, and writes the Space's context export into that folder; Agentes create, rename, and deactivate; Mesa creates and approves or rejects; Rutinas creates and toggles; Memoria records a statement; Email downloads an attachment, saves it into a chosen Space's folder as a real file, or mails a file from a chosen Space's folder as an attachment. Board revision submission, model policy, and routine step editing stay in the product services until their screens land.
- **Memory follows the pipeline** — recording a statement appends it to the agent-memory inlet, and the distilled row may appear after the next read.
- **Refresh on activity, not on push** — the panels re-read on the harness's forwarded session-activity event, on mount, and after every write.
- **Row metadata rides the sidebar's projection** — the mode, group, and badge are `sidebar.panellist` registration options the sidebar resolves per read; a badge shows the latest overview this surface published and appears with the sidebar's next projection of its rows.
- **Spanish copy under the shipped locales** — FaberLoom's product language is Spanish, and the client locale runtime requires the two shipped locales per namespace, so `zh` and `en` both carry the Spanish dictionary until a first-class `es` locale exists.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Section identity lives in one array (`FABERLOOM_SECTIONS`): the sidebar id, the main-panel key, the row order, the label key, the navigation mode and group keys, an optional overview-count badge, and both occupants. Adding a screen is one entry plus its copy keys. Below the tablet breakpoint the table/inspector split collapses to one column (the inspector becomes a full-width block under the table), and each table pans inside its own card with a sticky header.

</details>

**Runtime invariant:** No companion is published. Every registration is an effect on the plugin's fiber, and the browser spec proves the sidebar rows, main panels, and brand name all disappear when that fiber is disposed.
