---
description: "产品原生的自治能力（ctx.faberloomAutonomy）：每个（租户、空间、代理、动作类型）单元的 SHADOW、SUPERVISADO、DELEGADO 级别，其 §7.2 晋升报告，被委派条目的抽样复核，以及 §7.3 的自动暂停。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-autonomy

[English](README.md) | 中文

## Summary

本包承载每个单元 `(tenant, space, agent, actionType)` 的自治级别，以及推动级别变化的两条规则：§7.2 的晋升规则和带 D-13 取值的 §7.3 监控规则。它注册 `ctx.faberloomAutonomy` 宿主服务，通过以 `faberloomAutonomyOutcomes` 提供的窄端口读取已关闭条目，并且不导入 board 的任何内容。

## Table of Contents

- [Use this package](#use-this-package)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

在组合中挂载这一行，并与回答结果端口的适配器相邻，即可暴露 `ctx.faberloomAutonomy`。该服务是调用插件光纤上的 effect，因此销毁该光纤即移除它。

### Unit and level

单元是 `(tenantId, spaceId, agentId, actionType)`；`spaceId` 是规范中的 workspace。`autonomyUnitId(ref)` 返回其存储键，因此面板与 board 适配器指向同一条记录。每个单元一条持久记录，持有级别、生效中的晋升和最后一次自动暂停：

| Level | Meaning |
|---|---|
| `SHADOW` | 代理产出；没有条目以其权限执行 |
| `SUPERVISADO` | 每个条目由人决定，即 §7.1 的第 1–3 阶段 |
| `DELEGADO` | 单元在其回溯窗口内自主执行 |

`ensureUnit(actor, ref)` 以 `SHADOW` 注册单元；`getUnit`、`listUnits`、`report` 和 `listAudit` 是面板与 board 适配器的读取入口。每次读取都限定租户：其他租户的引用以 `TENANT_MISMATCH` 拒绝，列表永不含其他租户的单元。

### Evaluation and the outcome port

`report(actor, ref, { period? })` 通过 `AutonomyOutcomePort` 读取单元的已关闭条目，并分别报告各项数值：

| Number | Denominator |
|---|---|
| Real runs | 由人决定关闭的条目：`approved`、`approved-with-intervention`、`discarded` |
| Approved without intervention | 无编辑、无迭代、无疑问答复即通过的实跑（W-80） |
| Approval share | 实跑 |
| Reversal and failure rate | 最近 20 次委派，排除技术失败 |
| Technical failures | 单独计数；排除在所有分母之外（§7.2） |

没有 `reason` 的 `technical-failure` 结果会被拒绝（`TECHNICAL_FAILURE_REASON_REQUIRED`）：§7.2 只有在记录原因时才排除这些条目。未挂载端口时，服务以 `OUTCOME_SOURCE_UNAVAILABLE` 拒绝，而不是报告空历史。

### Promotion

`promote(actor, ref)` 是通往 `DELEGADO` 的唯一路径。它要求调用者持有该租户的治理角色，且单元满足已签字的阈值：10 次实跑、通过份额至少 0.70，以及配置了统计最小值时的该最小值。晋升记录由谁晋升、何时晋升、依据哪些数值，并追加一条 `promoted` 审计。

不存在自动晋升。`report` 说明单元是否达到阈值，列出仍未签字的取值，并在每次调用中报告 `automaticPromotion: 'DISABLED'`（W-53）。本包中没有任何东西会自行晋升单元。

### Monitoring and suspension

`assess(actor, ref)` 对已委派单元应用 §7.3 规则：当最近 20 次委派的回溯或失败率超过 10 % 时，把单元退回 `SUPERVISADO`，并追加一条带原因、窗口和比率的 `suspended` 记录。该决定无需人工命令；记录委派结果的调用方在其后调用 `assess`。

技术失败位于窗口之外，因此委派在技术上失败的单元保持其级别。`supervise(actor, ref, cause)` 是人工收窄命令，`reviewSample` 在被抽样的条目被拒绝时当场暂停。

重新激活是一次新的 `promote`：它再次需要 §7.2 的阈值和 W-64 的治理关卡。晋升会清空暂停字段；审计保留每一次暂停。

### Sample of delegated items

`planSample(actor, ref, period)` 选取该周期被委派条目的 10 %，至少一条，取自尚未进入样本的最早委派（D-13）。`planSample` 只做选取：执行从不等待复核。`reviewSample(actor, ref, { period, itemId, verdict, note? })` 记录一次人工判定，拒绝会暂停已委派单元；只有治理角色可以记录它。

样本量为 `max(sampleMinimum, ceil(sampleFraction × delegations))`；周期由调用方给出，以 `AutonomyPeriod.label` 或其边界标识。

### Configuration

每个字段都会校验。§7.2 与 D-13 的已记录取值为默认值；两个尚无业务签字的取值在这里没有值：

| Field | Default | Source |
|---|---|---|
| `minimumRealRuns` | `10` | §7.2 |
| `minimumApprovalShare` | `0.70` | §7.2 |
| `statisticalMinimum` | `null`（未签字） | §7.2、W-53 |
| `period` | `null`（未签字） | §7.2 |
| `sampleFraction` | `0.10` | D-13 |
| `sampleMinimum` | `1` | D-13 |
| `sampleRejectionsToSuspend` | `1` | D-13 |
| `monitoringWindow` | `20` | D-13 |
| `suspensionRate` | `0.10` | D-13 |
| `governanceRoles` | `['owner', 'admin']` | §7.2 关卡 |

`statisticalMinimum` 与 `period` 为 `null`，因为业务尚未签字：报告把它们命名为未签字，服务不提供替代值。没有周期时，评估覆盖端口为该单元报告的全部结果。

-----

<a id="model-experience"></a>
## Model Experience

### Service registration

#### What the model sees

无。`ctx.faberloomAutonomy` 是宿主侧服务：它不注册工具、不注入提示文本，也不写会话事件。

#### Token effect

每次请求零直接 token。

#### KV Cache effect

与实时请求无关：该注册从不触碰请求前缀。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **结果端口在本包中没有提供者** — `faberloomAutonomyOutcomes` 由 board 适配器提供，它从工作表中读取条目、批准、回溯和失败。在该行存在之前，`report`、`promote`、`assess` 和 `planSample` 以 `OUTCOME_SOURCE_UNAVAILABLE` 拒绝。
- **周期与统计最小值未签字** — `statisticalMinimum` 和 `period` 默认 `null`，并在 `unsignedValues` 中报告（§7.2、W-53）。部署在其行中签字；本包既不臆造取值也不臆造队列。
- **不存在自动晋升** — 没有操作会在没有 Owner 或 Admin 命令时晋升，也没有定时器或监听器调用 `promote`。可以在不授予任何单元自治的前提下启用该行。
- **监控由调用方驱动** — `assess` 应用规则，但没有调度它。board 适配器或例程在记录委派结果后调用它。
- **抽样按调用方声明的周期进行** — 周期标签、其边界以及 `planSample` 的运行频率由部署决定；样本从不跨越两个标签。
- **抽样不阻塞执行** — 本包只记录复核队列；暂停或保留被委派条目不属其契约。
- **人工监督不保留数值** — `supervise` 审计原因；只有自动暂停携带其判定依据的数值。

本包不发布 invariant 伴随模块，因为该服务未暴露其单元测试尚未断言的独立观测。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
