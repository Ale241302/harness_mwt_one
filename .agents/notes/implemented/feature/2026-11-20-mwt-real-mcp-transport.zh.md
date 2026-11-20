# Agent Note: MWT 写入使用已部署 MCP 的字段约定

Status: implemented

[English](2026-11-20-mwt-real-mcp-transport.md) | 中文

## Problem

O8A 传输实现过去发送通用的 `expediente`、`coleccion`、`campos`、`documentos`、`version_esperada` 和 `idempotency_key` 参数。已部署的 `expediente_obtener` 实际需要 `expediente_id`，`expediente_editar` 需要 `expediente_id` 和 `cambios` 对象。MCP 响应以 JSON 文本携带 expediente，包含 `updated_at`，但没有 ETag、文档列表或幂等保证。此前也没有注册生产传输实现。

## Decision

**MWT 服务在 Cordis tools 服务挂载后注册其 MCP 传输实现。** 它在每次调用时解析已挂载的 `expediente_obtener` 和 `expediente_editar` 工具，从该运行时继承操作者身份，解析 MCP 载荷，并且只写服务器允许的页眉字段。`mwtPrepareWrite` 通过已认证的 view 公开准备操作，不执行写入。

`updated_at` 是准备和写入前回读使用的本地修订观察值。服务器不接受它作为比较并写入的前置条件。写入后，服务读取每个获批字段，不匹配时不会标为 written。文档和未知字段在 MCP 写入前失败。一次性授权仍只允许一次调用，响应丢失保持 `unknown`。

## Alternatives considered

**保留通用参数，等待未来服务器支持。** 否决：已部署工具会拒绝该载荷，把这种传输实现描述为可用并不真实。

**在本次变更中加入服务器版本控制和幂等。** 暂缓：这些保证需要服务器迁移及独立验证。适配器明确说明它们缺席，不把 `updated_at` 宣称为等价能力。

**在浏览器面板中连接传输实现。** 否决：MWT 服务拥有目标，board 也是消费者；Cordis tools 运行时提供身份，无需引入 UI 依赖。

## Consequences

真实页眉 PATCH 路径现在具有准确提案和回读确认。文档写入、原子比较并写入和服务器去重仍不属于此传输实现。工具缺失或读取失败会停止准备；写入失败或响应丢失不会因乐观推断而成为已确认成功。

## Testing

传输套件覆盖 MCP 解包、根字段、`updated_at`、准确编辑参数、数值信用天数、不支持的字段和文档，以及响应丢失。真实 Cordis 组合测试覆盖传输注册、操作者工具调用、读取拒绝，以及写入错误不会成为 `written`。view 套件覆盖为已认证操作者准备提案和服务缺席拒绝。这些都是本地测试；任何真实操作都需要独立的 `AUTH-MWT-WRITE` 和目标证据。
