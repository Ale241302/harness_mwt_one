# Agent Note: Client domain layering in ui-conversation and ui-sidebar-documentpreview

Status: implemented

English | [中文](2026-10-13-client-domain-contract-boundaries.zh.md)

## Problem

`scripts/verify-client-domain-graph.ts` reported 25 intra-package layering violations in two client plugin packages. The violations were pre-existing — byte-identical to the previous release, with a clean working tree. The gate admits only the package's top-level `contract/` directory as the shared layer; a domain may import `contract/` and its own files, and a top-level non-assembly file may import `contract/` and top-level files, but a domain may not import a sibling domain.

- `packages/client/ui-conversation`: `skeleton/InputBar.tsx` imported `DraftEditor.tsx`, `view-binding.ts`, and `resolveSubmitMode` from the sibling `input` domain. The composer view lived under `input/editor/` together with the Lexical machine runtime, so the view an InputBar-owned shell renders and the machine it drives sat in one directory.
- `packages/client/ui-sidebar-documentpreview`: a `document/` domain held the definitions every renderer needs (`DocumentPreviewDefinition`, `DocumentLoadMode`, `DocumentContent`, `DocumentTextPage`, `DocumentPreviewProps`, the `sidebar.right.tab.document` slot declaration, `matchingDocumentPreviews`, `binaryDocumentPath`, the suffix helpers, and `unviewableBinaryPath`). Every renderer domain (`code`, `html`, `image`, `markdown`, `pdf`, `text`) and the top-level owner (`TextPreview.tsx`, `store.ts`, `face.ts`) imported those files from `document/`, and `TextPreview.tsx` additionally imported `text/lines.ts` and `text/index.ts`'s `PLAIN_BODY_ID`. Since the gate treats `document/` and `text/` as domains rather than contract, each such import was a violation.

## Decision

Both packages now satisfy the layering by moving shared definitions into the package's top-level `contract/` and by moving view code into the domain that owns it. No exemption, allowlist entry, or rule change was added to `verify-client-domain-graph.ts`, and no behaviour, test, or slot declaration changed.

**ui-conversation.** The domain boundary is now view versus machine. `skeleton/editor/` holds `DraftEditor.tsx`, `ComposerContentEditable.tsx`, `DecoratorPortals.tsx`, and the `view-binding.ts`/`keymap.ts` pair — the composer-view files the `InputBar` shell owns and installs through its effects. `input/editor/` retains the machine-side files: `runtime.ts` (the per-Session `DraftEditorRuntime` the input facade constructs), `projection.ts`, `chip-node.tsx`, `ReferenceChip.tsx`, `claim-decor.ts`, `reference-activation.ts`, `span-map.ts`, and `text-ref.ts`. `resolveSubmitMode` moved to `contract/composer-submission.ts` because both the `input` machine keymap and the `skeleton` bar resolve a gesture; its pure function body is byte-identical. `ComposerSubmissionPolicy` stays in `input/submission-policy.ts` — the `apply` assembly and the Settings row are its only callers. Editor-facing and submission types stay in `contract/draft-editor.ts`, `contract/input.ts`, and `contract/composer-submission.ts`.

**ui-sidebar-documentpreview.** The former `document/` domain became the package contract. `contract/document.ts` owns the keyed `sidebar.right.tab.document` slot declaration, `DocumentContent`, `DocumentTextPage`, `DocumentPreviewProps`, and `documentTabInfoFactory`. `contract/registry.ts` owns `DocumentLoadMode`, `DocumentPreviewDefinition`, `matchingDocumentPreviews`, `binaryDocumentPath`, and `DocumentPreviewRegistry` — the renderer registration API and the observable snapshot both the assembly and the owner read. `contract/suffix.ts` and `contract/unviewable.ts` hold the filename-suffix helpers and the no-renderer binary suffix list that the registry and the owner consult. `contract/lines.ts` owns `TextPage`, `LoadedPage`, `linesOf`, `loadedPages`, `lastLineLoaded`, and `scrollToLine` — source-line helpers the plain-text renderer and the owner's scroller share; `TextPage` moved there from `store.ts`, which now imports it (the store re-exports it for its public entry). `contract/plain-text.ts` owns `PLAIN_BODY_ID`, the plain renderer's identity and the owner's fallback key. The renderer domains and the top-level `TextPreview.tsx`, `store.ts`, and `face.ts` import only `contract/`.

## Related

The general rule and gate are owned by the [Web client architecture note](2026-07-19-gui-web-client-architecture.md) (`## Directory shape`); this note records the two-package realization and does not supersede it.

## Alternatives considered

- **Add the offending paths to the gate as exemptions.** The gate is the executable form of a design rule; exempting a path removes the rule where it was failing rather than fixing the layout, and the next contributor would copy the exemption.
- **Re-export domain files from `contract/`.** A `contract/` module that re-exports from a domain is itself a contract-to-domain edge, which the gate rejects; contract must be self-contained, so the definitions had to move rather than be re-exported.
- **Keep `document/` as a domain and move `TextPreview.tsx` into it.** That would have kept the registry beside its consumer, but `TextPreview.tsx` is the `text` tab type's body (with `definition.ts` and `TextTitle.tsx`), and it reads the registry of every renderer, so it is the package-level owner rather than a `document`-domain member; the top-level shell reads the registry through `contract/` instead.
- **Move only `resolveSubmitMode` to contract and leave `DraftEditor`/`view-binding` in `input/editor/`.** That closes three violations but leaves `skeleton` importing the `input` domain for presentation, contradicting the one-way direction the directory shape encodes; the view files belong to the domain that renders them.
- **Move `TextPage` into `contract/document.ts`.** It is a stored page, not a document-content contract, and `lines.ts` is its only algorithmic consumer; `contract/lines.ts` is the tighter home.

## Consequences

The gate exits 0 with no new exemptions, and the two packages' `/client` export surface, tests, and slot declarations are unchanged. The cost is indirection: `ui-sidebar-documentpreview` gained a `contract/` directory with six modules, and a reader following the document-preview API must know that the slot declaration, the registry, the suffix helpers, and the line helpers are all contract rather than domain code. In exchange, a new renderer domain can be added by importing only `contract/`, and `ui-conversation`'s composer view and machine can grow independently without a view-to-machine import.
