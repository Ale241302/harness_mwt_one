# Agent Note: Each Claude surface gets its own certified cycle

Status: implemented

English | [中文](2026-11-10-claude-surfaces.zh.md)

## Problem

The Claude adapter assumed one host. It produced a ready plugin for any caller, had no dated surface matrix, and could let a chat or Cowork reader see a component as operational merely because Code loaded it. There was no archive for surfaces that consume a ZIP and no inventory of the components a surface ignored.

## Decision

**The matrix decides the surface, not the adapter default.** `packages/faberloom/portable/src/adapters/surfaces.ts` records one row per surface with its status, exact host version, installation mechanism, authentication route, evidence, and limitations, dated `2026-11-10`. Code is certified for `2.1.126` with a plugin directory and local loopback OAuth. The desktop extension is open because it has no separate installation and cycle. Chat is open with a ZIP and remote OAuth because D02 does not expose a remote endpoint. Cowork is open with a ZIP and the host session because where its session runs was not verified.

**An open surface produces a draft, not a borrowed Code package.** `planClaudePackage` accepts a `surface`. A certified surface builds the ready package only for the matrix's exact host version; a different version is refused. An open surface returns only `faberloom/draft.md`, `sent:false`, `mesa:false`, empty components, `capabilities` false for every surface, and `surfaceStatus: 'open'`; it never announces Code's components as its own. A connection host that differs from the requested surface is refused, and a draft cannot be installed over an existing package.

**The inventory separates loaded from ignored.** `components` lists the files the package carries with their `loaded` flag; `ignored` lists the portable paths the conversion omitted or rejected. A rejected workflow is in `ignored` and absent from `components`; a resource carried for the model is present with `loaded:false`. The load record lists only loaded targets.

**ZIP is deterministic and surface-specific.** `archiveClaudePackage` writes stored entries in byte order with a fixed timestamp and UTF-8 names, so the same plan produces the same bytes across host locales. Code installs the directory; chat and Cowork are documented as ZIP consumers. `writeClaudeZip` writes the archive only; it does not install or publish anything.

**Each surface has its own authentication route.** Code uses the local loopback OAuth; chat uses remote OAuth; Cowork uses the host session. The plan carries `authRoute` and `matrixAsOf`, so a package states which route it expects instead of sharing one token path. Removing a package requires its `faberloom/load.json` or draft marker and removes only that directory; the artifact source and product records stay.

## Alternatives considered

**Keep one package for every Claude surface.** It would let an untested host inherit Code's certification and operational component list, which the matrix forbids.

**Mark chat/Cowork ready because the bytes are valid.** Manifest validity is not an installed cycle. Their status remains open until their own installation, authentication, and task are observed.

**Use a generic ZIP writer without a fixed timestamp.** Two identical plans would produce different archives. The fixed timestamp and path order make the archive reproducible.

**Let Code's directory serve chat/Cowork.** Chat needs a remote endpoint and Cowork depends on where the session runs; a directory install does not answer either.

## Consequences

Code and desktop are certified for the recorded version. Chat and Cowork remain open with their own ZIP and auth route, and HOST-03 remains `no-comprobada` for those surfaces. The matrix and `docs/faberloom/evidence/4b1-claude-matrix.json` are the dated evidence; 4A.3 remains open because no representative human session exists. Ignored components are visible to a reviewer but never announced as operational.

## Verification

- `packages/faberloom/portable/tests/surfaces.spec.ts`: dated matrix; Code ready; loaded/ignored inventory; deterministic ZIP; chat/Cowork drafts with their own auth and no operational components; remove only the package.
- `packages/faberloom/portable/tests/distribution.spec.ts`: Code manifest, component load, host version, and package removal.
- `packages/faberloom/portable/tests/conversion.spec.ts`: the conversion table that feeds `ignored`.
