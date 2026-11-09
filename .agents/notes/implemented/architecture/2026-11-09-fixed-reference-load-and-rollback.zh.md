# Agent Note: A fixed reference distinguishes published from loaded and rolls back only to an activated revision

Status: implemented

[English](2026-11-09-fixed-reference-load-and-rollback.md) | 中文

## Problem

3A.4 已把读取固定到工作引用并正确撤销，但产品无法区分修订只是已发布，还是确实被读取过。重启后的 runtime 没有测试证明同一引用仍记得加载状态。A1/A2 测试使用的是本地 Git 仓库，而不是已发布对象。rollback 也没有重新校验空间并拒绝已撤销来源的路径。

## Decision

**发布与加载是引用上的两个持久事实。** 读取成功后，工作引用行记录 `loadedAt`、`loadRevision` 与 `lastReadPath`。`referenceState(id)` 解析发布服务中固定修订的阶段（`none`、`pending`、`committed`、`uploaded`、`activated`、`failed` 或 `unavailable`），只有 `uploaded`/`activated` 标记为 `published`，只有 `loadRevision` 等于固定修订时才标记 `loaded`。读取工具在字节与清单验证通过后记录观察；记账失败绝不让读取失败。

**连接视图同时显示两个事实。** 每个令牌行携带引用 id、固定修订、发布阶段、发布标志、加载时间、读取修订与最后路径。连接面板渲染修订、发布与加载列；已发布但未读取的修订显示为 `Unconfirmed`。这些事实位于 `faberloom_mcp_oauth`，重启后的 runtime 读取同一行。

**A1/A2 针对已发布修订测试，而不是工作树。** MCP 测试在临时 Git 仓库与内存对象存储上挂载真实发布服务，发布两个修订，把每个工作引用固定到其中一个，并通过同一端点读取两者。A1 只返回自己的已发布字节，A2 只返回自己的；引用绝不会被重新解析到另一修订。

**Rollback 是到已激活发布的新引用。** `rollbackReference(id, targetRevision)` 要求源引用仍有效、目标不同于源修订、目标是同一空间的 `activated` 发布，并且 owner 仍能读取该空间。它创建没有加载状态的新引用，并拒绝已撤销来源而不是复活它。它返回引用；客户端仍需完成授权交换以获得该引用的令牌。

## Alternatives considered

**把已激活发布当作已加载。** 发布是服务端事实，加载是读取者的观察。把激活报告为加载会声称对话看过它从未请求的内容。

**把加载状态放在进程里。** 重启会抹掉区分。引用行是观察的持久位置。

**Rollback 时修改引用的修订。** 引用是对话呈现的固定句柄；改变修订会破坏 A1/A2 保证。Rollback 创建新引用。

**通过重新激活旧对象 rollback。** 激活是条件式的且已经发生；不可变对象仍在。缺少的控制是到它的授权引用，而不是第二次激活。

**在 rollback 内创建令牌。** 令牌交换是授权边界；服务方法不得签发 bearer secret。Rollback 返回引用，交换交给 OAuth 流程。

## Consequences

连接面板现在显示已发布修订是否真的被读取，且该状态跨重启保留。Rollback 不能静默复活已撤销引用或失败发布；操作者必须为返回的引用完成新授权。代价是引用行多三个字段、列出令牌时多一次发布查询，以及 rollback 后多一步授权。

## Verification

- `packages/faberloom/mcp-server/tests/oauth.spec.ts`：发布与加载状态；同一持久介质上的重启；A1/A2 对两个真实已发布修订；到已激活修订的 rollback、源撤销后的拒绝，以及未激活目标的拒绝。
- `packages/client/ui-faberloom/tests/registration.client.spec.tsx`：连接面板显示固定修订、发布阶段与未确认加载。
- `packages/faberloom/publication/tests/publication.spec.ts`：A1/A2 测试读取的已发布对象与签名清单。
