---
description: "Sidebar shell plugin for the dsh web client: brand row, New Session action, collapse control, scroll-aware region seat, and bottom-pinned Settings seat."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar

English | [中文](README.zh.md)

## Summary

The dsh web client sidebar lets users recognize the active build, start a new session, collapse navigation to a 56px rail, browse Workspaces and Sessions, and open Settings. It groups global panels into modes and accordions, preserves a bottom-pinned Settings entry, and hides idle scrollbars without moving browser rows. New Session uses an explicitly selected Workspace, then the current Session's Workspace, then the most recently active Workspace; if none exists, it opens a blank New Session page. Deployments can replace the brand mark or name while retaining the navigation controls and rail geometry.

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

The sidebar is the navigation shell: users see the brand, start new sessions, collapse the rail, and reach Settings. Feature plugins fill its seats — ui-workspace fills `sidebar.workspaces`, ui-settings registers the trigger row and settings panel at `sidebar.settings`, and any feature may add an action beside Settings at `sidebar.footer.action`.

### Brand and New Session

The expanded brand row renders `sidebar.brand.mark` and `sidebar.brand.name` as independent single slots; the collapsed rail renders the same mark slot. Without occupants, the shell uses the fish mark and a localized local-build label. A complete build stacks a code badge below the label as `version[-commit][-dirty]`, using `DSH_CLIENT_VERSION`, the optional 7-character `DSH_CLIENT_COMMIT_HASH`, and `DSH_CLIENT_GIT_DIRTY=true`; missing version metadata omits the badge. New Session targets the explicit Workspace used by a scoped action, otherwise the current Session's Workspace, otherwise the most recently active Workspace; when none exists it clears into the blank New Session page.

### Global panel entries

Plugins add an icon component to the root-scoped `sidebar.panellist` list with an `id`, optional `order`, a string or locale-aware `label`, and the optional placement thunks `mode`, `group`, and `badge`. The same id addresses the component registered in the layout's root-scoped `main` keyed slot; selecting a missing main entry throws without changing the current selection. The label supplies plain visible text, the accessible name, and the collapsed tooltip. Each row reads its own selected state through `usePanelInfo`; moving DOM focus to search or a directory picker does not change the displayed panel or its selected row. With no registrations, neither the list nor spacing for it is rendered. The shipped composition registers no example panel.

### Grouped panel navigation

A row that declares a `mode` navigates through a compact mode bar: one icon-only button per distinct mode value in registration order, each named by its mode and marked pressed while that mode is displayed. The bar renders once more than one mode exists, and only the displayed mode's rows render. Inside a mode, rows group by `group` in registration order under a heading button carrying a chevron, the group label, and that group's row count; the heading toggles its rows, groups start expanded, and a collapse lasts per mode and group while the sidebar stays mounted. The group holding the selected panel stays open, so the shell never leaves the active row behind a collapsed heading. A row that declares no mode stays visible in every mode, above the displayed mode's content, and a row that declares no placement keeps the flat list the shell has always rendered.

`badge` renders a short chip at the row's trailing edge in the wide column, a count or status the registrant owns and never a value the shell invents. The 56px rail drops the headings and renders the mode bar and the displayed mode's rows as icons, and each bar button reuses the glyph of the first row registered under its mode. The column is a query container: below 300px the bar and the headings tighten instead of clipping, titles ellipsize, and coarse pointers receive 44px hit targets. Group headings and row labels take the shared app type scale roles (`--dsw-font-panel-label` at 15/20 for a heading, `--dsw-font-ui-body` at 14/21 for a row, both from ui-theme's `app-type-scale.css`), and a `badge` chip takes the `--dsw-font-overline` role (mono, uppercase, 0.12em, the scale's one 11px step). The mode bar is a horizontal row, so its bubbles open above the buttons and never cover the neighbouring mode.

### Collapse behavior

During a live collapse, the expanded content fades out at its current width, the upper controls share one fade and leftward translation into the 56px rail, and the layout's column slide ends the motion. A page that starts collapsed renders the rail statically, and reduced-motion mode disables both transitions. The bottom-pinned `sidebar.settings` control and the `sidebar.footer.action` entries beside it share the fade timing but have no horizontal translation. Wide, the actions render to the right of Settings; in the 56px rail they stack above the Settings icon. The footer row keeps its icon controls at full size and lets any label yield the row's space first, so a long label ellipsizes inside its own control instead of squeezing a control out of the row.

### Scrollbars

Scrollbars in the column are a pointer affordance: the shell rebinds the scrollbar indirection to `transparent` whenever the pointer is outside the column and keeps the thumb drawn for 2s after the pointer leaves, so a list nobody is pointing at carries no bar. The reservation that keeps rows from moving belongs to the scrolling region (ui-workspace), so revealing a thumb never reflows.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The shell is pure composition: `SidebarRootComponentProps` composes the layout owner share, the global `useSessions` and `useWorkspaces` hooks, the declared brand, the `sidebar.workspaces` and `sidebar.settings` child slots, and injected navigation callbacks. Panel entries and their optional titles use the same composition path. Panel metadata is derived from list registrations and locale changes — `panels.ts` resolves every placement thunk once at publish time and derives the mode tabs and the displayed mode's accordions, while published snapshots compare field by field so an identical rebuild wakes no subscriber. The mode bar's pick and each group's collapsed state stay component-local for the mounted shell; selection belongs to the layout store.

### Slot discipline

Declaration-aware `slots.inject()` lets a replacing package activate before or after the sidebar. The foot holds the `sidebar.settings` seat plus the optional `sidebar.footer.action` list: the sidebar renders only those bottom-pinned layout slots and shares its column state (`wide`). The `/client` exports are the plugin body (`apply`/`inject`) plus the contract types only; SidebarRoot, the row components, and the tree derivation remain package-internal behind the slot registration.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages cover the surfaces that fill the shell's seats and the composition model.

- [ui-workspace](../ui-workspace/README.md) — the Workspace and Session browser rendered into `sidebar.workspaces`.
- [ui-settings](../ui-settings/README.md) — the settings domain base registering the trigger row at `sidebar.settings`.
- [ui-layout](../ui-layout/README.md) — the layout owner whose rail and column state the collapse uses.
- [ui-theme](../ui-theme/README.md) — the scrollbar token indirection the shell rebinds.
- [Slot system standard](../../../.agents/notes/implemented/architecture/2026-07-22-slot-type-chain-implementation.md) — the composition model behind the seats.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define what the shell owns versus what its occupants own; they are current package constraints.

- **Session state-dot rendering is owned by ui-workspace** — no done/error notification sources are available to this shell.
- **Workspace browser behavior is composition-owned** — grouping, ordering, search, and row state belong to ui-workspace, not this shell.
- **"New task completed" unread marking is local viewing state** — completion-time > last-seen never reaches the host.
- **A placement thunk is read when panel metadata is republished** — a registration or locale change rebuilds it, exactly as `label` works, so a `badge` that must follow a live count needs its registrant to republish rather than expect the shell to re-read a thunk on its own.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Panel metadata is a read-only presentation projection of the Slot registry and locale, with no independent write API. The registry owns entry identity and disposal; this package's assembly tests assert the projection after registration and locale notifications settle. The shell owns no separate navigation state to reconcile with those sources.
