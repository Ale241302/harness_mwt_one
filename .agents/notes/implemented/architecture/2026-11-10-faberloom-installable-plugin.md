# Agent Note: FaberLoom ships as an installable DSH plugin

Status: implemented

English | [中文](2026-11-10-faberloom-installable-plugin.zh.md)

## Problem

`@deepseek-ai/dsh-faberloom-app` is a workspace bundle. Its 34 dependencies use `workspace:^`, the package is unpublished, and its rows name packages that only exist inside the monorepo. A host that installs plugins by package name or local path cannot load it: `pnpm` links a local directory without installing its dependencies, and a linked directory loses the profile's host packages because Node resolves the real path outside the profile.

## Decision

**A packaging script turns the built bundle into a self-contained plugin.** `scripts/faberloom-portable/package-plugin.ts` copies each product package into `node_modules/@deepseek-ai/<name>` inside the plugin, keeps the host core as peer dependencies, keeps external dependencies (`zod`, `@aws-sdk/client-s3`, `@firecrawl/anydoc`) as registry dependencies, and rewrites every `cordis.patch.yml` row to a relative path into that nested tree. The plugin declares `dsh.bundle.patch`, so the host's plugin manager accepts it.

**Relative rows keep the product inside one directory.** `applyEntryPatches` resolves a row whose `name` starts with `./` against the patch file and converts it to a file URL. Every vendored package therefore loads from the plugin, while its bare imports of `@deepseek-ai/cordis`, `schemastery`, and the other host packages walk up to the profile's linked host tree. No core package is bundled, so there is one Cordis instance.

**The plugin is copied, not linked.** A junction to the build directory makes Node resolve the real path under the checkout, where the profile's host links are invisible. The verified install copies the directory into the profile. The manifest keeps `bundledDependencies` so a later `npm pack` carries the same tree.

## Alternatives considered

**Declare the product packages as `file:./vendor/*` dependencies.** `pnpm` links a local package and skips its dependencies, so the profile resolves neither the product packages nor their peers.

**Bundle the core packages too.** The plugin would mount a second `@deepseek-ai/cordis` and `schemastery`, which breaks service identity and duplicates the runtime the host already provides.

**Publish first and install by name.** Publishing is a separate, unauthorized operation. The local path proves the artifact and the composition without a registry.

## Consequences

A host with linked core packages (Desktop and the source launcher) can install the plugin by local path and load the full product UI. The plugin carries 34 product packages and 48 peers; an npm publication still needs a channel decision, and the packaged Desktop "Add plugin" dialog remains unverified until the artifact is installed through it. Update and uninstall behavior belongs to the host plugin manager and is not claimed here.

## Verification

- `pnpm exec tsx scripts/faberloom-portable/package-plugin.ts --out dist/dsh-plugin-faberloom`: 34 vendored packages, 48 peers, no `workspace:` reference.
- `dsh --profile plugin-test --dump-config`: exit 0; every FaberLoom row resolves to a `file://` path inside the plugin.
- A real web boot of that profile starts at `http://127.0.0.1:3080` with no failed imports; the page renders the FaberLoom brand, Mesa de trabajo, Espacios, Archivos, Rutinas, Flujos and Correo.
