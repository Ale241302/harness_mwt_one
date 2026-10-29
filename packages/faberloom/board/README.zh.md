---
description: "原生产品工作台（ctx.faberloomBoard）：带版本化修订、需证据的提交、绑定精确版本的批准、重新校验与需授权效应的工单。"
kind: "package-reference"
---

# @deepseek-ai/dsh-faberloom-board

[English](README.md) | 中文

## 概述

此包承载工作台：带版本化修订的准备结果与例外，批准绑定到精确版本，变更后需重新校验，效应需要显式授权。它还按条目运行一次迭代尝试——锁、工作草稿，以及只给出建议的轮次计数器——并承载 E15 的外部效应机制：按租户的效果预留、带校验消费者的发件箱、回退窗口、对账，以及为崩溃的接受所遗留预留而设的恢复清扫。它注册 `ctx.faberloomBoard` 主机服务；模型工具位于 `dsh-tool-faberloom`。

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
- `approve(writer, id, { expectedRowVersion, expectedArtifactVersion, expectedArtifactHash, confirmations? })`
- `approveWithEdits(writer, id, approval + edits)`
- `discard(writer, id, { expectedRowVersion, reason, note? })`
- `resolveCandidate(writer, id, candidateId, candidateHash, 'adopt' | 'keep')`
- `assignWorkspace(writer, id, workspaceId)`
- `events(actor, id)`

`approve` 要求已确认严重性，并拒绝待处理候选、过期条目或与当前不一致的版本/哈希。试点中批准绝不发送外部效果。`saveEdits` 与 `discard` 拒绝处于 `ITERANDO` 或已关闭的条目，`discard` 还拒绝 `DESCONOCIDO`；面板隐藏这些控件，而由服务对 MCP 与智能体调用者强制实施。旧的 `review`、`submitRevision`、`reopen`、`requestData`、`fail` 与 `complete` 仍作为现有面板的别名保留；`review` 批准时必须提供产物哈希，因此调用者批准的正是它看到的内容，`fail(writer, id, 'DESCONOCIDO')` 记录未确认的效应。

`assignWorkspace(writer, id, workspaceId)` 保留条目的业务键，要求目标空间位于 actor 的租户内（`NO_ACCESS`）且服务于条目的账户（`ACCOUNT_MISMATCH`），并返回 `BoardAssignment`：活跃条目，以及冲突转移给它的草稿。与另一个同键活跃条目冲突时，可替代的对等条目被关闭；对 `ITERANDO`、`EJECUCION_PENDIENTE` 或 `DESCONOCIDO` 的对等条目则把产物作为候选转移过去，并打开该条目（W-87、W-88）。被关闭条目的草稿 —— 它链接的迭代草稿与它的行内编辑草稿 —— 转移到活跃条目，并标记写入时所依据的版本与指向其来源条目的 `transferredFrom`，因此面板可以把它们作为“在更早版本上完成的工作”提供出来（W-98）。`transferredDrafts(actor, id)` 列出它们；来源键无法归属到该条目的行、或目标键已被占用的行，保持原位而不是猜测。`recoverTransferredDraft` 把其中列出的一个草稿变为活跃尝试的草稿，因此接收条目可以继续该工作，而不只是比较它（W-98）。

### 校验（E12）

校验是一个端口：board 声明某种产物类型需要哪些控件并负责调用，实现位于包外（ADR-003）。

`registerCheck(artifactType, checkId, fn, { class, source })` 返回自己的释放器，因此适配器从 `ctx.effect` 挂载它，与 handlers 包挂载处理器的方式一致。`DECLARED_CHECKS` 持有控件 id 与 D-8 签署的类别；注册一个 board 未声明的 id 会以 `CHECK_UNKNOWN` 被拒，类别不一致会以 `CHECK_CLASS_MISMATCH` 被拒，因此拼写错误在加载时就失败，而不是悄悄永不执行。登记表默认为空：未声明任何控件的产物类型照旧可批准；一旦声明，只要有已声明的控件没有适配器，批准就以 `CHECK_UNAVAILABLE` 被拒。

