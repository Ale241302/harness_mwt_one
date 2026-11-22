/**
 * Skills-root resolution for the installer.
 *
 * These paths mirror the roots the harness filesystem provider scans
 * (`<project>/.dsh/skills` and `<dshHome>/skills`), so an installed skill is
 * discovered by the running harness without a restart.
 *
 * @module
 */

import { access } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/**
 * Project-scoped skills root.
 * @param projectRoot - the resolved project root.
 * @returns the absolute project skills root.
 */
export function projectSkillRoot(projectRoot: string): string {
  return join(projectRoot, '.dsh', 'skills')
}

/**
 * User-scoped skills root.
 * @param dshHome - resolved DeepSeek Harness home.
 * @returns the absolute user skills root.
 */
export function userSkillRoot(dshHome: string): string {
  return join(dshHome, 'skills')
}

/**
 * Resolve the project root a workspace-scoped install targets: the nearest
 * ancestor of `cwd` that holds `.git`, or `cwd` itself when none does.
 * @param cwd - session working directory.
 * @returns the absolute project root.
 */
export async function findSkillProjectRoot(cwd: string): Promise<string> {
  const start = resolve(cwd)
  let current = start
  for (;;) {
    if (await exists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    // A missing or unreadable candidate only makes this ancestor unusable.
    return false
  }
}
