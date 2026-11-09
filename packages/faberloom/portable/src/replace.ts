/**
 * Replace writer for one portable artifact. It updates an existing destination
 * without deleting foreign files, refuses a managed file the user edited, and
 * keeps a recoverable previous tree until the new one is verified. The staging
 * and backup directories are siblings of the destination, so the rename stays
 * on one volume; the writer does not claim atomicity across volumes or sync
 * folders.
 * @module @deepseek-ai/dsh-faberloom-portable/src/replace
 */

import { createHash, createPublicKey, randomUUID, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { canonicalJson, sha256OfBytes } from './canonical.ts'
import { portableError } from './errors.ts'
import { aliasKey, assertArtifactPath, pathsOverlap } from './paths.ts'
import { planPortable } from './plan.ts'
import { signPortableManifest } from './sign.ts'
import type {
  PortableOwnership,
  PortableOwnershipFile,
  PortableOwnershipSignature,
  PortablePlan,
  PortableReplaceConfig,
  PortableReplaceHooks,
  PortableReplaceResult,
  PortableRequest,
} from './types.ts'

/** Ownership metadata directory inside the destination. */
const OWNERSHIP_DIRECTORY = '.faberloom'

/** Ownership manifest file inside the destination. */
const OWNERSHIP_PATH = `${OWNERSHIP_DIRECTORY}/ownership.json`

/** Detached ownership signature file inside the destination. */
const OWNERSHIP_SIGNATURE_PATH = `${OWNERSHIP_DIRECTORY}/ownership.sig.json`

/** Staging directory prefix, a sibling of the destination. */
const STAGING_PREFIX = '.faberloom-staging-'

/** Backup directory prefix, a sibling of the destination. */
const BACKUP_PREFIX = '.faberloom-backup-'

/** Journal file prefix, written in the destination's parent. */
const JOURNAL_PREFIX = '.faberloom-replace-'

/** One file copied from the destination into the staging tree. */
interface ForeignFile {
  readonly path: string
  readonly bytes: Buffer
  readonly sha256: string
  readonly mode: number
  readonly atime: Date
  readonly mtime: Date
}

/** Foreign files and empty directories copied forward. */
interface ForeignSnapshot {
  readonly files: readonly ForeignFile[]
  readonly directories: readonly string[]
}

/** One durable replace journal. */
interface ReplaceJournal {
  readonly formatVersion: 1
  readonly destination: string
  readonly staging: string
  readonly backup: string | null
  readonly digest: string
  readonly previousDigest: string | null
  readonly state: 'prepared' | 'swapped' | 'committed'
}

/** Whether a value is a plain record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether one path is inside a directory, after resolution. */
function inside(parent: string, child: string): boolean {
  const rel = relative(canonicalKey(parent), canonicalKey(child))
  return rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Reject a destination that is relative, UNC, a device path, or escapes. */
function assertDestination(value: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw portableError('PORTABLE_DESTINATION', 'a destination is required')
  }
  const path = value.trim()
  if (!isAbsolute(path)) throw portableError('PORTABLE_DESTINATION', `${path} is not absolute`)
  if (path.startsWith('\\\\') || path.startsWith('//')) {
    throw portableError('PORTABLE_DESTINATION', `${path} is a UNC path`)
  }
  if (path.split(/[\\/]/u).includes('..')) {
    throw portableError('PORTABLE_DESTINATION', `${path} carries a parent segment`)
  }
  const normalized = resolve(path)
  if (normalized === resolve(dirname(normalized))) {
    throw portableError('PORTABLE_DESTINATION', `${path} is a filesystem root`)
  }
  return normalized
}

/** Fold a path to the key that makes the journal stable across case and NFC. */
function canonicalKey(path: string): string {
  const normalized = path.normalize('NFC')
  return process.platform === 'win32' ? normalized.toLocaleLowerCase('en') : normalized
}

/** Resolve one destination to its real local path before any write. */
function canonicalDestination(value: string): string {
  const path = assertDestination(value)
  const parent = dirname(path)
  let parentStat
  try {
    parentStat = lstatSync(parent)
  } catch {
    throw portableError('PORTABLE_DESTINATION', `${parent} does not exist`)
  }
  if (parentStat.isSymbolicLink()) throw portableError('PORTABLE_SYMLINK', `${parent} is a symbolic link or junction`)
  if (!parentStat.isDirectory()) throw portableError('PORTABLE_DESTINATION', `${parent} is not a directory`)
  const realParent = realpathSync(parent)
  if (existsSync(path)) {
    if (lstatSync(path).isSymbolicLink()) throw portableError('PORTABLE_SYMLINK', `${path} is a symbolic link or junction`)
    return realpathSync(path)
  }
  return join(realParent, basename(path))
}

/** Refuse a symlink, junction, or special file anywhere under one directory. */
function assertNoLinks(root: string): void {
  let rootStat
  try {
    rootStat = lstatSync(root)
  } catch {
    throw portableError('PORTABLE_DESTINATION', `${root} does not exist`)
  }
  if (rootStat.isSymbolicLink()) throw portableError('PORTABLE_SYMLINK', `${root} is a symbolic link or junction`)
  if (!rootStat.isDirectory()) throw portableError('PORTABLE_DESTINATION', `${root} is not a directory`)
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = join(current, entry.name)
      const stat = lstatSync(target)
      if (stat.isSymbolicLink()) {
        throw portableError('PORTABLE_SYMLINK', `${relative(root, target)} is a symbolic link or junction`)
      }
      if (stat.isDirectory()) {
        walk(target)
        continue
      }
      if (!stat.isFile() || stat.nlink !== 1) {
        throw portableError('PORTABLE_DESTINATION', `${relative(root, target)} is not a single regular file`)
      }
    }
  }
  walk(root)
}

