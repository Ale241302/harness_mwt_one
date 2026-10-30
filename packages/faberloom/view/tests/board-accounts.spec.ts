import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

/** One client row as the MWT MCP server sends it, inside its own text block. */
function block(row: Record<string, unknown>): { type: 'text'; text: string } {
  return { type: 'text', text: JSON.stringify(row) }
}

/**
 * Boot the view over a stubbed tool runtime. The account filter reads the MWT
 * client catalog through `mcp__mwt__cliente_listar`, so the test owns that one
 * tool and leaves every other service absent.
 */
function harness(tools: {
  schemas: () => { name: string }[]
  execute: (input: unknown) => Promise<unknown>
}) {
  const ctx = {
    effect: (run: () => unknown) => { run(); return () => {} },
    on: () => () => {},
    provide: () => {},
    reflect: { provide: () => {} },
    logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
    get: (name: string) => name === 'tools' ? tools : undefined,
  } as unknown as Context
  return new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin' })
}

describe('board accounts from the MWT catalog', () => {
  it('reads one client per text block and sorts the names', async () => {
    const execute = vi.fn(async () => ({
      isError: false,
      value: {
        content: [
          block({ razon_social: 'Sondel S.A.', nombre_comercial: 'Sondel' }),
          block({ razon_social: 'COMERCIALIZADORA UMMIE, S.A.' }),
          block({ razon_social: 'SonDel Honduras S.A. de C.V.' }),
        ],
      },
    }))
    const view = harness({ schemas: () => [{ name: 'mcp__mwt__cliente_listar' }], execute })
    expect(await view.boardAccounts()).toEqual([
      'COMERCIALIZADORA UMMIE, S.A.',
      'SonDel Honduras S.A. de C.V.',
      'Sondel S.A.',
    ])
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      name: 'mcp__mwt__cliente_listar',
      arguments: { is_parent: 'all' },
    }))
  })

  it('reads a structured answer and a results envelope', async () => {
    const view = harness({
      schemas: () => [{ name: 'mcp__mwt__cliente_listar' }],
      execute: async () => ({
        isError: false,
        value: { structuredContent: { results: [{ razon_social: 'IMPORCOMP S.A.' }] } },
      }),
    })
    expect(await view.boardAccounts()).toEqual(['IMPORCOMP S.A.'])
  })

  it('returns nothing when the deployment mounts no MWT client catalog', async () => {
    const execute = vi.fn()
    const view = harness({ schemas: () => [], execute })
    expect(await view.boardAccounts()).toEqual([])
    expect(execute).not.toHaveBeenCalled()
  })

  it('caches the catalog so a second render does not call the server again', async () => {
    const execute = vi.fn(async () => ({
      isError: false,
      value: { content: [block({ razon_social: 'Sondel S.A.' })] },
    }))
    const view = harness({ schemas: () => [{ name: 'mcp__mwt__cliente_listar' }], execute })
    await view.boardAccounts()
    await view.boardAccounts()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('ignores a text block that is not a client row', async () => {
    const view = harness({
      schemas: () => [{ name: 'mcp__mwt__cliente_listar' }],
      execute: async () => ({
        isError: false,
        value: {
          content: [
            { type: 'text', text: 'catálogo leído' },
            block({ razon_social: 'PRO CUSTOMER CORP.' }),
          ],
        },
      }),
    })
    expect(await view.boardAccounts()).toEqual(['PRO CUSTOMER CORP.'])
  })

  it('resolves a stored document key into the signed URL the storage tool returns', async () => {
    const execute = vi.fn(async () => ({
      isError: false,
      value: {
        content: [{ type: 'text', text: JSON.stringify({ url: 'http://storage.test/bl.pdf?X-Amz-Signature=x' }) }],
      },
    }))
    const view = harness({ schemas: () => [{ name: 'mcp__mwt__artefacto_archivo_descargar' }], execute })
    expect(await view.boardArtifactUrl('documento/a9/bl.pdf')).toEqual({
      url: 'http://storage.test/bl.pdf?X-Amz-Signature=x',
    })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      name: 'mcp__mwt__artefacto_archivo_descargar',
      arguments: { key: 'documento/a9/bl.pdf', ttl_minutes: 15 },
    }))
  })

  it('returns null when the deployment mounts no storage tool', async () => {
    const view = harness({ schemas: () => [], execute: vi.fn() })
    expect(await view.boardArtifactUrl('documento/a9/bl.pdf')).toBeNull()
  })
})
