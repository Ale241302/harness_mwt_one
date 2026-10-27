/**
 * Built-in routine definitions the product provisions without the owner
 * authoring them. `LIVE_MAIL_ROUTINE` is the live mail agent: once an owner has
 * both an IMAP and an SMTP connection, it runs on every incoming message with
 * nobody in the panel. Provisioning matches on {@link LIVE_MAIL_ROUTINE_NAME},
 * so the name is a stable contract, not decoration.
 * @module @deepseek-ai/dsh-faberloom-routines/builtins
 */

import type { RoutineInput } from './types.ts'

/** Display name of the built-in live mail routine; provisioning matches on it. */
export const LIVE_MAIL_ROUTINE_NAME = 'Vigía de correo'

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
        instruction: 'Revisa MWT.ONE con las herramientas del MCP `mwt` y crea en el banco de trabajo las tareas que falten. Usa solo datos reales; no inventes. Cubre: falta subir la OC/PO (`documento_listar` frente a `expediente_obtener`); falta el SAP (solo rol Admin/CEO); estado que ya pasó su fecha fin de fase (`expediente_phase_durations_get` y `phase_durations_json`; `expediente_avanzar_estado` para cambiarlo); falta el operador (`operating_company_id`); lista de precios por vencer (`pricelist_por_vencer`). Identifica cada expediente por su **PF** (`proforma_codigos`); si no tiene PF usa `oc_codigos` o `sap_codigos`; si es una fusión usa `fusion_label`. **Nunca** pongas UUIDs (`id`, `uuid`, `expediente_id`, `documento id`) en el título ni en la evidencia. Por cada hallazgo crea una tarea con `faberloom_board_create`: title = «qué falta» + la PF/OC/SAP; summary = una frase completa, sin cortarla; evidence = referencias legibles (`expediente:<PF>`, `documento:<codigo> (kind=OC)`, `oc:<codigo>`, `sap:<numero>`), no volcados crudos de herramienta. Si algo no es consultable con las herramientas del MCP, dilo y no crees la tarea.',
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
 * The live mail routine: classify each incoming message, discard what the owner
 * always discards, leave a reply draft in the owner's voice, and resolve the
 * expediente through the `mwt` MCP when the message carries its OC/PO/SAP.
 */
export const LIVE_MAIL_ROUTINE: RoutineInput = {
  name: LIVE_MAIL_ROUTINE_NAME,
  definition: {
    intent: 'Clasificar el correo entrante, descartar lo que el usuario siempre borra y dejar un borrador de respuesta; resolver el expediente cuando el correo traiga la OC/PO/SAP.',
    triggers: [{ kind: 'email', match: '' }],
    steps: [
      {
        id: 'vigia-clasificar',
        instruction: 'Lee el correo entrante (usa el uid del evento con faberloom_mail_read). Revisa la memoria de descartes (enseñanzas con task email-trash) y clasifícalo: SPAM/DESCARTAR, RESPUESTA o EXPEDIENTE. Empieza aplicando la skill `grill-me-lite`: resume en una línea qué trae el correo y qué vas a hacer.',
        handler: 'agent',
        dependsOn: [],
      },
      {
        id: 'vigia-actuar',
        instruction: 'Según la clasificación: si es SPAM o coincide con un patrón que el usuario siempre descarta, usa faberloom_mail_trash; si requiere respuesta, redacta un borrador en la voz del usuario con faberloom_email_draft (nunca lo envíes). Si el correo trae enlaces de descarga o adjuntos (Excel, PDF, imágenes), descárgalos y léelos (faberloom_mail_read convierte los adjuntos y también las imágenes del cuerpo; usa faberloom_mail_download para los enlaces).',
        handler: 'agent',
        dependsOn: ['vigia-clasificar'],
      },
      {
        id: 'vigia-expediente',
        instruction: 'Si el correo trae una OC, PO, SAP o proforma, o alguno de sus adjuntos/enlaces lo contiene, busca el expediente en el MCP de MWT.ONE y súbele el documento que falte (OC/PO/SAP) o avanza su estado si la fecha fin de fase ya venció. Si no aplica, termina sin tocar el MCP.',
        handler: 'mcp',
        dependsOn: ['vigia-actuar'],
      },
    ],
    expectedResult: 'El correo se clasifica y se actúa: descartado si es spam, con borrador si requiere respuesta, con los adjuntos y enlaces leídos, y con el expediente actualizado si traía su documento.',
    permissions: ['mwt'],
    failurePolicy: 'review',
  },
}

