---
description: "原生自主性（ctx.faberloomAutonomy）：每个 (tenant, space, agent, actionType) 单元的 SHADOW、SUPERVISADO 与 DELEGADO 级别，其 §7.2 晋升报告、委派条目的抽样复核，以及 §7.3 的自动暂停。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-autonomy

[English](README.md) | 中文

## 概述

本包保存每个单元 `(tenant, space, agent, actionType)` 的自主级别，以及推动它的两条规则：§7.2 的晋升规则与 §7.3 的监控规则（D-13 的取值）。它注册 `ctx.faberloomAutonomy` 宿主服务，通过以 `faberloomAutonomyOutcomes` 提供的窄端口读取已关闭条目，并且不从看板导入任何内容。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本行挂载在组合中、紧邻提供结果端口的适配器，以暴露 `ctx.faberloomAutonomy`。服务是调用插件 fiber 上的 effect，因此释放该 fiber 会移除它。

### 单元与级别

单元是 `(tenantId, spaceId, agentId, actionType)`；`spaceId` 是规范的 workspace。`autonomyUnitId(ref)` 返回其存储键，因此面板与看板适配器指向同一条记录。每个单元一条持久记录，保存级别、生效中的晋升与最近一次自动暂停：

| 级别 | 含义 |
|---|---|
| `SHADOW` | 代理产出；没有条目在其授权下执行 |
| `SUPERVISADO` | 人类决定每个条目，即 §7.1 阶段 1–3 |
| `DELEGADO` | 单元在其回退窗口内自行执行 |

`ensureUnit(actor, ref)` 以 `SHADOW` 注册单元；`getUnit`、`listUnits`、`report` 与 `listAudit` 是面板与看板适配器使用的读取。每次读取都按租户限定：另一个租户的引用以 `TENANT_MISMATCH` 拒绝，列表永不包含另一个租户的单元。

### 评估与结果端口

`report(actor, ref, { period? })` 通过 `AutonomyOutcomePort` 读取该单元的已关闭条目，并分别报告这些数字：

| 数字 | 分母 |
|---|---|
| 真实运行 | 由人类决定关闭的条目：`approved`、`approved-with-intervention`、`discarded` |
| 无干预批准 | 未经编辑、迭代或回答疑问即批准的运行（W-80） |
| 批准占比 | 真实运行 |
| 回退与失败率 | 最近 20 次委派，排除技术故障 |
| 技术故障 | 单独计数；从每个分母中排除（§7.2） |

没有 `reason` 的 `technical-failure` 结果会被拒绝（`TECHNICAL_FAILURE_REASON_REQUIRED`）：§7.2 只在原因被记录时才排除这些条目。没有挂载端口时，服务以 `OUTCOME_SOURCE_UNAVAILABLE` 拒绝，而不是报告空历史。

### 晋升

`promote(actor, ref)` 是通往 `DELEGADO` 的唯一路径。它要求租户的治理角色，以及满足已签署阈值的单元：10 次真实运行、批准占比至少 0.70，并在配置了统计最小值时满足它。晋升记录由谁、何时、依据哪些数字做出，并追加 `promoted` 审计条目。

不存在自动晋升。`report` 说明单元是否满足阈值、列出仍未签署的值，并在每次调用时报告 `automaticPromotion: 'DISABLED'`（W-53）。本包中没有任何东西会自行晋升单元。

### 监控与暂停

`assess(actor, ref)` 对已委派单元应用 §7.3：当最近 20 次委派的回退或失败率超过 10 % 时，它把单元退回 `SUPERVISADO`，并追加带有原因、窗口与比率的 `suspended` 条目。该决定不需要人类命令；记录委派结果的调用方在其后调用 `assess`。

技术故障位于窗口之外，因此委派发生技术故障的单元保持其级别。`supervise(actor, ref, cause)` 是人类的收窄命令，`reviewSample` 会因被拒绝的抽样条目立即暂停。

重新激活是一次新的 `promote`：它再次需要 §7.2 的阈值与 W-64 的治理门禁。晋升清除暂停字段；审计保留每次暂停。

### 委派条目的抽样

`planSample(actor, ref, period)` 从尚未进入抽样的最早委派中选取该周期委派条目的 10 %，至少一个（D-13）。`planSample` 只做选取：执行从不等待复核。`reviewSample(actor, ref, { period, itemId, verdict, note? })` 记录一次人类判定，拒绝会暂停已委派单元；只有治理角色可以记录。

抽样量为 `max(sampleMinimum, ceil(sampleFraction × delegations))`；周期由调用方给出，并以 `AutonomyPeriod.label` 或其边界标注。

### 配置

每个字段都经过校验。§7.2 与 D-13 的书面取值为默认值，A-43 签署了两个曾开放的取值：

| 字段 | 默认值 | 来源 |
|---|---|---|
| `minimumRealRuns` | `10` | §7.2 |
| `minimumApprovalShare` | `0.70` | §7.2 |
| `statisticalMinimum` | `10` | §7.2、A-43 |
| `period` | `null`（未签署） | §7.2 |
| `periodDays` | `null`（未签署） | A-43 |
| `sampleFraction` | `0.10` | D-13 |
| `sampleMinimum` | `1` | D-13 |
| `sampleRejectionsToSuspend` | `1` | D-13 |
| `monitoringWindow` | `20` | D-13 |
| `suspensionRate` | `0.10` | D-13 |
| `governanceRoles` | `['owner', 'admin']` | §7.2 门禁 |

A-43 签署滚动评估窗口：部署设置 `periodDays`（试点使用 `30`），报告会命名该窗口，而不是让周期保持未签署。显式 `period` 优先于 `periodDays`；两者都没有的评估覆盖端口为该单元报告的全部结果，并把周期标注为未签署。晋升保持手动且带门禁，因此这里的默认值不会晋升任何单元（W-53）。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到什么

没有。`ctx.faberloomAutonomy` 是宿主侧服务：它不注册工具、不注入提示词文本，也不写会话事件。

#### Token 影响

每个请求零直接 token。

#### KV Cache 影响

与实时请求无关：注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **本包不提供结果端口的实现** — `faberloomAutonomyOutcomes` 由看板适配器提供，它从工作表中读取条目、批准、回退与失败。在该行存在之前，`report`、`promote`、`assess` 与 `planSample` 以 `OUTCOME_SOURCE_UNAVAILABLE` 拒绝。
- **评估窗口由部署声明** — `periodDays` 默认为 `null`，`statisticalMinimum` 默认为 `10`（A-43）。试点在其行中设置 `periodDays: 30`；两者都不设置的部署保持周期未签署，报告会说明这一点。本包既不发明周期，也不发明队列。
- **不存在自动晋升** — 没有操作会在没有 Owner 或 Admin 命令时晋升，也没有定时器或监听器调用 `promote`。该行可以在不授予任何单元自主性的情况下启用。
- **监控由调用方驱动** — `assess` 应用规则，但没有任何东西调度它。看板适配器或例程在记录委派结果后调用它。
- **抽样按调用方声明的周期** — 周期标签、其边界以及 `planSample` 的运行频率属于部署；抽样永不跨越两个标签。
- **抽样不阻塞执行** — 本包只记录复核队列；暂停或扣留已委派条目不属其契约。
- **人工监督不保留数字** — `supervise` 审计原因；只有自动暂停携带其判定所依据的数字。

本包不发布不变量伴随文件，因为该服务没有暴露其单元测试尚未断言的独立观察。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
