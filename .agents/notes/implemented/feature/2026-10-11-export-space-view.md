# Agent Note: Export a Space's view into its folder

Status: implemented

English | [中文](2026-10-11-export-space-view.zh.md)

## Problem

`faberloom-view` already exported a Work Flow's portable JSON or Archify HTML (`exportWorkflow`) and a Context export (`exportContext`), but both returned the content to the browser: the panel opened it in a dialog and the user copied it out. The agent's file tools, which read the Space's folder, never saw the export, so a routine that must attach a weekly snapshot — or a user who wants the export beside the client's files — had no way to place it there.

## Decision

`faberloom-view` gains the Remote `exportSpaceViewToFolder(spaceId, kind, targetId, format?)`. It resolves the destination through `resolveSpaceDir` — the Workspace the Space mirrors, or the deterministic `<DSH_HOME>/spaces/<ref>` area — calls the existing export (`exportContext` for `context`, `exportWorkflow` for `workflow`), and writes the returned content under `<space dir>/exportaciones/`, returning the path and byte count. The file name comes from the context export's own `filename`, or from the Work Flow id with the format's extension; the name passes through `basename`, so a suggested name can never escape the folder. The Spaces panel adds the **"Export to folder"** action, which writes the Space's context export as Markdown and reports the resulting path.

## Alternatives considered

**Keep the browser dialog and let the user save the file.** Rejected: it puts the export in the download directory, outside the folder the agent reads, and needs a manual step per export.

**Build a new serializer in the view.** Rejected: the export formats are owned by the Context and Work Flows services; the Remote must call them, not re-derive them.

**Let the caller pass the whole path.** Rejected: a panel action must not choose an arbitrary host path; the Remote owns the folder and the contained file name.

**Write the Work Flow export from the Workflows panel in this change.** Deferred: the Remote already serves both kinds; the Workflows panel action lands with its own copy when the panel's export area is next touched.

## Consequences

A Space's context export (and, by the same call, a Work Flow's JSON or Archify export) is a real file in the Space folder, where the agent, a routine, and the user all see it. Names are contained by construction, so an export cannot overwrite a file outside the folder. Repeated exports overwrite the previous file of the same name, which is the intended behaviour for a periodic snapshot.

## Testing

`packages/faberloom/view/tests/export-space-view.spec.ts` covers writing a context export into the Space folder with the service's own file name and writing a Work Flow export named after the flow id, asserting both the written bytes and the exact path.
