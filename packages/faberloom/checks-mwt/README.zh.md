---
description: "原生产品 proforma 校验（基于 MWT.ONE）：用 MWT MCP 读取填充看板的六项 D-8 控制，从 ctx.effect 挂载。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-checks-mwt

[English](README.md) | 中文

## 概述

看板声明了六项 proforma 控制，并且在适配器注册它们之前以 `CHECK_UNAVAILABLE` 拒绝每一次 proforma 批准。本包就是面向 MWT.ONE 的适配器：它用 MWT MCP 的读取填充看板的 `BoardCheckSource`，并从 `ctx.effect` 挂载注册，因此释放该行的 fiber 会移除全部六项控制。控制的实现、id 与类别留在 `dsh-faberloom-board`；本包从不复述它们。

响应字段取自实时服务器（`mwt-one 1.30.0`，`.artifacts/mwt-shapes.md`）的记录；`tests/fixtures/` 下的 fixture 是这些答案的脱敏副本。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发者说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把该行挂在看板与 MWT MCP 服务器旁边。它随 bundle 默认挂载；没有 `mwt` 服务器的部署用 `FABERLOOM_CHECKS_MWT=0` 把它取下。

```yaml
- id: faberloom-checks-mwt
  name: '@deepseek-ai/dsh-faberloom-checks-mwt'
  config:
    serverName: mwt
    toolTimeoutMs: 15000
```

`serverName` 是 MCP 服务器的本地名称，因此该行调用 `mcp__<serverName>__<tool>`。其端点与凭证属于 MCP 注册表行，不在这里。`toolTimeoutMs` 限定每次工具调用；超时的调用会被中止，控制判定为失败而不是继续等待。

### 读取

`MwtCheckClient` 是校验逻辑与传输之间的窄端口：六个方法，每个返回事实或抛错，因此 MCP 的词汇不会进入控制逻辑。

| 读取 | MWT.ONE 工具 | 返回 |
|---|---|---|
| `expediente(reference)` | `expediente_buscar` 作为存在性探测，`expediente_listar` 分页匹配 | `total_client`、`total_mwt`、`moneda`、`client_name`、`credit_days_cliente`、`credit_band` |
| `orderLines(reference)` | `expediente_lineas` | 每个 SKU 与尺码一行：`sku`、`size`、`qty`、`unit_price_mwt`、`unit_price_client`；答案省略的价格侧保持 null |
| `skuExists(sku)` | `producto_buscar` | 仅当目录 SKU 精确匹配时为 true |
| `stockAvailable(sku)` | `producto_buscar`、`stock_listar` | 在答案携带的记录上求和 `cantidad_disponible`；十进制字符串按其数值读取，没有记录的答案表示零可用量 |
| `priceBand(sku)` | `producto_precio_cliente` | `banda_vigente.id` 与 `plazo_dias` |
| `catalogPrice(sku)` | `producto_buscar` | `precio_venta`；零是已声明的价格，不是缺失 |

`expediente(reference)` 从不请求 UUID：没有任何读取返回 expediente id。搜索工具只证明引用存在，因此该行通过分页 `expediente_listar` 并匹配 `proforma_codigos` 与 `oc_codigos` 来找到。两行命名同一引用时保持未解析，而不是任选一行；不可读的分页同样如此。

`orderLines(reference)` 直接发送引用：服务器把 proforma、采购订单、SAP 或 `EXP-` 代码解析成内部 id，因此调用方不需要 UUID。`mwt-one 1.30.0` 每行回答一个文本块，共用的 JSON 读取器会把它们拼成多个文档；`lineRecords` 读取这种形式，也读取列表、`{ results }` 分页和单个行对象，因为不同部署可能给出这四种中的任意一种。不是 JSON 的块，或缺少 SKU 或可读 `qty` 的行，会让整份答案不可用，而不是把订单悄悄变短。

`mcpMwtCheckClient(call)` 在一次工具调用之上实现该端口，而该行在既有的工具接缝上构造这次调用：`ctx.tools.execute({ name: 'mcp__mwt__<tool>' })`。这里没有 JSON-RPC 客户端，也没有硬编码的端点、凭证或租户 id。

当载荷不携带某项数据时，读取返回 `null`。它绝不返回 0、默认价格带或替代价格：这正是 D-01 的阻断失败与 D-02 的必须确认得以诚实的原因。作为数据而非默认值的例外是明确写出的零（`precio_venta: 0`，或一条声明可用量为零的库存记录）。

### 注册

`registerProformaChecks(board, client)` 通过看板自身的 `registerProformaChecks` 注册六项控制，因此类别就是 D-8 签署的那些，不可能出现不一致。

