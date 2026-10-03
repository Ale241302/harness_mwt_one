import type { Context } from '@deepseek-ai/cordis'

export const name = 'space-reference-fixture'

/**
 * Provide a deterministic stand-in for the product spaces service so the
 * cross-space snapshot drives `faberloom_spaces_find` / `faberloom_spaces_reference`
 * without the storage domain or a real product tenant.
 * @param ctx - owning Cordis context.
 */
export function apply(ctx: Context): void {
  ctx.provide('faberloomSpaces' as never, {
    async find(): Promise<unknown[]> {
      return [
        { id: 'space-formats', title: 'Formatos de documentos', score: 3, reasons: ['title'] },
        { id: 'space-sondel', title: 'Sondel', score: 1, reasons: ['context'] },
      ]
    },
    async reference(_actor: unknown, id: unknown): Promise<unknown> {
      const title = id === 'space-sondel' ? 'Sondel' : 'Formatos de documentos'
      return {
        space: { id, title },
        context: {
          resolved: { plantilla: 'informe mensual', tono: 'formal' },
          conflicts: [],
          sources: [id],
          excluded: [],
          dataSources: [],
          directives: ['Directiva MWT: consulta el MCP de MWT.ONE para la empresa co-sondel.'],
        },
        memory: [{
          id: 'm1',
          spaceIds: [id],
          text: 'usar encabezado institucional',
          createdAt: '2026-10-03T00:00:00.000Z',
        }],
        files: [{
          id: 'f1',
          spaceId: id,
          name: 'modelo.docx',
          mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          size: 2048,
          sha256: 'snapshot',
          createdAt: '2026-10-03T00:00:00.000Z',
        }],
        agentId: 'agent-formatos',
        workspaceId: 'ws-formatos',
      }
    },
  })
}
