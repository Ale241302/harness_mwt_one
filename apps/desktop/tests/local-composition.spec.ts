/**
 * Wave 2.2: the local composition never mounts the deployment's credential,
 * checks, mirror, bridge, shares, session sync, inbound mail, or publication
 * rows, even when the home still carries every remote variable.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { composeEntries, loadOverlayPatches, loadProfileDirectory } from '@deepseek-ai/dsh-app-boot'
import { createPluginProfile } from '../src/project-manager.ts'
import { renderIdentityPatch } from '../src/identity.ts'
import { ensureLocalIdentity, writeLocalIdentityPatch } from '../src/local-identity.ts'

const homes: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** Compose the shipped Desktop profile, its overlay, the local patch, and the host's last overlay. */
function localRows() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-local-'))
  homes.push(home)
  vi.stubEnv('FABERLOOM_LOCAL', '1')
  vi.stubEnv('MWT_MCP_URL', 'http://127.0.0.1:9/mwt')
  vi.stubEnv('MWT_MCP_AUTHORIZATION', 'DeviceToken secret')
  vi.stubEnv('MWT_MCP_GATEWAY_KEY', 'gateway')
  vi.stubEnv('FABERLOOM_MCP_URL', 'http://127.0.0.1:9/faberloom')
  vi.stubEnv('FABERLOOM_GATEWAY_KEY', 'gateway')
  vi.stubEnv('CONSOLA_API_BASE', 'https://consola.mwt.one/api')
  vi.stubEnv('CONSOLA_TOKEN', 'tok')
  vi.stubEnv('FABERLOOM_MIRROR_ENABLED', '1')
  const profileDir = join(home, 'profiles', 'desktop')
  createPluginProfile(profileDir)
  const installAnchor = fileURLToPath(new URL('../../cli/package.json', import.meta.url))
  const profile = loadProfileDirectory('dsh desktop', profileDir, installAnchor)
  const desktop = fileURLToPath(new URL('../../desktop-host/config/desktop.cordis.patch.yml', import.meta.url))
  const localOverlay = fileURLToPath(new URL('../../desktop-host/config/desktop-local.patch.yml', import.meta.url))
  const localPatch = writeLocalIdentityPatch(home, ensureLocalIdentity(home), process.env)
  const warnings: string[] = []
  const rows = composeEntries([
    ...profile.layers.map(layer => layer.patches),
    profile.patches,
    loadOverlayPatches('dsh desktop', desktop),
    loadOverlayPatches('dsh desktop identity', localPatch),
    loadOverlayPatches('dsh desktop local', localOverlay),
  ], message => warnings.push(message))
  expect(warnings).toEqual([])
  return rows
}

it('mounts no MWT or FaberLoom MCP client in the local composition', () => {
  const rows = localRows()
  const clients = rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-client')
  expect(clients.map(row => (row.config as { serverName?: string } | undefined)?.serverName)).toEqual(['sicop'])
})

it('disables every deployment service in the local composition', () => {
  const rows = localRows()
  for (const id of [
    'credentials-console',
    'faberloom-checks-mwt',
    'faberloom-mirror',
    'faberloom-shares',
    'faberloom-session-shares',
    'faberloom-inbound',
    'faberloom-publication',
  ]) {
    expect(rows.find(row => row.id === id)?.disabled, id).toBe(true)
  }
  const mcp = rows.find(row => row.id === 'faberloom-mcp-server')
  expect(mcp?.disabled).not.toBe(true)
  const config = mcp?.config as {
    readonly ownerId?: string
    readonly enabled?: boolean
    readonly socketPath?: string
    readonly publicationRepo?: string
    readonly bridge?: boolean
    readonly gatewayUrl?: string
    readonly consoleBase?: string
  } | undefined
  expect(config?.ownerId).toEqual(expect.any(String))
  expect((config?.ownerId ?? '').length).toBeGreaterThan(0)
  expect(config?.enabled).toBe(true)
  expect(config?.socketPath).toContain('faberloom-mcp.sock')
  expect(config?.publicationRepo).toBe('')
  expect(config?.bridge).toBe(false)
  expect(config?.gatewayUrl).toBe('')
  expect(config?.consoleBase).toBe('')
})

it('keeps Mesa, context, memory, routines, and workflows mounted locally', () => {
  const rows = localRows()
  for (const id of ['faberloom-board', 'faberloom-context', 'faberloom-learning', 'faberloom-routines', 'faberloom-workflows']) {
    const row = rows.find(candidate => candidate.id === id)
    expect(row, id).toBeDefined()
    expect(row?.disabled, id).not.toBe(true)
  }
})

it('keeps the remote composition unchanged when local mode is off', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-remote-'))
  homes.push(home)
  vi.stubEnv('FABERLOOM_LOCAL', '0')
  vi.stubEnv('MWT_MCP_URL', 'http://127.0.0.1:9/mwt')
  vi.stubEnv('MWT_MCP_AUTHORIZATION', 'DeviceToken secret')
  vi.stubEnv('FABERLOOM_MCP_URL', 'http://127.0.0.1:9/faberloom')
  vi.stubEnv('FABERLOOM_GATEWAY_KEY', 'gateway')
  const profileDir = join(home, 'profiles', 'desktop')
  createPluginProfile(profileDir)
  const installAnchor = fileURLToPath(new URL('../../cli/package.json', import.meta.url))
  const profile = loadProfileDirectory('dsh desktop', profileDir, installAnchor)
  const desktop = fileURLToPath(new URL('../../desktop-host/config/desktop.cordis.patch.yml', import.meta.url))
  const remotePatch = join(home, 'remote-identity.patch.yml')
  writeFileSync(remotePatch, renderIdentityPatch(
    { email: 'owner@example.test', role: 'admin', readOnly: false, consolaBase: '' },
    home,
    process.env,
  ))
  const rows = composeEntries([
    ...profile.layers.map(layer => layer.patches),
    profile.patches,
    loadOverlayPatches('dsh desktop', desktop),
    loadOverlayPatches('dsh desktop identity', remotePatch),
  ])
  expect(rows.find(row => row.id === 'credentials-console')?.disabled).not.toBe(true)
  expect(rows.find(row => row.id === 'faberloom-checks-mwt')?.disabled).not.toBe(true)
  expect(rows.find(row => row.id === 'faberloom-shares')?.disabled).not.toBe(true)
  const clients = rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-client')
  expect(clients.map(row => (row.config as { serverName?: string } | undefined)?.serverName))
    .toEqual(['mwt', 'sicop', 'faberloom'])
})
