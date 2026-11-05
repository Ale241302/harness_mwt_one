# Agent Note: 远程 Mesa 拒绝读取时降级摘要，而不是清空页面

Status: implemented

[English](2026-11-05-board-remote-refusal-degrades-overview.md) | 中文

## Problem

Espacios 面板在加载 Spaces、Agents、Routines 和记忆的同一个 `Promise.all` 中读取 `faberloomBoard.list`。当中央 Mesa 返回 `401 UNAUTHENTICATED`——board token 过期，或网关无法识别会话——整个摘要失败。不依赖网络的本地 Spaces 与 Routines 一并消失，只剩 `faberloom: REMOTE_UNAVAILABLE — list failed on the remote board: la sesión no identifica email y tenant`。该消息也掩盖了"会话过期"与"传输失败"的区别：`BoardRemoteError` 未携带 `faberloom:` 代码，board 会把所有无代码失败折叠为 `REMOTE_UNAVAILABLE`。

## Decision

`FaberLoomOverview` 增加 `boardError: string | null`。视图通过私有 `readBoard` 读取 Mesa：捕获失败、记录一条警告，并返回空列表与该消息。Spaces、Agents、Routines 和记忆继续加载。Spaces 面板在写入反馈下方渲染一条提示：`UNAUTHENTICATED` 要求重新登录；其他代码说明远程 Mesa 无法读取、其余空间仍可用。

`BoardRemoteError` 的消息以 `faberloom: <CODE> — ` 开头，使 board 的"有代码的拒绝原样传播"规则适用于每次远程失败。401 以 `UNAUTHENTICATED` 到达面板，而不是 `REMOTE_UNAVAILABLE`。

**令牌轮换。** `FABERLOOM_BOARD_REMOTE_TOKEN_FILE` 指向一个网关在令牌一小时寿命内每 20 分钟重写的文件。`BoardRemote` 在每次请求前读取该文件；文件缺失或为空时保留上一个令牌，因此存活超过令牌寿命的 `dsh` 进程无需重启即可继续读取 Mesa。

## Alternatives considered

**重试读取。** 已撤销的会话不会因重试恢复，面板会持续等待且仍为空；重试还掩盖了会话失效的时刻。

**在 `on` 模式下用本地行作答。** 该模式承诺远端是唯一存储，静默的本地答复会让过期的看板看起来是最新的，比空 Mesa 更糟。

**展示网关原文。** 它暴露内部细节，且不告诉用户下一步该做什么。

## Consequences

会话过期现在只影响 Mesa。面板仍显示空 Mesa，但 `boardError` 阻止把该空值当作有效的空看板。令牌仍为一小时寿命；网关在该窗口内重写令牌文件，文件缺失或不可读时回退到进程已有的令牌。未挂载远程适配器的部署保持 `boardError: null`。

## Verification

- `packages/faberloom/board/tests/remote.spec.ts`：409 与 504 在新代码前缀下保持原有消息；重写令牌文件前后的两次请求发送轮换后的令牌，文件删除后保留上一个令牌。
- `packages/faberloom/board/tests/remote-mode.spec.ts`：有代码的适配器拒绝原样传播；传输失败仍变为 `REMOTE_UNAVAILABLE`。
- `packages/faberloom/view/tests/workspace-board.spec.ts`：摘要保留本地 Spaces 并报告 `boardError`。
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx`：Spaces 面板保留列表，`UNAUTHENTICATED` 显示登录提示，其他代码显示传输提示。
