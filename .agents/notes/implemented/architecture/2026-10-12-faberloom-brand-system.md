# Agent Note: Brand FaberLoom with its own type, mark, icons, and theme control

Status: implemented

English | [中文](2026-10-12-faberloom-brand-system.zh.md)

## Problem

The client and its Windows installer shipped the upstream DeepSeek identity inside a FaberLoom product: system font stacks instead of the brand's faces, the whale mark and wordmark in the sidebar, the hero and the official brand occupants, a foreign icon library for the product's own panel rows, a sign-in screen with no theme control and no in-flight feedback, and — on Windows — an installer wearing NSIS's stock blue wizard artwork, with no uninstall confirmation and no way to keep the user's data.

## Decision

The brand system in `Diseño entrelazado 3x3 Faber-Loom` is the source of truth, and every surface now renders from it.

**Typography.** Three self-hosted OFL faces carry the product: Geist for interface and body, Geist Mono for data, identifiers and code, and EB Garamond italic for titles and the wordmark. `packages/client/ui-theme/src/styles/fonts.css` declares them and `--dsw-font-family`, `--ds-font-family-code` and the new `--dsw-font-family-serif` bind them, so the web client, the desktop-bundled client and the gateway's session-less pages change together. The woff2 binaries live at `apps/web/public/fonts` (served as `/fonts/*`), `apps/desktop/renderer/fonts` (the pre-login document loads from disk) and `gateway/assets/fonts` (the gateway serves its own `GET /fonts/:file` allowlist), each with the SIL OFL text beside it. The brand's Typography document also fixes the interface scale, published as shared tokens in `packages/client/ui-theme/src/styles/app-type-scale.css`, mounted right after `base.css`: app title, screen title, panel label, UI body, control, caption, overline, and data with tabular figures, each one composite `--dsw-font-<role>` plus its family, weight, size, line-height, and style parts. That scale is typography rather than palette, identical in every theme, with the mono overline the one 11px interface role and `--dsh-content-font-size` left as the user's own adjustable body size; the product's screens and the sidebar consume those tokens instead of literals.

**Mark and wordmark.** `packages/client/ui-primitives` owns `FaberLoomMark` — the 3×3 woven knot on the brand's 48-unit field, collapsing to the single woven cross below 24px — and a two-tone `BrandWordmark` where "Faber" holds the coral and "Loom" takes the ink of its ground. The sidebar's brand occupants use both: `sidebar.brand.mark` takes the isotipo in place of the whale art, and `sidebar.brand.name` renders the shared `BrandWordmark` in serif italic, so "Faber" shows the coral alias and "Loom" takes the ground's ink, ink on the light palettes and cream on the dark ones. `packages/client/ui-theme/tests/themes.client.spec.ts` pins both halves across the five palettes, so a palette edit cannot make the wordmark monochrome again. The same mark and wordmark replace the whale art in the official brand occupants and in the conversation hero, whose retired whale-swim morph becomes the brand's single filled anchor node in coral on hover.

**Icons.** `packages/client/ui-primitives/src/icons/faberloom.tsx` carries the brand's ten glyphs and its documented standard library on one 24×24, stroke-1.75 grid (45 glyphs). The client's sidebar panel rows, the Settings trigger and the hero consume them, so the product's own chrome reads as one set; the foreign glyphs the brand document does not describe (file types, editor chrome) keep their current artwork and migrate in their own pass.

**Theme and language controls.** The signed-in sidebar foot keeps only the product's Settings control: the palette and interface-language choices live in the Settings modal that control opens — the palettes in the Apariencia (Appearance) row and the language in its own section — an arrangement [One place for the shell's preferences](../feature/2026-10-12-one-place-for-the-shell-preferences.md) owns. The language section marks each locale with a flag for English (United States), Chinese (China), or Spanish (Spain), drawn as a small inline SVG because Windows does not render flag emoji; a locale with no art simply has no icon. The flags live in `packages/client/ui-primitives` as `LocaleFlag`, where the settings section and any other language surface draw one shared art, because a feature plugin may not import another feature plugin's values. Both choices write through their own services (`theme`, `locale`), the same path the settings rows use, so a control and its row stay one setting; the five palettes themselves are the [shell design-system note](2026-10-12-faberloom-shell-design-system.md)'s subject. The foot's Settings control asks for its tooltip above the anchor, and the bubble is caption-sized. The desktop sign-in document and the gateway's session-less pages carry their own light/dark toggle — persisted in `$DSH_HOME/desktop-appearance.json` and in `localStorage` respectively, defaulting to the operating system — because a user who has not signed in has no server-side preference to read.

**Sign-in feedback.** The desktop submit button and the gateway login form mark themselves busy with an inline spinner while the request is in flight, and re-arm when the user returns with the browser's Back button.

**Windows installer.** `apps/desktop/build` carries the installer and uninstaller window icons, the header mark and the 164×314 wizard panels rendered from the committed brand SVGs, replacing NSIS's blue default bitmap. `apps/desktop/scripts/installer.nsh` adds the confirmation the assisted flow does not show and a keep-or-delete question naming `$PROFILE\.dsh` and the application profile, defaulting to keeping the data and staying silent during an update's silent uninstall.

## Alternatives considered

**Google Fonts CDN link.** Loses offline rendering in the desktop document and adds a third-party request to a signed-in product; self-hosting keeps the three faces inside the artifact with their licence text, at the cost of three copies of the binaries across serving surfaces.

**Keeping the wordmark as SVG outlines.** Two-tone colouring would need a font-to-path step in the build; live text in the brand face is the same artwork with less machinery, and the token still falls back to Georgia when the face is unavailable.

**A bespoke hover animation for the hero knot.** The brand reserves motion for the weaving progress state; the coral anchor node is the documented "en uso" signal and needs no keyframes.

**Rewriting every upstream glyph at once.** The glyphs the brand document does not describe have no design source; inventing them here would be authoring brand art without a decision, so they migrate separately.

**Reusing electron-builder's `deleteAppDataOnUninstall`.** It deletes silently on a build flag and cannot ask the user; the question needs the uninstall hook, and the flag stays off.

**Registering the sidebar foot toggle from `ui-theme`.** That is the feature's natural owner, but the seat belongs to `ui-sidebar`, and the chain `ui-sidebar → ui-layout → ui-theme` makes the project reference circular; the slot catalog also rejects a second declaration of the same seat ("SlotMap merges duplicates silently, so the catalog cannot tell which documentation wins"). The registrant therefore sits outside `ui-theme`'s closure, in the product plugin that already depends on both packages, and writes through the `theme` service instead of importing the feature's internals.

## Consequences

The UI changes face at once, so any layout that measured the old wordmark artwork needs its own check: the wordmark is now text with a token-driven face, not a fixed viewBox. The desktop, web and gateway copies of the fonts must stay byte-identical, and the OFL text must travel with each. The sidebar foot holds one control, the Settings trigger, so the trigger is icon-only, named by its hover tooltip rather than a label. The uninstall question is declared for every language electron-builder loads — makensis warns (6040) per missing language and electron-builder treats warnings as errors — which `apps/desktop/tests/branding.spec.ts` now asserts, so adding an installer language is a mechanical edit to `installer.nsh` rather than a build surprise. The installer artwork is rendered from the brand SVGs by hand; the packaging smoke checks that each file exists at the size NSIS requires, not that it still matches the design source.
