# 智能体笔记：Remote 方法名不得与其命名空间服务冲突

Status: implemented

[English](2026-10-13-remote-method-names-versus-the-namespace-service.md) | 中文

## Problem

浏览器的 Remote 装配（`@deepseek-ai/dsh-api-remotes`）通过为每个命名空间注册一个客户端服务来挂载所有选中的命名空间。该服务 `RemoteNamespaceService` 自带一套 API：`has`、`remove`、`installDirect`、`installScoped`，以及其原型（含 Cordis `Service` 基类）上的其余成员。`packages/api/workspace-files` 暴露了一个名为 `remove` 的修改动词，于是在装配的 `apply` 中挂载该命名空间时，`assertMethodAvailable` 抛出 `client api: method "workspaceFiles/remove" conflicts with its namespace service`。装配在一个事务里挂载全部命名空间，因此这次抛出会卸载已经装好的那些：所有 `remote.*` 服务随之消失，44 个客户端条目永远停在 pending，Web 客户端显示「Failed to load plugins」，而不是应用本身。没有任何更小的部分失败，因为承载 remote 表面的正是这个整体。

## Decision

**动词改名为 `removePath`。** 它准确描述该操作（一个文件，或一个空目录 / 显式要求连同内容一起删除的目录），延续修改类动词家族（`createFile`、`createDirectory`、`move`），并避开服务自身的 API。`packages/faberloom/tool-faberloom` 的 `faberloom_files_delete` 随之一同改名；浏览器一侧从未直接调用该 remote 动词，因此客户端代码不变。

**被保留的名字是 Remote 契约的一部分，而只有浏览器会执行这条约束。** `RemoteNamespaceService.assertMethodAvailable` 会拒绝出现在 `REMOTE_NAMESPACE_FIELDS` 中或服务原型上的方法名。该检查发生在命名空间被挂载的位置，也就是客户端装配，而不是声明 `@Remote` 的宿主。因此宿主侧测试、类型检查与该包自身的测试套件都观察不到这次冲突：它们验证的是服务，而只有真正的客户端装配才会构造命名空间服务。

## Consequences

- 影响面是整个 remote 表面。仅一个命名空间的方法名就足以让产品不可用，而宿主侧的所有检查依然全绿：故障位于浏览器所加载的制品面，源代码级测试看不见它，发布它的那次部署从 `/healthz` 看去也很健康。
- 这类错误的形态是「一个名字」，在 Service Definition 处选定，却在很远的客户端被拒绝。在树中新增的下一个动词、命名空间或方法，都会继承同一个陷阱，直到有门禁把这些名字与服务 API 对照检查。

## Alternatives considered

- **重命名服务自己的 `remove`。** 它是客户端的命名空间服务，为每个命名空间共享，其 `remove(kind, method, token)` 负责卸载方法；应当移动的是产品动词，而不是框架 API。
- **允许贡献遮蔽服务方法。** 拒绝遮蔽的原因正是：遮蔽卸载器会破坏卸载，而且该检查发生在安装之前而不是之后。
- **保留 `remove`，改用别的命名空间名挂载。** 命名空间名由 Service Definition 自己拥有，冲突发生在方法名上，因此这样做只会把问题顺延到下一个被保留的词。
