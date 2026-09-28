# Agent Note: MWT.ONE product branding

Status: implemented

English | [中文](2026-09-28-mwt-one-branding.zh.md)

## Problem

The deployed fork still wore the harness's own identity: the browser tab read "DSH Local Build", the favicon was the DSH svg, the sidebar and the empty-conversation hero showed the harness's mark, and the sidebar brand name read "faberloom". The product is MWT.ONE.

## Decision

- `apps/web/index.html` sets `<title>Harness MWT.ONE</title>` and points the favicon at `/brand-dark.png`; `apps/web/vite.config.ts`'s `DEFAULT_CLIENT_TITLE` (and the string it replaces in the built HTML) follow, so the built document keeps the title unless `DSH_CLIENT_TITLE` overrides it. The web manifest's name, short name, and icon follow too.
- The two shipped logo files live in `apps/web/public/`: `brand-dark.png` (the white swoosh, for the dark theme) and `brand-light.png` (the green one, for the light theme).
- `ui-faberloom` registers `FaberloomBrandMark` into `sidebar.brand.mark` and `conversation.hero.brand.mark`, replacing the harness mark in both places. The component draws both images and CSS swaps them on `body[data-ds-dark-theme]`, so it follows the theme without a runtime DOM read.
- The `brand.name` locale value is `MWT.ONE` in every language (a brand name is not translated).
- The gateway serves the login favicon from `/brand-dark.png` (the file ships in `gateway/assets/`), and its login and company pages link it.

## Alternatives considered

**Keep the DSH mark and only change the title.** The mark is the most visible identity on every screen; leaving it contradicts the name.

**Embed the favicon as a data URI in the gateway HTML.** It works without a file, but bloats the source with kilobytes of base64 and duplicates the asset; serving the shipped PNG keeps one copy.

## Consequences

- Every user-visible brand surface — tab title, favicon, sidebar, hero, login — is MWT.ONE.
- The mark follows the theme: white on dark, green on light.
- The images are served from the app's public root and the gateway's asset folder; a non-MWT deployment that wants its own mark overrides the same slots and the same public files.

## Testing

`packages/client/ui-faberloom/tests/registration.client.spec.tsx` asserts the sidebar brand name now reads `MWT.ONE`; the ui-faberloom suites pass (28 tests). The gateway's HTML and route changes are covered by the `node --check` build gate and the deploy smoke.
