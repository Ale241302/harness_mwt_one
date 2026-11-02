# Mesa backup and restore

English | [中文](mesa-backup.zh.md)

`faberloom_mesa` is dumped with `pg_dump -Fc` every 15 minutes; each run verifies its own artifact, copies it to an off-host mailbox, and applies a bounded retention. A weekly drill restores the newest artifact into a throwaway database, checks the counts, and drops it; a second weekly drill does the same with the copy downloaded from the mailbox. The decision, its RPO/RTO reasoning, and the rejected point-in-time-recovery alternative live in [ADR-008](../../ADRs_MESA/ADR-008-respaldo-mesa.md); this page records the installed pieces and the drill evidence.

## Installed pieces

- `scripts/backup-mesa.sh`, installed at `/opt/mwt/scripts/backup-mesa.sh`: dump, sha256 plus `pg_restore --list` verification, `.meta` with the source counts, retention, off-host copy.
- `scripts/restore-mesa-drill.sh`, installed at `/opt/mwt/scripts/restore-mesa-drill.sh`: restore into `mesa_drill_<UTC>`, verify, drop; `--offsite` drills the copy downloaded from the mailbox.
- `scripts/mesa-offsite.py` and `scripts/mesa-env.sh`: the mailbox client and the `.env` reader the two scripts share.
- `/etc/mwt/mesa-offsite.env` (mode 600, root): the mailbox account. The scripts read it without executing it, and a variable already exported wins.
- Artifacts in `/opt/backups/mesa-mwt-one` (mode 700), outside the container and outside the PostgreSQL data volume.
- State in `/opt/mwt/mesa_backup_status.txt` and `/opt/mwt/mesa_restore_drill_status.txt`; log in `/opt/mwt/logs/mesa_backup.log`.

## Schedule

```
*/15 * * * * flock -n /run/lock/mesa-backup.lock /opt/mwt/scripts/backup-mesa.sh >> /opt/mwt/logs/mesa_backup.log 2>&1 # mesa_backup
20 5 * * 0 flock -n /run/lock/mesa-backup.lock /opt/mwt/scripts/restore-mesa-drill.sh >> /opt/mwt/logs/mesa_backup.log 2>&1 # mesa_restore_drill
40 5 * * 0 flock -n /run/lock/mesa-backup.lock /opt/mwt/scripts/restore-mesa-drill.sh --offsite >> /opt/mwt/logs/mesa_backup.log 2>&1 # mesa_restore_drill_offsite
```

## Off-host copy

`MESA_OFFSITE=on` sends each artifact to a folder of the `alejandro@muitowork.com` mailbox on Hostinger (`INBOX.Mesa-Backups`), which is a different provider and a different host from the VPS. The upload is verified, not assumed: the client reads the message back, extracts the attachment, and compares its sha256 with the local file before it prunes the mailbox. Appending the same artifact twice is a no-op (`repeated=1`), so a retried cron run does not duplicate anything.

- Each message carries the artifact as an attachment and the `.meta` contents in the body between `--- meta ---` and `--- end meta ---`, so a restore also recovers the counts it must match.
- With `MESA_OFFSITE_AGE_RECIPIENT` the attachment is encrypted with age (`<dump>.age`) and the subject adds `plain_sha256` and `enc=age`. Reading the mailbox no longer exposes the database: an attacker would need the identity file, which `MESA_OFFSITE_AGE_IDENTITY` points at and a copy of which is kept on the operator's machine.
- Mailbox retention keeps every copy within 72 hours, one per UTC day for 30 days, at most 200 messages, and never fewer than 3, in that order.
- A dump larger than `MESA_OFFSITE_MAX_MB` (20 MB) is refused with `too_large` instead of silently truncated. Today's artifact is 286 625 bytes and the mailbox has 50 GB.
- A failed copy never invalidates the local backup: the state becomes `REMOTE_FAIL` with `offsite_reason`, and `--check-freshness` exits 3 instead of 0.
- The rclone leg (`MESA_REMOTE`) remains available for a second destination and is off. The measured `a2ftp` failure and the `mlocal` rehearsal are in [ADR-008](../../ADRs_MESA/ADR-008-respaldo-mesa.md).

