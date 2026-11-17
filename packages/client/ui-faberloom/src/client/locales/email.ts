/**
 * F1 email surface copy, Spanish first.
 *
 * This file lives beside the namespace dictionary because the text is product
 * copy, not component data. It is not yet registered in the locale seat: the F1
 * prototype is not wired into a panel, so the seat has no consumer for these
 * keys. When the screen enters the product, this object becomes the `es`
 * dictionary and `en`/`zh` follow, as the runtime requires all three.
 *
 * Conjugation is neutral ("Tienes"); the voseo form belongs to the dictionary
 * variant, never to a component literal.
 */

/** Copy the F1 email surface renders. */
export interface EmailCopy {
  readonly title: string
  readonly listHeading: string
  readonly listEmpty: string
  readonly listEmptyHint: string
  readonly listSynthetic: string
  readonly listFilter: string
  readonly readingPlaceholder: string
  readonly readingFrom: string
  readonly readingTo: string
  readonly readingDraft: string
  readonly readingDirty: string
  readonly readingSaved: string
  readonly readingSaving: string
  readonly readingSave: string
  readonly readingApprove: string
  readonly proposalTitle: string
  readonly proposalWhy: string
  readonly proposalUse: string
  readonly proposalKeep: string
  readonly approvalTitle: string
  readonly approvalHint: string
  readonly approvalTo: string
  readonly approvalCc: string
  readonly approvalBcc: string
  readonly approvalSubject: string
  readonly approvalBody: string
  readonly approvalAttachments: string
  readonly approvalVersion: string
  readonly approvalNone: string
  readonly approvalCancel: string
  readonly approvalConfirm: string
  readonly approvalNoRecipients: string
  readonly composeTitle: string
  readonly composeTo: string
  readonly composeSubject: string
  readonly composeBody: string
  readonly composeCancel: string
  readonly composePrepare: string
  readonly toolbarNew: string
  readonly toolbarSplit: string
  readonly toolbarFocus: string
  readonly lookSwitch: string
  readonly lookNames: Readonly<Record<'a' | 'b', string>>
  readonly a11yMessages: string
  readonly a11yDialog: string
  readonly loading: string
  readonly loadingHint: string
  readonly errorTitle: string
  readonly errorHint: string
  readonly retry: string
  readonly unread: string
}

/** Spanish copy for the F1 email surface. */export const emailEs: EmailCopy = {
  title: 'Correo',
  listHeading: 'Bandeja',
  listEmpty: 'Nada espera tu criterio',
  listEmptyHint: 'Cuando llegue un mensaje que necesite una decisión, aparece aquí.',
  listSynthetic: 'Datos de prueba: este buzón es sintético.',
  listFilter: 'Filtrar por asunto',
  readingPlaceholder: 'Elige un mensaje de la lista para leerlo.',
  readingFrom: 'De',
  readingTo: 'Para',
  readingDraft: 'Borrador',
  readingDirty: 'Tienes cambios sin guardar',
  readingSaved: 'Guardado',
  readingSaving: 'Guardando',
  readingSave: 'Guardar',
  readingApprove: 'Revisar y aprobar',
  proposalTitle: 'Propuesta del agente',
  proposalWhy: 'Por qué está aquí',
  proposalUse: 'Usar la versión nueva',
  proposalKeep: 'Quedarme con la actual',
  approvalTitle: 'Qué vas a aprobar',
  approvalHint: 'Revisa destinatarios, asunto, cuerpo y adjuntos. Lo que ves es lo que se envía.',
  approvalTo: 'Para',
  approvalCc: 'Copia',
  approvalBcc: 'Copia oculta',
  approvalSubject: 'Asunto',
  approvalBody: 'Cuerpo',
  approvalAttachments: 'Adjuntos',
  approvalVersion: 'Versión',
  approvalNone: 'Ninguno',
  approvalCancel: 'Cancelar',
  approvalConfirm: 'Aprobar y enviar',
  approvalNoRecipients: 'Falta un destinatario: no se puede aprobar.',
  composeTitle: 'Nuevo mensaje',
  composeTo: 'Para',
  composeSubject: 'Asunto',
  composeBody: 'Cuerpo',
  composeCancel: 'Descartar',
  composePrepare: 'Preparar borrador',
  toolbarNew: 'Nueva',
  toolbarSplit: 'Lista y lectura',
  toolbarFocus: 'Solo lectura',
  lookSwitch: 'Cambiar look',
  lookNames: { a: 'Papel', b: 'Pizarra' },
  a11yMessages: 'Mensajes',
  a11yDialog: 'Panel de aprobación',
  loading: 'Cargando la bandeja',
  loadingHint: 'En cuanto lleguen los mensajes aparecen aquí.',
  errorTitle: 'No se pudo cargar la bandeja',
  errorHint: 'Revisa la conexión y vuelve a intentarlo.',
  retry: 'Reintentar',
  unread: 'sin leer',
}

/** Copy the F1 iteration window renders. */
export interface TaskChatCopy {
  readonly launcher: string
  readonly title: string
  readonly close: string
  readonly fullscreen: string
  readonly restore: string
  readonly move: string
  readonly resize: string
  readonly draftLabel: string
  readonly draftHint: string
  readonly dirty: string
  readonly saved: string
  readonly saving: string
  readonly save: string
  readonly iterate: string
}

/** Spanish copy for the F1 iteration window. */
export const taskChatEs: TaskChatCopy = {
  launcher: 'Iterar sobre este correo',
  title: 'Iteración',
  close: 'Cerrar',
  fullscreen: 'Pantalla completa',
  restore: 'Volver a flotante',
  move: 'Mover ventana',
  resize: 'Redimensionar ventana',
  draftLabel: 'Qué quieres cambiar',
  draftHint: 'Escribe qué quieres cambiar. El correo no se toca hasta que apruebes.',
  dirty: 'Tienes cambios sin guardar',
  saved: 'Guardado',
  saving: 'Guardando',
  save: 'Guardar',
  iterate: 'Iterar',
}
