# Agent Note: 未知发送结果根据持久化意图状态进行核对

Status: implemented

[English](2026-11-20-unknown-send-durable-state.md) | 中文

## Problem

Correo 编写器过去通过检查返回错误文本中是否含有 `SEND_RESULT_UNKNOWN`，决定是否提供发送核对控件。服务抛出的 `FaberLoomSendError` 把该代码放在独立属性中，因此 Remote 错误文本可以描述 SMTP 响应丢失而不含代码。持久化尝试已经为 `unknown`，但用户看不到决策控件。

## Decision

**编写器在发送失败后读取该草稿持久化的发送意图。** 即使错误文本不含稳定代码，也只有 `unknown` 状态的意图会打开核对控件。仍在 `sending` 的尝试不提供结算决策；意图读取失败时保留原始发送错误，不用另一个错误覆盖它。服务还会在自身进程仍拥有该传输时拒绝 `resolveSend`，关闭替代调用路径；进程重启后遗留的 `sending` 仍可恢复。

`scripts/faberloom-daily/smtp-cut-proxy.cjs` 中的 PC4 冒烟代理提供受控故障。它只监听 loopback，通过隐式 TLS 向配置的 upstream 转发 SMTP，并且只在 Subject 与配置完全匹配时，于 upstream 接受完整 DATA 后截留最终 `250`。日志只包含时间、动作和 Subject 摘要。

## Alternatives considered

**在每个人类可读错误中加入代码。** 不能作为唯一机制：文本用于展示，持久化尝试才是结果的权威来源；Remote 序列化也可以继续分离这些字段。

**根据浏览器中的 socket 关闭推断状态。** 否决：浏览器无法区分投递前拒绝和 DATA 后确认丢失，只有主机记录的状态转换包含这种区别。

## Consequences

SMTP 响应丢失会产生持久化 `unknown` 和可见的用户决策，不会盲目重试。核对仍要求在选择 `sent` 前检查 Sent 或收件人；UI 变化不会自行观察投递，也不会自动结算尝试。代理是受控测试工具，不是自动重试机制或生产发送路径。

## Testing

`registration.client.spec.tsx` 重现不含代码的错误及持久化 `unknown`，再通过 `emailResolveSend` 结算；它也证明 `sending` 意图不显示结算控件。`send-intents.spec.ts` 保持 SMTP 响应不放行，证明传输仍活跃时两种 `resolveSend` 都会拒绝，并在完成后正常结算。`smtp-cut-proxy.spec.ts` 覆盖非目标邮件收到 `250`，以及目标邮件的 upstream 接受 DATA 而客户端丢失响应；同时检查日志不含凭据、收件人、正文和 Subject 原文。真实 PC4 观察记录在源码树之外，包含收到的邮件、恢复的 SMTP 配置和回读结算。
