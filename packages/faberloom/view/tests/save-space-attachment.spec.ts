import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
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
  attachments: [
    { name: 'oc.xlsx', mediaType: 'application/vnd.ms-excel', size: 2, contentBase64: 'AA==' },
    { name: 'notas.txt', mediaType: 'text/plain', size: 1, contentBase64: 'QQ==' },
  ],
}

/** The minimal service graph `saveSpaceAttachment` touches. */
function harness(options: { inbound?: boolean; readOnly?: boolean; manage?: boolean } = {}) {
  const space = { id: 'sp1', title: 'ACME', workspaceId: undefined }
  const spaces = {
    get: vi.fn(async () => space),
    canManage: vi.fn(async () => options.manage !== false),
    resolveWorkdir: vi.fn(async () => ({ kind: 'opaque' as const, ref: 'fw_oc' })),
  }
  const inbound = { readEmail: vi.fn(async () => CONTENT) }
  const ctx = {
    faberloomSpaces: spaces,
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => name === 'faberloomInbound' && options.inbound !== false ? inbound : undefined,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, {
    ownerId: 'owner@muitowork.com', role: 'admin', readOnly: options.readOnly === true,
  })
  return { view, spaces, inbound }
}

describe('saveSpaceAttachment', () => {
  it('writes one named attachment into the space folder', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-save-attachment-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view } = harness()

    const result = await view.saveSpaceAttachment('sp1', '12', 'oc.xlsx')

    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.bytes).toBe(1)
    expect(readFileSync(join(home, 'spaces', 'fw_oc', 'correo-adjuntos', 'oc.xlsx'), 'utf8')).toBe('\u0000')
  })

  it('writes every attachment when no name is given', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-save-attachment-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view } = harness()

    const result = await view.saveSpaceAttachment('sp1', '12')

    expect(result.files.map(file => file.name)).toEqual(['oc.xlsx', 'notas.txt'])
    expect(readFileSync(join(home, 'spaces', 'fw_oc', 'correo-adjuntos', 'notas.txt'), 'utf8')).toBe('A')
  })

  it('writes nothing for an unknown attachment name', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-save-attachment-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view } = harness()

    expect(await view.saveSpaceAttachment('sp1', '12', 'nope.pdf')).toEqual({ files: [] })
  })

  it('writes nothing without the inbound service', async () => {
    const { view } = harness({ inbound: false })

    expect(await view.saveSpaceAttachment('sp1', '12')).toEqual({ files: [] })
  })

  it('rejects a read-only identity before reading the mailbox', async () => {
    const { view, inbound } = harness({ readOnly: true })

    await expect(view.saveSpaceAttachment('sp1', '12')).rejects.toThrow('READ_ONLY')
    expect(inbound.readEmail).not.toHaveBeenCalled()
  })

  it('rejects a readable Space the identity cannot manage', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-save-attachment-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, inbound } = harness({ manage: false })

    await expect(view.saveSpaceAttachment('sp1', '12')).rejects.toThrow('cannot manage')
    expect(inbound.readEmail).not.toHaveBeenCalled()
    expect(existsSync(join(home, 'spaces', 'fw_oc', 'correo-adjuntos'))).toBe(false)
  })

  it('refuses a symlinked attachment folder and never overwrites an existing file', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-save-attachment-'))
    const outside = mkdtempSync(join(tmpdir(), 'view-save-outside-'))
    homes.push(home, outside)
    vi.stubEnv('DSH_HOME', home)
    mkdirSync(join(home, 'spaces', 'fw_oc'), { recursive: true })
    symlinkSync(outside, join(home, 'spaces', 'fw_oc', 'correo-adjuntos'), process.platform === 'win32' ? 'junction' : 'dir')
    const { view } = harness()

    await expect(view.saveSpaceAttachment('sp1', '12')).rejects.toThrow('MAIL_ATTACHMENT_PATH_UNSAFE')
    expect(existsSync(join(outside, 'oc.xlsx'))).toBe(false)

    rmSync(join(home, 'spaces', 'fw_oc', 'correo-adjuntos'), { recursive: true, force: true })
    await view.saveSpaceAttachment('sp1', '12', 'oc.xlsx')
    await expect(view.saveSpaceAttachment('sp1', '12', 'oc.xlsx')).rejects.toThrow(/EEXIST/u)
    expect(readFileSync(join(home, 'spaces', 'fw_oc', 'correo-adjuntos', 'oc.xlsx'), 'utf8')).toBe('\u0000')
  })
})
