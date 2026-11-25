/**
 * Built-in routine definitions the product provisions without the owner
 * authoring them. The live mail agent ("Vigía de correo") leaves a reply draft
 * for every message that needs one; the Marluvas operator ("Operadora Marluvas")
 * keeps the expediente in MWT.ONE up to date. Provisioning matches on the stable
 * names, so a name is a contract, not decoration.
 * @module @deepseek-ai/dsh-faberloom-routines/builtins
 */

import type { RoutineInput } from './types.ts'

/** Display name of the built-in reply-draft routine; provisioning matches on it. */
export const LIVE_MAIL_ROUTINE_NAME = 'Vigía de correo'

/** Display name of the built-in Marluvas expediente routine; provisioning matches on it. */
export const MARLUVAS_EXPEDIENTE_ROUTINE_NAME = 'Operadora Marluvas'

/** Catalog agent that operates the Marluvas mailboxes; provisioning matches on it. */
export const MARLUVAS_AGENT_NAME = 'Operador Marluvas'

/** Display name of the built-in MWT.ONE guard routine; provisioning matches on it. */
export const MWT_GUARD_ROUTINE_NAME = 'Vigía MWT.ONE'

/**
 * The MWT.ONE guard routine: a periodic review that files the expediente
 * follow-ups (missing OC/PO/SAP, an expired phase, a missing operator, an
 * expiring price list) as board tasks, with nobody opening a panel.
 */
export const MWT_GUARD_ROUTINE: RoutineInput = {
  name: MWT_GUARD_ROUTINE_NAME,
  definition: {
    intent: 'Revisar MWT.ONE periódicamente y crear en el banco de trabajo las tareas del expediente que hagan falta (OC/PO/SAP faltante, estado por fecha fin de fase, operador, lista de precios por vencer).',
    triggers: [{ kind: 'recurrence', match: '6h' }],
    steps: [
      {
        id: 'mwt-revisar',
        instruction: 'Revisa MWT.ONE con las herramientas del MCP `mwt` y crea en el banco de trabajo las tareas que falten. Usa solo datos reales; no inventes. Cubre: falta subir la OC/PO (`documento_listar` frente a `expediente_obtener`); falta el SAP (solo rol Admin/CEO); estado que ya pasó su fecha fin de fase (`expediente_phase_durations_get` y `phase_durations_json`; `expediente_avanzar_estado` para cambiarlo); falta el operador (`operating_company_id`); lista de precios por vencer (`pricelist_por_vencer`). Identifica cada expediente por su **PF** (`proforma_codigos`); si no tiene PF usa `oc_codigos` o `sap_codigos`; si es una fusión usa `fusion_label`. **Nunca** pongas UUIDs (`id`, `uuid`, `expediente_id`, `documento id`) en el título ni en la evidencia. Por cada hallazgo crea un ítem con `faberloom_board_submit`: `businessKey` = la PF/OC/SAP; `accountRef` = el cliente; `artifactType` = `tarea`; `title` = «qué falta» + la PF/OC/SAP; `summary` = una frase completa, sin cortarla; `evidence` = referencias legibles (`expediente:<PF>`, `documento:<codigo> (kind=OC)`, `oc:<codigo>`, `sap:<numero>`), no volcados crudos de herramienta. Una conversación no es un ítem: si el hallazgo no tiene PF/OC/SAP o evidencia legible, dilo y no crees el ítem.',
        handler: 'mcp',
        dependsOn: [],
      },
    ],
    expectedResult: 'Las tareas pendientes del expediente aparecen en el banco de trabajo sin que nadie las pida.',
    permissions: ['mwt'],
    failurePolicy: 'review',
  },
}

/**
 * The live reply routine: read each incoming message, discard what the owner
 * always discards, and leave one reply draft in the owner's voice when the mail
 * needs an answer. It never sends. Attachments come from the thread, the owner's
 * Spaces, or the expediente when the message names one of its references.
 */
export const LIVE_MAIL_ROUTINE: RoutineInput = {
  name: LIVE_MAIL_ROUTINE_NAME,
  definition: {
    intent: 'Leer el correo entrante, descartar lo que el usuario siempre borra y dejar UN borrador de respuesta en su voz, con la cuenta del buzón al que llegó, la firma de esa cuenta y los documentos que la respuesta deba llevar. Nunca envía.',
    triggers: [{ kind: 'email', match: '' }],
    steps: [
      {
        id: 'redactar',
        instruction: [
          'El evento trae `uid`, `mailbox` y `connectionId` del correo entrante. Léelo con `faberloom_mail_read` usando esos tres datos.',
          'Primero clasifica. Si es SPAM, un aviso automático, o coincide con una enseñanza activa de tarea `email-trash`, usa `faberloom_mail_trash` y termina. Si no requiere respuesta (solo informa, es un recibo, o ya lo respondimos), termina sin crear nada.',
          'Si requiere respuesta, redacta el borrador con `faberloom_email_draft` en la voz del usuario, breve y concreto. Saluda según la hora local de Costa Rica en que se enviará, no la del correo recibido, y termina en «Saludos,» sin escribir tu nombre ni la firma: la herramienta añade la firma HTML de la cuenta. Pasa siempre `uid` y `connectionId`: la herramienta elige la cuenta por el destinatario real del mensaje (To/Cc), no por el buzón que lo reportó, y rechaza el borrador si ese hilo ya tiene uno pendiente, si ya fue respondido o si el usuario lo descartó. No insistas ni busques otra cuenta.',
          'Documentos: adjunta solo lo que la respuesta deba llevar. Primero los adjuntos del propio hilo con `attachFromUid` y `attachNames`. Si falta un documento y el correo menciona una OC, SAP, PF, BL, AWB o contenedor, busca ese expediente en el MCP `mwt`, lista sus documentos y artefactos (`documento_listar`, `inventario_artefactos_expediente`), pide la URL firmada (`documento_descargar` o `artefacto_archivo_descargar`) y cópiala con `attachFromUrl`. Si el correo NO menciona ninguna de esas referencias, no toques el MCP ni busques documentos. Nunca escribas que un documento se envía aparte: si no pudiste adjuntarlo, dilo y deja que el usuario decida.',
          'Nunca envíes, muevas ni marques correo. El borrador queda en Borradores para que el usuario lo revise.',
        ].join(' '),
        handler: 'agent',
        dependsOn: [],
      },
    ],
    expectedResult: 'Cada correo que necesita respuesta tiene un único borrador en Borradores, con su cuenta, su firma y sus documentos; lo demás se descarta o se deja en paz.',
    permissions: ['mwt'],
    failurePolicy: 'review',
  },
}

