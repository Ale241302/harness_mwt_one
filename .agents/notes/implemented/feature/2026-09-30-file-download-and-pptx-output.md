# Agent Note: generated files download without a Host desktop, and decks build as PPTX

Status: implemented

English | [中文](2026-09-30-file-download-and-pptx-output.zh.md)

## Problem

The delivered-file cards and the produced-files row only opened a Sidebar preview or asked the Host desktop to open or reveal a file. On a headless deployment (the VPS Space) there is no desktop, so every native action was disabled and the card read *This Host has no desktop available to open files or folders*, with no way to save the file to the user's own machine. Separately, asking the model for *una presentación* produced SVG, HTML, and Markdown fragments: the shipped catalog has `frontend-slides` (HTML decks) and a PPTX *extractor*, but nothing that writes a PowerPoint file, and the image carries neither `python-pptx` nor an SVG rasterizer.

## Decision

- `/api/file` gains a `download` query parameter. With it, the same authenticated, size-capped read returns `Content-Disposition: attachment; filename="<last path segment>"`, with control characters and quotes replaced by `_` and `download` when the path has no segment. Without it the response is unchanged.
- `packages/client/ui-deliverables/src/client/download.ts` exposes `downloadWorkspaceFile(cwd, path)`: it resolves the path against the Session root and clicks an anchor at `/api/file?path=…&download=1`, so the Host desktop is not consulted.
- The delivered-file card's action menu always offers **Download**; the native *Open in default app* and file-manager rows appear only when the Host reports a desktop. The chevron is disabled only while a native action is pending.
- The produced-files row renders a trailing save control per chip, carrying the full path rather than the shortened name.
- The `DeliverablesInjected` face gains `downloadFile(path, cwd)`, bound by the plugin's `apply`.
- `packages/client/ui-sidebar-documentpreview/src/client/download.ts` exposes `downloadHostFile(absolutePath, name)`, and the preview header shows a save control once the file resource reports an absolute path.
- File-tool rows gain the same action: `ToolRow` takes an optional `onDownloadFile(path)`, `read`/`read_image`/`edit`/`write` bind it to `downloadWorkspaceFile(cwd, path)`, and a `row.download` key in the `conversation` dictionary labels the control beside the path link.
- `SearchBlock` takes an optional `onDownload` and renders a per-result save control on each file header (`grep`) and path row (`glob`); `grep`/`glob` rows supply it, labelled by `search.download`.
- The shared image lightbox (message, trajectory, and tool-gallery arms) gains a save link to the original image URL, labelled by `image.download`, so returned images are downloadable from the gallery.
- `skills-shared/pptx-deck/` ships a shared skill and `scripts/build_pptx.py`, a standard-library-only OOXML writer (title and bullet slides, an optional PNG/JPEG/GIF image, 16:9). It is the model's path to a real `.pptx` without `python-pptx` or a rasterizer; the skill routes richer decks (notes, tables) to `python-pptx` when importable and HTML decks to `frontend-slides` when wanted. Every slide carries a `slideLayout` relationship and the package carries `docProps/core.xml` and `docProps/app.xml`, matching PowerPoint-authored files: Office 16 offers to repair a package that is schema-valid but omits the slide→layout relationship, which the Open XML SDK validator does not flag.

## Alternatives considered

**A dedicated `GET /api/present.download` route in `ui-deliverables`.** It would reuse the `sessionId`/`seq`/`index` coordinates of `present`, but the produced-files row and the document preview are not `present` declarations, so the same save would need a second route. Extending the existing byte route covers all three surfaces through one authorization path.

**Fetch bytes through the `workspaceFiles.readAll` Remote and save a Blob.** It needs no Host change and resolves relative paths server-side, but it base64s the whole file across the wire and needs an object URL; the anchor route streams the bytes once and lets the browser own the filename.

**Bundle `python-pptx` or LibreOffice in the image.** Both change the deployment image for one skill, and `python-pptx` still cannot embed SVG. The standard-library writer deletes the dependency and always produces a valid file.

## Consequences

- Every generated file (SVG, HTML, Markdown, PPTX, …) is downloadable from the conversation and from the preview, regardless of Host desktop availability. File-tool rows (`read`/`read_image`/`edit`/`write`) download the path their call named, `grep`/`glob` cards download each named result file, and an image's lightbox downloads the original image.
- The download route keeps the existing byte cap (`attachments.imageLimits.maxImageBytes`, 20 MiB by default) and the existing sandboxed read access; nothing new is exposed.
- The PPTX writer has no speaker notes and no tables, and embeds raster images only; those cases point at `python-pptx` or a rasterizer.
- A skill under `skills-shared/` is model-invocable in every session; `skills-shared/ECC-LICENSE.txt` now names `pptx-deck` among the owner's own skills.

## Testing

`packages/api/session-controller/tests/media-references.host.spec.ts` covers the attachment header on GET and HEAD, the unchanged inline response, filename sanitization, and the empty-segment fallback. `packages/client/ui-deliverables/tests/download.client.spec.tsx` covers the URL and shift of a relative and an absolute path; `presented-file-card.client.spec.tsx` covers the save row with and without a desktop and the three-row keyboard order; `produced-files.client.spec.tsx` covers the per-chip save control and the Deliverables wiring. `packages/client/ui-sidebar-documentpreview/tests/download.client.spec.tsx` and `document-toolbar.client.spec.tsx` cover the preview control and its hidden state without an absolute path. `packages/client/ui-tool/tests/download.client.spec.tsx` covers the tool-row helper, and `read-card.client.spec.tsx`, `diff-card.client.spec.tsx`, and `search-card.client.spec.tsx` cover the row's save control for `read`, `edit`, and `grep`. `packages/client/ui-primitives/tests/search-block.client.spec.tsx` covers the per-result control and its absence, and `packages/client/ui-attachment/tests/image-lightbox.client.spec.tsx` covers the image save link. `build_pptx.py` is exercised against two-slide and image-bearing specs and validated with the Open XML SDK validator (0 errors under Office2007, Office2010, and Microsoft365), which also reproduced the shipped defect: the earlier package was schema-valid yet omitted every slide→`slideLayout` relationship, so Office 16 offered to repair it. Client and Host typechecks pass, and `ui-tool`, `ui-conversation`, `ui-attachment`, `ui-deliverables`, and `ui-sidebar-documentpreview` hold their per-file 100% coverage (the ui-primitives `SearchBlock.tsx` change is covered by its spec). The changed visible output still needs `DSH_SNAPSHOT=replay pnpm run test:web` before a PR.
