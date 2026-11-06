# Agent Note：知识提案的单一持久幂等入口

Status: implemented

[English](2026-11-06-knowledge-proposal-reception.md) | 中文

## 问题

看板此前没有专门的知识提案入口。生产者可以调用 `submit`，但它是面向运行的：要求 run id，把幂等键当作租户范围而不是 owner 范围，并会替代同一业务键上的非终态条目。因此，外部智能体在丢失应答后重试可能创建第二个条目；用同一键提交不同内容时，会静默拿回第一个条目而不是冲突。也没有字段级边界：没有任何东西阻止调用方一并发送 `ownerId`、`companyId`、`spaceId`、`state` 或 `approvedRevision`。

## 决策

**一个工具、七个字段、明确上限。** `faberloom_proposal_submit` 接收 `archivo`、`versionBase`、`cambio`、`motivo`、`evidencia`、`claveCliente` 与 `title`。`parseProposalInput` 同时是 MCP 工具与直接看板调用的边界：拒绝未知键，以 `PROPOSAL_AUTHORITY_FIELD` 命名权威字段，并执行 `PROPOSAL_LIMITS` 的上限（512 / 128 / 20,000 / 2,000 / 20 × 512 / 128 / 200）。MCP schema 为模型重复这些上限，看板再次执行，因为工具层不是唯一调用方。

**命名空间就是身份。** 来源引用是 `PROPUESTA:<company>:<owner>:<space>:<key>`，每个槽位经过 URI 编码；同样的四个规范槽位被哈希为幂等键。条目 id 由该哈希派生，因此两个进程收到同一命名空间时写入同一行而不是两行。持久的 `idem` 与 `bkey` 声明在行之前写入，顺序与 `submit` 一致。空间槽位属于命名空间，本增量中保持 `null`，因为七个字段不携带空间；后续批次从已验证引用派生它，而不是让调用方指定。

**重试是重放，不是新提交。** `submitProposal` 先读取确定性 id：内容哈希相同则返回 `{ recibida: true, id }` 且不修改行；内容哈希不同、owner 不同或不是提案行则返回 `PROPOSAL_CONFLICT`。哈希读取第一个修订，即收到时的提案，因此后续人工编辑或批准不会使客户端重试失效。若行不存在，已持有该业务键的活跃条目（已计划效果，或此前写入的行）也是冲突；提案绝不替代它，也绝不暴露它。owner 与公司在规范形式下比较并串行化，因此同一身份的两种拼写不会多开一行或第二把锁。

**路径是数据，但按路径校验。** `archivo` 必须是仓库相对路径：绝对路径、盘符、反斜杠或 `..` 段会在行存在之前以 `PROPOSAL_FIELD_INVALID` 被拒绝。

**提案是工作，不是决定。** 条目以 `PENDIENTE_CRITERIO` 进入，`approvedRevision: null`，无 effect key、无预留。`propuesta-conocimiento` 在 `classify.ts` 中有自己的 LOW 严重性规则与 N2 允许字段规则；两个规则表版本都升到 `2026-11-06.1`，使分类缓存与审计轨迹能区分表版本。批准仍然要求 human writer（`kind: 'human'`），1.1 的证据规则原样适用。

## 考虑过的替代方案

**复用 `submit` 并加命名空间幂等键。** 幂等声明是租户范围的，两个 owner 使用同一客户端键会碰撞；`submit` 还会替代同一业务键上的活跃条目，而这正是提案对已计划效果绝不能做的事。

**把去重放在进程 Map 中。** 重启即丢失，而且工具服务器与看板可能在不同进程。确定性 id 加持久声明能同时跨过两者。

**随机条目 id 加声明表。** 两个进程可能在任一方写入声明前都读到“无声明”。派生 id 让行写入在读取竞争时仍然幂等；写后回读把不同载荷变成冲突。

**接受权威字段但忽略它们。** 发送 `state: 'APROBADO'` 的调用方会以为自己改变了决定。拒绝该字段是在命名边界，而不是静默丢弃。

## 后果

提案在工具作答之前已持久，崩溃后的重试解析到同一行。同一键携带不同内容会显式失败，而不是返回他人的工作。看板绝不会因提案而创建效果、教学、上下文条目或索引行；那些仍是随后人工决定的后果。

确定性 id 意味着提案命名空间不可变：改变 owner、空间或客户端键会产生不同提案，这正是预期的身份。行写入后的回读比较能发现并发的不同载荷；但两个进程若都在对方写入前读到自己写入的内容，仍可能返回两个成功。部署保持每个 home 一个看板写入者，持久声明加派生 id 使常见重试路径正确。

## 验证

- `packages/faberloom/board/tests/proposal.spec.ts`：精确回执与待处理条目；两个不同键；同一介质上重启后的相同重试；八个并发相同调用；同键不同内容且第一行不变；owner 隔离与所有权威字段；持有业务键的已计划条目保持不变；无效果、不可完成、agent 不能批准；超长变更与证据列表且另一提案完好；不安全路径与非字符串字段；人工编辑后与批准后的相同重试；确定性 id 上的他人或非提案行。
- `packages/faberloom/mcp-server/tests/proposal.spec.ts`：工具被广告且按 scope 过滤；回执恰好只有 `recibida` 与 `id`；权威与未知字段在 executor 被拒；作用域在其它工具的令牌不能调用；不同键与冲突重试；上限。
- `packages/faberloom/board/tests/classify.spec.ts`：`propuesta-conocimiento` 解析为 LOW 与 N2，并带允许字段。