/** Hash one file and return its bytes plus its local metadata. */
function readHashed(path: string): { bytes: Buffer; sha256: string; mode: number; atime: Date; mtime: Date } {
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
    throw portableError('PORTABLE_CONCURRENT_CHANGE', `${path} is not a single regular file`)
  }
  const bytes = readFileSync(path)
  return { bytes, sha256: sha256OfBytes(bytes), mode: stat.mode, atime: stat.atime, mtime: stat.mtime }
}

/** Validate and read the ownership manifest and its detached signature. */
function readOwnership(
  destination: string,
  privateKeyPem: string,
  keyId: string,
): PortableOwnership | undefined {
  const ownershipPath = join(destination, OWNERSHIP_PATH)
  if (!existsSync(ownershipPath)) return undefined
  let parsed: unknown
  let signature: unknown
  try {
    parsed = JSON.parse(readFileSync(ownershipPath, 'utf8'))
    signature = JSON.parse(readFileSync(join(destination, OWNERSHIP_SIGNATURE_PATH), 'utf8'))
  } catch {
    throw portableError('PORTABLE_OWNERSHIP_INVALID', 'the ownership manifest is missing or unreadable')
  }
  if (!isRecord(parsed) || parsed['formatVersion'] !== 1 || !Array.isArray(parsed['files'])) {
    throw portableError('PORTABLE_OWNERSHIP_INVALID', 'the ownership manifest has an unexpected shape')
  }
  if (!isRecord(signature) || signature['algorithm'] !== 'ed25519' || signature['keyId'] !== keyId
    || typeof signature['value'] !== 'string') {
    throw portableError('PORTABLE_OWNERSHIP_INVALID', 'the ownership signature is invalid')
  }
  const publicKey = createPublicKey(privateKeyPem)
  let valid = false
  try {
    valid = cryptoVerify(
      null,
      Buffer.from(canonicalJson(parsed), 'utf8'),
      publicKey,
      Buffer.from(signature['value'], 'base64'),
    )
  } catch {
    valid = false
  }
  if (!valid) throw portableError('PORTABLE_OWNERSHIP_INVALID', 'the ownership signature does not verify')
  const files: PortableOwnershipFile[] = []
  const seen = new Set<string>()
  for (const entry of parsed['files']) {
    if (!isRecord(entry) || typeof entry['path'] !== 'string'
      || typeof entry['bytes'] !== 'number' || typeof entry['sha256'] !== 'string') {
      throw portableError('PORTABLE_OWNERSHIP_INVALID', 'an ownership row is incomplete')
    }
    let path: string
    try {
      path = entry['path'] === 'manifest.json' ? 'manifest.json' : assertArtifactPath(entry['path'])
    } catch {
      throw portableError('PORTABLE_OWNERSHIP_INVALID', `${entry['path']} is not an artifact path`)
    }
    const key = aliasKey(path)
    if (seen.has(key)) throw portableError('PORTABLE_OWNERSHIP_INVALID', `${path} is duplicated by alias`)
    seen.add(key)
    files.push({ path, bytes: entry['bytes'], sha256: entry['sha256'] })
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  const spaceId = typeof parsed['spaceId'] === 'string' ? parsed['spaceId'] : ''
  const artifactDigest = typeof parsed['artifactDigest'] === 'string' ? parsed['artifactDigest'] : ''
  return {
    formatVersion: 1,
    spaceId,
    artifactDigest,
    files,
  }
}

/** Build the ownership manifest for one planned artifact. */
function ownershipOf(plan: PortablePlan): PortableOwnership {
  const files: PortableOwnershipFile[] = plan.files.map(file => ({
    path: file.path,
    bytes: Buffer.byteLength(file.content, 'utf8'),
    sha256: sha256OfBytes(Buffer.from(file.content, 'utf8')),
  }))
  files.push({
    path: 'manifest.json',
    bytes: Buffer.byteLength(`${canonicalJson(plan.manifest)}\n`, 'utf8'),
    sha256: sha256OfBytes(Buffer.from(`${canonicalJson(plan.manifest)}\n`, 'utf8')),
  })
  files.sort((left, right) => left.path.localeCompare(right.path))
  return {
    formatVersion: 1,
    spaceId: plan.manifest.space.id,
    artifactDigest: plan.digest,
    files,
  }
}

/** Sign the canonical ownership manifest. */
function signOwnership(ownership: PortableOwnership, privateKeyPem: string, keyId: string): PortableOwnershipSignature {
  return signValue(ownership, privateKeyPem, keyId)
}

/** Sign one canonical value with the deployment key. */
function signValue(value: unknown, privateKeyPem: string, keyId: string): PortableOwnershipSignature {
  try {
    return {
      algorithm: 'ed25519',
      keyId,
      value: cryptoSign(null, Buffer.from(canonicalJson(value), 'utf8'), privateKeyPem).toString('base64'),
    }
  } catch (error) {
    throw portableError('PORTABLE_SIGNING', error instanceof Error ? error.message : String(error))
  }
}

/** Verify one detached signature over a canonical value. */
function verifyValue(
  value: unknown,
  signature: unknown,
  privateKeyPem: string,
  keyId: string,
): boolean {
  if (!isRecord(signature) || signature['algorithm'] !== 'ed25519' || signature['keyId'] !== keyId
    || typeof signature['value'] !== 'string') return false
  try {
    return cryptoVerify(
      null,
      Buffer.from(canonicalJson(value), 'utf8'),
      createPublicKey(privateKeyPem),
      Buffer.from(signature['value'], 'base64'),
    )
  } catch {
    return false
  }
}

/** Refuse a managed file the user changed or removed. */
function assertManagedUnchanged(destination: string, ownership: PortableOwnership): void {
  for (const file of ownership.files) {
    let stat
    try {
      stat = lstatSync(join(destination, file.path))
    } catch {
      throw portableError('PORTABLE_MANUAL_EDIT', `${file.path} was removed`)
    }
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw portableError('PORTABLE_MANUAL_EDIT', `${file.path} is no longer a regular file`)
    }
    const { sha256 } = readHashed(join(destination, file.path))
    if (sha256 !== file.sha256) throw portableError('PORTABLE_MANUAL_EDIT', `${file.path} was edited`)
  }
}

