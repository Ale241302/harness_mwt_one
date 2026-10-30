import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subagent'

export const name = 'space-ask-fixture'
export const inject = ['subagents']

/**
 * Provide deterministic spaces/agents services and register a fake subagent
 * provider, so `faberloom_spaces_ask` can be exercised end to end without a
 * real child model turn.
 * @param ctx - owning Cordis context carrying `subagents`.
 */
export function apply(ctx: Context): void {
  ctx.provide('faberloomSpaces' as never, {
    async reference(_actor: unknown, id: unknown) {
      return {
        space: { id, title: 'Formatos de documentos' },
        context: {
          resolved: { plantilla: 'informe mensual', tono: 'formal' },
          conflicts: [],
          sources: [id],
          excluded: [],
          dataSources: [],
          directives: ['Directiva MWT: consulta el MCP de MWT.ONE para la empresa co-sondel.'],
        },
        memory: [{ id: 'm1', spaceIds: [id], text: 'usar encabezado institucional', createdAt: '2026-10-03T00:00:00.000Z' }],
        entries: [{ id: 'e1', title: 'Regla de plantilla', body: 'La plantilla mensual manda para el reporte de Sondel.', version: 3, authorId: 'snapshot@muitowork.com', updatedAt: '2026-10-03T00:00:00.000Z' }],
        files: [],
        agentId: 'agent-formatos',
        workspaceId: undefined,
      }
    },
  })
  ctx.provide('faberloomAgents' as never, {
    async getAgent(id: unknown) {
      return { id, name: 'Agente de formatos', responsibility: 'Mantener las plantillas de reportes', skills: ['reportes'] }
    },
  })
  ctx.subagents.registerProvider({
    name: 'snapshot',
    capabilities: { agentOptions: false, outputSchema: false, depthLimit: false, toolFilter: false, persona: false },
    inheritsParentContext: false,
    async start() {
      return {
        id: 'snapshot-child' as never,
        localAgent: undefined,
        result: Promise.resolve({
          output: [{ type: 'text' as const, text: 'Usa la plantilla mensual del Space de formatos.' }],
          stopReason: 'completed' as const,
        }),
        async dispose(): Promise<void> {},
      }
    },
  })
}