`fn` 收到 `{ item, artifact, source }` —— 投影后的条目、待审的修订（`type`、`version`、`content`），以及注册时携带的来源端口 —— 返回 `{ status: 'ok' | 'warning' | 'fail', source, sourceVersion, checkedAt, fields }`，另可带稳定的 `reason`。抛出的校验（来源超时、适配器损坏、注册没有端口）一律报为 `SOURCE_UNAVAILABLE` 的 `fail`：来源不可用是一枚失败的控件，绝不是被跳过的控件。

`registerProformaChecks(board, source)` 注册 D-8 的六枚 proforma 控件并返回其释放器。适配器实现 `BoardCheckSource`；board 从不自行推导商务数值。无法回答的来源抛错，回答“没有记录”的来源返回 `value: null`。

| 控件 | 类别 | 读取内容 |
|---|---|---|
| `proforma.price` | bloqueante | 每条计费行的加价（计费单价减 `unit_price_mwt`）以分精度等于订单的 `unit_price_client - unit_price_mwt`；当订单给出两侧时，计费总额还等于 `total_client`（D-01）；缺少行、价格侧或引用即失败 |
| `proforma.sku` | bloqueante | 目录认识每一条计费 SKU |
| `proforma.quantity` | bloqueante | 计费数量等于 `orderRef` 所指采购订单，其行按 SKU 与尺码求和；只有一侧携带的 SKU 即失败 |
| `proforma.total` | bloqueante | 行合计等于计费总额（只读产物） |
| `proforma.stock` | confirmacion | 可用库存覆盖每条计费数量（D-02）；缺少库存数据需要确认 |
| `proforma.separation` | confirmacion | 草稿的 `separation` 模式与账户规则一致 |

`runChecks(actor, id)` 在当前修订上执行已声明的控件且不持久化任何结果，供面板的校验区读取。`approve` 与 `approveWithEdits` 在状态转换之前立即再跑同一条路径，不做缓存（W-49、W-50）；`approveWithEdits` 评估编辑后的内容，因为那才是被批准的版本。阻塞控件失败时以 `BLOCKING_CHECK` 拒绝批准；调用者未在 `confirmations` 中列出的、失败的需要确认控件以 `CHECK_CONFIRMATION_REQUIRED` 拒绝；批准事件记录每枚控件及其来源、版本、读取时刻，以及人工给出的确认。

### 字段来源（W-36）

每个修订携带自己的可编辑 `content`（proforma 为 `orderRef`、`lines`、`total`、`separation`），条目投影出 `fieldOrigins`：每个可编辑字段一条记录 —— 顶层键，加上对象值与数组元素的键，例如 `lines[0].unitPrice` —— 带运行声明的 `source`、`ref` 与读取时刻，或带 `{ source: null }` 表示该字段没有来源。`submit` 与 `submitRevision` 接受 `content` 与 `fieldOrigins`；`saveEdits` 与 `approveWithEdits` 重写内容，并丢弃被改动键之下的所有字段的来源，因为新值已不再来自原来的来源。

### 迭代（E14）

`iterate(writer, id, { baseVersion, actorSession })` 在调用者看到的版本上开启一次尝试。它要求 `PENDIENTE_CRITERIO` 与一个空间（`NO_SPACE`），生成新的 `iterationId`，递增 `iterationLockGeneration`，记录 `iterationBaseVersion`，按已解析的策略写入锁的到期时刻，并且不改变产物版本（W-31、W-11）。同一用户的两个标签页是两次不同的尝试：锁的主体是尝试而不是用户，`actorSession` 记录开启它的标签页。

`iterateWithEdits(writer, id, { expectedRowVersion, baseVersion, changes, actorSession })` 在同一次 `update` 中把编辑保存为下一个版本并在其上开启尝试，因此行、基础版本或状态冲突时不会创建版本、不会发生状态转换，调用者的编辑留在条目之外（W-69）。

