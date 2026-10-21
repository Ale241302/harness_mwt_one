/**
 * Where a routine can run: the VPS without the owner's computer, or a process
 * that has the owner's files. The answer is deliberately conservative: an
 * `agent`/`mcp` step is cloud-safe until its instruction names a local path or
 * a local mutation, because a confident "runs in the cloud" over a step that
 * edits an Excel file would be worse than saying it needs the PC.
 *
 * The classifier is a pure function over the stored definition, so the chat,
 * the HTTP view, and the MCP server all report the same verdict.
 * @module @deepseek-ai/dsh-faberloom-routines/cloud
 */

import type { RoutineDefinition } from './types.ts'

/** Where the work can happen. */
export type CloudExecutionScope = 'cloud' | 'local' | 'mixed'

/** One honest answer about a routine's execution environment. */
export interface CloudExecutionProfile {
  /** `cloud` when every step can run on the VPS, `local` when every step needs the PC, `mixed` otherwise. */
  readonly scope: CloudExecutionScope
  /** True when the whole routine can run on the VPS with the PC off. */
  readonly cloudReady: boolean
  /** True when at least one step needs the owner's computer powered on. */
  readonly requiresPc: boolean
  /** Steps that cannot run on the VPS, by id and human label. */
  readonly localSteps: readonly string[]
  /** Why those steps need the PC, in the user's language. */
  readonly reasons: readonly string[]
  /** One sentence the model can repeat to the user without inventing anything. */
  readonly note: string
}

/** One step as the classifier reads it; workflows map their nodes onto this. */
export interface CloudStepInput {
  /** Stable step or node id. */
  readonly id: string
  /** Human label, usually the instruction or node title. */
  readonly label: string
  /** Handler or node kind. */
  readonly handler: string
  /** Instruction, title, and configuration text the classifier scans. */
  readonly text: string
}

/** Handlers that only speak to services reachable from the deployment. */
const CLOUD_HANDLERS = new Set([
  'agent',
  'mcp',
  'mcp.call',
  'email.send',
  'email.followup',
  'email.extract-spreadsheet-link',
  'imap',
  'smtp',
  'wait',
  'delay',
  'condition',
  'transform',
  'memory.remember',
  'memory.teach',
  'board.create',
  'notify',
  'deadletter',
  'backup',
  'subroutine',
  'workflow',
  'reference',
])

/** Handlers that only make sense on the machine that owns the files. */
const LOCAL_HANDLERS = new Set([
  'shell',
  'command',
  'exec',
  'powershell',
  'bash',
  'script',
  'filesystem',
  'file',
  'files',
  'local',
])

/**
 * Text that means a step edits or reads something on the owner's computer.
 * The patterns name a local object together with a path or a local possessive;
 * a bare "archivo adjunto" is not one of them, because reading a mail
 * attachment is a cloud operation.
 */
const ACTION_WORDS = [
  'actualiza', 'actualizar', 'escribe', 'escribir', 'guarda', 'guardar',
  'modifica', 'modificar', 'edita', 'editar', 'sobrescribe', 'sobrescribir',
].join('|')
const FILE_WORDS = [
  'archivo', 'fichero', 'carpeta', 'excel', 'csv', 'xlsx', 'xls', 'docx', 'pdf',
  'onedrive', 'sharepoint',
].join('|')
const OBJECT_WORDS = ['archivo', 'fichero', 'carpeta', 'directorio'].join('|')
const COMPUTER_WORDS = ['pc', 'computadora', 'computador', 'equipo', 'm\\u00e1quina', 'maquina'].join('|')

