# @deepseek-ai/dsh-faberloom-effects-mwt

[English](README.md) | 中文

对 MWT.ONE 中的 expediente 执行写入（`ctx.faberloomMwt`）。

## 约定

`prepare` 通过已注册的 `MwtTransport` 读取目标，并保存一份提案：准确的 expediente、每个字段的原值和单位、每份文档的字节与 SHA-256、目标版本，以及阻止批准的歧义。修订哈希覆盖目标、版本和每个待写入字节。

`authorize` 为单个修订记录一次性授权，并包含操作者声明的范围。存在未解决歧义的提案会被拒绝。

`execute` 重新读取目标，拒绝已变化的版本，消费授权，写入一次并回读结果。每个获批字段必须与回读值一致；不一致会把提案标为 `failed`，并记录字段、预期值和实际值。目标可能已经接受写入但没有响应时，提案保持 `unknown`；执行器不会自行重试。

`reconcile` 根据操作者的决定结算 `unknown` 提案。`discard` 关闭从未写入的提案。

看板使用同一路径：以 `mwt.write` 动作获批的条目进入已注册适配器，并消费已有授权，不会创建授权。缺少授权会使效果失败，不会执行写入。

## 配置

目标通过 `useTransport(transport)` 按进程注册；包本身不包含端点或凭据。没有传输实现时，`prepare` 以 `NO_TRANSPORT` 拒绝，且 `transportReady` 为 false。

挂载 `tools` 后，服务通过 Cordis scope 注册 MCP 传输实现，并随该 scope 释放。它解析 `mcp__< servidor >__expediente_obtener` 与 `expediente_editar`，从挂载的工具运行时继承身份，不持有自己的凭据。

`createMwtToolTransport` 适配真实的 `expediente_obtener` 与 `expediente_editar`。读取只发送 `expediente_id`；写入发送 `expediente_id` 和 `cambios` 记录。解析器接受含 JSON 的 MCP 文本 `content` 和 `structuredContent`，公开根字段，并以 `version`、`etag` 或 `updated_at` 作为修订标记。

MCP 写入器只接受部署服务器允许的页眉字段：身份、操作、运输、派送、Incoterm、付款、信用天数、货币、PO 编号、状态、起点、目的地、跟踪、承运人和运输日期。三个信用天数字段转换为安全的 JSON 整数，其余值保持字符串。不支持的字段和文档变更会在调用 MCP 前抛出错误。

## Model Experience

模型可见输入不变：服务不公开 tool，也不公开 prompt。提案、授权和尝试是产品数据，不是 session event。

## 已知限制与后续工作

- `expediente_editar` 不写入文档。通用提案模型为其他传输实现保留文档变更，但 MCP 传输实现会在调用前拒绝它们。
- 真实 MCP 工具不接受 `version_esperada` 或 `idempotency_key`。服务仍在写入前检查修订、消费一次授权并只调用一次写入，但服务器不提供比较并写入或去重保证。
- MCP 凭据、端点注册和速率限制属于部署。
- 文档字节随提案保留到结算；保留期清理由部署负责。
- 响应丢失的写入保持 `unknown`，直到操作者核对；没有自动探测。