锁保存在条目上：`iterationId`、`iterationLockGeneration`、`iterationBaseVersion`、`iterationLockUntil`、`iterationLockBy` 与 `iterationDraftKey`。`renewIteration(writer, id, { iterationId, generation, actorSession })` 延长到期时刻，并拒绝过期尝试。`iterationStatus(actor, id)` 报告阶段、锁、轮次与条目提供的草稿：已链接的那份，或条目不再链接的失效尝试所留下的保留草稿，并给出其尝试 id、基础版本、`archived`、`superseded` 与 `retained` 标记，以及说明属于哪一种的 `draftLinked`。已记录的到期时刻已过的 `ITERANDO` 记录报告 `expired`，并按 `PENDIENTE_CRITERIO` 读取，因此到期等价于“保存并退出”，且读取不会写入条目（W-44）。没有记录到期时刻的记录视为有效，因此本版本之前写入的行仍然拒绝编辑。

每次迭代写入都在 `actorSession` 中携带调用者的标签页会话，尝试的 `iterationLockBy` 是写入判定的一部分：读到有效 id 与代次的第二个标签页会在任何存储、写入或审计之前以 `LOCK_HELD` 被拒（§9.7.1）。`LOCK_LOST` 与 `ITERATION_STALE` 保持原有顺序与含义，因此过期的尝试 id 仍报告为过期，而不是报告为锁被他人持有。没有记录持有者的记录不匹配任何会话；它只能通过在其上开启新尝试才可写（W-44）。

`saveIterationDraft(writer, id, { iterationId, generation, actorSession, baseVersion, summary?, evidence?, content? })` 把尝试的工作以 `<itemId>:<iterationId>` 存入 `iteration_drafts` 表，与同一尝试先前的草稿合并，并从条目链接它。尝试已不再有效——已暂停、已到期、已取消或被另一个标签页替换——时，写入会作为该失效尝试的草稿保存，而条目完全不被写入（W-57）。来自另一个标签页会话的写入以 `LOCK_HELD` 被拒且不存储任何内容。

每次迭代写入都同时校验状态、`iterationId`、代次、标签页会话与基础版本，并以 `LOCK_LOST`、`ITERATION_STALE` 或 `LOCK_HELD` 无副作用地拒绝（W-43、W-57）。产物已越过其基础版本的尝试已过期，绝不会覆盖更新的内容。

`pauseIteration(writer, id, { iterationId, generation, actorSession, reason })` 覆盖保存并退出、带到 SpaceLoom、未解决返回与 `lock-vencido`：释放锁、使尝试 id 失效、把条目返回 `PENDIENTE_CRITERIO`、保留与其基础版本绑定的草稿，并保持任何待处理候选不变（W-67、W-97）。`cancelIteration` 删除草稿且不改变版本，除非通过它在有候选时接受的 adopt 选择（W-41）；调用者省略该选择时以 `CANDIDATE_PENDING` 拒绝。二者都要求持有者的会话，因此来自另一个标签页的暂停或取消会被拒绝；任一出口之后，任何会话都可以开启新尝试。

`resumeIteration(writer, id, { baseVersion, actorSession })` 在条目提供的草稿上开启新尝试，并把该会话记录为持有者：它链接的草稿，或条目从未链接的、由失效尝试留下的草稿，因此迟到的回答仍然可达，而不是被搁置（W-57）。草稿是针对更旧版本写入的时，它把草稿标记为已过期，返回 `status: 'outdated'` 与差异字段，且不覆盖任何内容（W-68）。被新尝试替换的草稿（`superseded`）与超出保留窗口的草稿不会被提供。开启尝试只写入状态与锁；草稿通过 `applyIteration` 才会到达产物。

`recoverTransferredDraft(writer, id, { draftKey, actorSession })` 把 `transferredDrafts` 列出的一个草稿变为活跃尝试的草稿（§2.3、W-98）。它拒绝未转移到本条目的键（`NO_DRAFT`）以及超出保留窗口的键（`DRAFT_EXPIRED`）。草稿的基础版本仍是当前版本时，它把该行移到新尝试的键下、清除 `transferredFrom` 使提示不再提供它、记录带有来源条目的 `iteration.recovered`，并开启尝试；基础版本不再是当前版本时，它把草稿标记为已过期、返回差异字段，且不写入条目。恢复从不应用工作：版本只能通过带作用域的 `applyIteration` 前进。

