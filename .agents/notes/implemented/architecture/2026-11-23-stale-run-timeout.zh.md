# 代理笔记：调度器自行了结卡住的运行

状态：已实现

[English](2026-11-23-stale-run-timeout.md) | 中文

## 问题

真实部署中出现了十一条卡在 `running` 的执行，最早的一条来自 2026-10-22，分布在三个例程里。一趟会过期等待（`expireWaits`）并核对未决效果，但没有任何东西查看那种已经开始、永不结束的运行。进程在步骤中途死掉会把记录永远留在 `running`：它继续占着例程的并发槽，面板显示永远不会动的工作，而这条案件永远不会算作失败。

## 决定

### 阈值是带显式默认值的配置字段

`staleRunTimeoutMs` 与 `ownerId`、`enabled`、`intervalMs`、`alertWindowMs`、`maxRunsPerDay` 并列。默认六小时，零表示关闭该检查。六小时足够覆盖这个调度器运行的最慢的合法步骤，又短到让死掉的运行在同一个工作日内被了结；步骤更长的部署调高这个数字，而不是让代码知道它。

### 引擎拥有一个新方法，因为现有的都不合适

`reconcile(id)` 只在仍有未决效果时把执行移到复核，`expireWaits(now)` 只处理带截止期限的 `waiting` 记录。两者都无法了结没有未决效果的 `running` 执行，而调度器没有对执行表的通用写入。最小改动是 `FaberLoomRoutines.expireRuns(timeoutMs, now)`，就放在 `expireWaits` 旁边：它选出 `createdAt` 早于 `now - timeoutMs` 的 `running` 记录，把仍在运行的步骤以 `RUN_TIMEOUT` 标记为失败，并把执行置为 `needs_review` 且带同一原因。

`Execution` 没有 `startedAt`；`createdAt` 是 `startExecution` 把记录创建为 `running` 的时刻，因此它是该类型实际拥有的起始时刻。从等待中恢复的运行会保留它，这是有意的：超时衡量案件的实际耗时，而不是最后一步的耗时。

### 只改状态，因此不会重复效果

该方法不调用任何步骤处理函数、不调用任何效果适配器，也不碰效果账本。带效果的步骤可能在进程死掉前已经施加了效果，重跑会重复一封邮件或一次 MWT 写入；打开复核案件的人根据证据决定怎么办。同样出于这个原因，引擎方法不通知复核监听器：调度器的死信与提醒路径会给一个事件再加一条通知。

### 一趟报告一次，并按例程和日期通知一次

`DispatchReport` 增加 `expiredRuns`（这些 id），对既有字段是纯增量。受影响的每个例程每个 UTC 日得到一条 `stale-run` 通知，`dedupeKey = stale-run:<routineId>:<day>`，通过 `ctx.get('faberloomNotices')` 发布，形式与 `stopAtDailyLimit` 相同。通知写明例程、运行数量、最早的起始时刻，并说明没有发送邮件、没有重复效果。检查在这一趟的最前面运行，位于每日上限检查之前，因此也位于 `startDue` 与 `tick` 之前，而这两者的相对顺序不变：卡住的运行不是上限所管辖的工作，所以即使这一趟被上限停止，它也会被了结。

### 第二趟是无操作

引擎只选出 `running` 记录。运行一旦是 `needs_review`，下一趟就跳过它，因此状态变化与通知都不会重复。

## 考虑过的替代方案

**复用 `reconcile` 并报告 `RECONCILE_REQUIRED`。** 拒绝：reconcile 检查效果账本，没有未决效果时什么也不做，而这正是步骤卡住或死掉的常见情况。报告一个并不存在的未决效果会把操作员引向错误的地方。

**把执行标记为 `failed` 而不是 `needs_review`。** 拒绝：失败计数会声称步骤失败了，而事实是没人知道它是否完成；而且失败的执行在面板上没有留下可查的东西。

**暂停或编辑例程。** 拒绝：所有者的配置不是原因，手动重新激活例程也不是修复。

**给所有者发邮件。** 拒绝：E1 已取消自动邮件；持久通知才是产品界面。

**用 `updatedAt` 代替 `createdAt`。** 拒绝：`updatedAt` 随每次步骤写入移动，因此多步骤的长运行看起来总是新鲜的，而案件本身已经老了；`createdAt` 是唯一表示“这条执行何时开始”的字段。

## 后果

一个步骤确实很慢但仍在活着的运行会在越过阈值时被移到复核；人能看到那一步，并有意识地重新启动例程。阈值是部署选择，不同负载只需改一个字段。调度器每趟多扫描一次执行表，而这些执行在该趟的其他地方本来也会列出。

## 测试

`vitest run packages/faberloom/execution/tests` 通过 44 个测试。新增覆盖在 `tests/stale-runs.spec.ts`，复用同一套 Context + Storage + DomainFacility + access + routines 测试装置：旧的 `running` 执行以 `RUN_TIMEOUT` 移到 `needs_review`，其运行中的步骤被标记为失败，`expiredRuns` 列出它，处理函数只运行了一次；未超时的运行仍为 `running` 且不发布任何通知；`staleRunTimeoutMs: 0` 即使过了一天也关闭该检查；连续两趟只过期一次、只发布一条 `stale-run` 通知。
