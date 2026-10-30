# Agent Note: One place for the shell's preferences

Status: implemented

English | [中文](2026-10-12-one-place-for-the-shell-preferences.zh.md)

## Problem

The signed-in shell kept its two preferences in the sidebar foot: `packages/client/ui-faberloom` registered the palette menu and the interface-language menu as two `sidebar.footer.action` occupants beside the Settings control, each writing through its own service. That gave each preference a second home beside its settings row, made the foot carry three controls where the owner wanted one way in, and left the two menus' locale keys and the flag art in the product plugin rather than with the theme feature that owns the palettes and the locale feature that owns the language. A user could set the same preference from two places that then had to stay consistent.

## Decision

**The sidebar foot carries only the Settings control.** `packages/client/ui-faberloom` registers nothing into `sidebar.footer.action`: its palette menu, its language menu, the store wiring and locale keys behind them, and the flag art the plugin held are gone, so the foot's only occupant is `ui-settings`'s `sidebar.settings` control, which opens the Settings modal. `ui-sidebar` needed no change: `sidebar.footer.action` is a `list` seat, an empty list contributes no width, and the foot's rule — each icon control keeps its size while a label yields the row's space and ellipsizes inside its own control — is unchanged.

**The palette choice is the Appearance row's list.** `ui-theme`'s Apariencia (Appearance) row lists the registered palettes grouped into the brand's dark and light families, dark first, each row a swatch drawn from the palette definition's own tokens — the ground from `--dsw-alias-bg-base` and the accent from `--dsw-alias-brand-primary` — and marks the palette in effect, which is the snapshot's `active.id`, not the stored preference. `system` remains the persisted default and still resolves through the operating system (`prefers-color-scheme`) between the default pair; it has no row of its own, so a fresh install shows the palette it resolves to, and picking a row pins that palette.

**The interface language is a Settings section.** `ui-theme` registers a `settings.section` contribution with id `language` and order 25. Its closed control shows the active locale's flag and a chevron with no visible text; its list shows each locale's own name with the active one marked. The three flags — English, Chinese, and Spanish — are small inline SVGs in `packages/client/ui-primitives` (`LocaleFlag`), which is where they can live because a feature plugin may not runtime-import or re-export another feature plugin's values; a locale with no art still renders a named row but no icon. The locale package no longer registers a `settings.general.item` row of its own, so the interface-language choice exists once.

**The product composition disables two settings rows instead of deleting their packages.** `packages/bundle/faberloom-app/cordis.patch.yml` sets `disabled: true` on the `ui-settings-models` and `ui-settings-unarchive-sessions` rows, which other deployments still ship, so this product's Settings nav carries General, Complementos (Plugins), Presets de agente (Agent presets), and Idioma (Language); `packages/client/ui-settings-general` maps the `language` section id to the globe glyph. The consequence accepted with the disabled rows: Modelos was the only surface where a deployment-level provider key could be entered, and those keys now come from the environment (`.env`, including the `<NAME>_FILE` form) and from each agent's own key field.

## Alternatives considered

**Keeping the two foot controls.** The foot menus were already built and reachable from every screen, but the owner asked for one way in, and two entries beside Settings kept a second home for each preference.

**Keeping the language row in the General section.** The locale package's own row already wrote the same preference, but it duplicated the choice and showed the language's name as text where the owner wanted the active locale's flag.

**Deleting the two settings packages instead of disabling their rows.** The packages are still mounted by the web-app composition and can serve another deployment, so the product overlay takes their nav rows out and leaves the packages in the repository.

**Keeping the flag art in `ui-faberloom`.** The art had to move with the language choice into `ui-theme`, and the client bundle purity gate forbids one feature plugin importing or re-exporting another's values; `ui-primitives` is the shared package every feature plugin may use, so `LocaleFlag` lives there.

**Listing a follow-the-system row among the palettes.** `system` stays the persisted default and still resolves through the operating system, but the owner asked for the palettes only, so the list carries no such row and marks the palette `system` resolves to.

## Consequences

The shell's palette and interface language are each chosen in one place, the Settings modal, and the sidebar foot holds one control. A fresh install keeps `system` and shows the palette it resolves to; picking a row pins a palette, and the interface language shows the active locale's flag in both the closed control and its list row. Both choices write through the services they already used, so a theme or language package needs no new path, and the locale package's surface is one row smaller.

The cost is that neither preference is visible from the navigation column any more: a user who wants to see or change the palette or the language opens Settings. The two settings packages stay in the repository with their nav rows disabled in this product, and a deployment-level provider key is entered from the environment or an agent's own field rather than from a page.
