# Mesa backup and restore

English | [中文](mesa-backup.zh.md)

`faberloom_mesa` is dumped with `pg_dump -Fc` every 15 minutes; each run verifies its own artifact and applies a bounded retention, and a weekly drill restores the newest artifact into a throwaway database, checks the counts, and drops it. The decision, its RPO/RTO reasoning, and the rejected point-in-time-recovery alternative live in [ADR-008](../../ADRs_MESA/ADR-008-respaldo-mesa.md); this page records the installed pieces and the drill evidence.

## Installed pieces

- `scripts/backup-mesa.sh`, installed at `/opt/mwt/scripts/backup-mesa.sh`: dump, sha256 plus `pg_restore --list` verification, `.meta` with the source counts, retention.
- `scripts/restore-mesa-drill.sh`, installed at `/opt/mwt/scripts/restore-mesa-drill.sh`: restore into `mesa_drill_<UTC>`, verify, drop.
- Artifacts in `/opt/backups/mesa-mwt-one` (mode 700), outside the container and outside the PostgreSQL data volume.
- State in `/opt/mwt/mesa_backup_status.txt` and `/opt/mwt/mesa_restore_drill_status.txt`; log in `/opt/mwt/logs/mesa_backup.log`.

## Schedule

```
*/15 * * * * flock -n /run/lock/mesa-backup.lock /opt/mwt/scripts/backup-mesa.sh >> /opt/mwt/logs/mesa_backup.log 2>&1 # mesa_backup
20 5 * * 0 flock -n /run/lock/mesa-backup.lock /opt/mwt/scripts/restore-mesa-drill.sh >> /opt/mwt/logs/mesa_backup.log 2>&1 # mesa_restore_drill
```

## Off-host copy

The backup can push its artifact to an rclone target, and the stage is off because no off-host destination works today: `a2ftp` answers `530 Login authentication failed`, and `mlocal` is a MinIO volume on the same disk as the database. The path is exercised rather than hypothetical: the 2026-11-02 rehearsal uploaded `mesa_20261102T175722Z.dump` to `mlocal:mesa-mwt-one`, `rclone lsjson --stat` reported 274 705 bytes, and the artifact read back from the target hashed to the same sha256 as the local file.

```
MESA_REMOTE=a2ftp:mesa-mwt-one /opt/mwt/scripts/backup-mesa.sh   # empty means off
```

- The upload copies the artifact, its `.sha256`, and its `.meta`, and a failed copy never invalidates the local backup: the state becomes `REMOTE_FAIL` and `--check-freshness` exits 3 instead of 0, with the target and the reason.
- The destination keeps exactly what the local retention keeps, so enabling the flag cannot grow the remote without bound.

## RPO and RTO

| Metric | Target | Measured |
|---|---|---|
| RPO | 15 minutes or less | 15 minutes plus 0.3 s: the cron interval plus one dump |
| RTO | 15 minutes or less | 302 ms of `pg_restore`; the rest of the budget is detection and operator decision |

## Drill evidence

| Datum | Value |
|---|---|
| Artifact | `mesa_20261102T174140Z.dump` |
| Size | 274 705 bytes |
| sha256 | `a957fb3daa9479fab7f3b3adb6a6efa96f5e2acf6fbb320b3dad305bbeead0bc` |
| Dump duration | 226 ms (second run 274 ms, third 289 ms) |
| Items restored | 473 (drill floor 460) |
| Events restored | 2 436 (drill floor 2 413) |
| Orphan events | 0 |
| RLS and policies | both tables with RLS forced, 6 policies |
| `pg_restore` duration | 302 ms |
| Throwaway database | `mesa_drill_20261102t174140z`, dropped after the checks |
| Rotation | second run `kept=2 pruned=0`; third run with a planted 45-day artifact `kept=3 pruned=1` |
| Scheduled run | cron fired at 17:45:02 UTC, 467 ms, `kept=4` |
| Drill from the installed copy | 291 ms, 473 items, 2 436 events, database dropped |
| Write during a dump | 138 ms for a transaction on `mesa_items` |

## Commands

```sh
/opt/mwt/scripts/backup-mesa.sh                    # dump, verify, prune
/opt/mwt/scripts/backup-mesa.sh --prune-only       # retention only
/opt/mwt/scripts/backup-mesa.sh --check-freshness  # exit 1 if the last backup is stale or unverifiable
/opt/mwt/scripts/restore-mesa-drill.sh             # drill on a throwaway database
/opt/mwt/scripts/restore-mesa-drill.sh --keep      # keep the restored database for inspection
```

## Checks

- `scripts/test-backup-mesa.sh` covers retention, state, freshness, and the guards that refuse to point the drill at `faberloom_mesa`, `mwt_one`, `postgres`, `template0`, or `template1`.
- A failing verification deletes the artifact and exits non-zero, so a truncated dump never looks like a valid one.
- `--check-freshness` exits 1 when the last state is a failure, the artifact is gone, or the checksum no longer matches, and 3 when the local backup is valid but the off-host copy failed.

## Known limits

- The artifacts live on the same disk as the database and no off-host copy runs yet: the set covers logical corruption, operator error, and instance loss, not host loss.
- The drill checks integrity and shape (counts, orphans, RLS), not that each `payload` still means what the application expects.
- The drill restores with the dump's owners and ACLs, so it also fails if a referenced role disappeared from the cluster.

## Related

- [ADR-008: backup and restore of `faberloom_mesa`](../../ADRs_MESA/ADR-008-respaldo-mesa.md).
- [Mesa central in PostgreSQL](mesa-central-postgres.md).
