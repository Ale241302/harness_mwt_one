# Agent Note: The Mesa price control compares every order line

Status: implemented

[English](2026-10-28-mesa-per-line-price-checks.md) | 中文

> 取代[真实响应形态端口](2026-10-28-mesa-check-source-real-shapes.zh.md)中按订单总额比较价格的做法；该记录的来源端口与“行不可达”结论仅对其点名的读取仍然成立。

## 问题

D-01 按行签署一个加价：`sobreprecio = unit_price_client - unit_price_mwt`。适配器发布时改为比较计费总额与 expediente 的 `total_client`，因为 `expediente_lineas` 看起来需要一个没有任何读取会返回的 expediente id（`.artifacts/mwt-shapes.md` §3）。

对 `mwt-one 1.30.0` 的实机探测显示，该工具直接接受 proforma 或采购订单引用，每行回答一个文本块。`PF 2521-2026` 返回 36 个块、7 个 SKU，每个块携带 `sku`、`size`、`qty`、`unit_price_mwt`、`unit_price_client` 与 `total_price`。因此订单总额比较会在“一行多加、另一行等额少加”时通过，而阻断性的 `proforma.quantity` 控制此前完全没有行来源。

## 决定

**`orderLines(reference)` 就是行读取，并且直接发送引用。** `MwtToolCall` 增加 `expediente_lineas`；`MwtCheckClient` 增加 `orderLines(reference)`，发送 `{ expediente_id: reference }`，并读取四种答案形态：每行一个文本块（已部署服务器发出的形式）、一个块内含列表、一个块内含 `{ results }` 分页，以及单个行对象。不是 JSON 的块，或缺少 SKU 或可读 `qty` 的行，会让整份答案不可用：只比较恰好能解析的行，等于给部分订单定价。答案省略的价格侧保持 null。

**`proforma.price` 逐条计费行检查。** 对每一条行，取同一 SKU 的订单行，要求 `unitPrice - unit_price_mwt` 以分精度等于 `unit_price_client - unit_price_mwt`。订单没有的计费行、缺少 `unit_price_mwt` 或 `unit_price_client` 的行，以及没有价格的草稿行，都阻断失败。订单总额保留为第二个独立断言：expediente 给出两侧时，计费总额必须等于 `total_client`；两侧都没有时，按行读取为准。

**`proforma.quantity` 先求和再比较。** 订单的 `qty` 按 SKU 与尺码求和，再与草稿为该 SKU 计费的数量比较。只有一侧携带的 SKU 以 `ORDER_LINE_MISSING` 失败；总数不同以 `QUANTITY_MISMATCH` 失败。工件不带尺码，因此比较止于 SKU 合计，而不是发明一个尺码维度。

**该行默认挂载。** `cordis.patch.yml` 不带任何环境开关挂载 `faberloom-checks-mwt`，并保留 `serverName: mwt`；离线部署用 `FABERLOOM_CHECKS_MWT=0` 把它取下。需要手动打开的随包行正是那个阻断缺口：从未设置该标志的部署会一直以 `CHECK_UNAVAILABLE` 拒绝每一份 proforma。

## 备选方案

**保留订单总额比较。** 它只需一次读取、不需要处理容器，而且在总额相等时已经能通过。它落选是因为 D-01 签署的是按行差额：两条相互抵消的行能通过订单总额却违反 D-01，而控制会宣称该订单已验证。

**在工件里按 SKU 与尺码比较数量。** 订单声明尺码，按尺码比较本来最精确。它落选是因为工件只有 `sku`、`quantity` 与 `unitPrice`；读取草稿从不写入的尺码，等于与一个虚构字段比较。该行改为汇总订单行，并把这一限制写进文档。

**让配置行保持手动开启。** 保留 `FABERLOOM_CHECKS_MWT=1` 可以避免在没有 `mwt` 服务器的部署上挂载控制。它落选是因为该行现在已在实机上得到验证，而手动开启会让每份随包 proforma 默认被阻断。显式退出让例外有名字，而不是成为默认。

## 后果

- MWT 背书的 proforma 现在能在真实数据上通过全部阻断控制：`PF 2521-2026` 返回 36 行，每行加价 `0.00`，`proforma.price` 通过，`proforma.quantity` 通过。
- 控制证明的是 D-01 的加价一侧，而不是 `precio_lista + sobreprecio`：没有任何读取返回目录价，因此 `unit_price_client` 代替 `lista + sobreprecio`。
- 草稿把同一 SKU 的两个尺码写成两行时，只按 SKU 合计校验，因为工件没有可比较的尺码维度。
- 服务器回答被截断或不可读的行读取时，控制失败，而不是用能解析的行通过。
- 只列可用量的库存查询在没有匹配时不返回任何内容块；该行将其读作零可用量，因此 `proforma.stock` 报告 `STOCK_INSUFFICIENT` 并保持其确认类别，而不是作为故障失败。
- `expediente_lineas` 是唯一能解析引用的行读取：`expediente_obtener` 不携带 `lineas`，而 `expediente_edit_full_get` 对 proforma 代码返回 500 校验错误。
- `catalogPrice` 与 `priceBand` 仍没有控制消费方。

## 验证

`packages/faberloom/checks-mwt/tests/fixtures/mwt-answers.json` 保存脱敏后的行答案。测试证明：加价一致的按行比较通过、加价不同阻断失败、缺少 `unit_price_mwt` 失败、订单缺少计费行失败、数量相等通过、数量不同失败、订单行按 SKU 与尺码求和，以及单个对象、`results` 分页、单块列表和每行一块给出相同答案。`packages/faberloom/checks-mwt/tests/profile-row.spec.ts` 读取随包 patch，证明该行在无环境变量时挂载，且只有 `FABERLOOM_CHECKS_MWT=0` 会关闭它。`.artifacts/mwt-check-live.ts` 用真实 MCP 驱动 `mcpMwtCheckClient` 与看板自身的注册，覆盖 `PF 2521-2026`。`npx tsc -b packages/faberloom/checks-mwt/tsconfig.json`、`npx tsc -p tsconfig.host.json --noEmit`、`npx oxlint`、`npx vitest run packages/faberloom/checks-mwt/tests packages/faberloom/board/tests` 与 `npx tsx scripts/verify-cordis-config.ts` 均为绿色。
