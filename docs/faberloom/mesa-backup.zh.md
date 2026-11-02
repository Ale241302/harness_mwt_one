# Mesa 的备份与恢复

[English](mesa-backup.md) | 中文

`faberloom_mesa` 每 15 分钟用 `pg_dump -Fc` 转储一次；每次执行都校验自己产出的文件、把它复制到主机外的邮箱，并应用有界保留策略。每周一次的演练把最新文件恢复到一次性数据库、核对计数后删除；第二次每周演练用从邮箱下载的副本做同样的事。决策、RPO/RTO 论证和被否决的时间点恢复方案见 [ADR-008](../../ADRs_MESA/ADR-008-respaldo-mesa.md)；本页记录实际安装的部件与演练证据。

## 已安装的部件

- `scripts/backup-mesa.sh`，安装在 `/opt/mwt/scripts/backup-mesa.sh`：转储、sha256 与 `pg_restore --list` 校验、带源计数的 `.meta`、保留策略、主机外副本。
- `scripts/restore-mesa-drill.sh`，安装在 `/opt/mwt/scripts/restore-mesa-drill.sh`：恢复到 `mesa_drill_<UTC>`、校验、删除；`--offsite` 演练从邮箱下载的副本。
- `scripts/mesa-offsite.py` 与 `scripts/mesa-env.sh`：邮箱客户端，以及两个脚本共用的 `.env` 读取器。
- `/etc/mwt/mesa-offsite.env`（权限 600，属主 root）：邮箱账号。脚本读取它而不执行它，已经导出的变量优先。
- 文件存放在 `/opt/backups/mesa-mwt-one`（权限 700），位于容器之外，也不在 PostgreSQL 数据卷里。
- 状态写在 `/opt/mwt/mesa_backup_status.txt` 与 `/opt/mwt/mesa_restore_drill_status.txt`；日志在 `/opt/mwt/logs/mesa_backup.log`。

## 调度

```
*/15 * * * * flock -n /run/lock/mesa-backup.lock /opt/mwt/scripts/backup-mesa.sh >> /opt/mwt/logs/mesa_backup.log 2>&1 # mesa_backup
20 5 * * 0 flock -n /run/lock/mesa-backup.lock /opt/mwt/scripts/restore-mesa-drill.sh >> /opt/mwt/logs/mesa_backup.log 2>&1 # mesa_restore_drill
40 5 * * 0 flock -n /run/lock/mesa-backup.lock /opt/mwt/scripts/restore-mesa-drill.sh --offsite >> /opt/mwt/logs/mesa_backup.log 2>&1 # mesa_restore_drill_offsite
```

## 主机外副本

`MESA_OFFSITE=on` 把每个文件送到 Hostinger 上 `alejandro@muitowork.com` 邮箱的 `INBOX.Mesa-Backups` 文件夹；那是与 VPS 不同的提供商、不同的主机。上传是被校验的，而不是假定的：客户端把邮件读回来、取出附件、与本地文件比对 sha256，然后才修剪邮箱。同一个文件追加两次是空操作（`repeated=1`），因此重试的 cron 不会产生重复。

- 每封邮件把文件作为附件，并在正文的 `--- meta ---` 与 `--- end meta ---` 之间带上 `.meta` 的内容，因此恢复时也能拿回必须匹配的计数。
- 邮箱保留策略按顺序执行：72 小时内的每一份都保留；30 天内每个 UTC 日保留一份；最多 200 封；永远不少于 3 封。
- 超过 `MESA_OFFSITE_MAX_MB`（20 MB）的转储以 `too_large` 被拒绝，而不是被悄悄截断。今天的文件是 286 625 字节，邮箱配额 50 GB。
- 失败的副本从不会让本地备份失效：状态变为带 `offsite_reason` 的 `REMOTE_FAIL`，`--check-freshness` 以 3 而不是 0 退出。
- rclone 通道（`MESA_REMOTE`）仍可用于第二个目的地，目前关闭。`a2ftp` 的实测失败与 `mlocal` 的演练记录在 [ADR-008](../../ADRs_MESA/ADR-008-respaldo-mesa.md)。

```
MESA_OFFSITE=on /opt/mwt/scripts/backup-mesa.sh   # the .env supplies account and policy
/opt/mwt/scripts/mesa-offsite.py list             # catalog: name, bytes, sha256, counts
/opt/mwt/scripts/mesa-offsite.py check            # download the newest and compare sha256
/opt/mwt/scripts/mesa-offsite.py fetch --latest --out-dir /tmp/restore
/opt/mwt/scripts/mesa-offsite.py quota
```

