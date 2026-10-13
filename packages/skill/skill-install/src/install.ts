/**
 * Filesystem side of the native skill installer: copy a validated skill folder
 * into a scanned skills root, record provenance beside it, and remove it again.
 *
 * The two roots this module writes through are the exact directories
 * `@deepseek-ai/dsh-skill-filesystem` scans as `project-dsh` and `user-dsh`, so
 * an installed skill is first-class in the provider's catalog rather than a
 * parallel registry. Each installed skill carries a `.dsh-skill-install.json`
 * marker holding the source folder and the `SKILL.md` digest; the marker is what
 * makes an install idempotent (the same digest installs nothing) and reversible
 * (only a marked skill is ever removed, never a hand-authored one).
 *
 * @module @deepseek-ai/dsh-skill-install/install
 */

import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { findSkillProjectRoot, projectSkillRoot, userSkillRoot } from '@deepseek-ai/dsh-skill-filesystem'
import { pathIsDirectory } from './detect.ts'
import type { DetectedSkill, SkillInstallOutcome, SkillInstallRow, SkillScope, SkillUninstallStatus } from './types.ts'

/** Instruction file every skill directory must hold; also the idempotence identity. */
export const SKILL_FILE = 'SKILL.md'

/** Provenance marker written into an installed skill directory. */
export const INSTALL_MARKER_FILE = '.dsh-skill-install.json'

/** What one installed skill's marker records. */
interface InstallMarker {
  readonly name: string
  readonly destination: SkillScope
  readonly source: string
  readonly installedAt: string
  /** sha256 of the installed `SKILL.md`, compared to make a repeat install a no-op. */
  readonly digest: string
}

/**
 * Resolve the root one scope writes into.
 * @param destination - `workspace` or `global`.
 * @param cwd - session working directory the workspace root is derived from.
 * @param dshHome - resolved DeepSeek Harness home.
 * @param fs - optional filesystem service used for the project-root probe.
 * @returns the absolute skills root, or null when a workspace scope has no workspace.
 */
export async function resolveScopeRoot(
  destination: SkillScope,
  cwd: string | undefined,
  dshHome: string,
  fs: FileSystem | undefined,
): Promise<string | null> {
  if (destination === 'global') return userSkillRoot(dshHome)
  return cwd === undefined ? null : projectSkillRoot(await findSkillProjectRoot(cwd, fs))
}

/** sha256 of one candidate's `SKILL.md`, the identity idempotence compares. */
async function skillDigest(skill: DetectedSkill): Promise<string> {
  const content = await readFile(join(skill.directory, SKILL_FILE))
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Read one skill directory's install marker, or undefined when it has none.
 * @param directory - installed skill directory to inspect.
 * @returns the recorded marker, or undefined when it is absent or unreadable.
 */
export async function readInstallMarker(directory: string): Promise<InstallMarker | undefined> {
  let raw: string
  try {
    raw = await readFile(join(directory, INSTALL_MARKER_FILE), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(raw) as Partial<InstallMarker>
    if (typeof parsed.name !== 'string' || typeof parsed.digest !== 'string') return undefined
    return parsed as InstallMarker
  } catch {
    // A truncated or externally edited marker is treated as no marker, so its
    // directory is never removed as an install.
    return undefined
  }
}

/** Write one skill directory's install marker. */
async function writeInstallMarker(directory: string, marker: InstallMarker): Promise<void> {
  await writeFile(join(directory, INSTALL_MARKER_FILE), `${JSON.stringify(marker)}\n`, 'utf8')
}

/** Copy one validated skill directory into its target, without any source marker. */
async function copySkillDirectory(skill: DetectedSkill, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  await cp(skill.directory, target, {
    recursive: true,
    filter: source => basename(source) !== INSTALL_MARKER_FILE,
  })
}

/**
 * Install one validated skill into a resolved root.
 * @param skill - validated source skill.
 * @param root - resolved skills root to write into.
 * @param destination - scope the root belongs to, recorded in the marker.
 * @param replace - replace an existing skill of the same name instead of skipping it.
 * @returns the outcome for this skill.
 */
export async function installSkillFolder(
  skill: DetectedSkill,
  root: string,
  destination: SkillScope,
  replace: boolean,
): Promise<SkillInstallOutcome> {
  const target = join(root, skill.name)
  const digest = await skillDigest(skill)
  if (await pathIsDirectory(target)) {
    const marker = await readInstallMarker(target)
    if (marker?.digest === digest) return { name: skill.name, status: 'already-installed' }
    if (!replace) return { name: skill.name, status: 'skipped', reason: 'exists' }
    await rm(target, { recursive: true, force: true })
    await copySkillDirectory(skill, target)
    await writeInstallMarker(target, markerRecord(skill, destination, digest))
    return { name: skill.name, status: 'replaced' }
  }
  await copySkillDirectory(skill, target)
  await writeInstallMarker(target, markerRecord(skill, destination, digest))
  return { name: skill.name, status: 'installed' }
}

/** The marker record for one freshly written skill directory. */
function markerRecord(skill: DetectedSkill, destination: SkillScope, digest: string): InstallMarker {
  return {
    name: skill.name,
    destination,
    source: skill.directory,
    installedAt: new Date().toISOString(),
    digest,
  }
}

/**
 * Remove one folder-installed skill from a resolved root. A directory without a
 * readable install marker is never removed.
 * @param root - resolved skills root holding the skill.
 * @param name - skill name (its directory).
 * @returns whether the skill was removed, absent, or not an install.
 */
export async function removeInstalledSkill(root: string, name: string): Promise<SkillUninstallStatus> {
  const target = join(root, name)
  if (!(await pathIsDirectory(target))) return 'not-found'
  if (await readInstallMarker(target) === undefined) return 'not-an-install'
  await rm(target, { recursive: true, force: true })
  return 'removed'
}

/**
 * Read every folder-installed skill under one resolved root.
 * @param root - resolved skills root to scan.
 * @param destination - scope the root belongs to.
 * @returns one row per marked skill directory.
 */
export async function readInstalls(root: string, destination: SkillScope): Promise<SkillInstallRow[]> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }
  const rows: SkillInstallRow[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const marker = await readInstallMarker(join(root, entry.name))
    if (marker === undefined) continue
    rows.push({
      name: marker.name,
      destination,
      root,
      source: marker.source,
      installedAt: marker.installedAt,
    })
  }
  return rows
}

/**
 * Summarise one install call's per-skill outcomes.
 * @param outcomes - outcomes in report order.
 * @returns the overall verdict.
 */
export function summarizeOutcomes(outcomes: readonly SkillInstallOutcome[]): 'installed' | 'already-installed' | 'skipped' | 'refused' {
  if (outcomes.some(outcome => outcome.status === 'installed' || outcome.status === 'replaced')) return 'installed'
  if (outcomes.some(outcome => outcome.status === 'already-installed')) return 'already-installed'
  if (outcomes.length > 0 && outcomes.every(outcome => outcome.status === 'skipped')) return 'skipped'
  return 'refused'
}
