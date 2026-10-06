---
description: "共享会话目录（ctx.faberloomSessionShares）：Space 的会话在每个成员的主机上捕获，并发布到 MWT.ONE 控制台或从其中导入。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-session-shares

[English](README.md) | 中文

## 概述

共享会话目录（`ctx.faberloomSessionShares`）让 Space 的会话对每个成员可见，而不仅限于运行它们的主机。捕获一个本地会话会把它的可移植快照存入该 Space 并发布到 MWT.ONE 控制台；同步会导入其他成员发布的记录，因此所有者能看到受邀者的会话，受邀者也能看到所有者的。每次读取都要求对该 Space 具备 `view`（所有者，或有效的授权）。记录通过 `ctx.storageDomain` 持久化，控制台是跨主机传输。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limited)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在已具备 `ctx.storageDomain` 的组合中挂载此行，并配置 `consoleBase` 与 `consoleToken`（留空则回退到 `CONSOLA_API_BASE` 与 `CONSOLA_TOKEN`）。`ctx.faberloomSpaces` 与 `ctx.faberloomShares` 是可选的，仅用于执行 `view` 检查。该服务打开 `faberloom_session_shares` 域、注册 `ctx.faberloomSessionShares`，并暴露 `capture`、`list`、`content`、`remove` 与 `sync`。`capture(actor, input)` 把一个会话的可移植快照存入该 Space 并 POST 到控制台；`list(actor, spaceId)` 返回该 Space 的记录；`content(actor, spaceId, ownerId, sessionId)` 返回一条记录及其快照；`sync(readerId)` 为一个成员导入并清理控制台的记录。

控制台契约为 `${consoleBase}/harness/sessions`：`POST` 一条 `{ space_id, session_id, owner_email, title, workspace_id, created_at, updated_at, message_count, content }` 记录，`GET` 返回调用者可见的记录 `{ incoming: [...] }`，`DELETE /{id}` 撤回一条。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomSessionShares` 是主机服务：不注册工具、不注入提示文本，也不写入会话事件。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存影响

与实时请求无关：该注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limited"></a>

- **控制台是跨主机传输** —— 没有它，成员只能看到自己的捕获；发布与导入需要 `${consoleBase}/harness/sessions` 端点。
- **内容是可移植快照，不是实时会话** —— 共享记录携带捕获的快照 JSON 且为只读；它绝不会被导入本地会话存储，因此不会新增侧边栏会话。
- **记录止于最近一次捕获** —— 作者需要重新捕获以发布新的回合；没有流式推送。

未发布 invariant companion，因为该服务的单元测试已断言捕获/列表/内容生命周期、`view` 授权以及控制台导入与清理。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

本地捕获以 `owner:<spaceId>\u0000<ownerId>\u0000<sessionId>` 为键；导入记录以 `console:<readerId>\u0000<consoleId>` 为键，使 `sync` 恰好清理某位读者在控制台上已不存在的记录。授权通过 `ctx.faberloomSpaces` 解析 Space 所有者，并通过 `ctx.faberloomShares` 检查 `view` 权限；缺少任一服务时信任执行者。该域惰性打开、随调用 fiber 关闭，与其他 FaberLoom 服务一致。

</details>
