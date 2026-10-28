# Agent Note: 迭代是一次尝试、一把锁、一份草稿

Status: implemented

[English](2026-10-28-mesa-iteration-lock-and-draft.md) | 中文

## 问题

工作台无法迭代。条目从 E10 模型起就带有 `iterationId`、`iterationLockGeneration`、`iterationLockUntil` 与 `iterationDraftKey`，但没有任何命令写入它们：没有命令在条目的空间上打开对话，没有人工作时没有东西持锁，也没有东西阻止另一个标签页的过期写入落到条目上。

规范 §9.7.1 要求的机器由三种失效模式塑造。第一，来自先前尝试、另一个标签页，或在用户离开后才到达的回答，绝不能落到条目上；规范要求状态、`iteration_id`、代次与基础版本一致，并要求迟到的回答保存为该失效尝试自己的草稿（W-43、W-57）。第二，任何退出都不得对待处理候选作出决定：保存并退出、未解决返回、未作选择的取消与锁到期都让候选保持待处理，只有显式的 adopt/keep 才改变版本（W-41、W-97）。第三，锁需要一个在读取时有意义的到期时刻：已过 15 分钟的 `ITERANDO` 条目必须表现为"保存并退出"并把它草稿重新提供出来（W-44），而在本版本之前写入的记录没有到期时刻，必须继续拒绝编辑。

## 决定

**锁的主体是尝试，而不是用户。** `iterate` 要求 `PENDIENTE_CRITERIO` 与一个空间（否则 `NO_SPACE`，W-31），生成新的 `iterationId`，递增 `iterationLockGeneration`，记录 `iterationBaseVersion`，按已解析的策略写入 `iterationLockUntil`，并把标签页会话存入 `iterationLockBy`。产物版本不变（W-11）。同一用户的两个标签页是两次尝试：第二次 `iterate` 以 `LOCK_LOST` 被拒，改为读取第一次尝试，而不是共享它。

**由一个判断决定写入是否可以触及尝试。** 条目未在迭代或到期时刻已过时，`attemptRejection(record, input, now)` 返回 `LOCK_LOST`；所指 id 或代次不是当前值时返回 `ITERATION_STALE`；`requireAttemptBase` 追加基础版本比较。`renewIteration`、`pauseIteration`、`cancelIteration`、`applyIteration` 与草稿写入在改动任何东西之前都查询它们，因此过期写入没有效果，也不产生审计事件（W-43、W-57）。

**到期在读取时派生。** `stateAfterExpiry` 把记录了已过到期时刻的 `ITERANDO` 记录映射为 `PENDIENTE_CRITERIO`，`stateOf` 在每次读取与命令中应用它。因此 `get` 返回带草稿的已暂停条目，`approve`、`discard` 与 `saveEdits` 看到的是暂停，且任何读取都不写入条目。没有记录到期时刻的记录视为有效，因此本次变更之前写入的行继续拒绝编辑。在下一条写入条目的命令之前，原始记录仍保留 `ITERANDO`；这一点记录为已知限制。

**工作草稿保存在自己的表中。** `iteration_drafts` 以 `<itemId>:<iterationId>` 为键，保存基础版本、摘要、证据、内容、`archived` 标记、`outdated` 标记，以及与 D-09 一致的 `retainUntil`。条目只链接一个键。针对已不再有效的尝试的写入会以 `archived: true` 保存，条目完全不被写入（W-57）。新尝试会把先前链接的草稿归档，因此针对旧版本写入的工作绝不会作为当前草稿重新出现。保留期在读取与恢复时执行。

**每种退出只有一个含义。** `pauseIteration` 覆盖保存并退出、带到 SpaceLoom、未解决返回与 `lock-vencido`：释放锁、使尝试 id 失效、保留草稿与任何待处理候选，并返回 `PENDIENTE_CRITERIO`（W-67、W-97）。`cancelIteration` 删除草稿，并在调用者未指定 `adopt` 或 `keep` 时以 `CANDIDATE_PENDING` 拒绝；`keep` 不改变版本，`adopt` 是唯一的版本递增（W-41）。`applyIteration` 依据草稿与调用者的覆盖写入下一个版本与哈希，把学习范畴记录在其审计事件中，消费草稿，并在有待处理候选却未指定时拒绝。`resumeIteration` 在保留的草稿上开启新尝试，草稿是针对更旧版本写入的时，把草稿标记为已过期并返回差异字段而不是覆盖（W-68）。

