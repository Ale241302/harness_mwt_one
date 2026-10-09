# Agent Note: 空间精选上下文桥接

Status: implemented

[English](2026-10-08-space-curated-context-bridge.md) | 中文

## Problem

FaberLoom 把一个空间的精选上下文分在两层，而这两层此前从未相会。`ctx.faberloomContext` 拥有空间所记忆的、带版本且需审批的条目；`ctx.faberloomSpaces` 拥有空间的 `context` 键值映射、其有效记忆与附件。`find`、`reference` 以及 `spaces_ask` 的简报只读第二层，因此空间的精选上下文对跨空间工作是隐形的：SONDEL 向 SICOP 提问时会遗漏 SICOP 通过 Context 面板记录的一切，尽管同一个人在那里可以看到它们。

## Decision

上下文服务新增 `listForSpace(actor, spaceId)`，返回某一空间下该行为者可读的条目（`shared` 条目加上该行为者自己的），最新的在前。`SpaceIndexEntry` 新增 `contextEntries`（拼接后的标题与正文），`SpaceReference` 新增 `entries`（`SpaceEntryRef`）——一个在 spaces 包中声明的中性形状，使 spaces 永不导入 context 包。

`spaces.find` 与 `spaces.reference` 通过模块内的结构接口，以及用于类型化表层之外名称的文档化 `ctx.get` 重载，读取可选的 `ctx.faberloomContext` 服务，因此两个方向都不新增依赖边，且未挂载上下文服务的部署仍保持其映射加记忆的行为。`find` 以上下文权重对拼接条目计分（理由 `context-entries`）；`reference` 返回它们；`faberloom_spaces_reference` 渲染并返回它们（`id`、`title`、`body`、`version`）；`askBrief` 将它们交给负责的代理。

## Alternatives considered

**让 `spaces` 依赖 `context`。** 否决：`context` 已为归属而依赖 `spaces`，因此硬依赖会形成包环，并会把两个仅可选共存的服�务耦合起来。

**仅在 `tool-faberloom` 中做拼接。** 否决：`find` 的排序位于 spaces 服务内部，因此支持条目的 find 要么被绕过要么被复制；接缝（`ctx.spaceIndex`）接收的是 `SpaceIndexEntry`，工具无法加以充实。

**把精选条目复制进空间的 `context` 映射。** 否决：这会让同一数据有两个所有者，并失去版本历史与审批闸门。

## Consequences

`find` 现在会依据空间精选上下文所述来找到它，`reference` 在该映射与记忆之旁返回该上下文，`spaces_ask` 也会据此向负责的代理做简报。两层刻意保持分离：`context` 是空间的键值映射，`entries` 是带版本的 `ctx.faberloomContext` 集合。没有新增任何包依赖；上下文服务通过 `ctx.get` 结构化读取。

测试覆盖 `listForSpace` 的范围与可见性、`reference.entries`（有服务时填充、无服务时为空）以及 `find` 对条目的计分；跨引用与空间提问的快照夹具携带 `entries`，且跨引用会话日志反映新增的渲染行。三个包的 README 记录了该桥接。
