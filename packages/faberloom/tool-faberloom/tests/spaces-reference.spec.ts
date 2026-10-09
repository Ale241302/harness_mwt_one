import { describe, expect, it, vi } from 'vitest'
import { apply, type Config } from '../src/index.ts'

interface CapturedTool {
  readonly name: string
  readonly execute: (args: never, exec?: never) => Promise<unknown>
  readonly output: { render: (args: never, value: never) => readonly { type: string; text?: string }[] }
  readonly presentCall: (args: never) => unknown
}

interface Section {
  readonly name: string
  readonly order: number
  readonly text: string
}

/** Boot the product tools over a stub registry and capture the definitions. */
function harness(config: Config, services: Record<string, unknown> = {}): Map<string, CapturedTool> {
  const registered = new Map<string, CapturedTool>()
  const ctx = {
    tools: { register: (definition: CapturedTool) => { registered.set(definition.name, definition); return () => {} } },
    get: (name: string) => services[name],
    effect: (callback: () => unknown) => { callback(); return () => {} },
  }
  apply(ctx as never, config)
  return registered
}

const CONFIG: Config = { ownerId: 'compras2@sondelsa.com', role: 'client_b2b', companyId: 'co-sondel', readOnly: false }

/** A fake spaces service whose find and reference answers the tools consume. */
function fakeSpaces() {
  const find = vi.fn(async () => [
    { id: 'sp-1', title: 'Formatos de documentos', score: 3, reasons: ['title'] },
    { id: 'sp-2', title: 'Sondel', score: 2, reasons: ['context'] },
  ])
  const reference = vi.fn(async () => ({
    space: { id: 'sp-1', title: 'Formatos de documentos' },
    context: {
      resolved: { tono: 'formal', plantilla: 'informe' },
      conflicts: [{ key: 'tono', candidates: [{ spaceId: 'sp-1', value: 'formal' }] }],
      sources: ['sp-1'],
      excluded: [],
      dataSources: [],
      directives: ['Directiva MWT: consulta el MCP de MWT.ONE para el SKU SKU-1.'],
    },
    memory: [{ id: 'm1', spaceIds: ['sp-1'], text: 'usar encabezado institucional', createdAt: '2026-10-03T00:00:00.000Z' }],
    entries: [{ id: 'e1', title: 'Regla de tono', body: 'El tono es formal.', version: 2, authorId: 'compras2@sondelsa.com', updatedAt: '2026-10-03T00:00:00.000Z' }],
    files: [{ id: 'f1', spaceId: 'sp-1', name: 'modelo.txt', mediaType: 'text/plain', size: 10, sha256: 'abc', createdAt: '2026-10-03T00:00:00.000Z' }],
    agentId: 'agent-1',
    workspaceId: 'ws-1',
  }))
  return { find, reference, service: { find, reference } }
}

