# Agent Note: FaberLoom Space/Work Flow shares across the console

Status: implemented

[English](2026-10-05-faberloom-share-console-scope.md) | 中文

## Problem

从侧边栏 Workspace 行共享一个 Space 端到端失败，原因有两个且彼此独立。harness 通过 `ctx.faberloomShares` 完成共享，其 `create` 会 POST 到 `{CONSOLA_API_BASE}/harness/shares/`，但已部署的 MWT.ONE 控制台只接受 `kind` 为 `agent`/`skill`，因此 `kind: 'space'` 返回 400。另外，网关只在启动时把 `CONSOLA_TOKEN` 注入每个 `dsh`；进程一旦活过控制台 30 分钟的 access token，就会继续发送过期的 JWT，于是每次控制台调用都返回 401，直到进程重启。

## Decision

控制台的 `core.harness_share` 表与 `HarnessShareViewSet` 现在承载两个系列。agents/skills 保持每个资源一行、以 `(owner_email, kind, name)` 为键，可共享给多个邮箱。Spaces/Work Flows 新增 `resource_id`、`permissions`、`status`、`grantee_email` 与 `accepted_at`，并以 `(owner_email, kind, resource_id, grantee_email)` 为每个受邀者记一个 grant，因此把同一个 Space 再分享给第二个人不再覆盖第一个 grant。`M1_harness_share_scope.sql` 是为已应用的 `M0` schema 准备的幂等迁移；`list` 与 `create` 返回 `resource_id`、`permissions` 与 `status`。

harness 在每个 grant 中发布 `resource_id: input.resource.id`，因此控制台行的寻址使用真实资源 id，而不是显示名称。

网关在启动时、以及 `refreshConsolaAccess` 轮换时，把用户当前的控制台 JWT 写入 `<DSH_HOME>/.consola-token`，注入 `CONSOLA_TOKEN_FILE`，并通过 `NODE_OPTIONS` 把 `gateway/consola-token-watch.mjs` 预加载进每个 `dsh`。该 watcher 每分钟把文件重新读入 `process.env.CONSOLA_TOKEN`，同时网关每五分钟在过期前刷新每个已存 token。各服务本就每次调用都读 `process.env.CONSOLA_TOKEN`，因此环境不会失效。

## Alternatives considered

**token 过期时重启该 `dsh`。** 否决：透明重启仍会在每次轮换时切断用户的实时连接，而 token 会在一次正常会话的生命周期内轮换。

**让控制台调用经由网关代理。** 否决：网关无法判断容器内调用属于哪个用户，除非新增一个每用户凭据并贯穿每个调用控制台的服务，而 watcher 无需改动任何服务。

**控制台拒绝时改为本地共享。** 不作为主要修复而否决：控制台是跨主机传输，降级为仅本地 grant 会悄悄隐藏用户要求的功能。

## Consequences

共享一个 Space 或 Work Flow 会到达控制台，并存入一个可按 id 寻址的 grant，带有其权限与状态；agents/skills 不变。`dsh` 的控制台 token 在进程存活期间不再过期，这同时修复了邮件附件以及共享 Session/上下文的控制台调用。

接受步骤与受邀侧物化仍未实现：邮件链接仍指向一个并不存在的控制台 `accept` 路由，来向的 Space/Work Flow grant 也尚未物化到受邀者的存储中。`FaberLoomShares.sync` 是两者将来使用的接缝。
