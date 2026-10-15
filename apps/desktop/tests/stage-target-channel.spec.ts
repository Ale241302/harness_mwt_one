import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stageDesktopChannel } from '../scripts/stage-target-channel.ts'

const TEST_ORIGIN = 'https://desktop-updates.example.com'
const temporaryDirectories: string[] = []

interface Fixture {
  readonly repositoryRoot: string
  readonly appRoot: string
  readonly artifactsRoot: string
  readonly channelRoot: string
  readonly environment: NodeJS.ProcessEnv
}

async function fixture(version = '1.2.3'): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-channel-'))
  temporaryDirectories.push(root)
  const repositoryRoot = join(root, 'repository')
  const appRoot = join(repositoryRoot, 'apps', 'desktop')
  const artifactsRoot = join(appRoot, '.desktop-build', 'artifacts')
  const channelRoot = join(root, 'channel')
  await mkdir(artifactsRoot, { recursive: true })
  await writeFile(join(repositoryRoot, 'package.json'), `${JSON.stringify({ version })}\n`)
  await writeFile(join(appRoot, 'package.json'), `${JSON.stringify({ version })}\n`)

  const base = `faberloom-${version}-win-x64`
  const executable = 'signed NSIS executable fixture'
  await writeFile(join(artifactsRoot, `${base}.exe`), executable)
  await writeFile(join(artifactsRoot, 'latest.yml'), `${JSON.stringify({
    version,
    files: [{
      url: `${base}.exe`,
      size: Buffer.byteLength(executable),
      sha512: createHash('sha512').update(executable).digest('base64'),
      blockMapSize: 128,
    }],
  })}\n`)
  await writeFile(join(artifactsRoot, 'win-x64-release.json'), `${JSON.stringify({
    schemaVersion: 1,
    target: 'win-x64',
    version,
    environment: 'test',
    publicUrl: `${TEST_ORIGIN}/_/harness/desktop/stable/win-x64/`,
  })}\n`)

  return {
    repositoryRoot,
    appRoot,
    artifactsRoot,
    channelRoot,
    environment: {
      DSH_DESKTOP_AUTO_UPDATE_ENV: 'test',
      DOWNLOAD_TEST_ORIGIN: TEST_ORIGIN,
    },
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async path => rm(path, {
    recursive: true,
    force: true,
  })))
})

describe('desktop channel staging', () => {
  it('stages a release under the path its origin serves, without COS credentials', async () => {
    const paths = await fixture()
    const plan = await stageDesktopChannel('win-x64', paths.channelRoot, {
      repositoryRoot: paths.repositoryRoot,
      appRoot: paths.appRoot,
      artifactsRoot: paths.artifactsRoot,
      environment: paths.environment,
    })

    expect(plan.publicUrl).toBe(`${TEST_ORIGIN}/_/harness/desktop/stable/win-x64/`)
    const releaseDir = join(paths.channelRoot, '_', 'harness', 'desktop', 'stable', 'win-x64')
    expect(await readFile(join(releaseDir, 'faberloom-1.2.3-win-x64.exe'), 'utf8'))
      .toBe('signed NSIS executable fixture')
    expect(JSON.parse(await readFile(join(releaseDir, 'latest.yml'), 'utf8'))).toMatchObject({ version: '1.2.3' })
  })

  it('rebuilds the release directory so a superseded installer stops being served', async () => {
    const paths = await fixture()
    const releaseDir = join(paths.channelRoot, '_', 'harness', 'desktop', 'stable', 'win-x64')
    const otherTarget = join(paths.channelRoot, '_', 'harness', 'desktop', 'stable', 'mac-arm64')
    await mkdir(releaseDir, { recursive: true })
    await mkdir(otherTarget, { recursive: true })
    await writeFile(join(releaseDir, 'faberloom-1.2.2-win-x64.exe'), 'superseded installer')
    await writeFile(join(otherTarget, 'latest-mac.yml'), 'other target')

    await stageDesktopChannel('win-x64', paths.channelRoot, {
      repositoryRoot: paths.repositoryRoot,
      appRoot: paths.appRoot,
      artifactsRoot: paths.artifactsRoot,
      environment: paths.environment,
    })

    await expect(readFile(join(releaseDir, 'faberloom-1.2.2-win-x64.exe'), 'utf8')).rejects.toThrow()
    expect(await readFile(join(releaseDir, 'latest.yml'), 'utf8')).toContain('1.2.3')
    expect(await readFile(join(otherTarget, 'latest-mac.yml'), 'utf8')).toBe('other target')
  })

  it('refuses a package whose channel metadata names another origin', async () => {
    const paths = await fixture()
    await writeFile(join(paths.artifactsRoot, 'win-x64-release.json'), `${JSON.stringify({
      schemaVersion: 1,
      target: 'win-x64',
      version: '1.2.3',
      environment: 'test',
      publicUrl: 'https://elsewhere.example/_/harness/desktop/stable/win-x64/',
    })}\n`)

    await expect(stageDesktopChannel('win-x64', paths.channelRoot, {
      repositoryRoot: paths.repositoryRoot,
      appRoot: paths.appRoot,
      artifactsRoot: paths.artifactsRoot,
      environment: paths.environment,
    })).rejects.toThrow(/completion record/u)
  })
})
