/**
 * The defaults FaberLoom seeds for a new owner, taken from the product plan and
 * the screen schemas (`pantallas-faberloom.md` §5 agents, §7 routines).
 *
 * This is a starting catalogue, not a business policy: every value is editable
 * in the panels, and the seeder only assigns the skills that actually exist for
 * the owner's role.
 * @module @deepseek-ai/dsh-faberloom-defaults/catalog
 */

/** One agent the catalogue seeds. */
export interface SeedAgent {
  /** Display name. */
  readonly name: string
  /** Responsibility statement, as the plan words it. */
  readonly responsibility: string
  /** Skill names the plan's flows need; the seeder keeps only the ones that exist. */
  readonly skills: readonly string[]
}

/** One routine step the catalogue seeds. */
export interface SeedStep {
  /** Stable step id. */
  readonly id: string
  /** Instruction the step runs. */
  readonly instruction: string
  /** Registered handler the step runs under. */
  readonly handler: string
  /** Steps that must settle first. */
  readonly dependsOn: readonly string[]
  /** Wait pattern the step parks on, when it waits for a person or an event. */
  readonly waitFor?: string
}

/** One routine the catalogue seeds. */
export interface SeedRoutine {
  /** Display name. */
  readonly name: string
  /** Why the routine exists. */
  readonly intent: string
  /** Trigger kind and its pattern. */
  readonly trigger: { readonly kind: 'manual' | 'event' | 'email' | 'date' | 'recurrence'; readonly match?: string }
  /** Ordered steps. */
  readonly steps: readonly SeedStep[]
  /** Result the routine promises. */
  readonly expectedResult: string
  /** Actions the routine may take. */
  readonly permissions: readonly string[]
  /** What happens when a step fails. */
  readonly failurePolicy: 'stop' | 'continue' | 'review'
}

/** Agents seeded from the catalogue screen's example roster. */
export const SEED_AGENTS: readonly SeedAgent[] = [
  {
    name: 'Recepción',
    responsibility: 'Identifica al cliente y el espacio de cada caso que entra, y deja el expediente listo para el resto del proceso.',
    skills: ['mwt-compras-clientes-leer', 'mwt-compras-expedientes-leer'],
  },
  {
    name: 'Revisión de pedidos',
    responsibility: 'Contrasta cada pedido con las condiciones y el historial antes de que se prepare un documento.',
    skills: ['mwt-compras-historial-precios-leer', 'mwt-compras-cartera-leer'],
  },
  {
    name: 'Proformas',
    responsibility: 'Prepara el documento con precios verificados y lo deja listo para revisión.',
    skills: ['mwt-compras-clientes-leer', 'mwt-compras-inventario-leer', 'mwt-compras-historial-precios-leer'],
  },
]

/** Routines seeded from the routine screen's worked example. */
export const SEED_ROUTINES: readonly SeedRoutine[] = [
  {
    name: 'Pedido a proforma',
    intent: 'Preparar la proforma de una orden de compra que llega por correo.',
    trigger: { kind: 'email', match: 'orden de compra' },
    steps: [
      { id: 'pedido-identificar', instruction: 'Identifica al cliente y su espacio a partir de la orden recibida.', handler: 'agent', dependsOn: [] },
      { id: 'pedido-consultar', instruction: 'Consulta las condiciones y el historial de precios del cliente para el pedido.', handler: 'mcp', dependsOn: ['pedido-identificar'] },
      { id: 'pedido-preparar', instruction: 'Prepara la proforma con los precios verificados y adjunta las referencias usadas.', handler: 'agent', dependsOn: ['pedido-consultar'] },
      { id: 'pedido-revision', instruction: 'Espera la aprobación de la revisión antes de dar el pedido por preparado.', handler: 'wait', dependsOn: ['pedido-preparar'], waitFor: 'aprobacion' },
    ],
    expectedResult: 'Proforma con precios correctos, lista para enviar.',
    permissions: ['mwt'],
    failurePolicy: 'review',
  },
]
