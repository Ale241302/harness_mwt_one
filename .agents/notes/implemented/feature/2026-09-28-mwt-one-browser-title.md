# Agent Note: the deployed browser title reads Harness MWT.ONE

Status: implemented

English | [中文](2026-09-28-mwt-one-browser-title.zh.md)

## Problem

The deployed tab still read "DSH Local Build" after the MWT.ONE branding change. That change set `apps/web/index.html`'s `<title>` and `apps/web/vite.config.ts`'s `DEFAULT_CLIENT_TITLE`, which own only the initial document title. Once React mounts, `ui-layout`'s `AppFrame` recomputes `document.title` from `process.env.DSH_CLIENT_TITLE ?? t('brand.localBuild')`; the deployed build defined no `DSH_CLIENT_TITLE`, so the tab fell back to the localized "DSH Local Build" and the static title was overwritten.

## Decision

`scripts/deploy-vps.sh` passes `-e DSH_CLIENT_TITLE="Harness MWT.ONE"` to the builder container that runs `pnpm run build`. The client build already treats `DSH_CLIENT_*` as public artifact input (`client-build-environment.ts` inlines each value into the Vite and tsdown bundles), so the one environment value reaches both the static document and the mounted `AppFrame`. The browser title stays a build-environment concern, as `ui-brand-official`'s README states, rather than a locale or slot override.

## Alternatives considered

**Change the `brand.localBuild` locale string.** That key names a local build and is the app-frame and sidebar fallback; editing it would mislabel every non-branded build and split the title from the sidebar's brand name.

**Fall back to the vite `DEFAULT_CLIENT_TITLE` inside `AppFrame`.** The two constants already disagree by design: one is the document title, the other the unmounted shell fallback. The env value is the single source both read, so defining it keeps them consistent without a new coupling.

## Consequences

- The deployed tab reads "Harness MWT.ONE", and "Session title — Harness MWT.ONE" while a session is selected.
- A build without `DSH_CLIENT_TITLE` (a plain local `pnpm run build`) still reads "DSH Local Build", which is the intended local-build label.
- The VPS `.env` and the compose stack are untouched: the value is a build argument to the persistent builder, not runtime configuration.

## Testing

Built `@deepseek-ai/dsh-client-ui-layout` with `DSH_CLIENT_TITLE="Harness MWT.ONE"` and confirmed `lib/client.js` inlines `const productTitle = "Harness MWT.ONE";`. `packages/client/ui-layout`'s app-frame and document-title specs already cover the `DSH_CLIENT_TITLE` branch and the fallback.