/** Collect foreign files and directories, refusing collisions with the new plan. */
function collectForeign(destination: string, ownership: PortableOwnership | undefined, plan: PortablePlan): ForeignSnapshot {
  const managed = new Set((ownership?.files ?? []).map(file => aliasKey(file.path)))
  const planned = new Set(['manifest.json', ...plan.files.map(file => file.path)])
  const plannedAliases = new Set([...planned].map(path => aliasKey(path)))
  const files: ForeignFile[] = []
  const directories: string[] = []
  const seen = new Set<string>()
  const seenDirectories = new Set<string>()
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const target = join(current, entry.name)
      const path = relative(destination, target).replaceAll('\\', '/')
      if (entry.isDirectory()) {
        if (aliasKey(path) === aliasKey(OWNERSHIP_DIRECTORY)) continue
        const directoryKey = aliasKey(path)
        if (seenDirectories.has(directoryKey)) {
          throw portableError('PORTABLE_FOREIGN_CONFLICT', `${path} is duplicated by alias`)
        }
        for (const plannedPath of planned) {
          const plannedKey = aliasKey(plannedPath)
          if (directoryKey === plannedKey || directoryKey.startsWith(`${plannedKey}/`)) {
            throw portableError('PORTABLE_FOREIGN_CONFLICT', `${path} is a directory where ${plannedPath} needs a file`)
          }
        }
        seenDirectories.add(directoryKey)
        directories.push(path)
        walk(target)
        continue
      }
      if (path === OWNERSHIP_PATH || path === OWNERSHIP_SIGNATURE_PATH) continue
      const key = aliasKey(path)
      if (managed.has(key)) continue
      if (key === aliasKey('manifest.sig.json')) {
        throw portableError('PORTABLE_FOREIGN_CONFLICT', `${path} is reserved for the detached signature`)
      }
      if (seen.has(key)) throw portableError('PORTABLE_FOREIGN_CONFLICT', `${path} is duplicated by alias`)
      seen.add(key)
      for (const plannedPath of planned) {
        if (pathsOverlap(path, plannedPath)) {
          throw portableError('PORTABLE_FOREIGN_CONFLICT', `${path} would be overwritten by ${plannedPath}`)
        }
      }
      if (plannedAliases.has(key)) throw portableError('PORTABLE_FOREIGN_CONFLICT', `${path} aliases a planned file`)
      let hashed: ReturnType<typeof readHashed>
      try {
        hashed = readHashed(target)
      } catch {
        throw portableError('PORTABLE_CONCURRENT_CHANGE', `${path} disappeared while it was being read`)
      }
      files.push({ path, ...hashed })
    }
  }
  if (existsSync(destination)) walk(destination)
  files.sort((left, right) => left.path.localeCompare(right.path))
  directories.sort((left, right) => left.localeCompare(right))
  return { files, directories }
}

