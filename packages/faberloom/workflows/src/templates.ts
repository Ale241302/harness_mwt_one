/**
 * The built-in Work Flow templates: complete, validated graphs a user can start
 * from instead of drawing the automation from scratch. The anti-spam template is
 * the worked example (read mail, classify, discard spam, leave a note); the
 * others are short, real starting points. The same JSON travels to the knowledge
 * hub, so the catalog here is the source of truth the hub mirrors.
 * @module @deepseek-ai/dsh-faberloom-workflows/src/templates
 */

import type { WorkFlowDefinition, WorkFlowEdgeId, WorkFlowNodeId } from './types.ts'

/** One built-in template. */
export interface WorkFlowTemplate {
  /** Stable template id; the gallery and the tools address it by this. */
  readonly id: string
  /** Display name. */
  readonly name: string
  /** One-sentence description. */
  readonly description: string
  /** The graph the template creates. */
  readonly definition: WorkFlowDefinition
}

/** Node id helper for the template literals. */
const nid = (value: string): WorkFlowNodeId => value as WorkFlowNodeId

/** Edge id helper for the template literals. */
const eid = (value: string): WorkFlowEdgeId => value as WorkFlowEdgeId

/**
 * The anti-spam example: a new mailbox message is classified; spam is moved out
 * of the inbox and noted on the board, and everything else notifies the owner.
 * Both tails are gated on the same condition so a skipped branch never runs.
 */
const ANTI_SPAM: WorkFlowDefinition = {
  intent: 'Clasificar el correo entrante y descartar el spam, avisando al dueño.',
  nodes: [
    { id: nid('n1'), title: 'Correo entrante', position: { x: 40, y: 48 }, kind: 'trigger.email', config: { match: '' } },
    { id: nid('n2'), title: '¿Es spam?', position: { x: 260, y: 48 }, kind: 'condition', config: { expression: 'event.data.spam == true' } },
    { id: nid('n3'), title: 'Mover a Spam', position: { x: 500, y: 48 }, kind: 'imap.action', config: { op: 'move', folder: 'Spam' } },
    { id: nid('n4'), title: 'Anotar en la Mesa', position: { x: 740, y: 48 }, kind: 'board.create', config: { title: 'Spam borrado: {{event.data.subject}}' } },
    { id: nid('n5'), title: 'Avisar al dueño', position: { x: 500, y: 190 }, kind: 'notify', config: { kind: 'email', text: 'Correo nuevo recibido' } },
  ],
  edges: [
    { id: eid('e1'), from: nid('n1'), to: nid('n2') },
    { id: eid('e2'), from: nid('n2'), to: nid('n3'), condition: 'spam == true' },
    { id: eid('e3'), from: nid('n3'), to: nid('n4') },
    { id: 'e5' as never, from: nid('n2'), to: nid('n4'), condition: 'spam == true' },
    { id: 'e4' as never, from: nid('n2'), to: nid('n5'), condition: 'spam == false' },
  ],
  permissions: ['email:read'],
  failurePolicy: 'review',
}

/** A periodic inbox check that files a board task when unread mail piles up. */
const INBOX_DIGEST: WorkFlowDefinition = {
  intent: 'Cada 12 h revisar el correo y dejar una tarea en la Mesa si hay mensajes sin leer.',
  nodes: [
    { id: nid('d1'), title: 'Cada 12 h', position: { x: 40, y: 48 }, kind: 'trigger.schedule', config: { recurrence: 'every:12h', timezone: 'UTC' } },
    { id: nid('d2'), title: 'Buscar no leídos', position: { x: 300, y: 48 }, kind: 'imap.action', config: { op: 'search', query: 'UNSEEN' } },
    { id: nid('d3'), title: 'Avisar al dueño', position: { x: 560, y: 48 }, kind: 'notify', config: { kind: 'email', text: 'Revisión de correo: hay mensajes sin leer' } },
  ],
  edges: [
    { id: eid('e1'), from: nid('d1'), to: nid('d2') },
    { id: eid('e2'), from: nid('d2'), to: nid('d3') },
  ],
  permissions: ['email:read'],
  failurePolicy: 'continue',
}

/** A manual run that asks the Space's agent for a short summary and files it. */
const AGENT_SUMMARY: WorkFlowDefinition = {
  intent: 'A mano: pedir al agente un resumen y dejarlo en la Mesa de trabajo.',
  nodes: [
    { id: nid('a1'), title: 'A mano', position: { x: 40, y: 48 }, kind: 'trigger.manual', config: {} },
    { id: nid('a2'), title: 'Resumir', position: { x: 300, y: 48 }, kind: 'agent', config: { agentId: '', instruction: 'Resume en tres frases el estado del trabajo pendiente.', useSpaceContext: true } },
    { id: nid('a3'), title: 'Dejar el resumen', position: { x: 560, y: 48 }, kind: 'board.create', config: { title: 'Resumen del agente', summary: '{{result.a2.text}}' } },
  ],
  edges: [
    { id: eid('e1'), from: nid('a1'), to: nid('a2') },
    { id: eid('e2'), from: nid('a2'), to: nid('a3') },
  ],
  permissions: [],
  failurePolicy: 'continue',
}

/** Every built-in template, in gallery order. */
export const WORKFLOW_TEMPLATES: readonly WorkFlowTemplate[] = [
  {
    id: 'anti-spam',
    name: 'Anti-spam',
    description: 'Clasifica el correo entrante, mueve el spam fuera de la bandeja y deja constancia; el resto avisa al dueño.',
    definition: ANTI_SPAM,
  },
  {
    id: 'inbox-digest',
    name: 'Revisión de correo cada 12 h',
    description: 'Cada 12 h busca mensajes sin leer y avisa al dueño por correo.',
    definition: INBOX_DIGEST,
  },
  {
    id: 'agent-summary',
    name: 'Resumen del agente',
    description: 'A mano: pide un resumen al agente del Space y lo deja en la Mesa de trabajo.',
    definition: AGENT_SUMMARY,
  },
]

/**
 * Read one template by id.
 * @param id - the template id.
 * @returns the template, or undefined.
 */
export function getTemplate(id: string): WorkFlowTemplate | undefined {
  return WORKFLOW_TEMPLATES.find(template => template.id === id)
}
