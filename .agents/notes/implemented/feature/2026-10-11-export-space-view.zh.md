# Agent Note: Export a Space's view into its folder

Status: implemented

[English](2026-10-11-export-space-view.md) | 中文

## Problem

`faberloom-view` 已经能导出 Work Flow 的可移植 JSON 或 Archify HTML（`exportWorkflow`）以及 Context 导出（`exportContext`），但两者都把内容返回给浏览器：面板在对话框中打开它，用户再手动复制出去。读取 Space 文件夹的 agent 文件工具从未看到该导出，因此需要附上每周快照的例程、或希望导出文件与客户文件放在一起的用户，都无从把它放进去。

## Decision

`faberloom-view` 新增 Remote `exportSpaceViewToFolder(spaceId, kind, targetId, format?)`。它经 `resolveSpaceDir` 解析目标——该 Space 镜像的 Workspace，或确定性的 `<DSH_HOME>/spaces/<ref>` 区域——调用已有导出（`context` 用 `exportContext`，`workflow` 用 `exportWorkflow`），并把返回内容写入 `<space dir>/exportaciones/`，返回路径与字节数。文件名取自 context 导出自身的 `filename`，或取自 Work Flow id 加该格式的扩展名；名称经 `basename` 处理，因此建议名称无法逃逸该文件夹。Espacios 面板新增 **“导出到文件夹”** 动作，把该 Space 的 context 导出写为 Markdown 并报告结果路径。

## Alternatives considered

**保留浏览器对话框让用户自行保存。** 否决：它把导出放进下载目录，位于 agent 可读文件夹之外，且每次导出都需人工一步。

**在 view 内新建序列化器。** 否决：导出格式由 Context 与 Work Flows 服务拥有；Remote 应调用它们而非重新推导。

**让调用方传入完整路径。** 否决：面板动作不得选择任意主机路径；文件夹与受限文件名由 Remote 拥有。

**在本次变更中同时从 Workflows 面板写出 Work Flow 导出。** 延后：Remote 已同时服务两种类型；Workflows 面板的动作在其导出区域下次改动时随其文案一起落地。

## Consequences

Space 的 context 导出（以及同一调用下的 Work Flow JSON 或 Archify 导出）成为 Space 文件夹中的真实文件，agent、例程与用户都能看到。名称在构造上受限，因此导出无法覆盖文件夹之外的文件。重复导出会覆盖同名旧文件，这正是周期性快照的预期行为。

## Testing

`packages/faberloom/view/tests/export-space-view.spec.ts` 覆盖：以服务自带的文件名把 context 导出写入 Space 文件夹，以及以 flow id 命名写入 Work Flow 导出，并断言写出的字节与确切路径。