/** Compare the foreign set and bytes with the snapshot taken before staging. */
function assertForeignStable(
  destination: string,
  ownership: PortableOwnership | undefined,
  plan: PortablePlan,
  expected: ForeignSnapshot,
): void {
  const current = collectForeign(destination, ownership, plan)
  if (current.files.length !== expected.files.length
    || current.directories.length !== expected.directories.length
    || current.directories.some((path, index) => aliasKey(path) !== aliasKey(expected.directories[index] ?? ''))) {
    throw portableError('PORTABLE_CONCURRENT_CHANGE', 'the foreign file set changed during the replace')
  }
  const byKey = new Map(expected.files.map(file => [aliasKey(file.path), file]))
  for (const file of current.files) {
    const previous = byKey.get(aliasKey(file.path))
    if (previous === undefined || previous.sha256 !== file.sha256) {
      throw portableError('PORTABLE_CONCURRENT_CHANGE', `${file.path} changed during the replace`)
    }
  }
}

/** Whether a path is a symbolic link or a directory link. */
function isLink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/** Remove one staging or backup directory only when it is ours. */
function removeOwned(path: string, parent: string, prefix: string): void {
  if (!inside(parent, path) || !basename(path).startsWith(prefix)) return
  if (isLink(path)) {
    try {
      unlinkSync(path)
    } catch {
      // A link already gone is not this run's problem.
    }
    return
  }
  rmSync(path, { recursive: true, force: true })
}