/**
 * The Marluvas operator routine: one mail-driven loop that reads the full
 * thread, extracts the logistics documents, and operates the expediente through
 * the `mwt` MCP. It keeps the built-in name so provisioning converges the
 * routine an owner already has instead of creating a second trigger on the same
 * mailbox.
 *
 * The steps name the catalog agent, not its id: the id is home-local and the
 * mirror syncs routines across homes, so a stored id would flip on every sync.
 * @returns the routine input.
 */
export function marluvasExpedienteRoutine(): RoutineInput {
  const config = { agentName: MARLUVAS_AGENT_NAME }
  return {
    name: MARLUVAS_EXPEDIENTE_ROUTINE_NAME,
    definition: {
      intent: 'Operar el correo de Marluvas, de sus clientes y de Muito Work Limitada: leer el hilo completo, extraer PF, OC, SAP, embarque, DUA y documentos, y dejar el expediente actualizado en MWT.ONE con fechas, estados, artefactos, recepción, movimiento y finanzas.',
      triggers: [{ kind: 'email', match: '' }],
      steps: [
        {
          id: 'marluvas-triar',
          instruction: 'Eres el Operador Marluvas de Muito Work Limitada. Carga con la tool `skill` las skills `marluvas-operacion` y `marluvas-correo` y síguelas. Lee el correo entrante con `faberloom_mail_read` usando el uid y el connectionId del evento. Reconstruye el hilo con `faberloom_mail_search` por asunto normalizado, PF, OC, SAP y remitente; lee los mensajes relacionados y descarga sus adjuntos y enlaces con `faberloom_mail_attachment` y `faberloom_mail_download`. Clasifica el correo: PF/proforma/OC, SAP, embarque, documento, aduana, precio o irrelevante. Identifica cliente, operador, PF/OC/SAP, productos, tallas, cantidades, precios, plazos, comisión, fechas y documentos. No escribas todavía en MWT.ONE. Si no es un correo de Marluvas, de un cliente o de la operación de Muito Work, responde exactamente `IRRELEVANTE` y termina sin tocar el MCP. Si es relevante, responde con un bloque `TRIAGE:` que diga el tipo, el expediente, la evidencia descargada, los datos confirmados, lo que falta y las skills que hay que cargar después.',
          handler: 'agent',
          dependsOn: [],
          config,
        },
        {
          id: 'marluvas-operar',
          instruction: 'Si el turno anterior concluyó `IRRELEVANTE`, termina sin hacer nada. Si es relevante, carga con la tool `skill` las skills que correspondan al TRIAGE (`marluvas-expediente`, `marluvas-proforma`, `marluvas-sap`, `marluvas-estados`, `marluvas-documentos`, `marluvas-aduana`, `marluvas-logistica`) y ejecuta el playbook completo. Verifica primero `mcp__mwt__mwt_whoami`; solo escribe si la identidad es admin, superadmin o CEO. Busca antes de crear (`expediente_buscar`), crea o actualiza el expediente con líneas SKU × talla reales, registra o actualiza el SAP, sube OC/PF/ documentos, persiste los artefactos del Builder, avanza los estados con la fecha real de la evidencia y, si corresponde, crea la recepción y el movimiento con sus costos. No inventes datos. No envíes correos. Si falta un dato o la decisión no es segura, deja una tarea con `faberloom_board_submit` (`businessKey` = PF/OC/SAP, `accountRef` = cliente, `artifactType` = `tarea`) y continúa con lo confirmado.',
          handler: 'agent',
          dependsOn: ['marluvas-triar'],
          config,
        },
        {
          id: 'marluvas-verificar',
          instruction: 'Verifica en MWT.ONE lo que hizo el turno anterior: `expediente_obtener`, `expediente_lineas`, `sap_obtener`, `documento_listar`, `inventario_artefactos_expediente`, `transferencia_obtener` y las finanzas del expediente. Si no hubo cambios porque el correo era irrelevante, dilo y termina. Si algo quedó mal o incompleto, corrígelo o deja una tarea. Devuelve un reporte corto: PF/OC/SAP, cliente, operador, qué se creó o actualizó, estado y fechas, documentos y artefactos, recepción y movimiento, finanzas, discrepancias y pendientes.',
          handler: 'agent',
          dependsOn: ['marluvas-operar'],
          config,
        },
      ],
      expectedResult: 'El correo de Marluvas o de un cliente queda entendido y el expediente queda actualizado en MWT.ONE, con evidencia, fechas, estados, documentos y pendientes explícitos.',
      permissions: ['mwt'],
      failurePolicy: 'review',
    },
  }
}
