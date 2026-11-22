import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

const CONTENT = {
  text: 'Adjunto la orden de compra.',
  html: null,
  attachments: [{ name: 'oc.xlsx', mediaType: 'application/vnd.ms-excel', size: 2, contentBase64: 'AA==' }],
}

/** The service graph the Space entry guards touch. */
function harness(options: { manage?: boolean; readOnly?: boolean } = {}) {
  const space = { id: 'sp1', ownerId: 'other@example.com', title: 'Ajeno', workspaceId: undefined }
  const spaces = {
    get: vi.fn(async () => space),
    canManage: vi.fn(async () => options.manage !== false),
    list: vi.fn(async () => [space]),
    create: vi.fn(async () => space),
    remember: vi.fn(async () => ({})),
    attachFile: vi.fn(async () => ({})),
    resolveWorkdir: vi.fn(async () => ({ kind: 'opaque' as const, ref: 'fw_oc' })),
  }
  const inbound = { readEmail: vi.fn(async () => CONTENT) }
  const connections = {
    saveDraft: vi.fn(async () => ({ id: 'draft-1' })),
    recordDraftRevision: vi.fn(async () => ({ revision: 1 })),
  }
  const ctx = {
    faberloomSpaces: spaces,
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => name === 'faberloomInbound'
      ? inbound
      : name === 'faberloomConnections'
        ? connections
        : undefined,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, {
    ownerId: 'owner@muitowork.com', role: 'admin', readOnly: options.readOnly === true,
  })
  return { view, spaces, inbound, connections }
}

/** Seed one area with a file and a link that resolves outside it. */
function seedArea(home: string): { root: string; outside: string } {
  const root = join(home, 'spaces', 'fw_oc')
  const outside = join(home, 'outside')
  mkdirSync(root, { recursive: true })
  mkdirSync(outside, { recursive: true })
  writeFileSync(join(root, 'nota.txt'), 'nota')
  writeFileSync(join(outside, 'secreto.txt'), 'secreto')
  symlinkSync(outside, join(root, 'enlace'), process.platform === 'win32' ? 'junction' : 'dir')
  return { root, outside }
}

describe('Space entry authority', () => {
  it('denies rename, delete, open, and mail attach to a readable Space the identity cannot manage', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-entry-denied-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    seedArea(home)
    const { view, spaces, connections } = harness({ manage: false })

    await expect(view.renameSpaceEntry('sp1', 'nota.txt', 'otra.txt')).rejects.toThrow('cannot manage')
    await expect(view.deleteSpaceEntries('sp1', ['nota.txt'])).rejects.toThrow('cannot manage')
    await expect(view.openSpaceFile('sp1', 'nota.txt')).rejects.toThrow('cannot manage')
    await expect(view.attachMailToSpace('12', 'sp1')).rejects.toThrow('cannot manage')
    await expect(view.saveSpaceAttachment('sp1', '12')).rejects.toThrow('cannot manage')
    await expect(view.sendSpaceFileByEmail('sp1', 'nota.txt', 'a@example.com', 'S', 'T'))
      .rejects.toThrow('cannot manage')
    expect(spaces.remember).not.toHaveBeenCalled()
    expect(spaces.attachFile).not.toHaveBeenCalled()
    expect(connections.saveDraft).not.toHaveBeenCalled()
  })

  it('refuses a linked entry or parent in rename, delete, open, and mail send', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-entry-links-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    seedArea(home)
    const { view, connections } = harness()

    await expect(view.renameSpaceEntry('sp1', 'enlace/secreto.txt', 'robado.txt')).rejects.toThrow('fuera de la carpeta')
    await expect(view.deleteSpaceEntries('sp1', ['enlace/secreto.txt'])).rejects.toThrow('fuera de la carpeta')
    await expect(view.openSpaceFile('sp1', 'enlace/secreto.txt')).rejects.toThrow('fuera de la carpeta')
    await expect(view.sendSpaceFileByEmail('sp1', 'enlace/secreto.txt', 'a@example.com', 'S', 'T'))
      .rejects.toThrow('fuera de la carpeta')
    expect(connections.saveDraft).not.toHaveBeenCalled()
  })

  it('renames and deletes a regular entry when the identity manages the Space', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-entry-allowed-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { root } = seedArea(home)
    const { view } = harness()

    await view.renameSpaceEntry('sp1', 'nota.txt', 'renombrada.txt')
    expect(() => writeFileSync(join(root, 'renombrada.txt'), 'x', { flag: 'wx' })).toThrow()
    await view.deleteSpaceEntries('sp1', ['renombrada.txt'])
    expect(() => writeFileSync(join(root, 'renombrada.txt'), 'x', { flag: 'wx' })).not.toThrow()
  })

  it('refuses to mail a Space file for a read-only identity before reading it', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-entry-readonly-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    seedArea(home)
    const { view, connections } = harness({ readOnly: true })

    await expect(view.sendSpaceFileByEmail('sp1', 'nota.txt', 'a@example.com', 'S', 'T'))
      .rejects.toThrow('READ_ONLY')
    expect(connections.saveDraft).not.toHaveBeenCalled()
  })
})