/** Journal path for one destination. */
function journalPath(destination: string): string {
  const digest = createHash('sha256').update(canonicalKey(destination), 'utf8').digest('hex').slice(0, 16)
  return join(dirname(destination), `${JOURNAL_PREFIX}${digest}.json`)
}

/** Read and validate one signed journal, refusing paths it does not own. */
function readJournal(destination: string, privateKeyPem: string, keyId: string): ReplaceJournal | undefined {
  const path = journalPath(destination)
  if (!existsSync(path)) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    throw portableError('PORTABLE_RECOVERY', 'the replace journal is unreadable')
  }
  if (!isRecord(parsed) || parsed['formatVersion'] !== 1 || !isRecord(parsed['journal'])) {
    throw portableError('PORTABLE_RECOVERY', 'the replace journal has an unexpected shape')
  }
  if (!verifyValue(parsed['journal'], parsed['signature'], privateKeyPem, keyId)) {
    throw portableError('PORTABLE_RECOVERY', 'the replace journal signature does not verify')
  }
  const journal = parsed['journal']
  const recordedDestination = typeof journal['destination'] === 'string' ? journal['destination'] : ''
  if (canonicalKey(recordedDestination) !== canonicalKey(destination)) {
    throw portableError('PORTABLE_RECOVERY', 'the replace journal does not name this destination')
  }
  const staging = typeof journal['staging'] === 'string' ? journal['staging'] : ''
  const backup = journal['backup'] === null
    ? null
    : typeof journal['backup'] === 'string' ? journal['backup'] : ''
  const parent = dirname(destination)
  if (!inside(parent, staging) || !basename(staging).startsWith(STAGING_PREFIX)) {
    throw portableError('PORTABLE_RECOVERY', 'the journal staging path is not owned by this writer')
  }
  if (backup !== null && (!inside(parent, backup) || !basename(backup).startsWith(BACKUP_PREFIX))) {
    throw portableError('PORTABLE_RECOVERY', 'the journal backup path is not owned by this writer')
  }
  const state = journal['state']
  if (state !== 'prepared' && state !== 'swapped' && state !== 'committed') {
    throw portableError('PORTABLE_RECOVERY', 'the journal state is unknown')
  }
  const digest = typeof journal['digest'] === 'string' ? journal['digest'] : ''
  const previousDigest = journal['previousDigest'] === null
    ? null
    : typeof journal['previousDigest'] === 'string' ? journal['previousDigest'] : ''
  if (digest.length === 0) throw portableError('PORTABLE_RECOVERY', 'the journal has no artifact digest')
  return { formatVersion: 1, destination, staging, backup, digest, previousDigest, state }
}

/** Write one signed journal atomically enough for recovery. */
function writeJournal(journal: ReplaceJournal, privateKeyPem: string, keyId: string): void {
  const path = journalPath(journal.destination)
  const temporary = `${path}.${randomUUID()}.tmp`
  const envelope = { formatVersion: 1, journal, signature: signValue(journal, privateKeyPem, keyId) }
  try {
    writeFileSync(temporary, `${canonicalJson(envelope)}\n`, 'utf8')
    renameSync(temporary, path)
  } catch (error) {
    try {
      unlinkSync(temporary)
    } catch {
      // The temporary journal is already gone.
    }
    throw error
  }
}