### VPS 上的 SFTP 端点

`ftp.muitowork.com` 解析到 VPS，为人工传输提供一个隔离的 SFTP：`sshd-mesa.service` 用独立配置监听 2223 端口，只接受 `mesa-backup`，强制 `internal-sftp`，把用户限制在 `/srv/mesa-backups`，并拒绝密码、TTY 与转发。客户端密钥是 `/root/.ssh/mesa_sftp_ed25519`。

这个端点**不是**主机外副本：它与数据库共享主机和磁盘。它存在是因为该域名的 FTP 记录指向一个已被暂停的 a2hosting 账号，它替换了那条记录；上面那个邮箱才是能在丢失 VPS 后存活的副本。

## RPO 与 RTO

| 指标 | 目标 | 实测 |
|---|---|---|
| RPO | 不超过 15 分钟 | 15 分钟加 0,3 秒：cron 间隔加一次转储；主机外副本在同一次执行中完成 |
| RTO | 不超过 15 分钟 | 本地 `pg_restore` 309 毫秒，从邮箱副本恢复 305 毫秒；预算的其余部分是发现与操作员决策 |

## 演练证据

| 数据 | 值 |
|---|---|
| 文件 | `mesa_20261102T191843Z.dump` |
| 大小 | 286 625 字节 |
| sha256 | `80aa8ef1c6d30c6d7e91c410872d94129aa1147141e29a526d1b776bb1cf510b` |
| 转储耗时 | 201 毫秒 |
| 主机外上传 | 邮箱 uid 16，修剪前已读回并比对 |
| 恢复的事项 | 500（演练下限 460） |
| 恢复的事件 | 2 477（演练下限 2 413） |
| 孤立事件 | 0 |
| RLS 与策略 | 两张表都强制 RLS，共 6 条策略 |
| `pg_restore` 耗时 | 本地 309 毫秒，从邮箱 305 毫秒 |
| 一次性数据库 | `mesa_drill_20261102t191853z` 与 `mesa_drill_20261102t191854z`，均已删除 |
| 测试套件 | `scripts/test-backup-mesa.sh`：86 项检查，0 失败 |
| 转储期间的写入 | `mesa_items` 上的一次事务耗时 138 毫秒 |

## 命令

```sh
/opt/mwt/scripts/backup-mesa.sh                    # dump, verify, off-host copy, prune
/opt/mwt/scripts/backup-mesa.sh --prune-only       # retention only
/opt/mwt/scripts/backup-mesa.sh --check-freshness  # exit 1 if stale or unverifiable, 3 if the copy failed
/opt/mwt/scripts/restore-mesa-drill.sh             # drill on a throwaway database
/opt/mwt/scripts/restore-mesa-drill.sh --offsite   # drill the copy downloaded from the mailbox
/opt/mwt/scripts/restore-mesa-drill.sh --keep      # keep the restored database for inspection
```

## 检查

- `scripts/test-backup-mesa.sh` 覆盖保留策略、状态、新鲜度、`.env` 读取器、邮箱客户端的保留与主题解析，以及拒绝把演练指向 `faberloom_mesa`、`mwt_one`、`postgres`、`template0` 或 `template1` 的守卫。
- 校验失败会删除文件并以非零码退出，因此被截断的转储不会看起来像有效文件。
- 上次状态为失败、文件已消失或校验和不符时，`--check-freshness` 以 1 退出；本地备份有效但主机外副本失败时以 3 退出。

## 已知限制

- 邮箱副本按发送时的样子存放，静态不加密：能读那个邮箱的人就能读数据库。账号必须保持强密码与第二因素；给文件加密只会把密钥放在它所要保护的那块磁盘上。
- 演练检查的是完整性与形状（计数、孤立行、RLS），而不是每个 `payload` 是否仍符合应用的预期含义。
- 演练按转储中的属主与 ACL 恢复，因此被引用的角色从集群中消失时它同样会失败。
- 主机外通道依赖 Hostinger 的邮件服务：服务中断时本地备份仍然有效，状态停在 `REMOTE_FAIL`，直到下一次成功上传。

## 相关

- [ADR-008：`faberloom_mesa` 的备份与恢复](../../ADRs_MESA/ADR-008-respaldo-mesa.md)。
- [中央 Mesa 的 PostgreSQL 数据库](mesa-central-postgres.zh.md)。
