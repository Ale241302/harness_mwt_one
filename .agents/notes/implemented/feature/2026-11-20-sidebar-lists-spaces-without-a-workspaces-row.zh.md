# Agent Note: The sidebar lists Spaces, not a second Workspaces row

Status: implemented

[English](2026-11-20-sidebar-lists-spaces-without-a-workspaces-row.md) | 中文

## Problem

产品把 FaberLoom Space 与镜像它的 Workspace 视为同一个实体，但侧边栏为它保留了两个入口：`Espacios` 和 `Workspaces`。它们在同一份数据上打开两个屏幕——Spaces 表格，以及同一批 Spaces、文件夹与 Sessions 的设备树。用户必须记住哪一行承载哪些手势，两个屏幕也逐渐分叉：Workspaces 屏幕拥有文件夹路径和“在此新建对话”，Spaces 面板拥有创建、从文件夹采用和删除。

## Decision

**一个概念，一行。** `packages/client/ui-faberloom/src/client/panels.tsx` 从 `FABERLOOM_SECTIONS` 中删除 `faberloom-workspaces` 条目，同时移除侧边栏行与它的 `main` 页面，并删除已无引用的 `workspacesScreen`。`Espacios` 面板仍是创建 Space、从文件夹采用、重命名和删除的入口。

**浏览区域仍列出 Workspaces。** 侧边栏的 Workspace 浏览器继续绘制本机文件夹、其中的 Spaces 与 Sessions，因此无需第二个面板也能从该列打开对话。

## Alternatives considered

**保留该行但从侧边栏隐藏，让页面在别处可达。** 否决：没有其他表面链接到 `faberloom-workspaces`，该页面会成为伪装成功能的不可达代码。

**把 Workspaces 树合并进 Espacios 面板。** 暂缓：该面板是带详情栏的表格，被删除的屏幕是文件夹树，而该列已经在绘制那棵树。合并是一次重新设计，而不是删除重复行。

## Consequences

Work 组列出 Conversar、Mesa de trabajo、Espacios 和 Archivos。文件夹路径、按 Workspace 的 Session 列表与“在此新建对话”不再是独立页面；在 Workspace 中开始对话仍可从该列的 Workspace 行完成。

## Testing

`packages/client/ui-faberloom/tests` 通过（271 项测试）。注册规范现在期望的 section 列表不含 `faberloom-workspaces`，被删除的 `workspaces.client.spec.tsx` 只覆盖已移除的屏幕。
