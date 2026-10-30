import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
function harness(options: { inbound?: boolean } = {}) {
  const space = { id: 'sp1', title: 'ACME', workspaceId: undefined }
  const spaces = {
    get: vi.fn(async () => space),
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
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view }
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
})
