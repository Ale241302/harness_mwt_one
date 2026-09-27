# Agent Note: the Work bench aggregates tasks and works them in chat

Status: implemented

[English](2026-09-27-workbench-unified-tasks.md) | 中文

## 问题

工作台（`ctx.faberloomBoard`）只列看板项，且无法删除；任务不能关联到运行它的例程；而 FaberLoom 用户实际要处理的另外两个队列——待发送的邮件草稿和待回复的未读收件箱邮件——只存在于“邮件”面板。没有任何机制把任务变成“已经知道是哪个任务”的对话，MWT.ONE 的跟进项（缺少 OC/PO/SAP、阶段已过期、缺少操作方、价格表即将到期）也完全没有归宿。

## 决策

工作台成为跨多个来源的统一队列，提供与来源无关的“打开对话”手势、看板项的例程关联，以及由 agent 通过 `mwt` MCP 执行的 MWT.ONE 扫描。

- `FaberLoomBoard` 项新增 `routineId`（`setRoutine(ownerId, id, routineId | null)`），持久化在 `faberloom_board` 域中并使用可空默认值，因此旧行也能解析。`remove(ownerId, id)` 永久删除一项。
- `faberloomView` Remote 暴露 `deleteBoardItem` 与 `setBoardRoutine`，并且 `overview().board` / `boardDetail()` 携带 `routineId`。
- 面板读取三个实时来源——来自 `overview` 的看板项、`emailDrafts()`、以及 `emailInbox()`（IMAP 未读）——合并为一张带来源标签的表格；草稿提供“发送/丢弃”，未读邮件提供“回复”，任意行都提供**打开对话**。
- **打开对话**（`runTaskChat`）创建一个 harness 会话，用点名具体任务的面向模型提示词进行播种（看板项、草稿、待回复邮件，或 MWT 审查），然后打开它。任务上下文是提示词，不是界面文案。
- MWT.ONE 来源是单个 **扫描 MWT.ONE** 任务，仅在 `mwt` MCP 服务器已连接时显示（`ctx.faberloomView.mwtStatus().servers`）。选择它会打开一个带审查规则播种的对话；agent 使用 `mcp__mwt__*`（`expediente_listar`、`expediente_obtener`、`documento_listar`、`expediente_phase_durations_get`、`expediente_avanzar_estado` 等）并通过 `faberloom_board_create` 把每个跟进项登记为看板项。“忽略”即删除所创建的看板项。

## 考虑过的替代方案

**由 host 服务直接调用 MWT MCP 并解析案卷。** 工具签名已知，但 `expediente_listar`/`expediente_obtener` 的确切响应字段不在任何已交付契约中，因此 host 解析器等于对着一个实时、受 RBAC 约束的服务猜测；agent 已经持有这些 MCP 工具和同一身份，可以在源头做防御式解析。

**用分段控件为每个来源配独立检查器。** 行相同却更多外壳。单表加来源标签只保留一个选择、一个检查器和一个对话入口。

**打开面板时自动运行 MWT 扫描。** 扫描会消耗模型与 MCP 调用，因此保持为显式的一次点击任务。

## 后果

- 不再需要先关闭已打开的对话才能删除看板任务；删除是永久且立即的。
- 看板项现在依赖 `faberloom_board` 记录新增 `routineId`；旧行读作 `null`。
- 工作台在挂载时以及每次写入后做一次 IMAP 读取和草稿读取；未挂载邮件连接的部署会显示空的“邮件”来源而不会失败。
- MWT 跟进项通过 agent 呈现，因此其质量取决于已连接的 MCP 工具；缺少工具时会在对话中报告，而不是虚构任务。

## 测试

`packages/faberloom/board/tests/board.spec.ts` 覆盖 `remove`、`setRoutine` 以及带例程创建。`packages/client/ui-faberloom/tests/registration.client.spec.tsx` 覆盖删除看板任务、发送并丢弃草稿、以及列出待回复的未读邮件。`packages/client/ui-faberloom/tests/task-chat.client.spec.ts` 覆盖每个来源的播种与失败路径。
