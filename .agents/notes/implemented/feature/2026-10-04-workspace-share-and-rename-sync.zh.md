# Agent Note: 工作区行共享与工作区↔空间重命名同步

Status: implemented

[English](2026-10-04-workspace-share-and-rename-sync.md) | 中文

## Problem

在 MWT.ONE 产品中，侧边栏的 Workspace 与 FaberLoom 的 Space 是同一区域：视图按 `workspaceId` 把每个已注册的 Workspace 锚定到一个 Space。由此产生两个缺口。侧边栏行的菜单只有 Rename 和 Delete，因此共享 Space 只能在 Espacios 面板里完成，而无法从它所镜像的 Workspace 直接进入。而且两个名称会漂移：通过侧边栏重命名 Workspace 调用的是 harness 的 `workspaceRegistry`，从不触及 `ctx.faberloomSpaces`，于是 Espacios 模块保留旧标题；反过来重命名 Space 也从不触及镜像的 Workspace。

## Decision

`ui-workspace` 在 `sidebar.workspaces` 注册上声明一个 `list` 子槽 `sidebar.workspaces.rowMenu`，并把它渲染为真实 Workspace 行下拉菜单的前导行。`ui-primitives` 的 `Menu` 新增可选 `leading` 节点，在同一菜单卡片内渲染于自身条目之上。`WorkspaceBrowser` 把 `renderSlot('sidebar.workspaces.rowMenu', { workspaceId, title, close })` 向下传给 `ProjectRowItem`，后者将其作为 Menu 的 `leading` 转发。

`ui-faberloom` 贡献两个共享同一 `createWorkspaceShareStore()` 句柄的注册：`WorkspaceShareMenuItem` 注册进 `sidebar.workspaces.rowMenu`（排序在所有者自己的 Rename/Delete 之前），`WorkspaceShareDialog` 注册进 `shell.overlay`。行关闭下拉菜单并请求对话框；overlay 宿主拥有表单，并调用注入的 `share`，其接线到新的 `faberloomView.shareSpaceByWorkspace(workspaceId, emails, permissions)`。该 Remote 解析 `workspaceId` 匹配的 Space 并委托给 `shareSpace`，因此权限与授权路径不变。

工作区注册表声明并从 `WorkspaceEntity.setTitle` 经其 host 发出 `workspace/renamed(workspaceId, title)`。`FaberLoomViewService` 监听它，把标题采纳进镜像该 id 的 Space；`renameSpace` 则把同一标题写回镜像的 Workspace（`workspaceRegistry.get(space.workspaceId).setTitle(title)`），并加以保护，使已相等的标题不产生写入。

## Alternatives considered

**在 `ui-workspace` 上注入 `shareWorkspace` 回调。** 否决：feature 插件不得运行时导入或调用另一个 feature 插件，而注入面由工作区插件拥有。跨包 UI 的受认可途径是槽。

**在省略号旁放置独立的 Share 图标。** 否决：菜单才是所要求的位置，独立控件不会位于 Rename 之前。

**在客户端解析 Space。** 否决：`workspaceId`→Space 的映射是 `ctx.faberloomSpaces` 背后的持久化宿主状态；宿主 Remote 让授权检查集中在一处。

**用通用的工作区事件监听器取代专门事件。** 否决：注册表以命名事件发布变更（`workspace/removed` 已镜像其一），专门的 `workspace/renamed` 负载直接携带新标题，无需二次读取。

## Consequences

Workspace 行的菜单现在在任何贡献行之前、所有者的 Rename 与 Delete 之前，先列出贡献行。共享对话框托管在 shell overlay，因此关闭下拉菜单不会卸载它，而下拉菜单会在请求时关闭。共享的授权方式与 `shareSpace` 完全一致；没有镜像 Space 的 Workspace 会显式失败。重命名通过同一标题双向流动：先写 Space 一侧，使随之而来的 `workspace/renamed` 事件发现名称已相等，从而停止而不产生循环。新的 `workspace/renamed` 事件是增量的；不要求任何调用方监听，也不改变任何持久化格式。

测试覆盖：贡献的菜单行位于 Rename 之前并关闭下拉菜单；对话框的校验、权限切换、成功、失败与取消路径；`shareSpaceByWorkspace` 解析镜像与拒绝解析；`workspace/renamed` 的采纳及其失败日志；以及 `renameSpace` 对 Workspace 的反向写入，含无镜像与已相等的保护。注册表测试断言 `setTitle` 发出 `workspace/renamed`。
