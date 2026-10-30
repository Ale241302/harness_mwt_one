# Agent Note: Adopt an existing folder as a Space

Status: implemented

[English](2026-10-11-space-from-folder.md) | 中文

## Problem

FaberLoom 的 Space 始终镜像确定性的 `<DSH_HOME>/spaces/<ref>` 区域：`faberloom-view` 的 `ensureSpaceWorkspace` 在首次使用时创建该目录并把它注册为 Workspace。已经把自己的客户文件放在某个文件夹里的用户 —— 这是常见情形，也是产品的意义所在 —— 无法让 Space 指向该文件夹，因此 agent 的文件工具与侧边栏对话区从不作用于用户实际使用的文件夹。`faberloom-spaces` 的记录本就带有 `workspaceId`（“当 Workspace 被采纳为 Space 时该 Space 镜像的 harness workspace”），`UpdateSpaceInput` 也已接受它；缺的只是采纳动作。

## Decision

Espacios 面板把已有的文件夹采纳为 Space 的对话区。

- `faberloom-view` 新增 Remote `adoptSpaceWorkspace(id, path)`。它通过已挂载的 workspace registry 解析该文件夹——同一路径已注册的 Workspace 直接复用，否则创建一个以该 Space 命名的 Workspace——并把得到的 `workspaceId` 经 `ctx.faberloomSpaces.update` 写入该 Space。未挂载 registry 时抛错，与 `openSpaceWorkspace` 一致。
- `ui-faberloom` 注入 `remote.directoryPicker`（Desktop 用原生选择器，Web 用浏览选择器），并在 Space 详情中于*在此空间中开始新对话*旁新增 **“使用现有文件夹…”** 动作。流程位于 `src/client/adopt-space-workspace.ts`（`runAdoptSpaceWorkspace`），以便针对 stub context 测试：选择、采纳、刷新概览；选择被取消、选择失败或采纳被拒绝都不会改动当前 Workspace。
- `faberloom-view` 的 `./remote` 由 Typert 构建生成，因此新方法在下一次 `build:lib:host` 后即可经 `ctx.remote.faberloomView` 调用。

## Alternatives considered

**用一个新 Remote（`createSpaceFromFolder`）同时创建 Space 与 Workspace。** 否决：采纳文件夹是既有 Space 的属性，而 Space 可能先创建（带 agent、父级与继承）之后再指向某个文件夹。

**把文件夹复制进 `$DSH_HOME/spaces/<ref>`。** 否决：用户的目的是在自己的文件夹上工作而非副本；复制还会让 agent 与用户各自编辑的文件分叉。

**把路径直接写进 Space 记录而跳过注册 Workspace。** 否决：侧边栏、会话 `cwd` 与文件工具都经 workspace registry 解析；裸路径只在一处生效。

**让选择器在 host 侧运行。** 否决：Desktop 的选择器是 Electron 壳拥有的原生对话框，Web 的是浏览器界面；两者都已暴露客户端半边必须调用的 `remote.directoryPicker` 命名空间。

## Consequences

Space 现在可以指向用户能选中的任意文件夹，且侧边栏 Workspace、会话工作目录与 Space 都解析到它。已注册为 Workspace 的文件夹会被复用，因此重复采纳不会分叉出第二个条目。从未采纳文件夹的 Space 仍以确定性的 `<DSH_HOME>/spaces/<ref>` 区域为默认。只读身份仍受与其他 Space 写入相同的面板规则限制。

## Testing

`packages/faberloom/view/tests/adopt-space-workspace.spec.ts` 覆盖：注册所选文件夹并写入 `workspaceId`、复用同一路径上已存在的 Workspace、以及没有 registry 时明确失败。`packages/client/ui-faberloom/tests/adopt-space-workspace.client.spec.ts` 覆盖选择后采纳的流程、选择取消、选择器失败与采纳被拒绝。`ui-faberloom` 面板套件在其 harness 中提供注入的 `remote.directoryPicker`。
