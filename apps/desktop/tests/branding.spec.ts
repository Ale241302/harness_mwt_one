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
