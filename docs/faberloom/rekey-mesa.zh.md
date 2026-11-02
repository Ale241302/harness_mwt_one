# Mesa 身份重定键（rekey）

[English](rekey-mesa.md) | 中文

本页记录 P1 收尾之后 `faberloom_mesa` 中条目身份的状态：租户 `5525986c-3b09-4d13-bf8f-43ccaa2deae3` 的 460 个条目，其中 436 个还带着迁移写入的临时键 `legacy:<uuid>`。决策与被否决的方案见 [ADR-007](../../ADRs_MESA/ADR-007-identidad-mesa.md)；本页给出操作步骤和它在真实库上的结果。

## 决策一句话

`legacy:<uuid>` 就是这 436 个条目的规范且永久身份：记录里没有任何字段能标识这一行，而能命名案卷的字段标识的是主题——Mesa 有意为同一案卷保存多条提醒——。只有当条目自己声明了 `sourceRef` 或生产者键时才采纳派生键；本租户内没有这样的条目。

## 执行

```sh
node scripts/rekey-board-postgres.mjs --tenant 5525986c-3b09-4d13-bf8f-43ccaa2deae3 \
  --database-url "$MESA_DATABASE_URL" --export-dir .artifacts/mesa-rekey

node scripts/rekey-board-postgres.mjs --tenant 5525986c-3b09-4d13-bf8f-43ccaa2deae3 \
  --database-url "$MESA_DATABASE_URL" --export-dir .artifacts/mesa-rekey --apply
```

不加 `--apply` 就是 dry-run：读取租户、给每个条目归类、写出报告，不改任何一行。加了 `--apply` 会开启事务，写库前先导出当前键，只应用可采纳的键，并在同一事务内验证条目数未变、没有残留的重复活跃键。导出目录里还有该次运行的 `<报告>-revert.sql`，给出这一次改动的具体回滚。

会话用 `SET LOCAL ROLE mesa_app` 进入并设置 `app.tenant_id` 与 `app.role = 'admin'`，与迁移一致：`mesa_items` 的 RLS 策略会被真实求值，回填因此能写同租户里任意 owner 的行。

## 租户结果

| 数据 | 值 |
|---|---|
| 条目 / 事件 | 460 / 2413 |
| 纳入范围的条目（`legacy:<uuid>`） | 436 |
| 采纳的键 | 0 |
| 冲突 | 0 |
| 最终分布 | `legacy:<uuid>` 436 · sha256 23 · 其他 1 |
| 活跃键 | 451 行，451 个不同键 |
| Dry-run | 2026-11-02 17:44:00Z |
| Apply | 2026-11-02 17:45:19Z |
| 第二次运行 | 与第一次相同：`rekeyed` 0，`unchanged` 436 |

没有任何一行换了键，`payload`、`state`、`row_version` 和事件都没动：没有可采纳的键。这次收尾的价值在于身份不再"临时"，而是由已登记的决策确定，而不是因为没做决定。

## 按原因的条目分布

| 原因 | 条目 | 记录了什么 | 是否采纳 |
|---|---|---|---|
| `recorded` | 0 | `sourceRef` 或自身的生产者键 | 采纳 |
| `document` | 1 | `revisions[].documentRef` 里的案卷 token | 不采纳：命名的是主题 |
| `evidence` | 128 | 证据里唯一一个案卷 token | 不采纳：命名的是主题 |
| `legacy` | 307 | 无可识别内容，或混有两个引用 | 不适用 |

436 个条目都是 `artifactType = 'tarea'`、`spaceId = null`、`accountRef = null`、`sourceRef = null`；`payload.businessKey` 正是 `legacy:<id>`。证据中的第一条引用在 436 个条目里只有 123 个不同值：313 个条目与另一个条目共享同一条首条引用，这正是第一次生产环境 rekey 尝试遭遇的塌缩。

## 回填不触碰的活跃条目

有四个活跃条目的键与其自身记录不一致。它们的身份由服务写入，因此回填只在 `liveIdentityObservations` 里报告，不做修改。

| 条目 | 状态 | 当前键 | 其记录提出的键 |
|---|---|---|---|
| `1967df17-a631-490c-bba4-980b78dd181c` | `DESCARTADO` | `a9ca771b…` | `eee92c9d…` |
| `81264287-9eca-483a-a6b2-7dc1f1cd60ad` | `PENDIENTE_CRITERIO` | `PF 2520-2026` | `9f70a1f2…` |
| `85ed32e0-2a83-46bb-9aef-3a1570fedf3d` | `PENDIENTE_CRITERIO` | `c851cb74…` | `deb2266c…` |
| `c82a12d1-b53c-432f-80a3-e98baaaa373c` | `DESCARTADO` | `1ca3114c…` | `c1323a2e…` |

`81264287` 同时是冲突守卫的实证：它的生产者键 `PF 2520-2026` 解析到与 `528c898d-bf28-450f-8e9f-660d72d41d05` 相同的主题，计划把它报告为冲突而不是写进去。

## 验证

```sql
SELECT count(*) FROM mesa_items WHERE tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3';  -- 460
SELECT count(*) FROM mesa_items
 WHERE tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
   AND business_key LIKE 'legacy:%';                                                        -- 436
SELECT count(*) FROM (
  SELECT business_key FROM mesa_items
   WHERE tenant_id = '5525986c-3b09-4d13-bf8f-43ccaa2deae3'
     AND state NOT IN ('APROBADO', 'EJECUTADO', 'DESCARTADO', 'SUSTITUIDO')
   GROUP BY 1 HAVING count(*) > 1
) duplicadas;                                                                               -- 0
```

API 用 `alejandro@muitowork.com` 和 `alvaro@muitowork.com` 各自的真实 token 都返回 460 个条目（每页 200），状态分布未变：450 个 `PENDIENTE_CRITERIO`、6 个 `SUSTITUIDO`、3 个 `DESCARTADO`、1 个 `ERROR_RECUPERABLE`。

```sh
node --test scripts/rekey-board-postgres.test.mjs
```

这些测试覆盖：dry-run 不写库、apply 幂等、与活跃条目冲突、同一计划内两行相互冲突，以及当唯一线索只是案卷时保留 `legacy:<uuid>`。

## 备份与回滚

apply 之前，租户的键表与事件表已导出到 `.artifacts/mesa-rekey/`，文件名带日期。apply 之后两次导出的内容逐行与备份完全一致，因此 Mesa 的状态与运行前相同。每次运行的报告包含全部旧键，以及该次运行所改行的回滚 SQL；由于本次没有改动任何一行，回滚文件里写明了这一点。

## 服务侧复核

`rekeyAll` 现在会跳过本行自己的 `legacy:<id>` 标记：不再把它当作 `sourceRef`，因此第二次运行不会重新哈希 436 个条目，只会迁移声明了 `sourceRef` 的条目。`packages/faberloom/board/tests/board-identity.spec.ts` 中的 `keeps a legacy:<uuid> identity instead of rehashing it` 固定了两条分支。

## 待办

- `SOURCE_REF_PATTERN` 在年份分隔符处截断（`PF 2515-2026` 得到 `PF 2515`），因此派生 token 无法区分不同年份的同号案卷。
- 上表中的四个活跃条目仍然带着与自身记录不一致的键。
