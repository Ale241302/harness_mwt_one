# Agent Note: The primary button paints a dedicated surface, not the brand coral

Status: implemented

English | [中文](2026-10-15-primary-button-contrast.zh.md)

## Problem

The cream label `#F4F1ED` on the brand coral `#C96442` measures 3.46:1. A 14px label at weight 600 needs 4.5:1 for WCAG AA, so every primary button that paints the coral behind its label fails.

Three shipped surfaces paint it: the Desktop shell's `apps/desktop/renderer/startup.css`, the gateway's deployed login page in `gateway/server.mjs`, and the Web client, where `packages/client/ui-theme`'s palette catalog fills `--dsw-alias-button-primary-fill` with the palette coral and labels it with the palette canvas. That pairing measures 3.20:1 on Paper and 3.46:1 on Bond. The coral itself is the product identity, and the wordmark, the focus rings, and the decorative marks carry no text, so they are not the defect.

The [Desktop sign-in Agent Note](../architecture/2026-10-15-desktop-launch-backend-and-sign-in-card.md) recorded the pairing and left it in place.

## Decision

Each surface keeps the coral as its brand accent and paints the text-bearing primary button with a dedicated primary surface.

- `apps/desktop/renderer/startup.css` declares `--accent-surface: #A24E2C` and `--accent-surface-hover: #94472A`; the base `button` rule and `#recovery-submit` paint them, while `--accent` keeps `#C96442` for the focus ring and the wordmark. Cream `#F4F1ED` measures 5.09:1 on the light surface and 5.84:1 on its hover. Both dark blocks set `--accent-surface: #CD6B4A` and `--accent-surface-hover: #D97757`, which measure 4.60:1 and 5.34:1 under the dark ink `#1F1E1C`.
- `gateway/server.mjs`'s `AUTH_CSS` sets `--auth-primary: #A24E2C` and `--auth-primary-hover: #94472A`; `--auth-coral` keeps `#C96442` for the wordmark. The dark `--auth-primary` stays `#CD6B4A` with its `#D97757` hover.
- `packages/client/ui-theme/src/theme-palettes.ts` gains the `coralSurface` and `coralSurfaceHover` palette roles, and the alias mapping points `--dsw-alias-button-primary-fill` and `--dsw-alias-button-primary-hover` at them. Paper and Bond use `#A24E2C` and `#94472A`; Faber Warm and Slate repeat their coral `#CD6B4A` and hover to `#D97757`; Ink repeats `#D6724E` and hovers to `#E08760`. `--dsw-alias-brand-primary`, `--dsw-alias-brand-primary-new-colorprimary-new-color`, links, and focus rings keep the coral in every palette.

The palette's dark hover moves off `coralDeep` `#A84F33`, which measured 3.17:1 against the dark canvas ink, onto a lighter coral; the shell and the gateway already hover light on the dark theme.

## Alternatives considered

**Darken the accent token itself.** Rejected: the wordmark, the focus rings, and the decorative marks read that same token and carry no text, so one darker accent would restyle the brand to fix a button.

**Keep the coral and lighten the label.** Rejected: white on the coral measures 3.90:1, so no label colour reaches 4.5:1 on that surface at this size.

**Fix only the Desktop shell.** Rejected: the three surfaces render the same control with the same pairing, and the [Desktop sign-in Agent Note](../architecture/2026-10-15-desktop-launch-backend-and-sign-in-card.md) recorded them as one change.

**A new token family per surface (`--accent-primary`, `--auth-submit`, a second `--dsw-*` name).** Rejected: each file already names its text surfaces in one family, and the alias the Web client's primary button already reads is the right home for the new value.

**Reach 4.5:1 on the cream label alone (`#A5502E`).** Rejected: the Web client's Paper palette labels the same button with its own darker canvas `#EDE8DF`, which that value carries at 4.55:1; `#A24E2C` carries both creams with more margin.

## Consequences

One light primary-surface value serves all three surfaces, so a brand revision touches it in three places. The shell's disabled states and focus rings are untouched. The Web client's dark primary button keeps its rest fill and gains a lighter hover.

Two sheets painted the coral behind text for the same reason: `.primary` in `packages/client/ui-faberloom/src/client/faberloom.module.css` and in `packages/client/ui-faberloom/src/client/mcp-servers-section.module.css` set `background: var(--dsw-alias-brand-primary-new-colorprimary-new-color)` under the palette canvas label, which measures 3.20:1 on Paper and 3.46:1 on Bond. Both were closed in the same pass: each now consumes `--dsw-alias-button-primary-fill` and `--dsw-alias-label-primary-foreground`, so every primary button in the product uses the surface this decision defines.

## Testing

`packages/client/ui-theme/tests/themes.client.spec.ts` computes the WCAG relative-luminance ratio and requires 4.5:1 or more for `--dsw-alias-button-primary-fill` and `--dsw-alias-button-primary-hover` under each palette's `--dsw-alias-label-primary-foreground`. `apps/desktop/tests/startup-renderer.spec.ts` pins the two new shell values beside the retained coral. `test:gui` (418 files, 5989 tests), the two focused specs, `verify-client-ui-i18n`, and oxlint over the touched files pass. No gateway spec pins the login page's markup.