/**
 * The Marluvas variant of the live mail routine: one mail-driven loop that reads
 * the full thread, extracts the logistics documents, and operates the expediente
 * through the `mwt` MCP. It keeps the built-in name so provisioning converges the
 * routine an owner already has instead of creating a second trigger on the same
 * mailbox.
 * @param agentId - catalog agent that supplies the operator persona and model.
 * @returns the routine input, with every agent step bound to that agent.
 */
export function marluvasLiveMailRoutine(agentId: string): RoutineInput {
  const config = { agentId }
  return {
    name: LIVE_MAIL_ROUTINE_NAME,
    definition: {
      intent: 'Operar el correo de Marluvas, de sus clientes y de Muito Work Limitada: leer el hilo completo, extraer PF, OC, SAP, embarque, DUA y documentos, y dejar el expediente actualizado en MWT.ONE con fechas, estados, artefactos, recepción, movimiento y finanzas.',
      triggers: [{ kind: 'email', match: '' }],
      steps: [
        {
          id: 'marluvas-triar',
          instruction: 'Eres el Operador Marluvas de Muito Work Limitada. Carga con la tool `skill` las skills `marluvas-operacion` y `marluvas-correo` y síguelas. Lee el correo entrante con `faberloom_mail_read` usando el uid del evento. Reconstruye el hilo con `faberloom_mail_search` por asunto normalizado, PF, OC, SAP y remitente; lee los mensajes relacionados y descarga sus adjuntos y enlaces con `faberloom_mail_attachment` y `faberloom_mail_download`. Clasifica el correo: PF/proforma/OC, SAP, embarque, documento, aduana, precio o irrelevante. Identifica cliente, operador, PF/OC/SAP, productos, tallas, cantidades, precios, plazos, comisión, fechas y documentos. No escribas todavía en MWT.ONE. Si no es un correo de Marluvas, de un cliente o de la operación de Muito Work, responde exactamente `IRRELEVANTE` y termina sin tocar el MCP. Si es relevante, responde con un bloque `TRIAGE:` que diga el tipo, el expediente, la evidencia descargada, los datos confirmados, lo que falta y las skills que hay que cargar después.',
          handler: 'agent',
          dependsOn: [],
          config,
        },
        {
          id: 'marluvas-operar',
          instruction: 'Si el turno anterior concluyó `IRRELEVANTE`, termina sin hacer nada. Si es relevante, carga con la tool `skill` las skills que correspondan al TRIAGE (`marluvas-expediente`, `marluvas-proforma`, `marluvas-sap`, `marluvas-estados`, `marluvas-documentos`, `marluvas-aduana`, `marluvas-logistica`) y ejecuta el playbook completo. Verifica primero `mcp__mwt__mwt_whoami`; solo escribe si la identidad es admin, superadmin o CEO. Busca antes de crear (`expediente_buscar`), crea o actualiza el expediente con líneas SKU × talla reales, registra o actualiza el SAP, sube OC/PF/ documentos, persiste los artefactos del Builder, avanza los estados con la fecha real de la evidencia y, si corresponde, crea la recepción y el movimiento con sus costos. No inventes datos. No envíes correos. Si falta un dato o la decisión no es segura, deja una tarea con `faberloom_board_create` y continúa con lo confirmado.',
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