/** Remove one journal this writer created. */
function removeJournal(destination: string): void {
  const path = journalPath(destination)
  if (existsSync(path)) unlinkSync(path)
}

/** Read the artifact digest a destination currently carries, when readable. */
function manifestDigestAt(directory: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
    return isRecord(parsed) && typeof parsed['digest'] === 'string' ? parsed['digest'] : undefined
  } catch {
    return undefined
  }
}

/** Remove the temporary journals a crash may have left for this destination. */
function removeJournalTemporaries(destination: string): void {
  const path = journalPath(destination)
  const parent = dirname(path)
  const prefix = `${basename(path)}.`
  for (const name of readdirSync(parent)) {
    if (!name.startsWith(prefix) || !name.endsWith('.tmp')) continue
    try {
      unlinkSync(join(parent, name))
    } catch {
      // A temporary journal the filesystem still holds is left for the next run.
    }
  }
}

/** Recover the previous tree or clean the backup a crash left. */
function recover(destination: string, privateKeyPem: string, keyId: string): void {
  const journal = readJournal(destination, privateKeyPem, keyId)
  if (journal === undefined) return
  const parent = dirname(destination)
  for (const owned of [journal.staging, journal.backup]) {
    if (owned === null || !existsSync(owned)) continue
    if (lstatSync(owned).isSymbolicLink()) {
      throw portableError('PORTABLE_RECOVERY', `${owned} is a symbolic link or junction`)
    }
  }
  const current = existsSync(destination) ? manifestDigestAt(destination) : undefined
  if (current === journal.digest || current === journal.previousDigest) {
    // The destination is either the new verified tree or the previous one; the
    // backup is a duplicate and the staging tree is stale.
    removeOwned(journal.staging, parent, STAGING_PREFIX)
    if (journal.backup !== null) removeOwned(journal.backup, parent, BACKUP_PREFIX)
    removeJournal(destination)
    return
  }
  if (journal.backup !== null && existsSync(journal.backup)) {
    // The destination is missing or does not carry a known digest: restore the
    // previous tree, removing only a tree this journal did not produce.
    if (existsSync(destination)) rmSync(destination, { recursive: true, force: true })
    renameSync(journal.backup, destination)
    removeOwned(journal.staging, parent, STAGING_PREFIX)
    removeJournal(destination)
    return
  }
  removeOwned(journal.staging, parent, STAGING_PREFIX)
  removeJournal(destination)
  if (journal.previousDigest === null) return
  if (existsSync(destination)) {
    throw portableError('PORTABLE_RECOVERY', `${destination} has no known digest and no backup`)
  }
}

/** Verify the planned files and manifest in one directory. */
function verifyPlanned(directory: string, plan: PortablePlan): void {
  for (const file of plan.files) {
    let stat
    try {
      stat = lstatSync(join(directory, file.path))
    } catch {
      throw portableError('PORTABLE_WRITE_FAILED', `${file.path} is missing after the swap`)
    }
    if (!stat.isFile() || stat.nlink !== 1) {
      throw portableError('PORTABLE_WRITE_FAILED', `${file.path} is not a single regular file after the swap`)
    }
    const content = readFileSync(join(directory, file.path))
    if (content.length !== Buffer.byteLength(file.content, 'utf8') || sha256OfBytes(content) !== sha256OfBytes(Buffer.from(file.content, 'utf8'))) {
      throw portableError('PORTABLE_WRITE_FAILED', `${file.path} changed after the swap`)
    }
  }
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
  } catch {
    throw portableError('PORTABLE_WRITE_FAILED', 'the manifest is missing after the swap')
  }
  if (!isRecord(manifest) || manifest['digest'] !== plan.digest) {
    throw portableError('PORTABLE_WRITE_FAILED', 'the manifest digest changed after the swap')
  }
}