`applyIteration(writer, id, { iterationId, generation, actorSession, baseVersion, scope, summary?, evidence?, candidate? })` 依据草稿与调用者的覆盖写入下一个版本与哈希，把 `scope` 记录在审计事件中供学习侧使用，释放锁、删除草稿，并把条目返回 `PENDIENTE_CRITERIO`。待处理候选仍是条目的候选（W-40），必须在同一次调用中指定：`adopt` 使其成为生效版本，而且这是唯一的版本递增；`keep` 将其丢弃。只有当前尝试可以应用，且只能来自其持有者的会话（W-57）。

`iterationRoundCount` 保存在条目上。达到 `iterationRoundLimit` 后 `iterationStatus().suggestRewrite` 变为 true；没有任何操作被阻塞，因为 D-10 只是建议重写或丢弃。

| 配置字段 | 默认值 | 含义 |
|---|---|---|
| `iterationRenewalSeconds` | 30 | 客户端两次续期间隔的秒数（D-09） |
| `iterationLockSeconds` | 900 | 尝试在无活动情况下存活的秒数（D-09） |
| `iterationDraftRetentionDays` | 30 | 工作草稿保持可恢复的天数（D-09） |
| `iterationRoundLimit` | 5 | 出现建议前已应用的轮次（D-10） |

`iterationPolicy()` 返回解析后的值，因此面板按部署的数值调度，而不自带一份。

### 执行（E15）

`approveWithExecution(writer, id, input)` 批准精确的产物版本并为它接受一次执行：批准、效果预留与发件箱消息在同一条命令中获取，因此不存在已授权却没有发出意图的条目（§10.1）。它要求 `approve` 的全部前置条件，外加 `executionId`、`actionType`、`destination` 与显式 `authorization`；`idempotencyKey` 默认为 `effect:<effectKey>`。`actionType` 必须是部署接受的动作类型（`effectActionTypes`）；挂载了 `faberloomAccess` 服务时，接受会在获取任何内容之前向它索取 W-16 要求的 CEO 签名，并原样传播其拒绝。它返回条目、预留与消息。

`effect_key` 是签署的身份：`sha256(tenant_id + ":" + action_type + ":" + destination + ":" + business_key + ":" + artifact_hash)`。租户即条目的 `companyId`，从不省略，因此没有公司的部署使用保留字面量 `sin-empresa`。邮件目的地是一个地址列表——去空白、转小写、按逗号、分号或空白拆分、去重、排序——因此同样的收件人以另一种顺序或另一种分隔符产生相同的键；其他目的地按外部系统 id 原样保留。任何分量都不得包含 `:`，即公式用来连接分量的分隔符，因此两个元组绝不会共用一个键字符串（`EFFECT_COMPONENT_INVALID`）。导出 `effectKeyOf` 与 `normaliseDestination`，调用者据此算出 board 存储的同一个键。

预留存放在 `effect_reservations`，每租户每个 `effect_key` 一行（ADR-001：与 `keys`、`references` 相同的键认领表），状态为 `RESERVADA`、`DESPACHADA`、`CONCILIADA` 与 `LIBERADA`。同一键的竞争执行在预留在 `RESERVADA` 或 `DESPACHADA` 期间以 `EFFECT_TAKEN` 被拒，`admin_close` 之后亦然。所有者的重试保留同一行、同一 `executionId` 与同一幂等键；已释放或已对账的行释放该键。预留从不跨租户：行键携带租户，其他租户的消费者找不到任何消息。

动作类型有回退窗口时条目落在 `DELEGADO_EN_VENTANA`，没有时落在 `EJECUCION_PENDIENTE`；`reversalDeadline` 是效果可以离开的时刻。窗口内的 `revert(writer, id, { expectedRowVersion?, reason? })` 把条目返回 `PENDIENTE_CRITERIO`、释放预留并取消消息，因此不会发生效果（W-17、W-19）。到期或之后回退以 `WINDOW_EXPIRED` 被拒，没有记录到期时刻的委派条目以 `EFFECT_NO_DEADLINE` 被拒，而 `expireWindow(writer, id)` 是到 `EJECUCION_PENDIENTE` 的那一次转换：回退与到期在条目上串行化，因此恰好一个生效（W-18）。

