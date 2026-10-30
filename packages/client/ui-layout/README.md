---
description: "Shell layout for the Web GUI: the three-column AppFrame, its responsive rail regimes, the panel-geometry service, and theme presentation; for users and maintainers of the window chrome."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

## Summary

This package provides the Web GUI's shell frame: a three-column AppFrame with edge-column widths and `ctx.layout` presentation control. The right column concedes space before the center; its occupant renders fullscreen while the frame retains the wide-screen track underneath. Below the tablet breakpoint the rails leave the flow: the left one becomes an off-canvas drawer opened by one floating toggle, the right one overlays the canvas. Below the phone breakpoint the canvas is the page. The theme presenter owns color scheme, alias tokens, content font size, and document metadata. Layout state resets on reload.

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

The root slot composes the sidebar, the main content, and the right column. The sidebar spans 264–420px and defaults to 280px, keeping a 56px rail when collapsed in the wide regime; opening the right panel collapses a manually expanded sidebar. The right panel first opens at 45% of the viewport, then retains the user's pixel preference, capped at 70%. To protect 400px for the center, the frame first reduces the right panel to 300px, then reports insufficient room so its occupant closes it, and only then compresses the center further. Dragging has no transition delay; the right handle is absent while closed or fullscreen.

Global panels occupy the root-scoped `main` keyed slot; `conversation` is the reserved key for the Conversation. `ctx.layout.selectPanel(id)` selects a registered panel, and `null` selects the Conversation without changing the current Session. No global panel is registered by the shipped composition.

### Drawer toggle

The frame draws no chrome bar. Its only frame-level control is the left rail's floating toggle, and it appears below the tablet breakpoint, where the left rail is off-canvas: one 44px button in the top-start corner over the canvas, each carrying `aria-expanded` plus the localized `aria-label` from this package's `layout` dictionary. It is present only while the drawer is closed; clicking it opens the drawer, and the expanded sidebar's own collapse control, the scrim, and Escape close it. In the wide regime the sidebar carries its own collapse control, so no frame toggle renders there, and the right rail has no frame toggle: its expand control lives in the conversation header.

### Responsive regimes

The regime follows the frame's own measured width, not the window: the desktop app is routinely floating, resized, or split-screened. At or above the tablet breakpoint the three columns stay in the flow. Below it the rails leave the flow: the sidebar becomes an off-canvas drawer (slide-in, scrim, Escape, focus moved into the drawer and returned to the floating toggle on close, `aria-hidden` while closed) and the right rail reserves no track, so its panel overlays the canvas instead of squeezing it. Below the phone breakpoint the canvas is the page and the drawer is the only navigation. The layout never produces horizontal scrolling at 360px, 768px, 1024px, or 1440px, and crossing a breakpoint drops the drawer override so no state is stranded.

### Theme presentation

The presenter consumes resolved theme snapshots and projects them onto the document: `html { color-scheme }` for native UA chrome, `body[data-ds-dark-theme]` from the active color scheme, the theme's alias tokens and `--dsh-content-font-size` as inline variables on body, and one owned `<meta name="theme-color">` whose content follows the computed body background. Disposing the presenter removes its metadata node with its other global writes.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`selectPanel(id)` checks the live `main` registry before changing selection; an absent key throws and leaves the current panel intact. `beginNavigation()` returns an abort signal for an asynchronous UI navigation. A later call, a valid panel selection (including repeated selection), or layout disposal aborts that signal without cancelling underlying Session creation. Consumers check the signal before committing navigation or moving drafts.

One registration declares the child slots (three columns and the frame-wide overlay layer) and binds `ctx.layout` methods `selectPanel`, `toggleSidebar`, `openRightbar(track, fullscreen)`, and `closeRightbar`. The same registration's inject face publishes whether the left rail has an occupant as a private observable, bound to the frame's `useRails` selector hook: an unoccupied left rail shows no floating toggle. One root store separates `panelInfo` selection from `layoutInfo` measurements, width preferences, and presentation reports. `usePanelInfo` subscribes to the stable selection object; AppFrame subscribes to the stable layout object. The `rightbar` owner supplies actual `width`, `viewportWidth`, and normal-presentation eligibility `canShow`; insufficient room causes a deterministic close, never automatic reopening on widening. Fullscreen hides the width handle without releasing a track the occupant retains. The three responsive regimes derive from the measured frame width (`shellRegime`), and the drawer's open state is the store's existing narrow override, so a breakpoint crossing clears it exactly once. AppFrame keeps the column containers mounted. The right column's root controller renders `rightbar.session` through `SessionProvider` only while the Conversation is selected; its unmount report releases the track. The independent title component uses the selected Session title only while the Conversation is visible, with the build-configured product title or localized `brand.localBuild` (this package's `layout` dictionary consulting the shared common vocabulary) as its fallback; locale revisions update that fallback. The theme presenter is a second effect: pure DOM writes from resolved snapshots — initial state through the getter once, then event-driven only, with no React path. It applies palette, font-size, and token variables before measuring the rendered background as the single color authority. Fullscreen presentation suppresses grid and handle transitions; its occupant reports the new columns only after covering the frame. Fullscreen exit keeps transitions suppressed while the frame installs its destination geometry: close removes the right track, and restore retains it. Subsequent normal geometry actions restore ordinary transitions.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the layout surface is not enough. They move from the frame to the columns it renders and the theme it presents.

- [ui-sidebar](../ui-sidebar/README.md) — occupies the `sidebar` column and its seats.
- [ui-conversation](../ui-conversation/README.md) — occupies the `main` key `conversation`.
- [ui-sidebar-right](../ui-sidebar-right/README.md) — occupies the `rightbar` column with one docking surface per session.
- [ui-theme](../ui-theme/README.md) — the theme seam whose resolved snapshots the presenter consumes.
- [Web client architecture](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the layout shell manages browser viewing state; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current layout behavior. They are current package constraints, not a general window-manager comparison or a task backlog.

- **Panel geometry is transient** — reload restores the sidebar default and the right panel hidden; each dragged width is one frame-wide preference, not a per-Session fact.
- **Extremely narrow windows** — in the wide regime, after the right panel closes the center may still fall below 400px beside the 56px rail; below the tablet breakpoint the rails leave the flow instead.
- **Track and panel travel on one shared curve** — the frame's track transition and the occupant's slide read the same duration and easing variables; an occupant that used its own would detach the panel's edge from the conversation's while squeezing.
- **No scroll anchoring during squeeze reflow** — layout changes may move the reader's viewport.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The shell viewing-state store behind `ctx.layout` emits no Cordis events; clamp and track sequencing is asserted directly by this package's columns and service specs.
