import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  const root = mkdtempSync(join(tmpdir(), 'faberloom-move-'))
  roots.push(root)
  return root
}

/** The minimal service graph `moveSpaceEntry` touches, with two real areas. */
function harness(options: { canManage?: (id: string) => boolean } = {}) {
  const areas = { sp1: fixture(), sp2: fixture() }
  const spaces = {
    get: vi.fn(async (_actor: unknown, id: string) => ({
      id,
      ownerId: OWNER,
      title: id === 'sp1' ? 'Origen' : 'Destino',
      parentId: null,
      workspaceId: id === 'sp1' ? 'w1' : 'w2',
    })),
    canManage: vi.fn(async (_actor: unknown, id: string) => options.canManage?.(id) ?? true),
  }
  const registry = {
    get: vi.fn((id: string) => ({
      id,
      path: id === 'w1' ? areas.sp1 : areas.sp2,
      title: id === 'w1' ? 'Origen' : 'Destino',
      sessionIds: [] as string[],
    })),
    list: () => [
      { id: 'w1', path: areas.sp1, title: 'Origen', sessionIds: [] as string[] },
      { id: 'w2', path: areas.sp2, title: 'Destino', sessionIds: [] as string[] },
    ],
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
  const view = new FaberLoomViewService(ctx, { ownerId: OWNER, role: 'admin', readOnly: false })
  return { view, areas }
}

describe('moveSpaceEntry', () => {
  it('moves one file to the root of another Space and keeps its bytes', async () => {
    const { view, areas } = harness()
    writeFileSync(join(areas.sp1, 'uno.md'), 'uno\n')

    const result = await view.moveSpaceEntry('sp1', 'uno.md', 'sp2', '')

    expect(result.movedTo).toBe('uno.md')
    expect(existsSync(join(areas.sp1, 'uno.md'))).toBe(false)
    expect(readFileSync(join(areas.sp2, 'uno.md'), 'utf8')).toBe('uno\n')
  })

  it('moves a file into an existing folder of the destination Space', async () => {
    const { view, areas } = harness()
    writeFileSync(join(areas.sp1, 'uno.md'), 'uno')
    mkdirSync(join(areas.sp2, 'ENT'))

    const result = await view.moveSpaceEntry('sp1', 'uno.md', 'sp2', 'ENT')

    expect(result.movedTo).toBe('ENT/uno.md')
    expect(readFileSync(join(areas.sp2, 'ENT', 'uno.md'), 'utf8')).toBe('uno')
  })

  it('moves a folder and everything below it', async () => {
    const { view, areas } = harness()
    mkdirSync(join(areas.sp1, 'ENT'))
    writeFileSync(join(areas.sp1, 'ENT', 'dentro.md'), 'dentro')

    await view.moveSpaceEntry('sp1', 'ENT', 'sp2', '')

    expect(existsSync(join(areas.sp1, 'ENT'))).toBe(false)
    expect(readFileSync(join(areas.sp2, 'ENT', 'dentro.md'), 'utf8')).toBe('dentro')
  })

  it('refuses to overwrite an existing destination', async () => {
    const { view, areas } = harness()
    writeFileSync(join(areas.sp1, 'uno.md'), 'origen')
    writeFileSync(join(areas.sp2, 'uno.md'), 'destino')

    await expect(view.moveSpaceEntry('sp1', 'uno.md', 'sp2', ''))
      .rejects.toThrow(/ya existe/u)
    expect(readFileSync(join(areas.sp2, 'uno.md'), 'utf8')).toBe('destino')
  })

  it('refuses a destination that is not a folder', async () => {
    const { view, areas } = harness()
    writeFileSync(join(areas.sp1, 'uno.md'), 'uno')
    writeFileSync(join(areas.sp2, 'ENT'), 'archivo')

    await expect(view.moveSpaceEntry('sp1', 'uno.md', 'sp2', 'ENT'))
      .rejects.toThrow(/no es una carpeta/u)
  })

  it('refuses a folder moved inside itself', async () => {
    const { view, areas } = harness()
    mkdirSync(join(areas.sp1, 'ENT', 'HIJO'), { recursive: true })
    writeFileSync(join(areas.sp1, 'ENT', 'uno.md'), 'uno')

    await expect(view.moveSpaceEntry('sp1', 'ENT', 'sp1', 'ENT/HIJO'))
      .rejects.toThrow(/dentro de sí misma/u)
  })

  it('refuses a Space the identity cannot manage', async () => {
    const { view, areas } = harness({ canManage: id => id === 'sp1' })
    writeFileSync(join(areas.sp1, 'uno.md'), 'uno')

    await expect(view.moveSpaceEntry('sp1', 'uno.md', 'sp2', ''))
      .rejects.toThrow(/cannot manage/u)
  })

  it('refuses a path that leaves the source Space', async () => {
    const { view } = harness()

    await expect(view.moveSpaceEntry('sp1', '../fuera.md', 'sp2', ''))
      .rejects.toThrow(/fuera de la carpeta/u)
  })
})
