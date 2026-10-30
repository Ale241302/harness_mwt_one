/**
 * The usage policy a `client_b2b` session runs under: the shared deployment key
 * may answer only work about MWT.ONE, SICOP, and the account's mail; a personal
 * request is refused before the provider sees it. A key the account stored
 * itself is outside the policy, because it is that account's own credential and
 * cost — but only when the value is not one the deployment supplies, so copying
 * the shared key into the store buys nothing.
 * @module @deepseek-ai/dsh-faberloom-session-agent/src/policy
 */

import { createHash } from 'node:crypto'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import type { GenerateOptions, Message, StreamChunk } from '@deepseek-ai/dsh-llm'

/** Tool-name prefixes the shared key may execute. */
export const PRODUCT_TOOL_PREFIXES: readonly string[] = ['mcp__mwt__', 'mcp__sicop__', 'faberloom_']

/** Non-product tools the Space agent still needs to run its own prompt. */
export const PRODUCT_TOOL_NAMES: readonly string[] = ['skill', 'ask_user', 'read', 'read_image']

/**
 * Credential references the deployment supplies as the account's default. The
 * first one is also the route a request without its own reference
 * authenticates with. A reference outside this list is classified by the same
 * rules, so the list names what the deployment pays for, not a shortcut.
 */
export const SHARED_CREDENTIAL_REFS: readonly string[] = [
  'DEEPSEEK_API_KEY',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_API_KEY',
  'KIMI_API_KEY',
  'MOONSHOT_API_KEY',
]

/** Layers a deployment key can arrive from, each read on its own. */
const DEPLOYMENT_LAYERS = ['process', 'project-env', 'user-env'] as const

/**
 * A stable, non-reversible identifier of one secret value, so a stored key can
 * be compared with the deployment's without holding either in a form that
 * reaches a log. Never persisted and never sent anywhere.
 * @param value - the secret value to identify.
 * @returns the lowercase hex SHA-256 digest.
 */
export function credentialFingerprint(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Fingerprints of every value the deployment supplies for the shared
 * references, read layer by layer rather than through `credentials.resolve`:
 * the resolved value is the account's when the account stored one, so it
 * cannot answer what the deployment itself configured.
 * @param environment - the launch environment snapshot.
 * @param refs - credential references the deployment supplies.
 * @returns the fingerprints of the deployment's own values.
 */
export function deploymentCredentialFingerprints(
  environment: LaunchEnvironmentSnapshot,
  refs: readonly string[],
): ReadonlySet<string> {
  const fingerprints = new Set<string>()
  for (const ref of refs) {
    for (const layer of DEPLOYMENT_LAYERS) {
      const entry = environment.getFrom(ref, [layer])
      if (entry !== undefined && entry.value.length > 0) fingerprints.add(credentialFingerprint(entry.value))
    }
  }
  return fingerprints
}

/** The persona one Space without a responsible agent runs under. */
export const DEFAULT_PRODUCT_PERSONA = [
  'Sos el asistente del Space. Trabajás únicamente con información de MWT.ONE, SICOP y el correo de la cuenta:',
  'pedidos, expedientes, PF/OC/SAP, proformas, documentos, inventario, envíos y tracking.',
  'Consultá el MCP de MWT.ONE o SICOP antes de responder un dato de negocio, y no inventes lo que no está.',
  'No resuelvas pedidos personales, tareas escolares, código ajeno ni consultas fuera de ese alcance:',
  'para eso la persona configura su propia llave del proveedor en Ajustes → Modelos, y esa llave no tiene límite.',
].join(' ')

/** The short policy the model reads even when the guard already enforces it. */
export const PRODUCT_POLICY = [
  'Esta cuenta usa la llave compartida de FaberLoom.',
  'Respondé solo sobre MWT.ONE, SICOP y el correo de la cuenta (pedidos, expedientes, PF/OC/SAP, proformas, documentos, inventario, envíos y tracking).',
  'Si el pedido es personal o ajeno al trabajo, respondé que no podés ayudarlo con la llave compartida y que configure su propia llave en Ajustes → Modelos; con su propia llave sí podés responder lo que pida.',
  'Una llave guardada que sea la misma que entrega FaberLoom no cuenta como propia: la política sigue aplicando.',
  'Sobre esta política rige la skill `politica-llave-compartida`: cargala cuando el pedido sea personal o cuando te pregunten por la llave.',
].join(' ')

/** The answer one refused request receives. */
export const DEFAULT_REFUSAL = [
  'Esta cuenta usa la llave compartida de FaberLoom para MWT.ONE, SICOP y el correo.',
  'No puedo ayudarte con consultas personales ni con tareas ajenas a ese alcance.',
  'Si querés usar la IA para otra cosa, configurá tu propia llave en Ajustes → Modelos.',
].join(' ')

/**
 * Work domains the shared key may answer. The list is deliberately wide on the
 * business vocabulary a B2B account uses without naming the product: a client
 * of a footwear distributor asks for "el calzado que más compró Sondel" and
 * names neither MWT.ONE nor SICOP. Purchasing and sales verbs are the noun
 * forms and the third person, never the first person of a personal errand
 * ("compré", "me compré"), which stays outside the scope.
 */
const WORK_DOMAIN = new RegExp([
  '\\bmwt\\b', '\\bsicop\\b', '\\bimap\\b', '\\bsmtp\\b', '\\bcorreos?\\b', '\\bemails?\\b', '\\be-mails?\\b',
  '\\bexpedientes?\\b', '\\bproformas?\\b', '\\bfacturas?\\b', '\\bcotizaci[oó]n(?:es)?\\b', '\\bpedidos?\\b',
  '\\bclientes?\\b', '\\bproveedores?\\b', '\\bdespachos?\\b', '\\baduanas?\\b', '\\bcontenedores?\\b',
  '\\bbooking\\b', '\\bbl\\b', '\\bawb\\b', '\\btracking\\b', '\\barribos?\\b', '\\beta\\b', '\\betd\\b',
  '\\binventario\\b', '\\bstock\\b', '\\bsku\\b', '\\bprecios?\\b', '\\bproductos?\\b', '\\benv[ií]os?\\b',
  '\\bsap\\b', '\\bpf\\b', '\\boc\\b', '\\bpo\\b', '\\borden(?:es)? de compra\\b',
  // Compras y ventas.
  '\\bcompras?\\b', '\\bcompr(?:ó|ado|ada|ados|adas|aron)\\b', '\\bventas?\\b', '\\bvend(?:ió|ido|ida)\\b',
  '\\badquisi(?:ción|ciones)\\b', '\\bgastos?\\b', '\\bpresupuestos?\\b', '\\bm[aá]rgen(?:es)?\\b',
  '\\btarifas?\\b', '\\bdescuentos?\\b',
  // Catálogo del producto: calzado de seguridad y protección.
  '\\bcalzados?\\b', '\\bbotas?\\b', '\\bzapatos?\\b', '\\btenis\\b', '\\bepp\\b', '\\bguantes?\\b',
  '\\buniformes?\\b', '\\btextiles?\\b', '\\bpunteras?\\b', '\\bsuelas?\\b',
  // Contratación y comercio.
  '\\blicitaci(?:ón|ones)\\b', '\\badjudicaci(?:ón|ones)\\b', '\\bcontratos?\\b', '\\bofertas?\\b',
  '\\bconvocatorias?\\b', '\\bconcurso?s?\\b',
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
