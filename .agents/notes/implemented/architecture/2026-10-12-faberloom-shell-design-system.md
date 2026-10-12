# Agent Note: Adopt the FaberLoom shell — five palettes, grouped navigation, top bar, and responsive rails

Status: implemented

English | [中文](2026-10-12-faberloom-shell-design-system.zh.md)

## Problem

The signed-in client shipped one light and one dark theme behind a single toggle, a flat list of panel rows, and a three-column frame with no top bar and no behaviour for a window narrower than the desktop layout. The brand system in `Diseño entrelazado 3x3 Faber-Loom` defines five complete palettes, groups navigation into modes and accordions that carry counts, and expects a top bar with a search seat and rail controls plus rails that leave the flow when the window narrows. On a resized, floating, or split-screen desktop window — the common case for the desktop app — the rails still demanded their tracks and navigation became unusable, and the palette the product had chosen for itself was not reachable at all.

## Decision

**Palettes are registered themes.** `packages/client/ui-theme/src/theme-palettes.ts` is the catalog: five palettes transcribed from the brand book — `dark` (Faber Warm, the default), `slate`, `mono`, `light` (Paper, the default) and `cloud` — each mapped by role onto the shared `--dsw-alias-*` tokens (surfaces, ink, hairlines, accent, and the four functional states) and each carrying its `colorScheme`, its ground, and its brand-book name. The client half seeds `BUILTIN_THEMES` from that catalog at construction, so a durable preference naming any palette resolves on the first adoption instead of falling back; `light` and `dark` stay the pair a `system` preference picks between. Palette names are proper nouns and stay verbatim in every locale; only the dark/light group headings ride the dictionaries.

**The durable preference covers the catalog.** `THEME_PREFERENCES` derives from the catalog's ids plus `system` (`[...THEME_PALETTE_IDS, 'system']`), so the settings schema accepts every built-in palette and the existing write-back guard keeps working unchanged. A theme a plugin registers at runtime remains selectable and composes like any other, but has no durable value.

**Both faces read one catalog.** The Host half previously knew only light and dark: `boot-theme.ts` painted `#fff` or `#151517` and derived `body[data-ds-dark-theme]` from a three-value union. It now resolves the preference through the same catalog — a palette id paints that palette's own ground and its scheme before first paint, while `system` and an id from a newer build fall back to the neutral pair with the `prefers-color-scheme` query.

**The sidebar foot carries two menus.** The single theme toggle becomes a palette menu listing every registered theme grouped by scheme, each row carrying a swatch drawn from that theme's own definition, with follow-the-system above them; beside it sits an interface-language menu listing the registered locales. Both live in `packages/client/ui-faberloom` because the `sidebar.footer.action` seat sits outside `ui-theme`'s reference closure, and each writes through its own service (`theme`, `locale`).

**Navigation groups into modes and accordions.** `sidebar.panellist` gains three optional list options — `mode`, `group`, `badge` — resolved per projection like `label`. `packages/client/ui-slots` carries them verbatim on the stored entry, `packages/client/ui-sidebar` projects them into its panel metadata, and `packages/client/ui-faberloom` declares them for its sections (Operar / Aprender / Admin, with a thematic group per area and a badge only where the live overview holds a real number). The sidebar renders a mode bar when more than one mode exists, an accordion per group with its row count, and keeps a flat list unchanged when no row declares a mode or group.

**The frame owns a top bar and the responsive regimes.** `packages/client/ui-layout` renders a 54px top bar above the columns with a brand seat, a centre seat, and an actions seat (all three declared there, none with fallback), plus the rail toggles. Below 1024px the left column leaves the flow as an off-canvas drawer with a scrim, Escape-to-close and focus return, and the right rail hangs over the canvas instead of reserving a track; below 768px the canvas is the page. The regime comes from the frame's measured width, so a floating or split window lands in it without a device signal.

## Alternatives considered

**Keeping `ThemePreference` a closed union and adding the three new palette ids to it by hand.** That duplicates the palette ids in a second module and drifts the moment a palette is added. Deriving the tuple from the catalog keeps one list: the ids are declared once, in the module both faces already read.

**Letting a third-party theme id persist too.** The durable field crosses a Host schema that cannot enumerate a registry assembled at runtime, and the boot style has no ground to paint for an unknown id. The built-in catalog is the persistable set; a plugin theme composes in-session and its id is not written.

**A generic `meta` bag on the slot registry instead of three named list options.** The registry's list kind already carries row-presentation fields (`label`, `order`), and a typeless bag would let a misspelled key vanish silently. Three named optional thunks keep the type system honest about what an owner may read.

**Registering the extra palettes from `apply` after the runtime is built.** The runtime adopts the durable preference in its constructor; registering afterwards means a persisted palette id is read while still unknown and silently resets to the default. Seeding the built-in set at construction removes that ordering hazard.

**Painting only the neutral pair at boot whatever the palette.** A dark palette would flash a cool neutral ground before the shell mounts — visible on every load. The catalog's ground costs one lookup and removes the flash.

**A per-rail drawer owned by `ui-sidebar`.** The rails' widths, the resize handles, and the crossing state live in the layout store; a drawer in the sidebar would need to know the frame's width and would leave the right rail unreserved in the same regime. One measured regime in the frame keeps both rails consistent.

**A mode bar that follows the selected row's mode.** Switching navigation on a background selection change moves the user's ground under them; the bar keeps the user's pick and the active row's group is the thing that auto-expands.

## Consequences

Navigation now scales: a row is placed by its declarer, grouped without the sidebar knowing what a group means, and a section with no grouping metadata renders exactly as before — the three options are optional, and the flat list keeps its own snapshot. The top bar's three seats are empty until something registers into them, which is deliberate: no dead search box ships with the frame. The palette menu lists what the registry holds, so a theme package added later appears without touching the menu, and its swatch comes from the theme's own tokens.

Two limits are accepted. The Settings Appearance row still offers the default pair plus `system` — the five palettes are reachable from the foot menu, and folding the row into a palette list is its own change. And the slot catalog's list options are curated text, so adding the three members to `ctx.slots.register` also updated `scripts/gen-client-catalog.ts` and its spec in the same change; a future list option must do the same.

The boot style now paints the palette's own ground, which changes the injected index bytes. Nothing outside this package records those strings, and the boot page reads `--dsh-boot-bg` as its fallback, so the pre-paint colour follows the palette without a consumer edit.
