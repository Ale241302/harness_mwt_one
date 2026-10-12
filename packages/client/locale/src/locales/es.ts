import type { CommonKey } from './zh.ts'

/**
 * es base dictionary for the common namespace, checked complete against the zh
 * key set. Spanish is the product's own working language, so these are the
 * cross-feature standard words as the MWT.ONE side uses them.
 */
export const es = {
  'ok': 'Aceptar',
  'cancel': 'Cancelar',
  'close': 'Cerrar',
  'copy': 'Copiar',
  'copied': 'Copiado',
  'copy.failed': 'No se pudo copiar',
  'copy.value': 'Copiar el valor',
  'copy.json': 'Copiar JSON',
  'copy.path': 'Copiar la ruta de la propiedad',
  'copy.prettyJson': 'Copiar JSON formateado',
  'copy.compactJson': 'Copiar JSON compacto',
  'copy.optionsHint': '{action}; clic derecho para elegir qué copiar',
  'retry': 'Reintentar',
  'loading': 'Cargando…',
  'load.failed': 'No se pudo cargar',
  'submit': 'Enviar',
  'submitting': 'Enviando…',
  'next': 'Siguiente',
  'previous': 'Anterior',
  'skip': 'Omitir',
  'delete': 'Eliminar',
  'edit': 'Editar',
  'save': 'Guardar',
  'search': 'Buscar',
  'more': 'Más',
  'collapse': 'Contraer',
  'expand': 'Expandir',
  'back': 'Atrás',
  'brand.localBuild': 'Faberloom',
  'unknown': 'Desconocido',
  'none': 'Ninguno',
  'truncated': 'Recortado',
  'json.label': 'JSON',
  'markdown.footnotes': 'Notas al pie',
  'markdown.truncatedCharacters': '… recortado en {total} caracteres',
  'number.thousand': '{value}K',
  'number.million': '{value}M',
} satisfies Record<CommonKey, string>
