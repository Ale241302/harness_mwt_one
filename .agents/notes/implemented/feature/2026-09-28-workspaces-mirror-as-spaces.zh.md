# Agent Note: every harness Workspace mirrors as a Space

Status: implemented

[English](2026-09-28-workspaces-mirror-as-spaces.md) | 中文

## Problem

Space/Workspace 的关系是单向的。从 Spaces 面板创建 Space 会物化其会话目录并注册为 harness 工作区，但从 New Session 选择器直接创建的工作区（一个普通文件夹，例如 `SICOP`）对 Spaces 面板不可见：owner 在充满工作区的侧边栏旁看到一个空的 Spaces 列表。Spaces 面板与侧边栏把同一片区域命名为两个不同的世界。

## Decision

工作区就是空间区域，双向成立。

- 空间记录新增 `workspaceId`——空间镜像的 harness 工作区——作为同一域名版本下的可空、带默认值字段，与 `agentId` 完全一致。存储的是 id，绝不存储路径。
- `faberloomView.overview()` 采纳每个没有任何空间镜像的已注册工作区：创建一个以该工作区命名的空间并按 id 锚定。确定性目录 `<DSH_HOME>/spaces/<ref>` 与之匹配的遗留空间会被锚定而非重复创建，因此该过程幂等，且不会因每次读取而增长目录。只读身份不会触发写入。
- 当空间已有镜像时，`ensureSpaceWorkspace` 复用它；否则创建确定性目录并把新工作区的 id 记录到空间上。`spaceWorkspace`、`openSpaceWorkspace`、`deleteSpace` 以及 `workspace/removed` 监听器都通过锚点解析，对早于该字段的空间回退到确定性目录。
- 仅当目录位于 harness home 之下（`isUnderDshHome`）时，`deleteSpace` 才删除它；位于其外的被采纳工作区只注销、不删除。从侧边栏删除工作区会通过 `workspace/removed` 丢弃镜像的空间，现在按 id 匹配。

## Alternatives considered

**保持单向链接。** 这样 owner 创建的工作区仍会让 Spaces 面板保持为空，而这正是被报告的缺陷；owner 选择了自动镜像。

**显式的“从此工作区创建 Space”按钮。** 需要同样的锚点，但会把默认状态（空的 Spaces 面板）保留下来，并要求 owner 手动对账。因选择自动行为而被否决。

**在空间上存储文件系统路径而不是工作区 id。** 工作区注册表的 id 才是持久键；存储的路径在移动后会失效，并且会让 spaces 服务暴露路径，而其工作目录契约在设计上是不透明的。由 view 通过注册表解析 id。

## Consequences

- 从 New Session 选择器创建文件夹后，它会在下一次 overview 读取时出现在 Spaces 中；两个视图命名同一个目录。
- 删除 Space 会删除其会话目录与工作区注册（位于 harness home 之下）；删除工作区会丢弃 Space。
- 重命名工作区不会重命名其 Space，反之亦然，直到后续更改同步标题。
- 这逆转了[空间/工作区链接说明](2026-09-22-spaces-workspace-link-and-bench.zh.md)中“拒绝存储工作区 id”的备选方案；对于从不采纳工作区的空间，确定性目录规则仍然保留。

## Testing

`packages/faberloom/spaces/tests/spaces.spec.ts` 覆盖存储的镜像及其更新/清除。`packages/faberloom/view/tests/workspace-board.spec.ts` 覆盖孤立工作区的采纳、将遗留空间锚定而非重复创建，以及通过镜像工作区删除被采纳的空间。Host 与 Client 类型检查通过。