/** Write the new tree into one fresh staging directory. */
function writeStaging(
  staging: string,
  plan: PortablePlan,
  ownership: PortableOwnership,
  privateKeyPem: string,
  keyId: string,
  foreign: ForeignSnapshot,
  hooks: PortableReplaceHooks | undefined,
): void {
  try {
    mkdirSync(staging, { recursive: false })
    hooks?.beforeWrite?.()
    for (const directory of foreign.directories) {
      mkdirSync(join(staging, directory), { recursive: true })
    }
    for (const file of plan.files) {
      const target = join(staging, file.path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.content, 'utf8')
    }
    const manifestText = `${canonicalJson(plan.manifest)}\n`
    writeFileSync(join(staging, 'manifest.json'), manifestText, 'utf8')
    for (const file of foreign.files) {
      const target = join(staging, file.path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, file.bytes)
      utimesSync(target, file.atime, file.mtime)
      chmodSync(target, file.mode)
    }
    const ownershipText = `${canonicalJson(ownership)}\n`
    mkdirSync(join(staging, OWNERSHIP_DIRECTORY), { recursive: true })
    writeFileSync(join(staging, OWNERSHIP_PATH), ownershipText, 'utf8')
    writeFileSync(join(staging, OWNERSHIP_SIGNATURE_PATH), `${canonicalJson(signOwnership(ownership, privateKeyPem, keyId))}\n`, 'utf8')
    verifyPlanned(staging, plan)
  } catch (error) {
    removeOwned(staging, dirname(staging), STAGING_PREFIX)
    if (error instanceof Error && error.message.startsWith('faberloom: PORTABLE_')) throw error
    throw portableError('PORTABLE_WRITE_FAILED', error instanceof Error ? error.message : String(error))
  }
}

/** Whether the caller asked the writer to leave a crash state for recovery. */
function isCrash(error: unknown): boolean {
  return isRecord(error) && error['faberloomCrash'] === true
}

/**
 * Create or update one portable artifact in place. The previous tree is kept
 * as a backup until the new one is verified; foreign files are copied forward
 * and managed files the user edited are refused.
 * @param config - destination, signing key, key id, ceiling, and hooks.
 * @param request - identity, contributions, and fixed versions.
 * @returns what was written, preserved, removed, and backed up.
 * @throws {Error} `PORTABLE_DESTINATION`, `PORTABLE_SYMLINK`,
 * `PORTABLE_OWNERSHIP_INVALID`, `PORTABLE_MANUAL_EDIT`,
 * `PORTABLE_FOREIGN_CONFLICT`, `PORTABLE_CONCURRENT_CHANGE`,
 * `PORTABLE_WRITE_FAILED`, `PORTABLE_RECOVERY`, or a planner refusal.
 */
