# Agent Note: deleting an open session disposes its agent

Status: implemented

[English](2026-09-27-session-delete-disposes-live-agent.md) | 中文

## 问题

[永久删除会话功能](../feature/2026-09-25-session-delete.zh.md) 对任何在 `ctx.sessions` 中仍存活的会话以 `session/busy` 拒绝，但没有任何代码会关闭它们。会话一旦被打开历史或被准入提示词就变为存活，而 `ApiSessionAgentController` 丢弃了 `ctx.agents.create`/`resume` 返回的 `AgentHandle`。Agent 注册表只通过该 handle 暴露释放能力，因此控制器一旦丢弃它，进程就不再持有拆除该 Agent 的能力，会话就会在进程整个生命周期内保持存活。于是用户曾打开过的对话永远无法删除：删除对话框始终返回 `session/busy`，在用户看来就是“会话删不掉”。

## 决策

`ApiSessionAgentController` 保留它创建或恢复的每个普通 Agent 的 `AgentHandle`，`SessionCommandController` 在移除存储之前释放它所拥有的存活 Agent。

- `ApiSessionAgentController` 维护一个 `Map<SessionId, AgentHandle>`，并在每个激活点 `retainHandle()` 该 handle —— `createOrAdopt` 的创建分支与恢复分支、`resumeObserved`，以及 `SessionCommandController.fork` 的子会话创建。`resolve()` 仍向调用方返回裸 `Agent`。
- `ownsSession(sessionId)` 报告本控制器是否持有该会话的释放器。`disposeSession(sessionId)` 通过 `handle.dispose()` 取消、排空、注销并分离该 Agent，然后遗忘该 handle；没有保留 handle 的会话保持不变。
- `SessionCommandController.removeAll` 先在任何存活 id 缺少保留 handle 时拒绝，然后释放它所拥有的每个存活 id，再复查没有存活者，最后才删除存储。由其他创建者留下的存活会话仍是 `session/busy`，而释放后仍存活的会话会在触碰任何存储之前被拒绝。
- `deleteOrphans` 继续跳过存活会话：批量清理绝不关闭用户可能正在阅读的对话。

## 考虑过的替代方案

**在删除前由 Client 关闭会话。** Web Host 没有暴露 `session/close` Remote，Client 也无法释放 Host Agent。Host 是 handle 的唯一持有者，而 Client 侧关闭会与随后的删除竞争。

**新增 `AgentRegistry.dispose(id)`，让删除可以释放任意 id。** 注册表有意只通过创建该 Agent 的消费者的 `AgentHandle` 能力暴露释放；按 id 释放会让任何调用方拆掉它并不拥有的 Agent。

**不再为读取历史而激活 Agent。** 后台提升（promotion）需要一个存活 Agent 来承载被提升的观察，因此必须保留 handle 而不能回避。

## 后果

- 删除打开的会话现在会先取消正在运行的回合并关闭该对话；删除不再因会话存活而失败。
- 对于本控制器并不拥有其 Agent 的会话，`session/busy` 仍然保留。
- 控制器为每个存活的普通 Agent 持有一个释放器，直到该 Agent 被删除或被取代。释放是单次且幂等的，因此被取代的 handle 无害。

## 测试

`packages/api/session-controller/tests/commands-delete.host.spec.ts` 覆盖删除前释放所拥有的存活会话、拒绝不拥有的存活会话、拒绝释放后仍存活的会话、兄弟顺序，以及 `deleteOrphans` 的选择。`packages/api/session-controller/tests/agent.host.spec.ts` 覆盖保留已恢复的 handle 并只释放一次。