**轮次计数器按条目计，且只给建议。** 每次应用的尝试都会让 `iterationRoundCount` 上升；达到 `iterationRoundLimit` 时 `iterationStatus().suggestRewrite` 变为 true，且没有任何东西被阻塞（D-10）。

**四个 D-09/D-10 取值是经校验的 `Config` 字段。** `iterationRenewalSeconds`（30）、`iterationLockSeconds`（900）、`iterationDraftRetentionDays`（30）与 `iterationRoundLimit`（5）由插件行解析，并通过 `iterationPolicy()` 暴露，因此面板按部署的数值调度，机器中不隐藏常量。

## 考虑过的替代方案

**按条目单独建一张锁表。** 它能让清扫器不必扫描条目即可读取锁，并让条目记录更小。它落选是因为 ADR-001 把状态与审计保留在一条记录里：第二张表中的锁可能与授权它的状态不一致，而对条目的 `update` 是服务唯一信任的提交点。

**在读取发现过期锁时写入暂停。** 从 `get` 持久化暂停可以让原始行不再留下 `ITERANDO`。它落选是因为读取会因此产生变更、发出 domain-changed 事件，并把一次列举变成对每个过期条目的写入风暴；派生暂停是幂等的，而下一条命令本来就会持久化已释放的字段。

**把草稿字段留在条目上。** 每个条目一条记录符合 ADR-001，也不需要新表。它落选是因为失效尝试的迟到回答要么覆盖当前草稿，要么需要在条目上再放一组草稿字段；而取消必须只删除一次尝试的工作，且不触碰已记录的状态。

**每个用户会话一个代次计数器。** 按会话计数可以让用户在不生成新 id 的情况下恢复自己的尝试。它落选是因为规范让尝试而不是用户成为锁的主体：同一个人的两个标签页是两次尝试，代次必须属于尝试才能区分二者。

## 结果

- 六个新字段与一张新表：`iterationBaseVersion`、`iterationLockBy`、`iterationRoundCount` 与 `iteration_drafts`。已有记录原样加载，因为每个字段都带默认值。
- `iteration.ts` 把机器导出为基于一条记录加一个时钟的纯函数；服务保留授权与单次 `update` 提交，读取方可以解析出下一次写入将执行的同一阶段。
- 过期的尝试按暂停读取，但在下一条命令写入条目之前，原始行仍保留 `ITERANDO`。
- 在尝试期间通过 `resolveCandidate` 解决的候选仍会移动版本；随后该尝试以 `ITERATION_STALE` 拒绝，而不是覆盖它。
- 锁在单个进程内由每个条目的一次 `KvTable.update` 串行化，而不是由租约串行化；第二个写入进程需要真正的租约。
- 草稿行不会被清扫：保留期在读取或恢复草稿时执行，因此该表会增长，直到有清扫器接手。
- `applyIteration` 记录学习范畴后即止；修正记录由视图在提交后写入，候选的创建与晋升仍在学习工作中（T4.5–T4.7）。Mesa 读取它所用的迭代 Remote 记录在 [Mesa 迭代界面](2026-10-28-mesa-iteration-surface.zh.md) 中。

## 验证

`packages/faberloom/board/tests/board-iteration.spec.ts` 证明了它点名的每条验收标准：W-31 拒绝没有空间的条目，W-10 在尝试进行中拒绝批准、丢弃与编辑，W-43 拒绝使用上一次尝试代次的写入，W-67 释放锁并保留草稿，W-97 在未解决返回时保留草稿与待处理候选，W-41 在到期与 keep 选择下都不触碰候选，W-44 把过期尝试读作已暂停并恢复其草稿，W-68 返回差异字段且不覆盖，W-57 把迟到回答保存为其失效尝试的归档草稿，W-40 让到达的产物仍是同一条目的候选，W-69 在冲突时既不应用编辑也不应用尝试，D-10 只在第五个已应用轮次让建议变为 true。`npx tsc -b packages/faberloom/board/tsconfig.json`、`npx tsc -p tsconfig.host.json --noEmit`、`npx oxlint packages/faberloom/board/src packages/faberloom/board/tests` 与 `npx vitest run packages/faberloom/board/tests packages/faberloom/view/tests packages/faberloom/mcp-server/tests packages/faberloom/tool-faberloom/tests` 均为绿色。
