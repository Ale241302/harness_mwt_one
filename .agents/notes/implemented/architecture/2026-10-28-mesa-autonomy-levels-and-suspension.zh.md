# Agent Note: 每个单元的自治级别，以及让它保持诚实的暂停

Status: implemented

[English](2026-10-28-mesa-autonomy-levels-and-suspension.md) | 中文

## 问题

§7.1–§7.3 为每个单元 `(tenant, space, agent, actionType)` 定义自治级别、§7.2 的晋升规则和 §7.3 的监控规则；D-13 固定了抽样与暂停的取值，而周期与统计最小值仍未签字。

委派一个单元会移除喂养其评估的人工决定，因此被委派单元恰好在最需要安全信号时失去了它。

此前没有任何持久记录承载级别：board 拥有条目与批准，learning 包统计结果但不授予任何权限。

两个约束塑造了这次修复。

board 正由另一条车道修改，因此本包不得导入它；而 `ctx.storageDomain` 每条记录只有一次持久写入，`update()` 是唯一的读-改-写。

当周期与统计最小值未签字时，W-53 禁止自动晋升单元。

## 决定

**每个单元一条持久记录、一个级别，以及推动它的两条规则——晋升凭显式命令，暂停由服务执行。**

### 单元与级别

`autonomyUnitId(ref)` 用 NUL 分隔符连接 §7.2 的四个字段，因此两个不同单元永不共用键，租户也无法寻址另一租户的记录。

`ensureUnit` 以 `SHADOW` 注册且可重复调用；`promote` 到达 `DELEGADO`；`supervise`、委派比率越界和被拒的抽样条目都会让单元退回 `SUPERVISADO`。

引用指向另一租户的读取在触达存储之前以 `TENANT_MISMATCH` 拒绝，列表按记录的租户过滤。

### 结果端口

`AutonomyOutcomePort` 是本包了解所发生之事的唯一途径：每个单元可选周期一次调用，回答 `approved`、`approved-with-intervention`、`discarded`、`delegated-confirmed`、`delegated-reversed`、`delegated-failed` 或 `technical-failure`。

组合以 `faberloomAutonomyOutcomes` 提供它；board 适配器实现它。未挂载端口时，`report`、`promote`、`assess` 和 `planSample` 以 `OUTCOME_SOURCE_UNAVAILABLE` 拒绝，因为空历史与不可读历史是两件不同的事实。

没有 `reason` 的 `technical-failure` 会被拒绝：§7.2 只有在记录原因时才排除这些条目。

### 分母

实跑是由人决定关闭的条目——通过、经干预通过、丢弃——因为 §7.2 统计的是由人决定关闭的条目。

委派只进入监控窗口，从不进入晋升份额；同时计入两者会让被委派单元凭自己的产出晋升自己。

技术失败位于所有分母之外，单独报告。

### 晋升

`promote` 重新读取数值，检查 `minimumRealRuns`（10）、`minimumApprovalShare`（0.70），以及在配置了统计最小值时检查它，随后要求该租户的 `governanceRoles`（`owner`、`admin`）。

它存储由谁晋升、何时晋升以及依据的数值，并追加一条 `promoted` 审计。

没有该命令，任何操作都不会晋升。`report` 公布 `automaticPromotion: 'DISABLED'`，并在未签字时把 `period` 与 `statistical-minimum` 命名为未签字，因此 W-53 体现在数据中，而不是暗示于缺失的按钮。

### 暂停与抽样

`assess` 应用 §7.3：单元处于 `DELEGADO` 时，最近 `monitoringWindow`（20）次委派中高于 `suspensionRate`（0.10）的回溯或失败率会把它退回 `SUPERVISADO`，并审计原因、窗口、计数与比率。

当被拒的抽样条目达到 `sampleRejectionsToSuspend`（1）时，`reviewSample` 当场暂停。

`planSample` 从未被抽样的最早委派中选取 `max(sampleMinimum, ceil(sampleFraction × delegations))`——10 %，最少一条——且只记录队列：执行从不等待复核。

重新激活是一次新的 `promote`，因此 W-64 的新的 Owner/Admin 关卡与 §7.2 的阈值再次适用；晋升清空暂停字段，审计保留每一次暂停。

### 审计

每条记录携带单元、租户、时刻、事件、执行者（服务自行决定时为 `automatic`）、原因、条目或周期，以及数值。

键是时刻加进程内序号，因此同一毫秒写入的条目读回时仍保持顺序。

## 考虑过的替代方案

- **导入 board 并直接读取其条目。** 否决：它把两个因不同原因变化的包耦合在一起，而本车道不能触碰 board。
- **端口报告合格后自动晋升。** 被 W-53 否决：周期与统计最小值未签字，规则不完整，服务只能报告。
- **由日历月推导周期。** 否决：业务周期是签字值，日历月会是臆造值。
- **随机抽取样本。** 否决：复核者无法复现或质疑选取；按时刻排序可审计。
- **把技术失败当作普通失败。** 被 §7.2 与 D-13 的意图否决：集成超时不是关于代理的证据。

## 后果

- 两个取值在业务签字前保持 `null`，每份报告都命名它们；没有任何默认值替代。
- 只要存在端口提供者，本包即可使用；在那之前，其评估路径响亮拒绝，而不是报告零。
- `assess` 需要调用方。board 适配器或例程在记录委派结果后运行它；服务内部没有调度。
- 没有治理角色的租户成员不能晋升、监督或记录抽样判定，因此关卡之外的人无法用拒绝对单元实施暂停。
- 暂停后再次晋升的单元保留两次决定的审计，并开始新的晋升记录。

## 测试

`packages/faberloom/autonomy/tests/autonomy.spec.ts` 覆盖验收路径：九次实跑不晋升，69 % 不晋升而 70 % 晋升，普通成员不能晋升而管理员可以，二十次委派中的三次回溯会暂停并在审计中留下原因，一条被拒的抽样条目会暂停，仅有技术失败不会，同名单元的两个租户互不可见，样本为 10 % 且最少一条。
