/**
 * Atomic whole-file replacement for the JSON backend.
 *
 * Publish protocol: write a same-directory temp file, fsync it, then
 * `rename()` over the target. Rename is an atomic replace on POSIX and on
 * Windows (libuv maps it to `MoveFileExW(..., MOVEFILE_REPLACE_EXISTING)`),
 * and replacement is the intended semantic here — unlike the session-log
 * backend's link()+unlink() no-clobber protocol, a unit file has exactly one
 * writer per process and last-write-wins is correct. After the rename the
 * parent directory is fsynced on POSIX so the new entry is crash-durable.
 * @module @deepseek-ai/dsh-storage-json/src/atomic
 */

import { open, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Error codes Windows reports while another handle holds the target file. */
const RENAME_RETRY_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

/**
 * Rename the temp file over its target, riding out a scanner's transient hold.
 *
 * `MoveFileExW(REPLACE_EXISTING)` answers `EPERM`/`EBUSY` while another process
 * reads the destination. The replacement is still the intended publication, so
 * a short bounded backoff avoids dropping a whole unit write on a scan.
 * @param from - temporary path.
 * @param to - target path.
 * @param operation - the rename to attempt; tests inject a failing one.
 * @param wait - the backoff; tests inject a resolved one.
 * @returns resolution after the replacement.
 */
export async function renameWithRetry(
  from: string,
  to: string,
  operation: (from: string, to: string) => Promise<void> = rename,
  wait: (ms: number) => Promise<void> = async (ms) => { await new Promise(resolve => setTimeout(resolve, ms)) },
): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await operation(from, to)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? ''
      if (!RENAME_RETRY_CODES.has(code) || attempt >= 8) throw error
      await wait(20 * (attempt + 1))
    }
  }
}

/**
 * Durably replace `path` with `data`.
 * @param path - Absolute target file path.
 * @param data - Full new file content.
 * @returns resolution after the replacement is crash-durable.
 */
export async function writeAtomic(path: string, data: string): Promise<void> {
  const tmp = join(dirname(path), `.${randomUUID()}.tmp`)
  try {
    const handle = await open(tmp, 'wx', 0o600)
    try {
      await handle.writeFile(data, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await renameWithRetry(tmp, path)
    await fsyncDirectory(dirname(path))
  } catch (error) {
    await rm(tmp, { force: true })
    throw error
  }
}

/** fsync a POSIX directory so a just-renamed entry is crash-durable. */
/* v8 ignore start -- Windows rejects O_RDONLY directory opens; POSIX coverage exercises this. */
async function fsyncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await open(path, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}
/* v8 ignore stop */
