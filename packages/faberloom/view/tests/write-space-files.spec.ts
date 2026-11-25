import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

const OWNER = 'owner@muitowork.com'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'faberloom-write-'))
  roots.push(root)
  return root
}

/** The minimal service graph `writeSpaceFiles` touches. */
function harness(options: { canManage?: boolean; readOnly?: boolean; area?: string } = {}) {
  const area = options.area ?? fixture()
  const space = { id: 'sp1', ownerId: OWNER, title: 'B2B', parentId: null, workspaceId: 'w1' }
  const spaces = {
    get: vi.fn(async () => space),
    canManage: vi.fn(async () => options.canManage ?? true),
  }
  const registry = {
    get: vi.fn(() => ({ id: 'w1', path: area, title: 'B2B', sessionIds: [] as string[] })),
    list: () => [] as { id: string; path: string; title: string; sessionIds: string[] }[],
  }
  const ctx = {
    faberloomSpaces: spaces,
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => name === 'workspaceRegistry' ? registry : undefined,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: OWNER, role: 'admin', readOnly: options.readOnly ?? false })
  return { view, area, spaces }
}

describe('writeSpaceFiles', () => {
  it('writes files under the Space area and reports each digest', async () => {
    const { view, area } = harness()

    const result = await view.writeSpaceFiles('sp1', [
      { path: 'B2B/ENT_cliente.md', content: '# Cliente\n' },
      { path: 'B2B/PLB/cierre.md', content: 'cierre\n' },
    ])

    expect(result.written).toBe(2)
    expect(result.files.map(file => file.path)).toEqual(['B2B/ENT_cliente.md', 'B2B/PLB/cierre.md'])
    expect(result.files.every(file => /^[a-f0-9]{64}$/u.test(file.sha256))).toBe(true)
    expect(readFileSync(join(area, 'B2B', 'PLB', 'cierre.md'), 'utf8')).toBe('cierre\n')
  })

  it('creates the area when the registered folder does not exist yet', async () => {
    const missing = join(fixture(), 'todavia-no-existe')
    const { view } = harness({ area: missing })

    const result = await view.writeSpaceFiles('sp1', [{ path: 'uno.md', content: 'uno' }])

    expect(result.written).toBe(1)
    expect(readFileSync(join(missing, 'uno.md'), 'utf8')).toBe('uno')
  })

  it('refuses an identity that cannot manage the Space', async () => {
    const { view } = harness({ canManage: false })

    await expect(view.writeSpaceFiles('sp1', [{ path: 'uno.md', content: 'uno' }]))
      .rejects.toThrow(/cannot manage this space/u)
  })

  it('refuses a read-only identity', async () => {
    const { view } = harness({ readOnly: true })

    await expect(view.writeSpaceFiles('sp1', [{ path: 'uno.md', content: 'uno' }]))
      .rejects.toThrow(/READ_ONLY/u)
  })

  it('refuses a batch above the call cap', async () => {
    const { view } = harness()

    await expect(view.writeSpaceFiles('sp1', [{ path: 'grande.md', content: 'x'.repeat(4_000_001) }]))
      .rejects.toThrow(/4000000 bytes/u)
  })
})
