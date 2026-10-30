/**
 * The usage policy a `client_b2b` session runs under: the shared deployment key
 * may answer only work about MWT.ONE, SICOP, and the account's mail; a personal
 * request is refused before the provider sees it. A user-supplied key is outside
 * the policy, because it is that user's own credential and cost.
 * @module @deepseek-ai/dsh-faberloom-session-agent/src/policy
 */

import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'

/** Tool-name prefixes the shared key may execute. */
export const PRODUCT_TOOL_PREFIXES: readonly string[] = ['mcp__mwt__', 'mcp__sicop__', 'faberloom_']

/** Non-product tools the Space agent still needs to run its own prompt. */
export const PRODUCT_TOOL_NAMES: readonly string[] = ['skill', 'ask_user', 'read', 'read_image']

/** Credential references the deployment itself configures. */
export const SHARED_CREDENTIAL_REFS: readonly string[] = ['DEEPSEEK_API_KEY']

/** The persona one Space without a responsible agent runs under. */
export const DEFAULT_PRODUCT_PERSONA = [
  'Sos el asistente del Space. Trabajás únicamente con información de MWT.ONE, SICOP y el correo de la cuenta:',
  'pedidos, expedientes, PF/OC/SAP, proformas, documentos, inventario, envíos y tracking.',
  'Consultá el MCP de MWT.ONE o SICOP antes de responder un dato de negocio, y no inventes lo que no está.',
  'No resuelvas pedidos personales, tareas escolares, código ajeno ni consultas fuera de ese alcance.',
].join(' ')

/** The short policy the model reads even when the guard already enforces it. */
export const PRODUCT_POLICY = [
  'Esta cuenta usa la llave compartida de FaberLoom.',
  'Respondé solo sobre MWT.ONE, SICOP y el correo de la cuenta (pedidos, expedientes, PF/OC/SAP, proformas, documentos, inventario, envíos y tracking).',
  'Si el pedido es personal o ajeno al trabajo, respondé que no podés ayudarlo con la llave compartida y que configure su propia llave en Ajustes → Modelos.',
].join(' ')

/** The answer one refused request receives. */
export const DEFAULT_REFUSAL = [
  'Esta cuenta usa la llave compartida de FaberLoom para MWT.ONE, SICOP y el correo.',
  'No puedo ayudarte con consultas personales ni con tareas ajenas a ese alcance.',
  'Si querés usar la IA para otra cosa, configurá tu propia llave en Ajustes → Modelos.',
].join(' ')

/** Work domains the shared key may answer. */
const WORK_DOMAIN = new RegExp([
  '\\bmwt\\b', '\\bsicop\\b', '\\bimap\\b', '\\bsmtp\\b', '\\bcorreos?\\b', '\\bemails?\\b', '\\be-mails?\\b',
  '\\bexpedientes?\\b', '\\bproformas?\\b', '\\bfacturas?\\b', '\\bcotizaci[oó]n\\b', '\\bpedidos?\\b',
  '\\bclientes?\\b', '\\bproveedores?\\b', '\\bdespachos?\\b', '\\baduanas?\\b', '\\bcontenedores?\\b',
  '\\bbooking\\b', '\\bbl\\b', '\\bawb\\b', '\\btracking\\b', '\\barribos?\\b', '\\beta\\b', '\\betd\\b',
  '\\binventario\\b', '\\bstock\\b', '\\bsku\\b', '\\bprecios?\\b', '\\bproductos?\\b', '\\benv[ií]os?\\b',
  '\\bsap\\b', '\\bpf\\b', '\\boc\\b', '\\bpo\\b', '\\borden(?:es)? de compra\\b',
].join('|'), 'iu')

/** A short answer that continues the work of the previous turn. */
const CONTINUATION = /^(?:s[ií]|dale|ok|okay|contin[uú]a|segu[ií]|hacelo|hazlo|ahora|bien|perfecto|gracias)\b/iu

/**
 * The text of the latest human message. A tool result arrives as a user-role
 * message too, so its source kind is what separates it from the person typing.
 * @param messages - the request messages.
 * @returns the latest human text, or undefined when the turn carries none.
 */
export function latestHumanText(messages: readonly Message[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message === undefined || message.role !== 'user' || message.source.kind !== 'user') continue
    const text = message.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    return text.length === 0 ? undefined : text
  }
  return undefined
}

/** Whether the request already carries a tool result, so it continues an allowed turn. */
function continuesAfterTool(messages: readonly Message[]): boolean {
  return messages.some(message => message.source.kind === 'tool')
}

/** Whether an earlier human message belongs to the work domain. */
function hasWorkContext(messages: readonly Message[]): boolean {
  return messages.some((message) => {
    if (message.role !== 'user' || message.source.kind !== 'user') return false
    const text = message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
    return text.length > 0 && WORK_DOMAIN.test(text)
  })
}

/**
 * Decide whether the shared key may answer one assembled request. Internal
 * calls without a session (the board classifier), auxiliary calls with a
 * purpose, and continuations after a tool result pass; a human turn needs a
 * work-domain term, or a short continuation of an earlier work turn.
 * @param options - the request the loop assembled.
 * @returns true when the request may reach the provider.
 */
export function usageAllowed(options: GenerateOptions): boolean {
  if (options.sessionId === undefined) return true
  if (options.purpose !== undefined) return true
  if (continuesAfterTool(options.messages)) return true
  const text = latestHumanText(options.messages)
  if (text === undefined) return false
  if (WORK_DOMAIN.test(text)) return true
  return text.length <= 40 && CONTINUATION.test(text) && hasWorkContext(options.messages)
}

/**
 * The stream one refused request yields: one visible text block and a normal
 * stop, so the client renders the refusal as the assistant's answer.
 * @param refusal - the text the user reads.
 * @returns the chunks the model call would have produced.
 */
export async function* refusalStream(refusal: string): AsyncIterable<StreamChunk> {
  yield { type: 'text-delta', index: 0, text: refusal }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: refusal } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

/**
 * Whether one tool name belongs to the product surface the shared key may use.
 * @param name - registered tool name.
 * @param prefixes - allowed prefixes.
 * @returns true when the tool is product-owned.
 */
export function isProductTool(name: string, prefixes: readonly string[] = PRODUCT_TOOL_PREFIXES): boolean {
  return PRODUCT_TOOL_NAMES.includes(name) || prefixes.some(prefix => name.startsWith(prefix))
}
