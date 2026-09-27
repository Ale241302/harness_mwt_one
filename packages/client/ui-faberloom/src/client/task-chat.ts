/**
 * The work-bench "open chat" gesture: it starts one harness conversation
 * already knowing which work-bench task it belongs to, so the agent works the
 * exact task (board item, email draft, pending email, or an MWT.ONE review)
 * instead of starting blind. The task context is a model-facing prompt, not
 * product copy, so it is authored here rather than in the UI dictionary.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls ctx.sessions (create / binding / open).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls ctx.layout.selectPanel.
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'

/** The one write the seed performs on the shared store: publish a failure. */
export interface TaskChatBound {
  setError(message: string): void
}

/** One work-bench task the chat should be seeded with. */
export interface TaskChatInput {
  /** Task source: `board`, `draft`, `inbox`, or `mwt`. */
  readonly kind: string
  /** Display title (the task's or email's subject). */
  readonly title: string
  /** Extra context: status, sender, summary, or the task id. */
  readonly detail: string
}

/** The first thing every task chat must do: name the task before acting. */
const TASK_GUIDE = 'Empieza aplicando la skill `grill-me-lite`: resume en una línea de qué trata esta tarea del banco de trabajo y cuál es el siguiente paso concreto; luego ayúdame a resolverla.'

/** Build the model-facing opening prompt for one task source. */
function promptFor(input: TaskChatInput): string {
  return `${TASK_GUIDE}\n\n${taskBody(input)}`
}

/** Build the source-specific body of the opening prompt. */
function taskBody(input: TaskChatInput): string {
  if (input.kind === 'draft') {
    return [
      'Estoy revisando un borrador de correo en el banco de trabajo (Work bench).',
      '',
      `Asunto: ${input.title}`,
      `Contexto: ${input.detail}`,
      '',
      'Revisa el borrador, mejora el texto con la voz del remitente si hace falta y déjalo listo para enviar. No lo envíes sin mi confirmación.',
    ].join('\n')
  }
  if (input.kind === 'inbox') {
    return [
      'Tengo un correo pendiente de responder (no leído del INBOX).',
      '',
      `De/Asunto: ${input.title}`,
      `Contexto: ${input.detail}`,
      '',
      'Lee el correo completo con las herramientas de correo de FaberLoom, redacta una respuesta con la voz del remitente y guárdala como borrador. No la envíes sin mi confirmación.',
    ].join('\n')
  }
  if (input.kind === 'mwt') {
    return [
      'Revisa MWT.ONE con las herramientas del MCP `mwt` y crea aquí las tareas del banco de trabajo que hagan falta.',
      '',
      'Reglas:',
      '- Usa solo datos reales del MCP; no inventes.',
      '- Por cada expediente que lo requiera, crea una tarea con `faberloom_board_create` (title claro y evidence con el dato real, p. ej. `expediente:EXP-...`).',
      '- Cubre: falta subir la OC/PO (`documento_listar` frente a `expediente_obtener`); falta el SAP (solo rol Admin/CEO); estado que ya pasó su fecha fin de fase (`expediente_phase_durations_get` y `phase_durations_json`; `expediente_avanzar_estado` para cambiarlo); falta el operador (`operating_company_id`); lista de precios por vencer.',
      '- Si algo no es consultable con las herramientas del MCP, dilo y no crees la tarea.',
    ].join('\n')
  }
  return [
    'Estoy trabajando una tarea del banco de trabajo (Work bench).',
    '',
    `Tarea: ${input.title}`,
    `Contexto: ${input.detail}`,
    '',
    'Ayúdame a completarla. Si toca datos de MWT.ONE, usa las herramientas del MCP `mwt` para consultar o actualizar los valores reales (no inventes) y continúa hasta resolverla o decirme exactamente qué falta.',
  ].join('\n')
}

/**
 * Create a chat session seeded with the task context and open it. A failed
 * session create is published to the store; the current panel stays otherwise.
 * @param ctx - client root context carrying sessions and layout.
 * @param bound - the shared store's write surface, for a failure.
 * @param input - the work-bench task behind the gesture.
 */
export function runTaskChat(ctx: ClientContext, bound: TaskChatBound, input: TaskChatInput): void {
  void (async () => {
    const sessionId = await ctx.sessions.create({})
    const session = ctx.sessions.binding(sessionId)?.session
    if (session !== undefined) {
      await session.prompt([{ type: 'text', text: promptFor(input) }], 'queue')
    }
    ctx.sessions.open(sessionId)
    ctx.layout.selectPanel(null)
  })().catch(() => { bound.setError('task chat failed') })
}
