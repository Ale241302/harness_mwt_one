/**
 * The tool policy for mounted MCP tools. Enforcement lives here because the
 * call is the operation that decides: the tools stay visible to the model, and
 * a mutating mail tool is refused where it runs.
 *
 * The policy names raw MCP tool names, the identity the MCP client keeps for a
 * tool. The public name the model calls is derived by `publicToolName` from that
 * identity, so normalization and truncation can never hide a guarded tool.
 *
 * Every guarded name denies. This deployment runs `danger-full-access`, which
 * maps the approval policy to `never`, and that policy resolves an `ask` to
 * `rejected` without prompting anyone; an `ask` here would tell the model and
 * the owner that a human rejected the call. A deployment that composes an
 * interactive approval policy can turn the mutating set into `ask` at this one
 * policy table and keep the same enforcement point.
 *
 * @module @deepseek-ai/dsh-faberloom-mcp-registry/policy
 */

import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

/** The raw mail tool that would send mail without a FaberLoom draft. */
const SEND_RAW_NAME = 'send_email'

/** What each guarded raw tool changes, in the owner's language, keyed by raw name. */
const CHANGED_BY: ReadonlyMap<string, string> = new Map([
  ['messages_delete-bulk', 'eliminar varios mensajes del buzón a la vez'],
  ['messages_move', 'mover un mensaje a otra carpeta'],
  ['messages_move-bulk', 'mover varios mensajes a otra carpeta'],
  ['messages_update-flags', 'cambiar las marcas de un mensaje'],
  ['messages_patch', 'modificar un mensaje del buzón'],
  ['folders_create', 'crear una carpeta en el buzón'],
  ['folders_update', 'cambiar una carpeta del buzón'],
  ['webhooks_create', 'crear un webhook que recibe avisos del correo'],
  ['webhooks_update', 'cambiar un webhook que recibe avisos del correo'],
  ['webhooks_regenerate-secret', 'regenerar el secreto de un webhook'],
  ['webhooks_test', 'enviar una prueba a un webhook'],
])

/** Every raw tool name this policy covers; the caller derives their public names. */
export const GOVERNED_RAW_TOOLS: readonly string[] = [SEND_RAW_NAME, ...CHANGED_BY.keys()]

/**
 * The reversible message actions the owner may invoke from the Correo panel.
 * Permanent deletion, sending, folder edits and webhooks stay out: the panel
 * moves a message to Trash so a misclick is recoverable.
 */
const OWNER_ACTION_RAW_TOOLS: ReadonlySet<string> = new Set([
  'messages_patch',
  'messages_update-flags',
  'messages_move',
  'messages_move-bulk',
])

/**
 * Whether one raw tool is a mailbox action the owner can trigger from the panel.
 * @param rawName - the server's own tool name.
 * @returns true for the reversible message actions.
 */
export function isOwnerMailAction(rawName: string): boolean {
  return OWNER_ACTION_RAW_TOOLS.has(rawName)
}

/**
 * The decision one raw MCP tool call takes before it runs.
 * @param rawName - the server's own tool name, never the public name.
 * @returns the deny decision, or undefined when the call is none of this policy's business.
 */
export function mcpToolDecision(rawName: string): PreToolDecision | undefined {
  if (rawName === SEND_RAW_NAME) {
    return {
      kind: 'deny',
      reason: 'El envío de correo debe hacerse desde un borrador de FaberLoom, que el dueño aprueba antes de salir. Esta herramienta de MCP no puede enviar correo por su cuenta.',
    }
  }
  const change = CHANGED_BY.get(rawName)
  if (change === undefined) return undefined
  return {
    kind: 'deny',
    reason: `El agente no puede ${change} desde MCP («${rawName}»). Hazlo tú en el buzón o desde FaberLoom.`,
  }
}
