# Agent Note: 私有的 Memory、Context、Work Flow 与 Routine

Status: implemented

[English](2026-10-11-private-faberloom-records.md) | 中文

## Problem

共享一个 Space 或 Work Flow 会给另一个身份一组按动作划分的权限（`view-memory`、`edit-workflows`、`delete-routines` 等），并通过共享内容目录发布所有者的 Memory、Context、Work Flow 与 Routine。此前没有办法让所有者把某一条记录排除在这组内容之外：每一份可发布的条目都会随之传播，因此只要授权带有对应的模块权限，成员——以及成员经由 `ctx.faberloom*` 与模型工具行动的智能体——就能读取并编辑它。只有 Context 带有 `local`/`pending`/`shared` 可见性，但 `publishSpaceContent` 忽略了它，仍然会把 `local` 条目录发布出去。

## Decision

Memory、Work Flow 与 Routine 新增持久的 `visibility: 'shared' | 'private'`，默认 `shared`，因此域版本保持为 1，且在此字段之前写入的记录仍能加载。Context 保留其 `local | pending | shared` 词表，其中 `local` 即私有状态，且现在**仅作者可见**：Space 所有者与其他成员都读不到它，`visible` 只放行其作者，`context.sync` 也从不存储 `local` 控制台行。只有所有者可以切换可见性：`ctx.faberloomSpaces.setMemoryVisibility`、`ctx.faberloomWorkflows.setVisibility`、`ctx.faberloomRoutines.setRoutineVisibility`，以及 Context 既有的 `approve`/`reject`；视图 Remote 层将它们暴露为 `setMemoryVisibility`、`setWorkflowVisibility` 与 `setRoutineVisibility`。所有者通过把 Space 或 Work Flow 授权给 grant 中的邮箱来共享一条记录，也可以随时将其保持为私有。

私有记录在读取或发布它的那个操作上执行限制，而不是在调用方：

- `publishSpaceContent` 跳过 `private` 的 Memory、Work Flow 或 Routine，以及非 `shared` 的 Context 条目；`FaberLoomShares.publishContent` 也会丢弃任何 payload 带 `visibility: 'private'` 的条目，因此该记录永远不会到达 MWT.ONE 控制台或另一个身份的进程。
- `materializeSharedContent` 忽略带 `visibility: 'private'` 的控制台行，因此即使控制台返回了这样的行，也不会物化出副本。
- `ctx.faberloomSpaces.listMemory` 对可读 Space 的成员隐藏另一位所有者的 `private` 条目；`ctx.faberloomWorkflows.list` 及其 `requireAccess` 对非所有者拒绝 `private` 流程，即使活动授权带有 `view` 或 `edit-graph`。
- `ctx.faberloomContext.visible` 只把 `local` 条目放行给其作者，因此 Space 所有者仍能裁定 `pending` 贡献，但一旦它变为 `local` 就再也读不到；`context.sync` 跳过 `local` 控制台行，而不是存下一份读不到的副本。

将 Work Flow 设为私有还会在 `ctx.faberloomWorkflows.setVisibility` 内部撤销其对外直连的 Work Flow 授权——拒绝落在服务里，而不是视图——因为受邀者导入的副本带有自己的可见性，必须停止解析；可见性变更会立即重新发布所有者的 Space 内容。Space 的成员仍会在下一次同步时失去已物化的副本，因为控制台会替换作者的全集。Espacios 的 Memory/Workflows/Routines 面板提供切换，Context 面板的 approve/reject 组合即其私有/共享控制。

## Alternatives considered

**一个裸布尔 `private` 字段。** 否决：值词表与 Context 既有的 `visibility` 一致，并为日后的 `pending` 留出空间。

**在工具层过滤。** 否决：工具门面可被其他调用方绕过；拒绝应落在服务方法与发布/物化操作里（AGENTS.md，"Enforce a decision in the operation that makes it"）。

**提升域版本。** 否决：带默认值的成员让单布局存储继续以版本 1 加载，而存储层从不迁移。

**仅依据授权缺失来推导私有。** 否决：授权集是这条事实的错误归属；记录本身必须携带谁可以看它，这样撤销或重新授权的权限永远不会悄悄重新发布所有者留下的记录。

## Consequences

这三个新字段是增量且带默认值的；每一份既有持久记录都以 `shared` 加载，保持不变。`local` 的 Context 条目现在不再被发布，这是修复一处潜在泄漏，而非改变既定行为。私有记录对成员的智能体不可见，因此无论 Space 授权带有哪些模块权限，它都无法在一次对话回合中被读取、编辑或执行。所有者自己的智能体仍可正常读取。测试覆盖了仅所有者可切换、对成员隐藏的读取、`FaberLoomShares` 中的发布丢弃、Work Flow 上的控制台授权撤销、Context 的仅 `local` 读取，以及面板切换。

## Deferred

- **Teachings 与外部记忆核心。** `ctx.faberloomMemory`（learning）与 `memoryCoreUrl` 背后的 agent-memory 核心不走共享内容目录，因此它们在构造上就只属于所有者，此标志不适用于它们。在它们本身可共享之前，给 Teachings 一个显式标志继续推迟。
- **按 Space 的粒度。** `publishSpaceContent` 会把所有者的 Work Flow 与 Routine 发布到每一个共享 Space，而不只是流程或例程所属的那个。私有记录仍被排除；更粗的粒度早于本次改动。
- **残留的导入副本。** 授权被撤销或流程变为私有后，成员导入的记录仍留在其存储中，但每条读取路径——`list`、`requireAccess`、`materializeSharedContent`——都拒绝它。
- **立即重新发布需要控制台。** 只有在设置了 `CONSOLA_API_BASE` 与 `CONSOLA_TOKEN` 时，可见性变更才会立即重新发布；否则由周期性的 `overview` 遍次在大约十秒内发布。
