import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { en, zh } from '../src/locale.ts'

/** Release identity the packaging tests share; mirrors the macOS signature suite. */
const RELEASE_ENVIRONMENT = {
  DSH_DESKTOP_APP_ID: 'com.example.desktop',
  DSH_DESKTOP_TARGET_PLATFORM: 'darwin',
  DSH_DESKTOP_TARGET_ARCH: 'arm64',
  DSH_DESKTOP_MACOS_SIGNING_IDENTITY: 'Example Company (TEAMID1234)',
  DSH_DESKTOP_MACOS_TEAM_ID: 'TEAMID1234',
  APPLE_API_KEY: '/private/credentials/AuthKey_TEST123456.p8',
  APPLE_API_KEY_ID: 'TEST123456',
  APPLE_API_ISSUER: '11111111-2222-3333-4444-555555555555',
  DOWNLOAD_TEST_ORIGIN: 'https://desktop-updates.example.com',
}

const COLD_IMPORT_TIMEOUT_MS = 60_000

beforeAll(async () => {
  for (const [name, value] of Object.entries(RELEASE_ENVIRONMENT)) vi.stubEnv(name, value)
  await import('../electron-builder.config.mjs')
}, COLD_IMPORT_TIMEOUT_MS)

afterAll(() => { vi.unstubAllEnvs() })

it('names the packaged application after the product', async () => {
  const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
  const config = createElectronBuilderConfig(RELEASE_ENVIRONMENT, 'darwin', 'arm64')
  expect(config.productName).toBe('Faberloom')
  expect(config.artifactName).toBe('faberloom-${version}-${os}-${arch}.${ext}')
  expect(config.icon).toBe('build/icon.png')
  expect(config.win.icon).toBe('build/icon.ico')
})

it('ships the FaberLoom application icons', () => {
  expect(existsSync(fileURLToPath(new URL('../build/icon.png', import.meta.url)))).toBe(true)
  expect(existsSync(fileURLToPath(new URL('../build/icon.ico', import.meta.url)))).toBe(true)
})

it('points the installer and uninstaller windows at the FaberLoom artwork', async () => {
  const { createElectronBuilderConfig } = await import('../electron-builder.config.mjs')
  const config = createElectronBuilderConfig(RELEASE_ENVIRONMENT, 'darwin', 'arm64')
  expect(config.nsis.oneClick).toBe(false)
  expect(config.nsis.installerIcon).toBe('build/icon.ico')
  expect(config.nsis.uninstallerIcon).toBe('build/icon.ico')
  expect(config.nsis.installerHeaderIcon).toBe('build/installerHeaderIcon.ico')
  expect(config.nsis.installerHeader).toBe('build/installerHeader.bmp')
  expect(config.nsis.installerSidebar).toBe('build/installerSidebar.bmp')
  expect(config.nsis.uninstallerSidebar).toBe('build/uninstallerSidebar.bmp')
  expect(config.nsis.include).toContain('installer.nsh')
})

it('ships installer bitmaps at the sizes the NSIS wizard requires', () => {
  const bitmaps: readonly [string, number, number][] = [
    ['installerSidebar.bmp', 164, 314],
    ['uninstallerSidebar.bmp', 164, 314],
    ['installerHeader.bmp', 150, 57],
  ]
  for (const [name, width, height] of bitmaps) {
    const bitmap = readFileSync(fileURLToPath(new URL(`../build/${name}`, import.meta.url)))
    expect(bitmap.subarray(0, 2).toString('ascii')).toBe('BM')
    expect(bitmap.readInt32LE(18)).toBe(width)
    expect(bitmap.readInt32LE(22)).toBe(height)
    expect(bitmap.readUInt16LE(28)).toBe(24)
  }
  const headerIcon = readFileSync(fileURLToPath(new URL('../build/installerHeaderIcon.ico', import.meta.url)))
  expect(headerIcon.readUInt16LE(0)).toBe(0)
  expect(headerIcon.readUInt16LE(2)).toBe(1)
  expect(headerIcon.readUInt16LE(4)).toBe(4)
  expect([headerIcon[6], headerIcon[22], headerIcon[38], headerIcon[54]]).toEqual([16, 24, 32, 48])
})

it('asks before uninstalling and before deleting the user data', () => {
  const script = readFileSync(fileURLToPath(new URL('../scripts/installer.nsh', import.meta.url)), 'utf8')
  expect(script).toContain('!macro customUnInit')
  expect(script).toContain('!macro customUnInstall')
  expect(script).toContain('areYouSureToUninstall')
  expect(script).toContain('faberloomUninstallData')
  expect(script).toContain('!insertmacro faberloomRemoveUserData "$APPDATA" "$LOCALAPPDATA" "$PROFILE"')
  expect(script).toContain('RMDir /r "${PROFILE_DIR}\\.dsh"')
  expect(script).toContain('RMDir /r "${APP_DATA}\\@deepseek-ai"')
})

it('carries the uninstall data question in every language the installer loads', async () => {
  // app-builder-lib types its own language table as `any`; state the two
  // members this test reads instead of letting `any` reach the assertions.
  const langs = await import('app-builder-lib/out/util/langs.js') as unknown as {
    readonly bundledLanguages: readonly string[]
    readonly lcid: Readonly<Record<string, number>>
  }
  const script = readFileSync(fileURLToPath(new URL('../scripts/installer.nsh', import.meta.url)), 'utf8')
  const declared = new Set(
    [...script.matchAll(/^LangString faberloomUninstallData (\d+) /gmu)]
      .map(match => Number(match[1] ?? '')),
  )
  // makensis warns (6040) for every loaded language without an entry and
  // electron-builder treats warnings as errors, so the list must be complete.
  const missing = langs.bundledLanguages
    .map(language => ({ language, id: langs.lcid[language] ?? 0 }))
    .filter(entry => !declared.has(entry.id))
  expect(missing).toEqual([])
  expect([...declared].every(id => Object.values(langs.lcid).includes(id))).toBe(true)
})

it('brands the web document and its install manifest', () => {
  const html = readFileSync(fileURLToPath(new URL('../../web/index.html', import.meta.url)), 'utf8')
  expect(html).toContain('<title>Faberloom</title>')
  expect(html).toContain('faberloom_favicon32.svg')
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../web/public/manifest.webmanifest', import.meta.url)), 'utf8'),
  ) as { name: string; short_name: string; icons: readonly { src: string }[] }
  expect(manifest.name).toBe('Faberloom')
  expect(manifest.short_name).toBe('Faberloom')
  expect(manifest.icons.map(icon => icon.src).some(src => src.includes('faberloom'))).toBe(true)
})

it('carries the product name and no upstream name in the shell copy', () => {
  for (const messages of [en, zh]) {
    const text = Object.values(messages).join('\n')
    expect(text).toContain('Faberloom')
    expect(text).not.toContain('DeepSeek Harness')
  }
})
