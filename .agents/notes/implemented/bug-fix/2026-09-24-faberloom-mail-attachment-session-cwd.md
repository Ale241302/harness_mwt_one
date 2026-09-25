# Agent Note: a saved mail attachment lands in the session workspace

Status: implemented

English | [中文](2026-09-24-faberloom-mail-attachment-session-cwd.zh.md)

## Problem

`faberloom_mail_attachment` wrote the original bytes to `correo-adjuntos/` under `process.cwd()`. In the web gateway each dsh process runs from the user's home, while a Space session's working directory is its Workspace directory (`$DSH_HOME/spaces/<ref>`). The right sidebar's Files tab lists the session cwd, so the copy landed outside the tree the user can open and was unreachable from the UI.

## Decision

The tool resolves the target directory from the session cwd — `exec.agent?.session.header.cwd ?? process.cwd()` — and writes `correo-adjuntos/<name>` there.

- The session cwd is the same `header.cwd` the `workspaceFiles` Remote resolves as its workspace root, so the file appears at the tree root under `correo-adjuntos/`.
- `process.cwd()` remains only the fallback for a call with no bound Agent.
- The gateway workspace rule names the link (`faberloom_mail_attachment_link`) as the primary delivery and the workspace file as the fallback when no console session exists.

## Alternatives considered

**Keep `process.cwd()` and tell the user to look in the home directory.** The Files tab cannot list outside the workspace (it answers `workspace-file/outside-workspace`), so the file would stay unreachable from the UI.

**Write through `ctx.fs`.** The workspace-aware filesystem is the right owner of workspace writes, but this tool already writes with node `fs`; resolving the session cwd keeps the change to the one path that was wrong.

## Consequences

- The saved file is openable in the Files tab through the existing viewers (PDF, image, HTML, Markdown, text, code); there is no dedicated download button, so the link stays the direct download.
- A headless call without an Agent keeps the previous behavior under `process.cwd()`.

## Testing

`packages/faberloom/tool-faberloom/tests/mail-attachments.spec.ts` drives the tool with a stub `exec` carrying a session cwd and asserts the file is written under that cwd (and not the process cwd).
