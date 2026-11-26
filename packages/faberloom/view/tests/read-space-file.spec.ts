import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  const root = mkdtempSync(join(tmpdir(), 'faberloom-read-'))
  roots.push(root)
  return root
}

/** The minimal service graph `readSpaceFile` touches, with one real area. */
function harness() {
  const area = fixture()
  const spaces = {
    get: vi.fn(async (_actor: unknown, id: string) => ({
      id,
      ownerId: OWNER,
      title: 'Marluvas',
      parentId: null,
      workspaceId: 'w1',
    })),
    canManage: vi.fn(async () => true),
  }
  const registry = {
    get: vi.fn((id: string) => ({ id, path: area, title: 'Marluvas', sessionIds: [] as string[] })),
    list: () => [{ id: 'w1', path: area, title: 'Marluvas', sessionIds: [] as string[] }],
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
  return { view, area }
}

describe('readSpaceFile', () => {
  it('returns Markdown decoded as text so the tablero can paint it', async () => {
    const { view, area } = harness()
    writeFileSync(join(area, 'AGENTS.md'), '# Marluvas\n\nContexto del espacio.\n')

    const file = await view.readSpaceFile('sp1', 'AGENTS.md')

    expect(file.name).toBe('AGENTS.md')
    expect(file.mediaType).toBe('text/markdown')
    expect(file.text).toBe('# Marluvas\n\nContexto del espacio.\n')
    expect(file.base64).toBeNull()
  })

  it('returns JSON and YAML as text', async () => {
    const { view, area } = harness()
    writeFileSync(join(area, 'datos.json'), '{"ok":true}')
    writeFileSync(join(area, 'perfil.yaml'), 'nombre: Marluvas\n')

    expect((await view.readSpaceFile('sp1', 'datos.json')).mediaType).toBe('application/json')
    expect((await view.readSpaceFile('sp1', 'datos.json')).text).toBe('{"ok":true}')
    expect((await view.readSpaceFile('sp1', 'perfil.yaml')).text).toBe('nombre: Marluvas\n')
  })

  it('returns an image as base64 with its media type', async () => {
    const { view, area } = harness()
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])
    writeFileSync(join(area, 'foto.png'), bytes)

    const file = await view.readSpaceFile('sp1', 'foto.png')

    expect(file.mediaType).toBe('image/png')
    expect(file.bytes).toBe(bytes.length)
    expect(file.text).toBeNull()
    expect(Buffer.from(file.base64 ?? '', 'base64').equals(bytes)).toBe(true)
  })

  it('names an unknown extension as generic bytes so the panel downloads it', async () => {
    const { view, area } = harness()
    writeFileSync(join(area, 'contrato.docx'), Buffer.from('docx'))

    const file = await view.readSpaceFile('sp1', 'contrato.docx')

    expect(file.mediaType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect((await view.readSpaceFile('sp1', 'contrato.docx')).text).toBeNull()
    writeFileSync(join(area, 'pieza.bin'), Buffer.from([0x00, 0x01]))
    expect((await view.readSpaceFile('sp1', 'pieza.bin')).mediaType).toBe('application/octet-stream')
  })

  it('refuses a path outside the Space and a directory', async () => {
    const { view, area } = harness()
    mkdirSync(join(area, 'ENT'))

    await expect(view.readSpaceFile('sp1', '../fuera.md')).rejects.toThrow(/fuera|ruta|espacio/u)
    await expect(view.readSpaceFile('sp1', 'ENT')).rejects.toThrow(/archivo/u)
  })
})
