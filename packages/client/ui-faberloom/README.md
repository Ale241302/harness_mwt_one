---
description: "FaberLoom surface for the Web GUI: the identity tokens, the brand name, and the global panels (Conversar, Mesa de trabajo, Espacios, Agentes, Rutinas, Memoria, Conexiones) that the faberloom profile serves; for users and maintainers of the FaberLoom workspace."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-faberloom

English | [中文](README.zh.md)

## Summary

The FaberLoom surface turns the shared Web shell into the FaberLoom workspace: it overrides the accent token with the FaberLoom identity, labels the sidebar brand, and registers one global panel per FaberLoom section. Every panel reads one shared overview from a declared store; Espacios and Agentes create and rename their records through `ctx.remote.faberloomView`, and each write republishes the refreshed overview so all panels update at once. The Conversar panel hands the user to the harness conversation, which owns the composer. The package is mounted only by the `faberloom` profile.

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
- the `sidebar.brand.name` occupant;
- ten `sidebar.panellist` rows and their matching `main` panels, addressed by the shared `MainPanelId`;
- the chat gestures: an `@` trigger source that lists the owner's active agents (a pick inserts `@name`) and a `/routine` command contribution with a popup that starts the picked routine, both fed by the workspace overview through `ctx.remote.faberloomView`.

The Spaces detail links the business space to the harness workspace: `spaceWorkspace` projects the space's conversation area (its `fw_` workdir registered as a workspace, titled after the space) and "New conversation in this space" opens a session in it, so the sidebar's workspace group and the space stay the same thing. The Work bench reviews with a note, submits new prepared revisions, moves items through the exception states (request data, fail, complete), and lists recorded effects with detail and date.

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

- **Panel actions where the screen allows them** — Espacios and Agentes create, rename, and (agents) deactivate; Mesa creates and approves or rejects; Rutinas creates and toggles; Memoria records a statement. Board revision submission, model policy, and routine step editing stay in the product services until their screens land.
- **Memory follows the pipeline** — recording a statement appends it to the agent-memory inlet, and the distilled row may appear after the next read.
- **Refresh on activity, not on push** — the panels re-read on the harness's forwarded session-activity event, on mount, and after every write.
- **Spanish copy under the shipped locales** — FaberLoom's product language is Spanish, and the client locale runtime requires the two shipped locales per namespace, so `zh` and `en` both carry the Spanish dictionary until a first-class `es` locale exists.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Section identity lives in one array (`FABERLOOM_SECTIONS`): the sidebar id, the main-panel key, the row order, the label key, and both occupants. Adding a screen is one entry plus its copy keys.

</details>

**Runtime invariant:** No companion is published. Every registration is an effect on the plugin's fiber, and the browser spec proves the sidebar rows, main panels, and brand name all disappear when that fiber is disposed.