```
MESA_OFFSITE=on /opt/mwt/scripts/backup-mesa.sh   # the .env supplies account and policy
/opt/mwt/scripts/mesa-offsite.py list             # catalog: name, bytes, sha256, counts
/opt/mwt/scripts/mesa-offsite.py check            # download the newest and compare sha256
/opt/mwt/scripts/mesa-offsite.py fetch --latest --out-dir /tmp/restore
/opt/mwt/scripts/mesa-offsite.py quota
```

### SFTP endpoint on the VPS

`ftp.muitowork.com` resolves to the VPS and serves an isolated SFTP for manual transfers: `sshd-mesa.service` listens on port 2223 with its own configuration, accepts only `mesa-backup`, forces `internal-sftp`, chroots to `/srv/mesa-backups`, and refuses passwords, TTY, and forwarding. The client key is `/root/.ssh/mesa_sftp_ed25519`; `scripts/mesa-sftp-setup.sh` installs the whole endpoint and `--check` reports its state.

This endpoint is **not** an off-host copy: it shares the host and the disk with the database. It exists because the domain's FTP record pointed at a suspended a2hosting account, and it replaces that record; the mailbox above is the copy that survives losing the VPS.

## RPO and RTO

| Metric | Target | Measured |
|---|---|---|
| RPO | 15 minutes or less | 15 minutes plus 0.3 s: the cron interval plus one dump; the off-host copy runs in the same pass |
| RTO | 15 minutes or less | 309 ms of `pg_restore` locally, 305 ms from the mailbox copy; the rest of the budget is detection and operator decision |

## Drill evidence

| Datum | Value |
|---|---|
| Artifact | `mesa_20261102T191843Z.dump` |
| Size | 286 625 bytes |
| sha256 | `80aa8ef1c6d30c6d7e91c410872d94129aa1147141e29a526d1b776bb1cf510b` |
| Dump duration | 201 ms |
| Off-host upload | mailbox uid 16, read back and compared before pruning |
| Items restored | 500 (drill floor 460) |
| Events restored | 2 477 (drill floor 2 413) |
| Orphan events | 0 |
| RLS and policies | both tables with RLS forced, 6 policies |
| `pg_restore` duration | 309 ms local, 305 ms from the mailbox |
| Throwaway databases | `mesa_drill_20261102t191853z` and `mesa_drill_20261102t191854z`, both dropped |
| Suite | `scripts/test-backup-mesa.sh`: 86 checks, 0 failures |
| Write during a dump | 138 ms for a transaction on `mesa_items` |

## Commands

```sh
/opt/mwt/scripts/backup-mesa.sh                    # dump, verify, off-host copy, prune
/opt/mwt/scripts/backup-mesa.sh --prune-only       # retention only
/opt/mwt/scripts/backup-mesa.sh --check-freshness  # exit 1 if stale or unverifiable, 3 if the copy failed
/opt/mwt/scripts/restore-mesa-drill.sh             # drill on a throwaway database
/opt/mwt/scripts/restore-mesa-drill.sh --offsite   # drill the copy downloaded from the mailbox
/opt/mwt/scripts/restore-mesa-drill.sh --keep      # keep the restored database for inspection
```

## Checks

- `scripts/test-backup-mesa.sh` covers retention, state, freshness, the `.env` reader, the mailbox client's retention and subject parsing, and the guards that refuse to point the drill at `faberloom_mesa`, `mwt_one`, `postgres`, `template0`, or `template1`.
- A failing verification deletes the artifact and exits non-zero, so a truncated dump never looks like a valid one.
- `--check-freshness` exits 1 when the last state is a failure, the artifact is gone, or the checksum no longer matches, and 3 when the local backup is valid but an off-host copy failed.

## Known limits

- The mailbox stores ciphertext under a key the VPS holds at `/etc/mwt/mesa-age.key` (mode 600) and the operator keeps a copy of at `%USERPROFILE%\.mesa\mesa-age.key`. Losing both copies makes the off-host artifacts unreadable; the local backups still restore.
- The drill checks integrity and shape (counts, orphans, RLS), not that each `payload` still means what the application expects.
- The drill restores with the dump's owners and ACLs, so it also fails if a referenced role disappeared from the cluster.
- The off-host leg depends on Hostinger's mail service: an outage leaves the local backup valid and the state at `REMOTE_FAIL` until the next successful upload.

## Related

- [ADR-008: backup and restore of `faberloom_mesa`](../../ADRs_MESA/ADR-008-respaldo-mesa.md).
- [Mesa central in PostgreSQL](mesa-central-postgres.md).
