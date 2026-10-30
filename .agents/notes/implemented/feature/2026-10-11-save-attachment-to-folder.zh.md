# Agent Note: Save a mailbox attachment into a Space's folder

Status: implemented

[English](2026-10-11-save-attachment-to-folder.md) | 中文

## Problem

Email 面板列出邮件的附件并通过浏览器 blob（`link.download`）下载，因此文件落到浏览器或操作系统的下载目录 —— 在 agent 可读写的工作区之外。模型工具 `faberloom_mail_attachment` 已经写出真实文件，但写进**会话** cwd（`correo-adjuntos/`），而当入口是邮箱时，那并不是用户正在使用的 Space。在 Email 面板阅读采购订单的用户无法把它放进客户的 Space 文件夹。

## Decision

`faberloom-view` 新增 Remote `saveSpaceAttachment(spaceId, uid, name?)`。它经 `ctx.get('faberloomInbound').readEmail(actor.id, uid)` 读取邮件，给出名称时只取该附件（否则取全部），经 `resolveSpaceDir` 解析目标——该 Space 镜像的 Workspace，或确定性的 `<DSH_HOME>/spaces/<ref>` 区域——并把每个文件写入 `<space dir>/correo-adjuntos/<name>`，与模型工具相同的目录约定。它返回已写入的 `{ name, path, bytes }` 列表；当 inbound 服务缺失、UID 不是正整数或没有匹配附件时返回空列表。

Email 面板的附件字段新增目标 **Space 选择器**（来自共享 overview 的该 owner 的 Space）以及每个附件的 **“保存到文件夹”** 动作。该动作调用 `saveAttachmentToSpace(spaceId, uid, name)` 并报告结果路径；未选择 Space 时禁用。原有下载动作保留，想把文件留在本地的用户仍可用。

## Alternatives considered

**复用浏览器下载再手动拷入。** 否决：需要第二步人工操作，且只存在于“下载”目录的文件 agent 无法处理。

**通过已有的模型工具写入。** 否决：工具在 agent 会话内运行并带有自己的 cwd；面板没有会话，而目标是用户选定的 Space。

**把附件存为 Space 的文件记录（`attachFile`）。** 本动作否决：`attachFile` 是 Space 自有的记录存储，会列在 Files 面板但不在磁盘上，agent 的文件工具无法读取。

**用模态框询问 Space。** 否决：附件字段已带邮件的上下文，内联选择器让动作只需一次点击且无需额外对话框。

## Consequences

邮件附件可直接放入某个 Space 的文件夹，agent 的文件工具、侧边栏对话与用户看到同一个文件。目标显式，因此文件不会写进非预期的 Space。附件是复制而非移动，邮箱保留其副本。“expediente MWT.ONE → 文件夹”方向不在此覆盖：它经 `faberloom_mwt_call`，待其面板动作落地。

## Testing

`packages/faberloom/view/tests/save-space-attachment.spec.ts` 覆盖：把指定名称的单个附件写入 Space 文件夹、未给名称时写入全部附件、未知名称不写入、以及 inbound 服务缺失时不写入。`ui-faberloom` 面板套件在 stub 视图上渲染 Email 面板；locale gate 覆盖新增文案。