| 控制 | 类别 | 该行报告的来源 |
|---|---|---|
| `proforma.price` | bloqueante | `mwt.order`：每条计费行的加价（`unitPrice - unit_price_mwt`）以分精度等于订单的加价（`unit_price_client - unit_price_mwt`）；当 expediente 同时给出订单总额两侧时，另有 `mwt.price`，其必须与计费总额一致 |
| `proforma.sku` | bloqueante | `mwt.catalog`；未知 SKU 即失败 |
| `proforma.quantity` | bloqueante | `mwt.order`：订单的 `qty` 按 SKU 与尺码求和后，等于草稿为该 SKU 计费的数量 |
| `proforma.total` | bloqueante | 只读工件，不读来源 |
| `proforma.stock` | confirmacion | `mwt.stock`；缺库存要求显式确认 |
| `proforma.separation` | confirmacion | `mwt.separation`；没有 MWT 读取能给出拆分规则，因此始终要求确认 |

客户端抛出的错误会以 `SOURCE_UNAVAILABLE` 到达看板：来源故障是失败的控制，绝不是被跳过的控制（ADR-003）。

-----

<a id="model-experience"></a>
## 模型体验

### 注册的控制

#### 模型看到什么

什么都没有。该行注册确定性的看板控制，不注册提示词、schema 或工具结果。失败的控制只通过看板自身的批准拒绝到达模型，由 `faberloom_board` 工具报告。

#### Token 影响

每个请求零直接 token：该行不添加任何模型可见文本。

#### KV Cache 影响

与实时请求无关：注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **工件不带尺码，因此数量按 SKU 比较** — 订单每个 SKU 与尺码一行，该行把它们汇总成草稿所计费的 SKU 合计。把同一 SKU 的两个尺码作为两行计费的草稿，在 SKU 合计正确时通过，因为工件没有可比较的尺码维度。
- **按行价格比较的是加价，不是目录价** — D-01 写的是 `price = lista + sobreprecio`，但 `producto_precio_cliente` 既不返回目录价也不返回客户价（无客户时 `clientes` 为空），因此该行证明的是加价一侧：通过 `unitPrice - unit_price_mwt = unit_price_client - unit_price_mwt`，计费单价必须等于订单的 `unit_price_client`。订单没有的行，或缺少 `unit_price_mwt` 或 `unit_price_client` 的行，都阻断失败。
- **`expediente_lineas` 是唯一能解析引用的行读取** — `expediente_obtener` 不返回 `lineas`，而 `expediente_edit_full_get` 对 proforma 代码返回 500 校验错误，因此两者都需要服务器从不返回的内部 UUID。
- **`catalogPrice` 与 `priceBand` 没有控制消费方** — 它们暴露目录为某 SKU 声明的内容（`precio_venta`、`banda_vigente.id`、`plazo_dias`），留给需要目录价的价格规则。当前没有任何控制读取它们。
- **没有可调用的价格历史读取** — D-01 提到 `historial_precios_*`，但 `skills-catalog` 中的 `historial-precios` 模块没有记录任何直接的 MCP 工具，因此只读取当前目录价。
- **`separation` 没有 MWT 来源** — 没有任何 MWT.ONE 读取说明账户需要补充函还是新 proforma。控制报告无记录，`confirmacion` 类别要求显式确认；它绝不会静默通过。
- **存在性探测按代码前缀选择参数** — 以 `PF` 开头的引用作为 `proforma` 发送；其他引用去掉 `PO`/`OC` 前缀后作为 `oc_number` 发送。服务器拒绝该参数会让引用未解析，从而使阻断控制失败，而不是通过。
- **只有 proforma 或采购订单代码会被解析** — `expediente_buscar` 会列出 SAP 代码，但适配器不搜索它们；SAP 引用以缺少来源数据失败。
- **只读一页库存** — `stock_listar` 以 `limit: 200` 只读一次；记录数超过一页的 SKU 会被少算。分页等待真实案例。
- **库存在身份可列出的所有节点上求和** — 未配置节点过滤，因为 D-02 没有指定节点，而按部署选择节点没有已签署的决定。
- **空的库存答案表示零** — 只列可用量的 `stock_listar` 查询在没有匹配时不返回任何内容块，该行将其读作零可用量；随后需要确认的控制报告 `STOCK_INSUFFICIENT`，而不是来源故障。
- **列表分页在短页或报告的总数处结束** — 两者都不报告的分页只读一次，其后的引用保持未解析（阻断失败，绝不是通过）。

不发布 invariant 伴随包，因为本包只注册看板控制，不暴露其规格尚未断言的独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

该行依赖 `tools`，因此 MWT 服务器必须在适配器注册之前挂载。MCP 注册表在启动时挂载已启用的服务器，而 loader 会解析两个注入，因此只写该行而不写服务器的组合永远不会应用它。响应字段名只出现在 `wire.ts` 与 `client.ts` 中；扩大获准的读取集合意味着向 `MwtToolName` 增加工具名并向 `MwtCheckClient` 增加方法，而不是伸手进入看板。

</details>
