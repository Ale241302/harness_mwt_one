# Agent Note: FaberLoom Space/Work Flow shares across the console

Status: implemented

[English](2026-10-05-faberloom-share-console-scope.md) | 中文

## Problem

从侧边栏 Workspace 行共享一个 Space 端到端失败，原因有两个且彼此独立。harness 通过 `ctx.faberloomShares` 完成共享，其 `create` 会 POST 到 `{CONSOLA_API_BASE}/harness/shares/`，但已部署的 MWT.ONE 控制台只接受 `kind` 为 `agent`/`skill`，因此 `kind: 'space'` 返回 400。另外，网关只在启动时把 `CONSOLA_TOKEN` 注入每个 `dsh`；进程一旦活过控制台 30 分钟的 access token，就会继续发送过期的 JWT，于是每次控制台调用都返回 401，直到进程重启。

## Decision

控制台的 `core.harness_share` 表与 `HarnessShareViewSet` 现在承载两个系列。agents/skills 保持每个资源一行、以 `(owner_email, kind, name)` 为键，可共享给多个邮箱。Spaces/Work Flows 新增 `resource_id`、`permissions`、`status`、`grantee_email` 与 `accepted_at`，并以 `(owner_email, kind, resource_id, grantee_email)` 为每个受邀者记一个 grant，因此把同一个 Space 再分享给第二个人不再覆盖第一个 grant。`M1_harness_share_scope.sql` 是为已应用的 `M0` schema 准备的幂等迁移；`list` 与 `create` 返回 `resource_id`、`permissions` 与 `status`。

harness 在每个 grant 中发布 `resource_id: input.resource.id`，因此控制台行的寻址使用真实资源 id，而不是显示名称。

控制台在 `GET {consoleBase}/harness/shares/accept?grant=<id>` 提供邀请链接：该 action 无需认证（行 id 只出现在受邀者的邮件里，因此它就是链接的密钥），把该行标记为 `active` 并写入 `accepted_at`，并通过 `StaticHTMLRenderer` 返回一个简单的 HTML 确认页。每个 grant 邮件发送的是该控制台行 id，而不是所有者本地的 grant id，因此受邀者打开的链接能在控制台解析。

受邀侧会导入并物化它所接受的内容。`shareSpace` 随 grant 发布一个可移植快照——Space 的标题与上下文、其 Memory 条目、其 Context 条目、其 Space 作用域的 Work Flow，以及这些流程所依托的 Routine；`shareWorkflow` 则发布 `{ scope, definition }`。视图的 `overview` 每进程调用一次 `FaberLoomShares.sync`，并对每个 active 的来向 grant 通过 `FaberLoomShares.snapshotFor` 读取快照。Space 用 `faberloomSpaces.importShared` 以远程资源 id 物化、归发布者所有，因此同一个 grant 即可授权它；同时为受邀者镜像一个侧边栏 Workspace，并把它的 Memory、Context 条目、Work Flow 和 Routine 重建为受邀者自己的副本，其中文本、标题、名称已存在者会跳过，因此重复 sync 或再次共享只会新增内容。Work Flow 用 `faberloomWorkflows.importShared` 以远程 id 物化。没有发布快照的 grant 会被跳过，因此旧邀请不会物化出空资源。控制台会把作为文本返回的 `jsonb` `payload` 归一化为对象，`sync` 也会防御性地解析文本 payload。

FaberLoom 自身的 Memory 来自显式记录，而不是对话日志。`faberloom-tool` 增加一个 `faberloom:memory` 系统提示段落，指示助手用 `faberloom_spaces_remember` 按区域解析并保存持久的 Space 事实；视图则通过 `session/event` 的 `turn/end` 监听器，把 Space 区域内每个完成的轮次——其最后的问题与结果，按文本去重——计入该 Space 的 memory；监听器把 Session 的 `cwd` 解析到其 Workspace，再解析到其 Space。

Space 的对话 Session 随 grant 一起传递。控制台通过 `HarnessSessionViewSet` 把它们存进 `core.harness_shared_session`，路径为 `{CONSOLA_API_BASE}/harness/sessions/`：作者按 `(owner_email, space_id, session_id)` POST 一行并带上可移植日志，active 的受邀者或 Space 所有者列出收到的行，两者都可 DELETE。`shareSpace` 通过 `ctx.faberloomSessionShares.capture` 发布该区域的 Session——尽最大努力、不在共享的关键路径上，因此缓慢或未接线的目录绝不会让 grant 失败——受邀者的 `spaceSessions` 从控制台同步并在 Space 下列出它们。`M2_harness_shared_session.sql` 是新增该表的幂等迁移。受邀者的 `overview` 与 `spaceSessions` 还会通过 `sessionPersistence.create`+`append` 在自己的主机上重建每个导入的 Session，把镜像区域作为 header 的 `cwd` 并把它挂到 Workspace 上，因此侧边栏会在 Space 旁列出该对话；该副本以已存 Session id 幂等。发布是持续的：每个完成的轮次会把其 Session 捕获进目录，且行为者的 `overview` 会为每个共享 Space 发布行为者自己的新 Session，并镜像每个共享 Space 的 Session，因此所有者能看到受邀者的对话，受邀者也能看到所有者的。自动捕获的 Memory 文本会去掉 harness 的 `<system-reminder>` 块。

网关在启动时、以及 `refreshConsolaAccess` 轮换时，把用户当前的控制台 JWT 写入 `<DSH_HOME>/.consola-token`，注入 `CONSOLA_TOKEN_FILE`，并通过 `NODE_OPTIONS` 把 `gateway/consola-token-watch.mjs` 预加载进每个 `dsh`。该 watcher 每分钟把文件重新读入 `process.env.CONSOLA_TOKEN`，同时网关每五分钟在过期前刷新每个已存 token。各服务本就每次调用都读 `process.env.CONSOLA_TOKEN`，因此环境不会失效。

## Alternatives considered

**token 过期时重启该 `dsh`。** 否决：透明重启仍会在每次轮换时切断用户的实时连接，而 token 会在一次正常会话的生命周期内轮换。

**让控制台调用经由网关代理。** 否决：网关无法判断容器内调用属于哪个用户，除非新增一个每用户凭据并贯穿每个调用控制台的服务，而 watcher 无需改动任何服务。

**控制台拒绝时改为本地共享。** 不作为主要修复而否决：控制台是跨主机传输，降级为仅本地 grant 会悄悄隐藏用户要求的功能。

## Consequences

共享一个 Space 或 Work Flow 会到达控制台，并存入一个可按 id 寻址的 grant，带有其权限与状态；agents/skills 不变。`dsh` 的控制台 token 在进程存活期间不再过期，这同时修复了邮件附件以及共享 Session/上下文的控制台调用。

接受邀请会把控制台的 grant 标记为 active，受邀者的下一次 overview 会导入该 grant 并以远程 id 物化共享的 Space/Work Flow。共享的 Space 还会作为侧边栏 Workspace 出现，它的 Memory、Context、Work Flow 与 Routine 会复制给受邀者。复制的 Work Flow 以 `draft` 物化，复制的 Routine 可能引用发布者的 connection id，因此它可能出现在 Routine 面板中而在受邀者主机上没有可用的邮箱；共享的 Space 只带上下文，不携带附件。该 Space 的区域 Session 会随 grant 一起发布，受邀者在 Space 的共享 Session 列表下读取；从 Spaces 面板直接捕获会更新同一批行。
