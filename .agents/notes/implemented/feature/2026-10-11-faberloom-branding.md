# Agent Note: FaberLoom product branding

Status: implemented

English | [中文](2026-10-11-faberloom-branding.zh.md)

## Problem

The fork had been branded **MWT.ONE** (see the archived [MWT.ONE product branding](../../archived/feature/2026-09-28-mwt-one-branding.md) and [MWT.ONE browser title](../../archived/feature/2026-09-28-mwt-one-browser-title.md) notes): the browser tab, favicon, web manifest, sidebar and hero marks, and the gateway's login favicon all carried MWT.ONE. The product is **Faberloom**; MWT.ONE is the console the product talks to, not the product.

## Decision

The product brand is `Faberloom`, in both the web application and the Desktop shell, while the deployment host `harness.mwt.one` and every reference to the MWT.ONE console, its MCP, and its permissions keep their names.

- `apps/web/index.html` sets `<title>Faberloom</title>` and points the favicon at `/faberloom_favicon32.svg`; `apps/web/vite.config.ts`'s `DEFAULT_CLIENT_TITLE` follows, and `scripts/deploy-vps.sh` passes `DSH_CLIENT_TITLE="Faberloom"` so the deployed build keeps the title after `ui-layout`'s `AppFrame` recomputes it.
- `apps/web/public/manifest.webmanifest` names the app `Faberloom` and lists `faberloom_appicon512.svg` (maskable) and `faberloom_favicon32.svg` (any). The four shipped assets — `faberloom_isotipo_dark.svg`, `faberloom_isotipo_mono.svg`, `faberloom_favicon32.svg`, `faberloom_appicon512.svg` — live in `apps/web/public/`.
- `ui-faberloom`'s `FaberloomBrandMark` renders those isotope files into `sidebar.brand.mark` and `conversation.hero.brand.mark`, swapping `faberloom_isotipo_dark.svg` (cream) and `faberloom_isotipo_mono.svg` (ink) from CSS on `body[data-ds-dark-theme]`. `brand.name` and `brand.localBuild` are `Faberloom` in every language, because a brand name is not translated.
- The product accent is the FaberLoom orange `#c96442`, set on `--dsw-alias-brand-primary-new-colorprimary-new-color` in both theme blocks of `ui-theme`'s `design-platform.css`. That token drives the product surfaces' buttons, active tabs, links, focus rings, and Work-Flow accents; the semantic `--dsw-alias-state-success-*` green stays green.
- The gateway serves `/favicon.ico` and `/faberloom_favicon32.svg` from `gateway/assets/faberloom_favicon32.svg`, and its login and company pages link that file.
- The Desktop's `productName` and `artifactName` are `Faberloom` / `faberloom-${version}-${os}-${arch}`, and its shell copy (startup, update, plugin window) reads `Faberloom` in both locales.

## Alternatives considered

**Keep MWT.ONE and change nothing.** Rejected: the product name is Faberloom; the mark and title are the most visible identity on every screen.

**Keep the theme-switched PNG marks and only rename the text.** Rejected: the shipped SVGs are the brand's own assets, scale cleanly, and need no raster regeneration per theme.

**Rename the MWT.ONE console and its MCP references too.** Rejected: MWT.ONE is a separate system the product integrates with; renaming its console, MCP server, and permission vocabulary would make the code lie about what it calls.

**Ship a separate brand per surface (web vs Desktop).** Rejected: one product, one brand; the Desktop loads the same client and must not disagree with the web.

## Consequences

Every user-visible brand surface — tab title, favicon, manifest, sidebar, hero, gateway login — reads Faberloom and uses the orange accent, in the web build and the Desktop. The MWT.ONE console, its MCP tools, its permission strings, and the `harness.mwt.one` host are untouched. A deployment that wants its own mark overrides the same slots and the same public files. The plain `apps/web` build, which does not mount `ui-faberloom`, now shows `Faberloom` beside the upstream harness mark until a deployment mounts the faberloom profile.

## Testing

`packages/client/ui-faberloom/tests/registration.client.spec.tsx` asserts the sidebar brand reads `Faberloom`; `packages/client/ui-sidebar` (root spec and snapshot), `packages/client/ui-layout`, `packages/client/locale`, and `apps/desktop/tests` (including the `expected/startup-*.txt` documents) carry the new copy. `apps/web/tests/pwa-manifest.e2e.ts` and `apps/web/tests/built-boot.expected.e2e.ts` assert the built manifest and the local-build label from `apps/web/dist`.
