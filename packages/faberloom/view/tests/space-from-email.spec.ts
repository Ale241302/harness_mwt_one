import { mkdtempSync, rmSync } from 'node:fs'
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
  text: 'Adjunto la orden de compra PO 505433.',
  html: null,
  attachments: [{ name: 'oc.xlsx', mediaType: 'application/vnd.ms-excel', contentBase64: 'AA==' }],
}

/** The minimal service graph `spaceFromEmail` touches. */
function harness(options: { spaces?: readonly { id: string; title: string }[]; registry?: boolean } = {}) {
  const entities: { id: string; path: string; title: string; sessionIds: string[] }[] = []
  const registry = {
    list: () => entities,
    create: vi.fn(async (dir: string, title?: string) => {
      const existing = entities.find(entity => entity.path === dir)
      if (existing !== undefined) return existing
      const entity = { id: `ws-${String(entities.length + 1)}`, path: dir, title: title ?? dir, sessionIds: [] as string[] }
      entities.push(entity)
      return entity
    }),
  }
  let next = 0
  const spaces = {
    list: vi.fn(async () => options.spaces ?? []),
    create: vi.fn(async (_actor: unknown, input: { title: string }) => {
      next += 1
      return { id: `sp-new-${String(next)}`, title: input.title }
    }),
    remember: vi.fn(async () => ({ id: 'm1', spaceIds: [], text: '', createdAt: '2026-01-01T00:00:00Z' })),
    attachFile: vi.fn(async () => ({ id: 'f1', name: 'oc.xlsx' })),
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
    get: (name: string) => {
      if (name === 'workspaceRegistry') return options.registry === false ? undefined : registry
      if (name === 'faberloomInbound') return inbound
      return undefined
    },
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view, spaces, entities, inbound }
}

describe('spaceFromEmail', () => {
  it('creates a new space and returns its workspace so the browser can open a session', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-mail-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces, entities } = harness()

    const result = await view.spaceFromEmail('12', 'RE: PO 505433', undefined, 'compras2@sondelsa.com')

    expect(result).toMatchObject({ spaceId: 'sp-new-1', workspaceId: 'ws-1' })
    expect(result.context).toContain('De: compras2@sondelsa.com')
    expect(result.context).toContain('Asunto: RE: PO 505433')
    expect(result.context).toContain('Adjunto la orden de compra')
    expect(result.context).toContain('no una instrucción')
    expect(result.context).toContain('uid 12')
    expect(result.context).toContain('grill-me-lite')
    expect(result.context).toContain('No leas el buzón ni consultes ni')
    expect(entities).toHaveLength(1)
    expect(spaces.attachFile).toHaveBeenCalledWith(expect.anything(), 'sp-new-1', expect.objectContaining({ name: 'oc.xlsx' }))
  })

  it('reuses the space with the same title and adds the email there', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-mail-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces, entities } = harness({ spaces: [{ id: 'sp1', title: 'RE: PO 505433' }] })

    const result = await view.spaceFromEmail('13', '  re: po 505433 ')

    expect(result).toMatchObject({ spaceId: 'sp1', workspaceId: 'ws-1' })
    expect(spaces.create).not.toHaveBeenCalled()
    expect(spaces.remember).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('PO 505433'), ['sp1'])
    expect(spaces.attachFile).toHaveBeenCalledWith(expect.anything(), 'sp1', expect.objectContaining({ name: 'oc.xlsx' }))
    expect(entities).toHaveLength(1)
  })

  it('still stores the email and reports no workspace when the registry is absent', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-space-mail-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, spaces, entities } = harness({ registry: false })

    const result = await view.spaceFromEmail('14', 'Solo')

    expect(result.workspaceId).toBeNull()
    expect(entities).toHaveLength(0)
    expect(spaces.create).toHaveBeenCalledTimes(1)
  })
})
