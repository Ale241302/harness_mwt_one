# Agent Note: Space 共享会话

Status: implemented

[English](2026-10-04-space-shared-sessions.md) | 中文

## Problem

共享一个 Space 会把它的授权与记忆交给受邀者，但不包括会话。每个成员运行各自的主机，因此所有者看不到受邀者在该 Space 区域中开始的会话，受邀者也看不到所有者的；会话列表与内容都留在运行它们的主机上。承载共享授权的控制台传输是唯一的跨主机通道，而没有任何会话目录使用它。

## Decision

`ctx.faberloomSessionShares`（包 `@deepseek-ai/dsh-faberloom-session-shares`）持有一个持久化的、按 Space 划分的共享会话目录。`capture(actor, input)` 把一个会话的可移植快照存入该 Space 并 POST 到控制台；`list(actor, spaceId)` 返回该 Space 的记录；`content` 返回一条记录及其快照；`remove` 撤回它；`sync(readerId)` GET 控制台为某成员准备的记录、upsert 并清理控制台已不再携带的导入记录。每次读取都通过 `ctx.faberloomSpaces` 解析 Space，并通过 `ctx.faberloomShares` 要求 `view`；缺少任一服务时信任执行者。

视图暴露 `captureSpaceSessions`、`spaceSessions`、`spaceSessionContent` 与 `removeSpaceSession`。捕获通过已挂载的 `ctx.sessionQuery` 读取每个本地会话的可移植快照（`readSession` 加上折叠后的 `readTitle`），当查询服务缺失时回退到面板给出的标题与空正文。Espacios 面板新增 `Sesiones compartidas` 字段：一个 `Sincronizar` 动作捕获本机在该 Space 区域的会话并重新列出，每条记录打开一个只读转录弹窗，`Quitar` 撤回一条记录。

控制台契约为 `${consoleBase}/harness/sessions`：`POST` 一条 `{ space_id, session_id, owner_email, title, workspace_id, created_at, updated_at, message_count, content }` 记录，`GET` 返回调用者可见的记录 `{ incoming: [...] }`，`DELETE /{id}`。本地捕获以 `owner:<spaceId>\u0000<ownerId>\u0000<sessionId>` 为键；导入记录以 `console:<readerId>\u0000<consoleId>` 为键，因此 `sync` 恰好清理某位读者的导入记录。

## Alternatives considered

**把外部会话导入本地会话存储。** 否决：在某个新 id 下物化另一台主机的日志会触及持久化会话格式、谱系与工作区挂接，而只读目录已经回答了「看到列表与内容」，且不破坏本地状态。

**把会话放进现有的共享负载。** 否决：授权负载是某个时点的资源快照，而会话持续变化，需要自己的发布与清理生命周期。

**成员之间的实时推送通道。** 否决：没有成员到成员的传输；控制台是既定的跨主机接缝，与共享授权传输一致，轮询 `sync` 复用它。

## Consequences

跨主机成员可见性需要 `${consoleBase}/harness/sessions` 端点；没有控制台时成员只能看到自己的捕获，`sync` 为空操作，因此该功能降级为本地。共享记录是可移植快照且为只读：它不新增侧边栏会话，且止于作者最近一次捕获，不是流式。内容可能很大，因为它携带快照的事件；服务把它存入持久化域，查看器只渲染文本块。`view` 授权在每个操作中强制执行，因此没有有效授权的成员无法列出、读取或撤回记录。

测试覆盖捕获/列表/内容生命周期、`view` 授权及缺少服务时的路径、作者与 Space 所有者删除并在失败时吞掉控制台删除、控制台发布与 204 答复、缺省字段的导入与下一次同步的清理、排序与 Space 过滤，以及域释放。视图测试覆盖捕获回退（缺少查询服务、标题被拒、无工作区）、列表、读取、删除与未挂载失败。