`effect_outbox` 为每个效果保存一条消息，携带键与执行 id，状态为 `PENDIENTE`、`DESPACHADO`、`CONFIRMADO`、`FALLIDO` 或 `CANCELADO`；`CANCELADO` 的消息不可派发。`dispatchEffect(actor, effectKey)` 是消费者：在一个租户区内要求消息可派发、预留仍为 `RESERVADA` 且属于同一执行、条目仍授权该效果、控件仍然通过；否则不发出任何效果、释放预留并把消息标记为 `CANCELADO`（W-95、W-102）。它在 `reversalDeadline` 之前拒绝发出，并在到期时刻已过时自行提交窗口到期（W-19）。适配器是一个端口：`registerEffectAdapter(actionType, adapter)` 从 `ctx.effect` 挂载它，board 发送 `{ effectKey, executionId, itemId, actionType, destination, idempotencyKey, attempt }`；没有适配器的动作类型以 `EFFECT_NO_ADAPTER` 被拒，而消息保持 `PENDIENTE`。抛错、被中止的信号或配置的派发超时都记为 `DESCONOCIDO`：没有确认，条目绝不会是 `EJECUTADO`（W-22）。同一端口还带有可选的 `probe(dispatch, { signal })`，它询问目的地已发出的效果结果如何，而不会再次发出；其中的抛错、中止或派发超时同样记为 `DESCONOCIDO`。`pendingEffects(actor)` 列出该租户仍可发出的消息。

`reconcile(writer, id, { outcome, ref?, detail? })` 了结一个已派发的效果：`CONFIRMADO` 把条目关闭为 `EJECUTADO`，`FALLIDO` 带该结果移到 `ERROR_RECUPERABLE`，`DESCONOCIDO` 记录这次尝试并保留未知状态（W-21、W-76）。`probeEffect(writer, id, { expectedRowVersion? })` 询问目的地（§9.8），并通过同一条命令了结该回答，返回其后的效果投影：声明了 `probe` 的适配器回答 `CONFIRMADO`、`FALLIDO` 或 `DESCONOCIDO`；没有 `probe` 的适配器让该命令不写入任何内容，因此仍由操作者陈述结果，而投影报告 `adapter.probe: false`。`retry(writer, id)` 保留原始执行 id、预留与幂等键，并把条目返回 `EJECUCION_PENDIENTE`；结果为未知时以 `OUTCOME_UNKNOWN` 被拒，除非适配器声明目的地幂等（W-21、W-84）。结果未知期间 `submitRevision` 与 `discard` 仍被拒绝，新产物成为候选，因此效果保留其追踪链（W-76）。

`adminClose(writer, id, { reason, expectedRowVersion? })` 是对结果未知条目的行政关闭（D-9）：租户的所有者或管理员（`actor.role === 'admin'`）、必填理由，以及保持 `DESPACHADA` 并带 `closedAt`、`closedBy` 与 `closeReason` 的预留，因此对账仍然开放（W-65）。待处理候选变成一个新条目，以 `supersedesItemId` 链接并携带候选哈希（W-86）。之后对已关闭条目的对账写入 `effect.late_confirmation`、更新 `executionOutcome`、通过 `alerts(actor)` 可见地抛出 `LATE_CONFIRMATION` 告警，并且绝不重开条目（W-85）。`effectStatus(actor, id)` 为面板投影该效果：预留、消息、告警、`reversalDeadline`、`executionOutcome`、对账是否仍然开放、动作类型，以及服务该类型的适配器声明——是否已注册、是否声明目的地幂等、是否能向目的地查询。

替换处于 `DELEGADO_EN_VENTANA` 的条目（`submit`、`assignWorkspace`）会取消其已排期的执行：消息变为 `CANCELADO`、预留变为 `LIBERADA`，且不发出任何效果（W-56）。