const LOCAL_PATTERNS: readonly { readonly pattern: RegExp; readonly reason: string }[] = [
  { pattern: /[A-Za-z]:\\/u, reason: 'usa una ruta de Windows' },
  { pattern: /\\\\[^\\\s]/u, reason: 'usa una ruta de red local' },
  {
    pattern: new RegExp(`\\b(?:${OBJECT_WORDS})\\s+(?:local|de\\s+(?:mi|tu)\\s+(?:${COMPUTER_WORDS}))\\b`, 'iu'),
    reason: 'nombra un archivo o carpeta local',
  },
  {
    pattern: new RegExp(`\\b(?:en|de|desde)\\s+(?:mi|tu)\\s+(?:${COMPUTER_WORDS}|escritorio)\\b`, 'iu'),
    reason: 'nombra tu computadora o tu escritorio',
  },
  {
    pattern: new RegExp(`\\b(?:${ACTION_WORDS})\\b[^.?!\\n]{0,80}\\b(?:${FILE_WORDS})\\b`, 'iu'),
    reason: 'actualiza un archivo local',
  },
  {
    pattern: new RegExp(`\\b(?:${FILE_WORDS})\\b[^.?!\\n]{0,80}\\b(?:local|en\\s+(?:mi|tu)\\s+(?:${COMPUTER_WORDS}))\\b`, 'iu'),
    reason: 'trabaja con un archivo local',
  },
  {
    pattern: /\b(?:powershell|cmd\.exe|bash|terminal|shell|comando\s+local)\b/iu,
    reason: 'ejecuta un comando local',
  },
  {
    pattern: /\b(?:faberloom_(?:files?|file_|space_files|workspace_files)|filesystem|write_file|read_file|open_file)\b/iu,
    reason: 'usa herramientas de archivos locales',
  },
]

/**
 * Classify one set of steps. A local handler is always a blocker; an
 * `agent`/`mcp` step is a blocker only when its text names a local path or a
 * local mutation. Unknown handlers are blockers too, because no deployment has
 * promised to run them.
 * @param steps - the steps or nodes to inspect.
 * @returns the profile the UI and the chat report.
 */
export function classifyCloudSteps(steps: readonly CloudStepInput[]): CloudExecutionProfile {
  const localSteps: string[] = []
  const reasons: string[] = []
  let cloudCount = 0
  for (const step of steps) {
    const handler = step.handler.trim().toLowerCase()
    const label = step.label.trim().length === 0 ? step.id : step.label.trim()
    if (LOCAL_HANDLERS.has(handler)) {
      localSteps.push(label)
      reasons.push(`El paso "${label}" usa el handler local "${handler}".`)
      continue
    }
    if (!CLOUD_HANDLERS.has(handler)) {
      localSteps.push(label)
      reasons.push(`El paso "${label}" usa "${handler}", que no está declarado como ejecutable en el VPS.`)
      continue
    }
    // An agent or MCP turn is cloud-safe unless its own words ask for a local
    // file. The same rule applies to skill nodes compiled to an agent turn.
    const local = LOCAL_PATTERNS.find(candidate => candidate.pattern.test(step.text))
    if (local !== undefined && (handler === 'agent' || handler === 'mcp' || handler === 'mcp.call')) {
      localSteps.push(label)
      reasons.push(`El paso "${label}" ${local.reason}; necesita la PC encendida.`)
      continue
    }
    cloudCount += 1
  }
  if (localSteps.length === 0) {
    return {
      scope: 'cloud',
      cloudReady: true,
      requiresPc: false,
      localSteps: [],
      reasons: [],
      note: 'Puede ejecutarse en el VPS aunque la PC esté apagada y la aplicación cerrada.',
    }
  }
  const mixed = cloudCount > 0
  return {
    scope: mixed ? 'mixed' : 'local',
    cloudReady: false,
    requiresPc: true,
    localSteps,
    reasons,
    note: mixed
      ? `Se ejecuta en el VPS salvo ${localSteps.map(label => `"${label}"`).join(', ')}; esos pasos necesitan la PC encendida y la aplicación abierta.`
      : 'Necesita la PC encendida y la aplicación abierta: todos sus pasos trabajan con archivos o comandos locales.',
  }
}

/**
 * Classify one routine definition.
 * @param definition - the stored definition.
 * @returns the profile for that definition.
 */
export function classifyRoutine(definition: RoutineDefinition): CloudExecutionProfile {
  return classifyCloudSteps(definition.steps.map(step => ({
    id: step.id,
    label: step.instruction.trim().length === 0 ? step.id : step.instruction,
    handler: step.handler,
    text: `${step.instruction}\n${JSON.stringify(step.config)}`,
  })))
}
