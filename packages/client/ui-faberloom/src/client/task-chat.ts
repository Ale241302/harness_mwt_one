/**
 * The work-bench "open chat" gesture: it starts one harness conversation
 * already knowing which work-bench task it belongs to, so the agent works the
 * exact task (board item, email draft, pending email, or an MWT.ONE review)
 * instead of starting blind. The task context is a model-facing prompt, not
 * product copy, so it is authored here rather than in the UI dictionary.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { FaberLoomBoardIterationContext } from '@deepseek-ai/dsh-faberloom-view/types'
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
  /** Task source: `board`, `iteration`, `draft`, `inbox`, or `mwt`. */
  readonly kind: string
  /** Display title (the task's or email's subject). */
  readonly title: string
  /** Extra context: status, sender, summary, or the task id. */
  readonly detail: string
  /** FabreLoom agent the owner assigned to the task, when they picked one. */
  readonly agentName?: string | null
  /** The pinned iteration context the host filtered for this actor (§8.5). */
  readonly iteration?: FaberLoomBoardIterationContext
  /** Folder of the Space the task belongs to, so the session is born there. */
  readonly cwd?: string
}

/** The first thing every task chat must do: name the task before acting. */
const TASK_GUIDE = 'Empieza aplicando la skill `grill-me-lite`: resume en una línea de qué trata esta tarea del banco de trabajo y cuál es el siguiente paso concreto; luego ayúdame a resolverla.'

/** Name the assigned agent so the live agent works with it, not instead of it. */
function agentLine(agentName: string | null | undefined): string {
  const name = (agentName ?? '').trim()
  return name.length === 0
    ? ''
    : `\n\nEl usuario asignó a esta tarea el agente «${name}»: trabaja con él como especialista, además del agente vivo.`
}

/** Build the model-facing opening prompt for one task source. */
function promptFor(input: TaskChatInput): string {
  return `${TASK_GUIDE}\n\n${taskBody(input)}${agentLine(input.agentName)}`
}

/** Build the source-specific body of the opening prompt. */
function taskBody(input: TaskChatInput): string {
  if (input.kind === 'iteration' && input.iteration !== undefined) {
    const pinned = input.iteration
    // A provider above the item's data class receives metadata only, so the
    // prompt names what is missing instead of sending an empty summary (W-48).
    const withheld = pinned.summary === null
    return [
      'Estoy iterando un ítem del banco de trabajo (Work bench) desde la Mesa.',
      '',
      `Ítem: ${pinned.title}`,
      `Cuenta: ${pinned.accountRef ?? 'sin cuenta'}`,
      `Espacio: ${pinned.spaceTitle ?? 'sin espacio'}`,
      `Versión: v${String(pinned.version)}`,
      ...pinned.summary === null ? [] : [`Resumen vigente: ${pinned.summary}`],
      ...pinned.draftSummary === null ? [] : ['', `Trabajo sin terminar: ${pinned.draftSummary}`],
      ...withheld
        ? ['', 'El contenido de este ítem no se carga en este proveedor: trabaja solo con estos metadatos '
          + 'y pídeme el dato que falte en vez de suponerlo.']
        : [],
      '',
      'El ítem queda fijado: partimos de esa cuenta, ese espacio y esa versión, '
        + 'y no inventamos datos que no estén en el contexto cargado.',
      'Propón el cambio campo por campo; cada respuesta que cambie el borrador se muestra como diff y las verificaciones se recalculan.',
    ].join('\n')
  }
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
    // A task with a Space opens its session inside that Space's folder, so the
    // conversation appears in the sidebar where the work lives; a task with no
    // Space still opens a global session instead of refusing the gesture.
    const sessionId = await ctx.sessions.create(input.cwd === undefined ? {} : { cwd: input.cwd })
    const session = ctx.sessions.binding(sessionId)?.session
    if (session !== undefined) {
      await session.prompt([{ type: 'text', text: promptFor(input) }], 'queue')
    }
    ctx.sessions.open(sessionId)
    ctx.layout.selectPanel(null)
  })().catch(() => { bound.setError('task chat failed') })
}