`recoverOrphanedReservations(actor)` 是恢复清扫。接受操作在提交条目之前先写入预留与其消息，因此两者之间的崩溃会留下没有任何条目记录的 `RESERVADA` 行；`revert`、`reconcile` 与 `pruneEffects` 都需要条目才能触及它，于是该键会一直被占用，同一效果的每一次其他执行都会以 `EFFECT_TAKEN` 被拒。清扫会释放早于 `effectReservationLeaseMs`、且没有任何条目记录其键的行，取消其消息，在 `effect_events` 中保存 `effect.orphaned` 审计事件，并抛出 `ORPHAN_RELEASED` 告警；它返回释放的键以及写入的行。键被条目记录的行无论处于何种状态都不会被清扫，因为失败的执行仍需要其预留来重试（W-84）；年轻于租约的行也会被放过，因为它的接受可能仍在提交。

`complete` 与 `recordEffect` 早于预留，只为从未有过效果的条目保留：`complete` 拒绝其 `effectKey` 没有 `CONCILIADA` 预留的条目（`EFFECT_NOT_CONCILIATED`），`recordEffect` 拒绝携带效果键的条目（`EFFECT_VIA_OUTBOX`），因为该效果属于发件箱及其对账（W-84）。

| 配置字段 | 默认值 | 含义 |
|---|---|---|
| `effectReversalWindowMs` | `{ 'mail.send': 900000 }` | 每个动作类型的回退窗口毫秒数；未列出的类型没有窗口（D-12）。部署把 `FABERLOOM_REVERSAL_WINDOW_MS` 映射到邮件条目上 |
| `effectActionTypes` | `['mail.send', 'inventory.reserve', 'shipment.create']` | 接受或适配器可命名的动作类型；部署扩展该列表而不是另造一种拼写，未列出的类型以 `EFFECT_ACTION_UNKNOWN` 被拒 |
| `effectRetentionDays` | 90 | 已了结的预留与消息在 `pruneEffects` 可删除前保存的天数 |
| `effectDispatchTimeoutMs` | 30000 | 一次派发尝试在结果变为 `DESCONOCIDO` 前可用的毫秒数 |
| `effectReservationLeaseMs` | 300000 | `RESERVADA` 行在被 `recoverOrphanedReservations` 释放前可无条目可达的毫秒数；必须长于一次接受的三次写入 |

`effectPolicy()` 返回解析后的值，包括接受的动作类型，因此客户端读取 board 的列表而不必自己保留一份。`pruneEffects(actor)` 删除超出保留窗口的已了结行——也包括没有条目记录其键的效应的审计事件——从不触碰活跃预留或未了结消息；没有任务自动调用这两个清扫。

