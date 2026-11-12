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
 * The generator writes the same defect in several ways — "Falta avanzar la
 * fase", "Falta avanzar el estado", "Estado desfasado", "Fase ... vencida" — so
 * the patterns are grouped by defect, not by wording. The table is deliberately
 * small and literal; an alert that matches nothing returns `undefined` and stays
 * untouched, because inventing a question for an item the product does not
 * understand is worse than leaving it for a person to read.
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

/** Every wording the generator uses for a phase that passed or stayed open. */
const PHASE_DEFECTS = new RegExp([
  '^falta avanzar la fase',
  '^fase vencida',
  '^falta avanzar (el|de) estado',
  '^estado .*desfasado',
  '^estado [a-z_]+ vencid',
  '^fase [a-z_]+ vencid',
  '^fase [a-z_]+ abierta',
  '^falta cerrar (el expediente|o replanificar|la fase)',
  '^(exp|pf) .*fase .*vencid',
].join('|'), 'iu')

const RULES: readonly CriterionRule[] = [
  {
    pattern: /^falta subir la oc.*sin expediente/iu,
    criterion: {
      action: 'Asignar la OC/PO a un expediente',
      question: 'La OC/PO no tiene expediente: ¿a cuál corresponde, o hay que abrirlo?',
    },
  },
  {
    pattern: /^falta subir la oc/iu,
    criterion: {
      action: 'Adjuntar la OC/PO al expediente',
      question: '¿La OC/PO ya está en MWT.ONE? Si está, adjuntala y cerrá el pendiente; si no, pedísela al operador.',
    },
  },
  {
    pattern: PHASE_DEFECTS,
    criterion: {
      action: 'Avanzar la fase',
      question: '¿La fase ya ocurrió en MWT.ONE? Si ocurrió, avanzá el estado; si no, reprogramá la fecha.',
    },
  },
  {
    pattern: /^falta la fecha fin|^fases? (fuera de orden|solapad)|^fases cerrado sin fecha/iu,
    criterion: {
      action: 'Completar o corregir las fechas de fase',
      question: '¿Cuál es la fecha real de esa fase? Completala o corregí el cruce en MWT.ONE.',
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
    pattern: /marcado err[aá]do/iu,
    criterion: {
      action: 'Reemplazar el SAP marcado ERRADO',
      question: 'El SAP cargado está marcado ERRADO: ¿cuál es el SAP correcto para reemplazarlo?',
    },
  },
  {
    pattern: /^falta el pdf/iu,
    criterion: {
      action: 'Adjuntar el PDF de la OC',
      question: '¿El PDF de la OC está en el expediente? Adjuntalo; si no aparece, pedíselo al operador.',
    },
  },
  {
    pattern: /falta registrar el sap|falta el bl|falta bl|falta transcribir|recepci[oó]n y registro de bl/iu,
    criterion: {
      action: 'Registrar el documento',
      question: '¿El SAP, el BL o las líneas de la PO están en el expediente? Cargalos; si no aparecen, pedíselos al operador.',
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
    pattern: /documentos? oc (fantasma|duplicad|descuadrad)|oc fantasma|^falta depurar|^eliminar documento/iu,
    criterion: {
      action: 'Depurar el duplicado',
      question: '¿El documento es un duplicado o una carga vacía? Descartalo con la evidencia del documento que queda.',
    },
  },
  {
    pattern: /^falta descartar.*revertid/iu,
    criterion: {
      action: 'Descartar la alerta sin cerrar la fase',
      question: 'El expediente fue revertido: ¿confirmás descartar el aviso sin cerrar la fase?',
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
  {
    pattern: /^no verificable/iu,
    criterion: {
      action: 'Verificar el dato en la fuente',
      question: 'El dato no llega por el conector: ¿falta en MWT.ONE o es un límite del MCP?',
    },
  },
  {
    pattern: /^(correcci[oó]n|sin hallazgo|descartar hallazgo)/iu,
    criterion: {
      action: 'Descartar el hallazgo',
      question: 'La alerta ya no aplica porque el dato está cargado: ¿confirmás descartar el hallazgo?',
    },
  },
  {
    pattern: /^falta confirmar expediente duplicado/iu,
    criterion: {
      action: 'Confirmar el duplicado',
      question: 'Dos expedientes con la misma PF: ¿cuál queda y cuál se unifica?',
    },
  },
  {
    pattern: /falta el sku|expediente bloqueado|bloqueos pre-expediente/iu,
    criterion: {
      action: 'Destrabar el expediente',
      question: 'El expediente no avanza por un dato maestro o de catálogo: ¿se crea el dato o se abre el expediente?',
    },
  },
  {
    pattern: /^factura/iu,
    criterion: {
      action: 'Asociar la factura al expediente',
      question: 'La factura no tiene expediente: ¿a cuál corresponde, o hay que abrirlo?',
    },
  },
  {
    pattern: /^preparar la proforma/iu,
    criterion: {
      action: 'Preparar la proforma',
      question: 'Es una tarea de preparación: ¿qué falta para armar la proforma con precios verificados?',
    },
  },
  {
    pattern: /^falta la eta|nodo logistico|sin carrier/iu,
    criterion: {
      action: 'Completar la logística',
      question: 'Falta carrier, ETD/ETA o tracking: ¿cuál es el dato real del embarque?',
    },
  },
  {
    pattern: /^falta subir el/iu,
    criterion: {
      action: 'Subir el documento que falta',
      question: '¿El documento está en el expediente? Adjuntalo; si no aparece, pedíselo al operador.',
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
