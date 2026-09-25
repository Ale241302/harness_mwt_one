# Agent Note：保存的邮件附件落在会话工作区里

Status: implemented

[English](2026-09-24-faberloom-mail-attachment-session-cwd.md) | 中文

## 问题

`faberloom_mail_attachment` 把原始字节写到 `process.cwd()` 下的 `correo-adjuntos/`。在 Web 网关里每个 dsh 进程从用户主目录运行，而 Space 会话的工作目录是它的 Workspace 目录（`$DSH_HOME/spaces/<ref>`）。右侧边栏的“文件”标签列出的正是会话 cwd，因此副本落到了用户可打开目录树之外，无法从 UI 触达。

## 决定

该工具从会话 cwd 解析目标目录——`exec.agent?.session.header.cwd ?? process.cwd()`——并在那里写入 `correo-adjuntos/<name>`。

- 会话 cwd 与 `workspaceFiles` Remote 解析为工作区根所用的 `header.cwd` 是同一个，因此文件出现在目录树根下的 `correo-adjuntos/`。
- `process.cwd()` 仅在没有绑定 Agent 的调用中作为回退。
- 网关工作区规则把链接（`faberloom_mail_attachment_link`）列为主要交付方式，把工作区文件列为无控制台会话时的回退。

## 考虑过的替代方案

**保留 `process.cwd()` 并让用户去主目录里找。** “文件”标签无法列出工作区之外的内容（会返回 `workspace-file/outside-workspace`），文件仍无法从 UI 触达。

**通过 `ctx.fs` 写入。** 感知工作区的文件系统是工作区写入的正确归属，但该工具已用 node 的 `fs` 写入；解析会话 cwd 把改动限制在本来就有问题的那一条路径上。

## 后果

- 保存的文件可在“文件”标签里用既有查看器打开（PDF、图片、HTML、Markdown、文本、代码）；没有专门的下载按钮，因此链接仍是直接下载方式。
- 没有 Agent 的 headless 调用保持原先在 `process.cwd()` 下的行为。

## 测试

`packages/faberloom/tool-faberloom/tests/mail-attachments.spec.ts` 用一个携带会话 cwd 的桩 `exec` 驱动该工具，断言文件写在该 cwd 下（而不是进程 cwd）。