此表面的稳定错误：`EFFECT_IDENTITY_INCOMPLETE`（缺动作类型、执行 id、目的地、业务键或产物哈希）、`EFFECT_COMPONENT_INVALID`（某个分量包含公式分隔符）、`EFFECT_ACTION_UNKNOWN`（部署不接受的动作类型）、`EFFECT_TAKEN`（另一个活跃执行持有该键）、`EFFECT_NOT_CONCILIATED`（对预留未了结的条目调用 `complete`）、`EFFECT_VIA_OUTBOX`（对带有有效果键的条目调用 `recordEffect`）、`NOT_DELEGATED`、`EFFECT_NO_DEADLINE`、`WINDOW_OPEN`、`WINDOW_EXPIRED`、`EFFECT_DISPATCHED`、`NO_EFFECT`、`NOT_RETRYABLE`、`OUTCOME_UNKNOWN`、`OUTCOME_KNOWN`、`REASON_REQUIRED`、`EFFECT_NO_ADAPTER`、`OUTBOX_NOT_PENDING` 与 `NOT_FOUND`。

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
- **不随包提供校验适配器** — 本包只提供端口、已声明的控件与 proforma 实现。要批准 proforma 的部署需在自己包内挂载 `registerProformaChecks`，用 MCP 调用填充 `BoardCheckSource`；在此之前每次 proforma 批准都会以 `CHECK_UNAVAILABLE` 被拒，这是有意为之。
- **尚未声明 `informativo` 控件** — D-8 只为 proforma 签署了阻塞与需确认两类控件，因此 `informativo` 类别没有已注册的示例，其分支没有被任何控件覆盖。
- **校验结果不持久化** — 条目不保存校验快照。面板实时重读 `runChecks`，批准事件保留允许该决定的结果；按条目保存校验记录随持久化工作加入。
- **发件箱消费者不在此调度** — `dispatchEffect` 与 `pendingEffects` 只是表面；部署用自己的定时器或工作进程驱动它们，board 不启动任何循环。
- **不随包提供效果适配器** — 本包只提供端口。要发出邮件、库存或运输效果的部署需为每个动作类型挂载一个适配器；在此之前，该类型的派发以 `EFFECT_NO_ADAPTER` 被拒且消息保持 `PENDIENTE`，这是有意为之。
- **预留认领是单写入者** — 认领、条目提交与消息写入在每租户一个进程内区段中运行，与键认领相同；第二个产品写入者需要在 `(tenant, effect_key) WHERE status IN (RESERVADA, DESPACHADA)` 上真正的唯一约束，也就是 ADR-001 的重新评估触发条件。
- **发件箱与目的地之间没有原子性** — 消息在调用适配器之前变为 `DESPACHADO`，因此在认领与结果之间崩溃会留下已派发却未确认的预留；由 `reconcile` 了结它，任何状态都不会声称目的地未确认的效果。
- **签名属于访问包** — 挂载 `faberloomAccess` 时，`approveWithExecution` 向它索取 W-16 要求的签名并原样传播其拒绝；没有该服务的组合不执行签名校验，因为 board 无法判断哪些动作类型受保护。
- **旧的效应路径保留一项豁免** — `complete` 可关闭预留已 `CONCILIADA` 的已批准条目，`recordEffect` 可为从未携带效果键的条目记录效果。两者都拒绝仍有活跃预留的条目，且都不会获取预留；`approveWithExecution` 是唯一获取预留的路径。
- **保留期与恢复清扫不会被自动调度** — `pruneEffects` 与 `recoverOrphanedReservations` 在调用者运行时才运行；没有任务调用它们，因此已了结行与孤立预留会等待运维处理。
- **恢复清扫会扫描租户** — 找出没有条目记录的键需要读取该租户的每个条目，因为存储没有 `effectKey` 的二级索引；清扫是运维节奏，而不是每次派发的检查。
- **每次尝试只读取一次控件** — 消费者在条目的写链之外运行已声明的控件，若条目在此期间移动则以 `STALE_REVALIDATION` 拒绝派发，并让消息保持 `PENDIENTE` 供下一次尝试；它绝不会基于过期结论发出效果。
- **迭代锁的持有者按尝试确定，而非按进程** — 写入判定把调用者的标签页会话与 `iterationLockBy` 比较，而 `KvTable.update` 在单个进程内串行化一个条目。不同进程中作用于同一条目的两个写入者仍需要真正的租约；持有者检查拒绝的是第二个标签页，而不是第二个主机。
- **已应用的范畴只被记录，不被学习** — `applyIteration` 把 `scope` 写入其审计事件后即止。修正记录、学习候选与晋升位于本包之外（T4.5–T4.7）。
- **草稿不会被清扫** — 保留期在读取或恢复草稿时执行；没有任务删除过期行，因此 `iteration_drafts` 会增长，直到后续清扫器接手。
- **过期的尝试是派生出来的，不会被重写** — 直到下一条写条目的命令之前，记录仍保留 `ITERANDO` 与其草稿键，因此直接读取原始行的读者看到的仍是服务已经报告为已暂停的锁。
- **候选仍可在尝试之外被解决** — `resolveCandidate` 不检查迭代锁，因此在尝试期间采纳会移动版本，随后该尝试以 `ITERATION_STALE` 拒绝，而不是覆盖它。
- **服务之外没有迭代表面** — 迭代的 MCP 工具与 Remote 方法不属于本包，因此面板只能通过主机服务调用这些命令。

未发布 invariant companion，因为该服务不暴露其单元测试尚未断言的独立观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者背景 — 点击展开</summary>

无。

</details>
