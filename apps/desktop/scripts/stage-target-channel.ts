/**
 * Stage one validated Desktop release into the directory tree its update
 * origin serves.
 *
 * The published layout is not free: the packaged application computes the
 * updater URL from its origin and the fixed `_/harness/desktop/stable/<target>`
 * path, so a file the origin cannot serve at exactly that path is a file the
 * application never finds. Staging therefore writes the validated channel plan
 * verbatim and rebuilds the release directory, so a superseded installer or
 * blockmap stops being served instead of lingering beside the current one.
 *
 * The transfer itself belongs to the deployment: `scripts/publish-desktop-channel.ps1`
 * stages here and copies the result to the host that serves the origin.
 */

import { copyFile, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  createDesktopChannelPlan,
  type DesktopChannelPlan,
  type DesktopReleasePlanOptions,
} from './desktop-upload-plan.ts'
import type { DesktopPackageTargetName } from './package-target.ts'

/** Environment variable naming the directory tree the update origin serves. */
export const DESKTOP_CHANNEL_DIR_ENV = 'DSH_DESKTOP_CHANNEL_DIR'

const SUPPORTED_TARGETS = new Set<DesktopPackageTargetName>(['mac-arm64', 'mac-x64', 'win-x64'])

function targetName(value: string): DesktopPackageTargetName {
  if (!SUPPORTED_TARGETS.has(value as DesktopPackageTargetName)) {
    throw new Error(`desktop channel: unsupported target ${JSON.stringify(value)}; expected ${[...SUPPORTED_TARGETS].join(', ')}`)
  }
  return value as DesktopPackageTargetName
}

/**
 * Copy one validated release into the channel directory that serves its origin.
 * @param targetNameValue - Fixed platform and architecture to stage.
 * @param channelDir - Directory the update origin maps to its root.
 * @param options - Optional filesystem roots and environment for tests or release automation.
 * @returns The staged channel plan, so callers can report the served URL.
 */
export async function stageDesktopChannel(
  targetNameValue: DesktopPackageTargetName,
  channelDir: string,
  options: DesktopReleasePlanOptions = {},
): Promise<DesktopChannelPlan> {
  const plan = await createDesktopChannelPlan(targetNameValue, options)
  const root = resolve(channelDir)
  await rm(resolve(root, plan.keyPrefix), { recursive: true, force: true })
  for (const artifact of plan.artifacts) {
    const destination = resolve(root, artifact.key)
    await mkdir(dirname(destination), { recursive: true })
    await copyFile(artifact.path, destination)
  }
  return plan
}

async function main(): Promise<void> {
  const { positionals } = parseArgs({ args: process.argv.slice(2), allowPositionals: true })
  const requested = positionals[0]
  if (requested === undefined || positionals.length !== 1) {
    throw new Error('desktop channel: expected exactly one target')
  }
  const target = targetName(requested)
  const channelDir = process.env[DESKTOP_CHANNEL_DIR_ENV]?.trim()
  if (channelDir === undefined || channelDir === '') {
    throw new Error(`desktop channel: ${DESKTOP_CHANNEL_DIR_ENV} must be set to the directory the update origin serves`)
  }
  const plan = await stageDesktopChannel(target, channelDir)
  for (const artifact of plan.artifacts) {
    process.stdout.write(`desktop channel: staged ${artifact.key}\n`)
  }
  process.stdout.write(`desktop channel: ${plan.target} ${plan.version} -> ${plan.publicUrl}\n`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
