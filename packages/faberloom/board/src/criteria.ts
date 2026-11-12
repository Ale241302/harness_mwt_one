/**
 * The criterion one pending item is waiting for, in the question a human can
 * answer.
 *
 * The board's alerts are generated from the expediente's own defects — a purchase
 * order that was never attached, a phase that passed its date, a SAP document
 * that is missing. A severity is not a criterion: an item classified `MEDIUM`
 * still leaves the panel with nothing to answer. Each entry here names the action
 * the defect asks for and the question whose answer settles it, so the human
 * decision is one click and the board records a correction with its scope.
 *
 * The table is deliberately small and literal. An alert that matches nothing
 * returns `undefined` and stays untouched: inventing a question for an item the
 * product does not understand is worse than leaving it for a person to read.
 * @module @deepseek-ai/dsh-faberloom-board/src/criteria
 */

/** The action a defect asks for, and the question that settles it. */
export interface BoardCriterion {
  /** What the item asks the account to do. */
  readonly action: string
  /** The question a human answers; recorded as the item's doubt. */
  readonly question: string
}

/** One pattern over the item title, with the criterion it names. */
interface CriterionRule {
  readonly pattern: RegExp
  readonly criterion: BoardCriterion
}

const RULES: readonly CriterionRule[] = [
  {
    pattern: /^falta subir la oc\/po/iu,
    criterion: {
      action: 'Adjuntar la OC/PO al expediente',
      question: '¿La OC/PO ya está en MWT.ONE? Si está, adjuntala y cerrá el pendiente; si no, pedísela al operador.',
    },
  },
  {
    pattern: /^falta subir el/iu,
    criterion: {
      action: 'Subir el documento que falta',
      question: '¿El documento está en el expediente? Adjuntalo; si no aparece, pedíselo al operador.',
    },
  },
  {
    pattern: /^falta avanzar la fase/iu,
    criterion: {
      action: 'Avanzar la fase',
      question: '¿La fase ya ocurrió en MWT.ONE? Si ocurrió, avanzá el estado; si no, reprogramá la fecha.',
    },
  },
  {
    pattern: /^fase vencida/iu,
    criterion: {
      action: 'Avanzar la fase o reprogramar',
      question: 'La fecha de la fase pasó sin cambio de estado: ¿ocurrió y hay que avanzar, o hay que reprogramar?',
    },
  },
  {
    pattern: /^dead letter/iu,
    criterion: {
      action: 'Reintentar el efecto',
      question: '¿El efecto se puede reintentar? Si el error es permanente, marcalo ERROR_RECUPERABLE y avisá.',
    },
  },
  {
    pattern: /^falta el documento del sap|^falta el pdf|^falta el/iu,
    criterion: {
      action: 'Adjuntar el documento del SAP',
      question: '¿El documento del SAP está en el expediente? Adjuntalo; si no está, pedíselo al operador.',
    },
  },
  {
    pattern: /^falta depurar|^eliminar documento/iu,
    criterion: {
      action: 'Depurar el duplicado',
      question: '¿El documento es un duplicado del original? Descartalo con la evidencia del que queda.',
    },
  },
  {
    pattern: /^falta descartar/iu,
    criterion: {
      action: 'Descartar: ya está resuelto',
      question: 'El pendiente que nombra la alerta ya fue cargado o cerrado: ¿confirmás descartar la alerta?',
    },
  },
  {
    pattern: /^no cerrar/iu,
    criterion: {
      action: 'Descartar la alerta',
      question: 'Es residuo de una reversión: ¿confirmás descartar el aviso sin cerrar la fase?',
    },
  },
  {
    pattern: /^falta corregir/iu,
    criterion: {
      action: 'Corregir el dato en MWT.ONE',
      question: 'Hay un dato inconsistente entre expedientes: ¿cuál es el valor correcto en MWT.ONE?',
    },
  },
]

/**
 * The criterion one item title names.
 * @param title - the item's title, as the generator wrote it.
 * @returns the action and question, or undefined when no rule matches.
 */
export function reviewQuestion(title: string): BoardCriterion | undefined {
  const text = title.trim()
  if (text.length === 0) return undefined
  return RULES.find(rule => rule.pattern.test(text))?.criterion
}
