# Agent Note: 上下文导出、导入与替换

Status: implemented

[English](2026-10-08-context-export-import.md) | 中文

## Problem

Context 面板可以创建、编辑、版本化、审批、拒绝与删除条目，但某个 Space 的上下文记录被困在一台主机上。所有者无法备份它、在 Space 或部署之间迁移它，或整体替换某个 Space 的记录；成员的知识也无法离开面板。

## Decision

上下文服务新增三项操作。`export(actor, { spaceId?, format })` 返回该行为者可读的条目（可选地限定到某个 Space），每条带上其版本历史，格式为 JSON（默认）或 Markdown。`import(actor, payload)` 解析该 JSON，并按该行为者的归属为每个其标题在该 Space 中尚不存在的条目创建（所有者写入 shared，成员写入 pending），因此重复导入同一条记录是幂等的。`replace(actor, spaceId, entries)` 仅限所有者，整体替换某个 Space 的记录：标题不在新集合中的条目被移除，保留的标题获得新版本，新标题被创建。工具 `faberloom_context_export` 与 `faberloom_context_import` 暴露导出与导入（通过 `contextTools` 选择启用）。视图暴露 `exportContext`、`importContext` 与 `replaceContext`；Context 面板新增 **Export** 按钮（下载 JSON）与 **Import** 控件（读取文件），二者均已本地化。

## Alternatives considered

**一次导出一个条目。** 否决：记录——某个 Space 的条目集合及其历史——才是备份或移交所移动的单位。

**作为单个条目的新版本导入。** 否决：导入创建的是条目，而非单个条目的版本；记录是一个集合。

**为替换新增工具。** 否决：替换是面板/破坏性操作，因此它保持为面板驱动的视图 Remote，而非模型工具。

## Consequences

某个 Space 的上下文记录变得可移植：所有者可将其导出为 JSON 或 Markdown、在别处导入，或通过一次调用替换某个 Space 的记录。导入遵循可见性机制——所有者的导入为 shared，成员的导入以 pending 起始——并跳过重复标题，因此重复导入是空操作。`replace` 通过追加版本保留被保留条目的历史，并连同其历史移除被丢弃的条目。README 与面板文案均已本地化，且工具保持选择启用，因此未启用它们的部署不新增请求 schema。

测试覆盖上下文服务（带版本的 JSON 导出、Markdown、导入幂等性、畸形载荷、仅所有者可替换）、工具（导出与导入）以及视图（三个 Remote 与畸形载荷的拒绝）。
