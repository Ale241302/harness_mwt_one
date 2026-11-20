# Agent Note: The sidebar renders the registered Workspace browser again

Status: implemented

[English](2026-11-20-sidebar-restores-the-registered-workspace-browser.md) | 中文

## Problem

侧边栏丢失了人们每天使用的所有 Workspace 手势：重命名和删除 Workspace、归档和删除 Session、搜索、拖动排序，以及共享、移动和创建子 Space 的行。标准贡献仍在注册；只是外壳不再渲染它。

这次回归来自让该列绘制自己的 Workspace 树的改动。`packages/client/ui-faberloom/src/client/sidebar/sidebar.tsx` 用本地 `SidebarTree` 组件替换了 `renderSlot('sidebar.workspaces', …)`。`ui-workspace` 的浏览器拥有该插槽：它渲染 Workspace 与 Session 行，并且是唯一渲染 `sidebar.workspaces.rowMenu` 的表面——`ui-faberloom` 在其中注册“共享”、“移动”和“创建子 Space”。外壳绘制自己的树后，浏览器的行和菜单从未挂载，而这三个贡献仍注册在一个无人渲染的插槽上。

树的注释用空列表为这次替换辩护：“标准浏览器读取的是此组合不提供的流”。浏览器和树读取同一个框架钩子 `useWorkspaces(state => state.items)`，因此填充树的组合也会填充浏览器。

## Decision

**已注册的浏览器重新拥有浏览区域。** `sidebar.tsx` 再次以 `wide` 和 `expandSidebar` 所有者属性渲染 `sidebar.workspaces`，本地树连同其契约成员 `openSession` 一并移除。“共享”、“移动”和“创建子 Space”照旧注册到 `sidebar.workspaces.rowMenu`，并出现在浏览器 Workspace 行菜单里，位于它自己的“重命名”和“删除”之上。

**外壳不再保留第二棵树。** 并行表面需要自己的行菜单、确认对话框、搜索和拖拽顺序才能与浏览器对等，而产品已把 FaberLoom Space 与其 Workspace 当作同一个实体。

## Alternatives considered

**保留树并在其中加入这四个手势。** 目前否决：它会重复浏览器的行菜单、重命名、删除、归档、搜索和拖拽排序，并且需要为三个 `sidebar.workspaces.rowMenu` 贡献提供第二个宿主，或为每个改用重命名的插槽。如果该列日后需要把“带文件夹的 Spaces”作为区别于 Workspaces 的独立表面，这就是那条路。

**仅当树找不到 Workspace 时渲染浏览器。** 否决：两者读取同一快照，条件无法区分它们；只会增加一个永不触发的分支。

## Consequences

该列重新是标准浏览器：Workspace 与 Session 行、它们的菜单、搜索、拖拽顺序，以及产品的“共享”、“移动”和“创建子 Space”行。FaberLoom Spaces 不再作为单独的文件夹树出现在列中；Space 通过镜像它的 Workspace 到达，这也是产品原本对这对概念的称呼。

## Testing

`packages/client/ui-faberloom/tests` 通过（277 项测试）。`tsc -p packages/client/ui-faberloom/tsconfig.json` 无错误。被删除的树测试只覆盖已移除的组件；`packages/client/ui-workspace/tests` 中浏览器自己的套件覆盖恢复的行与菜单。
