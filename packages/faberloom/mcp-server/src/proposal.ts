/**
 * The proposal tool: one MCP entry that receives the seven business fields and
 * answers with the receipt of the durable, pending board item it created.
 *
 * The schema bounds every field for the model, and the board parser enforces the
 * same bounds again when the tool, a bridge, or a direct caller invokes it. No
 * field names an owner, a company, a state, or an approval: those are the
 * server's, and a caller that sends one receives `PROPOSAL_AUTHORITY_FIELD`.
 * @module @deepseek-ai/dsh-faberloom-mcp-server/proposal
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  PROPOSAL_LIMITS,
  type BoardProposalReceipt,
} from '@deepseek-ai/dsh-faberloom-board'
import type { McpToolDefinition } from './protocol.ts'
import { PROPOSAL_TOOL } from './protocol.ts'

/** The tool definition, in the order the catalogue advertises it. */
export const PROPOSAL_TOOL_DEFINITION: McpToolDefinition = {
  name: PROPOSAL_TOOL,
  description: 'Presenta una propuesta de conocimiento (archivo, versión base, cambio, motivo, evidencia y clave) para revisión humana. No aprueba ni publica.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['archivo', 'versionBase', 'cambio', 'motivo', 'evidencia', 'claveCliente', 'title'],
    properties: {
      archivo: {
        type: 'string',
        minLength: 1,
        maxLength: PROPOSAL_LIMITS.archivo,
        description: 'Ruta relativa del archivo que la propuesta cambia.',
      },
      versionBase: {
        type: 'string',
        minLength: 1,
        maxLength: PROPOSAL_LIMITS.versionBase,
        description: 'Revisión sobre la que se preparó el cambio.',
      },
      cambio: {
        type: 'string',
        minLength: 1,
        maxLength: PROPOSAL_LIMITS.cambio,
        description: 'Cambio propuesto, en texto o diff acotado.',
      },
      motivo: {
        type: 'string',
        minLength: 1,
        maxLength: PROPOSAL_LIMITS.motivo,
        description: 'Por qué se propone el cambio.',
      },
      evidencia: {
        type: 'array',
        minItems: 1,
        maxItems: PROPOSAL_LIMITS.evidenciaItems,
        items: { type: 'string', minLength: 1, maxLength: PROPOSAL_LIMITS.evidenciaItem },
        description: 'Referencias que sostienen la propuesta.',
      },
      claveCliente: {
        type: 'string',
        minLength: 1,
        maxLength: PROPOSAL_LIMITS.claveCliente,
        description: 'Clave de idempotencia del cliente, única por dueño y espacio.',
      },
      title: {
        type: 'string',
        minLength: 1,
        maxLength: PROPOSAL_LIMITS.title,
        description: 'Título visible para la persona que revisa.',
      },
    },
  },
}

/**
 * Submit one proposal as the authenticated owner.
 * @param context - context carrying the board service.
 * @param ownerId - authenticated owner the token names.
 * @param companyId - company the token is scoped to, when any.
 * @param spaceId - space the token's proposals are filed in, when any.
 * @param args - untrusted tool arguments.
 * @returns the exact receipt of the pending item.
 */
export async function submitProposal(
  context: Context,
  ownerId: string,
  companyId: string | undefined,
  spaceId: string | undefined,
  args: Record<string, unknown>,
): Promise<BoardProposalReceipt> {
  const writer = companyId === undefined ? { id: ownerId } : { id: ownerId, companyId }
  return await context.faberloomBoard.submitProposal(writer, args, spaceId ?? null)
}
