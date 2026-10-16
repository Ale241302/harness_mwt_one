/**
 * Archive handling of the harness installer: a `.zip` the operator picked is
 * expanded into a temporary directory with `fflate`, which reads the format in
 * process on every platform.
 *
 * Every entry name is validated before anything is written, so an archive can
 * only ever address a path inside the extraction root: an entry that is
 * absolute, drive-qualified, or walks up with `..` refuses the whole archive
 * rather than being skipped, because such an archive is malformed or hostile
 * and half-expanding it would hide that.
 *
 * @module @deepseek-ai/dsh-skill-install/archive
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { unzipSync } from 'fflate'

/** Instruction file extension the installer accepts as an archive. */
export const ARCHIVE_EXTENSION = '.zip'

/**
 * Whether one archive entry name addresses a path inside the extraction root:
 * a relative POSIX path whose every segment is a real name.
 * @param name - the entry name as the archive spells it.
 * @returns whether the entry may be written under the root.
 */
export function isSafeEntryPath(name: string): boolean {
  if (name.includes('\\')) return false
  if (name.startsWith('/') || /^[A-Za-z]:/u.test(name)) return false
  const segments = name.replace(/\/+$/u, '').split('/')
  return segments.length > 0 && segments.every(segment => segment.length > 0 && segment !== '..')
}

/**
 * Expand one `.zip` under a directory that already exists.
 * @param archive - absolute path of the archive.
 * @param into - absolute extraction root.
 * @returns the number of files written.
 * @throws when the archive is not a readable zip, or an entry addresses a path outside `into`.
 */
export async function readZipArchive(archive: string, into: string): Promise<number> {
  const body = await readFile(archive)
  const entries = unzipSync(new Uint8Array(body))
  let files = 0
  for (const [name, content] of Object.entries(entries)) {
    if (!isSafeEntryPath(name)) {
      throw new Error(`harness archive entry addresses a path outside the extraction root: ${JSON.stringify(name)}`)
    }
    const target = join(into, ...name.replace(/\/+$/u, '').split('/'))
    if (name.endsWith('/')) {
      await mkdir(target, { recursive: true })
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
    files += 1
  }
  return files
}
