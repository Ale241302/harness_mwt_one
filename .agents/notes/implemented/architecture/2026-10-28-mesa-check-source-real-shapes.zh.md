# Agent Note：工作台的验证端口按 MWT 的真实响应结构运行

Status: implemented

[English](2026-10-28-mesa-check-source-real-shapes.md) | 中文

## 问题

当已声明的阻断性验证没有适配器时，工作台会拒绝批准形式发票；而缺少数据源的已声明验证按设计就是失败（ADR-003、D-01）。第一个适配器按猜测的字段别名注册了六个验证：`lines`、`qty`、`precio_mwt`、`precio_lista`、`cantidad`。对 `mwt-one` 1.30.0 的实机探测表明这些字段都不存在，因此在看似已配置的情况下，一旦启用适配器，所有验证都会失败关闭。

探测同时确定了数据源能与不能回答的内容：

- `expediente_buscar` 返回 `{existe, total, matches[]}`；匹配项带有编码、`estado`、`product_count` 与 `monto_cliente_usd`，但没有卷宗 id。
- `expediente_listar` 返回 `{count, limit, offset, results[]}`；行内带有 `total_client`、`total_mwt`、`moneda`、`client_name`、`credit_days_cliente` 与 `credit_band`，同样没有 id，即使 `campos` 指定也不行。
- `expediente_lineas` 需要 `expediente_id`，因此不可达。
- `producto_buscar` 返回 `{productos[], total}` 并带 `precio_venta`；`producto_precio_cliente` 返回 `{sku, banda_vigente, plazo_dias, clientes}`，没有列表价或客户价，`clientes` 为空。
- `stock_listar` 返回一个扁平对象，其中 `cantidad_disponible` 是十进制字符串。

## 决定

**价格验证以订单为单位。** `BoardCheckSource` 提供 `orderTotals(orderRef)`，不再提供按行的 `price`；`proforma.price` 在分位精度上把开票总额与卷宗的 `total_client` 比较，并要求引用已解析且两侧齐全。引用解析为零行、两行，或行内缺少任一总额，验证即失败。`proforma.quantity` 保持其分类，在没有行数据源时失败，因为没有行就无法证明数量。

**按响应原本的结构读取，不在验证里重塑。** `wire.ts` 负责四种真实响应的读取器，把十进制字符串解析为数字，把明确的零保留为数据，缺失字段保持为空。`resolveExpediente` 分页读取 `expediente_listar`，并按 `proforma_codigos` 或 `oc_codigos` 匹配；`expediente_buscar` 只作为存在性探测。`expediente_lineas` 从工具联合类型中移除，而不是留下一个无法成功的调用。

## 备选方案

- 保留按行价格验证并让它失败关闭。它永远无法通过，会在不说明原因的情况下永久阻断试点。
- 先向 MWT 索要卷宗 id，在此之前不交付任何东西。方向正确，但会让适配器在此期间无法对实机服务验证。
- 未经签署就把 `proforma.quantity` 改为确认类。很快，但会批准没人验证过的数量。

## 后果

- 适配器现在与实机数据源一致，配置行仍默认关闭（`FABERLOOM_CHECKS_MWT=1` 启用）。
- 启用后仍会阻断所有基于 MWT 的形式发票批准，因为 `proforma.quantity` 是阻断性的，且没有读取会返回卷宗 id。这是数据源限制，记录在两个包的 README 中，而不是验证的缺陷。
- 按行的加价，即 D-01 的 `unit_price_client - unit_price_mwt`，在 MWT 提供卷宗 id 或行读取之前仍不可达。把 `quantity` 从阻断改为确认属于 D-8 修订，需要业务签署，而不是代码默认值。
- `catalogPrice` 与 `priceBand` 已修正，但在出现行数据源之前没有验证消费者。

## 验证

`packages/faberloom/checks-mwt/tests/fixtures/mwt-answers.json` 保存了捕获响应的脱敏副本。测试证明：总额不同时阻断失败、总额相等时通过、引用无法解析时失败、行内缺少 `total_mwt` 时失败、十进制库存正确求和、目录价为零仍是数据。`npx vitest run packages/faberloom/checks-mwt/tests packages/faberloom/board/tests` 全绿，`npx tsc -p tsconfig.host.json --noEmit` 无输出。
