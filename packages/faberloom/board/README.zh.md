---
description: "原生产品工作台（ctx.faberloomBoard）：带版本化修订、需证据的提交、绑定精确版本的批准、重新校验与需授权效应的工单。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-board

[English](README.md) | 中文

## 概述

此包承载工作台：带版本化修订的准备结果与例外，批准绑定到精确版本，变更后需重新校验，效应需要显式授权。它注册 `ctx.faberloomBoard` 主机服务；模型工具位于 `dsh-tool-faberloom`。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在组合中挂载此行即可暴露 `ctx.faberloomBoard`。该服务是调用插件 fiber 上的副作用，释放该 fiber 即移除。

### 读取与隔离

`get(actor, id)` 与 `list(actor, filter)` 都要求 `BoardActor`，不存在无过滤的列举。只有所有者能读取，且当条目带有 `companyId` 时，actor 必须携带相同的公司；没有公司的 actor 只能读取没有公司的条目。`companyId: null` 表示单租户部署，而不是通配符。MCP 令牌携带公司，view 传递部署解析出的 actor，因此浏览器、API 与外部智能体共用同一条读写规则。

### WorkLoom 命令

`submit(writer, request)` 要求 `runId`、`idempotencyKey` 与 `businessKey`；重复的幂等键返回现有条目。条目携带持久化的 `state`（`PENDIENTE_CRITERIO`、`APROBADO`、`DESCARTADO`、`DESCONOCIDO` 等）、派生的 `column`、带来源与置信度的 `severity`、`rowVersion`、`artifactHash`、`events[]` 与 `pendingCandidate`。

`create` 与 `submit` 以 `CROSS_TENANT_REFERENCE` 拒绝属于其他租户的被引用对象。`spaceId` 通过已挂载的 `faberloomSpaces` 服务解析，由它持有空间租户；`runId`、`executionId` 与 `accountRef` 是不透明引用，因此第一个存储它的条目会记录可复用它的租户（`references` 表）。无法校验的引用一律拒绝，不予存储。

`runId` 与 `businessKey` 在写入条目记录之前先认领到 `keys` 表；记录写入失败时释放认领，因此崩溃只会留下没有条目的键，而不会留下两个同键的活跃条目。唯一性按租户计算：同一公司内另一个所有者的活跃条目持有该键时返回 `DUPLICATE`。

对话提示不是条目。条目是运行准备的结果，或带 PF/OC/SAP、账户与证据的具体缺数据任务；`artifactType` 区分 `proforma` 与 `tarea`。`submit` 接受 `accountRef`、`valueAmount`、`valueCurrency`、`dueAt`、`dataClass`、`severity` 与 `severityConfidence`，让工作台一次写入就能显示金额、期限与分类。

`list` 返回规范队列顺序：优先级等级降序，未分类或无空间的条目排在所有 `CRITICAL` 之前，其后依次是到期日、USD 金额、创建时刻与 id。严重程度与数据分类来自 `classify.ts`：先跑确定性规则，规则无法判定的产物保持未分类，而不是猜测。临时分类的条目不开放任何字段，因此在分类前既不建立索引，也不发送给供应商。

命令通过一次 `KvTable.update` 变换修改，因此状态变更与审计事件在同一条记录中提交：

- `setSeverity(writer, id, severity, source, confidence, expectedRowVersion?)`
- `saveEdits(writer, id, { expectedRowVersion, baseVersion, changes })`
- `approve(writer, id, { expectedRowVersion, expectedArtifactVersion, expectedArtifactHash })`
- `approveWithEdits(writer, id, approval + edits)`
- `discard(writer, id, { expectedRowVersion, reason, note? })`
- `resolveCandidate(writer, id, candidateId, candidateHash, 'adopt' | 'keep')`
- `assignWorkspace(writer, id, workspaceId)`
- `events(actor, id)`

`approve` 要求已确认严重性，并拒绝待处理候选、过期条目或与当前不一致的版本/哈希。试点中批准绝不发送外部效果。`saveEdits` 与 `discard` 拒绝处于 `ITERANDO` 或已关闭的条目，`discard` 还拒绝 `DESCONOCIDO`；面板隐藏这些控件，而由服务对 MCP 与智能体调用者强制实施。旧的 `review`、`submitRevision`、`reopen`、`requestData`、`fail` 与 `complete` 仍作为现有面板的别名保留；`review` 批准时必须提供产物哈希，因此调用者批准的正是它看到的内容，`fail(writer, id, 'DESCONOCIDO')` 记录未确认的效应。

`assignWorkspace` 保留条目的业务键，要求目标空间位于 actor 的租户内（`NO_ACCESS`）且服务于条目的账户（`ACCOUNT_MISMATCH`），并返回活跃条目。与另一个同键活跃条目冲突时，可替代的对等条目被关闭；对 `ITERANDO`、`EJECUCION_PENDIENTE` 或 `DESCONOCIDO` 的对等条目则把产物作为候选转移过去，并打开该条目。

-----

<a id="model-experience"></a>
## 模型体验

### 服务注册

#### 模型看到的内容

没有。`ctx.faberloomBoard` 是主机服务：不注册工具、不注入提示文本，也不写入会话事件。

#### Token 影响

每次请求直接消耗为零。

#### KV 缓存影响

与实时请求无关：该注册从不触碰请求前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限所有者审阅** — 变更需要工单所有者；基于成员的审阅需要访问层。
- **单写入者唯一性** — `idempotency_key` 与 `business_key` 的认领在单个进程内串行化。若部署有多个产品写入者，需要真正的唯一约束或租约；项目的 ADR-001 记录了该决定与重新评估的触发条件。
- **精简的引用登记** — 本包不持有运行、执行或账户登记，因此不透明引用的租户由第一个存储它的条目确定。从第二次使用起，其他租户会被拒绝；首次使用被信任，而所有者服务缺失的引用一律拒绝。
- **不透明文档** — 文档以引用表示；二进制文档随 blob 存储加入。

未发布 invariant companion，因为该服务不暴露其单元测试尚未断言的独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
