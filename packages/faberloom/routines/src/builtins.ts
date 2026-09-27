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
