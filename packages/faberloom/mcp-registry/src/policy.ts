/**
 * The approval policy for mounted MCP tools. Enforcement lives here because the
 * call is the operation that decides: the tools stay visible to the model, and
 * a mutating mail tool is refused or held for the owner's approval where it
 * runs.
 *
 * The policy names raw MCP tool names, the identity the MCP client keeps for a
 * tool. The public name the model calls is derived by `publicToolName` from that
 * identity, so normalization and truncation can never hide a guarded tool.
 *
 * @module @deepseek-ai/dsh-faberloom-mcp-registry/policy
 */

import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

/** The raw mail tool that would send mail without a FaberLoom draft. */
const SEND_RAW_NAME = 'send_email'

/** What each guarded raw tool changes, in the owner's language, keyed by raw name. */
const APPROVAL_CHANGES: ReadonlyMap<string, string> = new Map([
  ['messages_delete-bulk', 'elimina varios mensajes del buzón a la vez'],
  ['messages_move', 'mueve un mensaje a otra carpeta'],
  ['messages_move-bulk', 'mueve varios mensajes a otra carpeta'],
  ['messages_update-flags', 'cambia las marcas de un mensaje'],
  ['messages_patch', 'modifica un mensaje del buzón'],
  ['folders_create', 'crea una carpeta en el buzón'],
  ['folders_update', 'cambia una carpeta del buzón'],
  ['webhooks_create', 'crea un webhook que recibe avisos del correo'],
  ['webhooks_update', 'cambia un webhook que recibe avisos del correo'],
  ['webhooks_regenerate-secret', 'regenera el secreto de un webhook'],
  ['webhooks_test', 'envía una prueba a un webhook'],
])

/** Every raw tool name this policy covers; the caller derives their public names. */
export const GOVERNED_RAW_TOOLS: readonly string[] = [SEND_RAW_NAME, ...APPROVAL_CHANGES.keys()]

/**
 * The decision one raw MCP tool call takes before it runs.
 * @param rawName - the server's own tool name, never the public name.
 * @returns the deny or ask decision, or undefined when the call is none of this policy's business.
 */
export function mcpToolDecision(rawName: string): PreToolDecision | undefined {
  if (rawName === SEND_RAW_NAME) {
    return {
      kind: 'deny',
      reason: 'El envío de correo debe hacerse desde un borrador de FaberLoom, que el dueño aprueba antes de salir. Esta herramienta de MCP no puede enviar correo por su cuenta.',
    }
  }
  const change = APPROVAL_CHANGES.get(rawName)
  if (change === undefined) return undefined
  return {
    kind: 'ask',
    reason: `La herramienta de MCP «${rawName}» ${change}. FaberLoom pide tu aprobación antes de ejecutarla.`,
  }
}