describe('faberloom spaces reference tools', () => {
  it('registers both tools with their Web presenters', () => {
    const tools = harness(CONFIG, { faberloomSpaces: fakeSpaces().service })
    expect(tools.get('faberloom_spaces_find')!.presentCall({ query: 'x' } as never)).toMatchObject({ title: 'Find product spaces' })
    expect(tools.get('faberloom_spaces_reference')!.presentCall({ id: 'sp-1' } as never)).toMatchObject({ title: 'Reference product space' })
  })

  it('finds spaces by text as the acting identity', async () => {
    const fake = fakeSpaces()
    const tools = harness(CONFIG, { faberloomSpaces: fake.service })
    const result = await tools.get('faberloom_spaces_find')!.execute({ query: 'formatos', limit: 5 } as never) as {
      matches: { id: string; title: string; score: number; reasons: string[] }[]
    }
    expect(fake.find).toHaveBeenCalledWith(
      { id: 'compras2@sondelsa.com', role: 'client_b2b', companyId: 'co-sondel', readOnly: false },
      'formatos',
      5,
    )
    expect(result.matches).toEqual([
      { id: 'sp-1', title: 'Formatos de documentos', score: 3, reasons: ['title'] },
      { id: 'sp-2', title: 'Sondel', score: 2, reasons: ['context'] },
    ])
  })

  it('defaults the limit, renders the matches, and renders an empty result', async () => {
    const fake = fakeSpaces()
    const tools = harness(CONFIG, { faberloomSpaces: fake.service })
    const find = tools.get('faberloom_spaces_find')!

    const result = await find.execute({ query: 'formatos' } as never)
    expect(fake.find).toHaveBeenCalledWith(expect.anything(), 'formatos', 10)
    const text = find.output.render({} as never, result as never)[0]?.text ?? ''
    expect(text).toContain('Formatos de documentos')
    expect(text).toContain('sp-1')

    fake.find.mockResolvedValueOnce([])
    const empty = await find.execute({ query: 'nada' } as never)
    expect(find.output.render({} as never, empty as never)[0]?.text).toContain('No hay ningún Space')
  })

  it('references a space and renders its context, memory, files, and agent', async () => {
    const fake = fakeSpaces()
    const tools = harness(CONFIG, { faberloomSpaces: fake.service })
    const reference = tools.get('faberloom_spaces_reference')!
    const result = await reference.execute({ id: 'sp-1' } as never)

    expect(fake.reference).toHaveBeenCalledWith(expect.objectContaining({ id: 'compras2@sondelsa.com' }), 'sp-1')
    expect(result).toEqual({
      id: 'sp-1',
      title: 'Formatos de documentos',
      resolved: [{ key: 'tono', value: 'formal' }, { key: 'plantilla', value: 'informe' }],
      conflicts: ['tono'],
      memory: ['usar encabezado institucional'],
      entries: [{ id: 'e1', title: 'Regla de tono', body: 'El tono es formal.', version: 2 }],
      files: [{ name: 'modelo.txt', mediaType: 'text/plain', size: 10 }],
      agentId: 'agent-1',
      workspaceId: 'ws-1',
      directives: ['Directiva MWT: consulta el MCP de MWT.ONE para el SKU SKU-1.'],
    })
    const text = reference.output.render({} as never, result as never)[0]?.text ?? ''
    expect(text).toContain('tono=formal')
    expect(text).toContain('usar encabezado institucional')
    expect(text).toContain('Regla de tono: El tono es formal.')
    expect(text).toContain('modelo.txt (text/plain, 10 bytes)')
    expect(text).toContain('agent-1')
  })

  it('renders an unassigned space with empty context, memory, and files', async () => {
    const fake = fakeSpaces()
    fake.reference.mockResolvedValueOnce({
      space: { id: 'sp-9', title: 'Vacío' },
      context: { resolved: {}, conflicts: [], sources: [], excluded: [], dataSources: [], directives: [] },
      memory: [],
      entries: [],
      files: [],
      agentId: undefined,
      workspaceId: undefined,
    } as never)
    const tools = harness(CONFIG, { faberloomSpaces: fake.service })
    const reference = tools.get('faberloom_spaces_reference')!
    const result = await reference.execute({ id: 'sp-9' } as never)
    const text = reference.output.render({} as never, result as never)[0]?.text ?? ''
    expect(text).toContain('Contexto: ninguno')
    expect(text).toContain('Contexto curado: ninguno')
    expect(text).toContain('Archivos: ninguno')
    expect(text).toContain('Agente responsable: ninguno')
  })

  it('surfaces the access denial from the spaces service', async () => {
    const fake = fakeSpaces()
    fake.reference.mockRejectedValueOnce(new Error('faberloom: space access denied'))
    const tools = harness(CONFIG, { faberloomSpaces: fake.service })
    await expect(tools.get('faberloom_spaces_reference')!.execute({ id: 'sp-9' } as never))
      .rejects.toThrow('space access denied')
  })

  it('fails loud when the spaces service is not mounted', async () => {
    const tools = harness(CONFIG)
    await expect(tools.get('faberloom_spaces_find')!.execute({ query: '' } as never))
      .rejects.toThrow('the spaces service is not mounted')
  })

  it('fails loud without an authenticated identity', async () => {
    const tools = harness({}, { faberloomSpaces: fakeSpaces().service })
    await expect(tools.get('faberloom_spaces_find')!.execute({ query: 'x' } as never))
      .rejects.toThrow('no authenticated identity')
  })

  it('registers the cross-space prompt section after the mentions section', () => {
    const sections: Section[] = []
    const systemPrompt = {
      getSectionOrder: (name: string) => (name === 'DEPLOYMENT_PERSONA_PREFIX' ? 0 : 1),
      section: (input: Section) => { sections.push(input); return () => {} },
    }
    harness(CONFIG, { systemPrompt })

    const spaces = sections.find(section => section.name === 'faberloom:spaces')
    expect(spaces).toBeDefined()
    expect(spaces!.order).toBe(2)
    expect(spaces!.text).toContain('faberloom_spaces_find')
    expect(spaces!.text).toContain('faberloom_spaces_reference')
  })
})