export function replacePortable(config: PortableReplaceConfig, request: PortableRequest): PortableReplaceResult {
  if (config.signingKeyPem.trim().length === 0) throw portableError('PORTABLE_SIGNING', 'no signing key is configured')
  if (config.keyId.trim().length === 0) throw portableError('PORTABLE_SIGNING', 'no key id is configured')
  const destination = canonicalDestination(config.destination)
  const parent = dirname(destination)
  removeJournalTemporaries(destination)
  if (existsSync(destination)) assertNoLinks(destination)
  recover(destination, config.signingKeyPem, config.keyId)
  // Recovery may have restored a backup; revalidate before reading or copying.
  if (existsSync(destination)) assertNoLinks(destination)

  const planned = planPortable({
    ...request,
    ...(config.maxBytes === undefined ? {} : { maxBytes: config.maxBytes }),
  })
  const signature = signPortableManifest(planned.manifest, config.signingKeyPem, config.keyId)
  const ownership = ownershipOf(planned)
  const destinationExists = existsSync(destination)
  const previous = destinationExists
    ? readOwnership(destination, config.signingKeyPem, config.keyId)
    : undefined
  if (previous !== undefined && previous.spaceId !== planned.manifest.space.id) {
    throw portableError('PORTABLE_IDENTITY_CONFLICT', `${destination} belongs to Space ${previous.spaceId}`)
  }
  if (previous !== undefined) assertManagedUnchanged(destination, previous)
  const foreign = collectForeign(destination, previous, planned)

  const staging = join(parent, `${STAGING_PREFIX}${randomUUID()}`)
  const backup = destinationExists ? join(parent, `${BACKUP_PREFIX}${randomUUID()}`) : null
  writeStaging(staging, planned, ownership, config.signingKeyPem, config.keyId, foreign, config.hooks)
  // Revalidate the sources after the staging write: a user edit, deletion, or
  // new foreign file during the write must not be silently replaced.
  try {
    assertForeignStable(destination, previous, planned, foreign)
    if (previous !== undefined) assertManagedUnchanged(destination, previous)
    if (existsSync(destination)) assertNoLinks(destination)
  } catch (error) {
    removeOwned(staging, parent, STAGING_PREFIX)
    throw error
  }

  const previousDigest = destinationExists
    ? previous?.artifactDigest ?? manifestDigestAt(destination) ?? null
    : null
  const journal: ReplaceJournal = {
    formatVersion: 1,
    destination,
    staging,
    backup,
    digest: planned.digest,
    previousDigest,
    state: 'prepared',
  }
  let cleanupPending = false
  try {
    writeJournal(journal, config.signingKeyPem, config.keyId)
    if (backup !== null) renameSync(destination, backup)
    config.hooks?.afterBackup?.()
    renameSync(staging, destination)
    writeJournal({ ...journal, state: 'swapped' }, config.signingKeyPem, config.keyId)
    verifyPlanned(destination, planned)
  } catch (error) {
    if (isCrash(error)) throw error
    let committed = false
    if (existsSync(destination)) {
      try {
        verifyPlanned(destination, planned)
        committed = true
      } catch {
        committed = false
      }
    }
    if (!committed) {
      const parentNow = dirname(destination)
      if (backup !== null && existsSync(backup)) {
        // The new tree did not verify: restore the previous tree and remove
        // only the tree this run created.
        if (existsSync(destination)) rmSync(destination, { recursive: true, force: true })
        renameSync(backup, destination)
        removeOwned(staging, parentNow, STAGING_PREFIX)
        removeJournal(destination)
      } else {
        if (!destinationExists && existsSync(destination)) rmSync(destination, { recursive: true, force: true })
        removeOwned(staging, parentNow, STAGING_PREFIX)
        removeJournal(destination)
      }
      if (error instanceof Error && error.message.startsWith('faberloom: PORTABLE_')) throw error
      throw portableError('PORTABLE_WRITE_FAILED', error instanceof Error ? error.message : String(error))
    }
    // The new tree verified despite the journal error; fall through to cleanup.
  }

  // The new tree verified: the replace is committed. Cleanup failure leaves
  // the signed journal and backup for the next run; it never rolls back.
  try {
    config.hooks?.afterSwap?.()
    config.hooks?.beforeCleanup?.()
    if (backup !== null) removeOwned(backup, parent, BACKUP_PREFIX)
    writeJournal({ ...journal, state: 'committed' }, config.signingKeyPem, config.keyId)
    removeJournal(destination)
  } catch (error) {
    if (isCrash(error)) throw error
    cleanupPending = true
  }

  const removed = (previous?.files ?? [])
    .map(file => file.path)
    .filter(path => !ownership.files.some(file => aliasKey(file.path) === aliasKey(path)))
  return {
    path: destination,
    manifest: planned.manifest,
    signature,
    digest: planned.digest,
    rejected: planned.rejected,
    written: [...planned.files.map(file => file.path), 'manifest.json'],
    preserved: foreign.files.map(file => file.path),
    preservedDirectories: foreign.directories,
    removed,
    backup,
    cleanupPending,
    ownership,
  }
}
