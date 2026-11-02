# Mesa 的备份与恢复

[English](mesa-backup.md) | 中文

`faberloom_mesa` 每 15 分钟用 `pg_dump -Fc` 转储一次；每次执行都校验自己产出的文件并应用有界保留策略，每周一次的演练把最新文件恢复到一次性数据库、核对计数后删除。决策、RPO/RTO 论证和被否决的时间点恢复方案见 [ADR-008](../../ADRs_MESA/ADR-008-respaldo-mesa.md)；本页记录实际安装的部件与演练证据。

## 已安装的部件

- `scripts/backup-mesa.sh`，安装在 `/opt/mwt/scripts/backup-mesa.sh`：转储、sha256 与 `pg_restore --list` 校验、带源计数的 `.meta`、保留策略。
- `scripts/restore-mesa-drill.sh`，安装在 `/opt/mwt/scripts/restore-mesa-drill.sh`：恢复到 `mesa_drill_<UTC>`、校验、删除。
- 文件存放在 `/opt/backups/mesa-mwt-one`（权限 700），位于容器之外，也不在 PostgreSQL 数据卷里。
- 状态写在 `/opt/mwt/mesa_backup_status.txt` 与 `/opt/mwt/mesa_restore_drill_status.txt`；日志在 `/opt/mwt/logs/mesa_backup.log`。

## 调度

```
*/15 * * * * flock -n /run/lock/mesa-backup.lock /opt/mwt/scripts/backup-mesa.sh >> /opt/mwt/logs/mesa_backup.log 2>&1 # mesa_backup
20 5 * * 0 flock -n /run/lock/mesa-backup.lock /opt/mwt/scripts/restore-mesa-drill.sh >> /opt/mwt/logs/mesa_backup.log 2>&1 # mesa_restore_drill
```

## 主机外副本

备份可以把 artifact 推送到一个 rclone 目标，但这一步是关闭的，因为今天没有可用的主机外目的地：`a2ftp` 返回 `530 Login authentication failed`，而 `mlocal` 是与数据库同盘的 MinIO 卷。这条路径是演练过的，不是纸面的：2026-11-02 的演练把 `mesa_20261102T175722Z.dump` 上传到 `mlocal:mesa-mwt-one`，`rclone lsjson --stat` 报告 274 705 字节，从目标读回的 artifact 与本地文件的 sha256 相同。

```
MESA_REMOTE=a2ftp:mesa-mwt-one /opt/mwt/scripts/backup-mesa.sh   # empty means off
```

- 上传会复制 artifact、它的 `.sha256` 与 `.meta`，失败的副本从不会让本地备份失效：状态变为 `REMOTE_FAIL`，`--check-freshness` 以 3 而不是 0 退出，并给出目标与原因。
- 目的地只保留本地保留策略保留的内容，因此该开关打开后远端不会无界增长。

## RPO 与 RTO

| 指标 | 目标 | 实测 |
|---|---|---|
| RPO | 不超过 15 分钟 | 15 分钟加 0,3 秒：cron 间隔加一次转储 |
| RTO | 不超过 15 分钟 | `pg_restore` 耗时 302 毫秒；预算的其余部分是发现与操作员决策 |

## 演练证据

| 数据 | 值 |
|---|---|
| 文件 | `mesa_20261102T174140Z.dump` |
| 大小 | 274 705 字节 |
| sha256 | `a957fb3daa9479fab7f3b3adb6a6efa96f5e2acf6fbb320b3dad305bbeead0bc` |
| 转储耗时 | 226 毫秒（第二次 274 毫秒，第三次 289 毫秒） |
| 恢复的事项 | 473（演练下限 460） |
| 恢复的事件 | 2 436（演练下限 2 413） |
| 孤立事件 | 0 |
| RLS 与策略 | 两张表都强制 RLS，共 6 条策略 |
| `pg_restore` 耗时 | 302 毫秒 |
| 一次性数据库 | `mesa_drill_20261102t174140z`，校验后删除 |
| 轮转 | 第二次执行 `kept=2 pruned=0`；第三次放入一个 45 天前的文件后 `kept=3 pruned=1` |
| 定时执行 | cron 在 17:45:02 UTC 触发，耗时 467 毫秒，`kept=4` |
| 从安装副本演练 | 291 毫秒，473 个事项，2 436 条事件，数据库已删除 |
| 转储期间的写入 | `mesa_items` 上的一次事务耗时 138 毫秒 |

## 命令

```sh
/opt/mwt/scripts/backup-mesa.sh                    # dump, verify, prune
/opt/mwt/scripts/backup-mesa.sh --prune-only       # retention only
/opt/mwt/scripts/backup-mesa.sh --check-freshness  # exit 1 if the last backup is stale or unverifiable
/opt/mwt/scripts/restore-mesa-drill.sh             # drill on a throwaway database
/opt/mwt/scripts/restore-mesa-drill.sh --keep      # keep the restored database for inspection
```

## 检查

- `scripts/test-backup-mesa.sh` 覆盖保留策略、状态、新鲜度，以及拒绝把演练指向 `faberloom_mesa`、`mwt_one`、`postgres`、`template0` 或 `template1` 的守卫。
- 校验失败会删除文件并以非零码退出，因此被截断的转储不会看起来像有效文件。
- 上次状态为失败、文件已消失或校验和不符时，`--check-freshness` 以 1 退出；本地备份有效但主机外副本失败时以 3 退出。

## 已知限制

- 备份文件与数据库在同一块磁盘上，而且目前没有运行主机外副本：它能覆盖逻辑损坏、误操作和实例丢失，但不能覆盖主机丢失。
- 演练检查的是完整性与形状（计数、孤立行、RLS），而不是每个 `payload` 是否仍符合应用的预期含义。
- 演练按转储中的属主与 ACL 恢复，因此被引用的角色从集群中消失时它同样会失败。

## 相关

- [ADR-008：`faberloom_mesa` 的备份与恢复](../../ADRs_MESA/ADR-008-respaldo-mesa.md)。
- [中央 Mesa 的 PostgreSQL 数据库](mesa-central-postgres.zh.md)。
