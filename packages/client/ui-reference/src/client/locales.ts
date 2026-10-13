/** `reference` namespace dictionaries for the unified `@` source. */

import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Dictionary namespace owned by this plugin. */
export const NS = 'reference'

/**
 * Simplified Chinese dictionary (the key-set source of truth).
 *
 * The `time.*` bucket words are this namespace's own copy of the session-row
 * vocabulary: locale-owned copy keeps the words per plugin, while the
 * bucketing they name is the one shared {@link relativeTime} in ui-primitives.
 */
export const zh = {
  'section.files': '文件与文件夹',
  'section.sessions': '对话',
  'candidate.attach': '添加为附件：{name}',
  'attach.error.notFound': '这个文件不在了，可能已被移动或删除。',
  'attach.error.tooLarge': '这个文件太大，无法作为附件读取。',
  'attach.error.notRegularFile': '这不是一个常规文件，无法作为附件读取。',
  'attach.error.unavailable': '无法读取这个文件：{message}',
  'candidate.noCwd': '（无工作目录）',
  'crumb.root': '工作区',
  'listing.empty': '空文件夹',
  'listing.noResults': '没有结果',
  'listing.truncated': '条目太多，只显示了一部分。',
  'listing.error.notFound': '这个文件夹不在了。可能已被移动或删除。',
  'listing.error.outsideWorkspace': '这个文件夹在工作区之外，不会列出它的内容。',
  'listing.error.notDirectory': '这不是一个文件夹。',
  'listing.error.unavailable': '无法列出这个文件夹：{message}',
  'time.now': '刚刚',
  'time.minutes': '{n}分钟',
  'time.hours': '{n}小时',
  'time.days': '{n}天',
  'time.months': '{n}个月',
  'time.years': '{n}年',
} satisfies Record<string, string>

/** The reference namespace key union. */
export type ReferenceKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The unified `@` reference menu's copy. */
    reference: ReferenceKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'section.files': 'Files & folders',
  'section.sessions': 'Sessions',
  'candidate.attach': 'Attach {name}',
  'attach.error.notFound': 'That file is gone. It may have been moved or deleted.',
  'attach.error.tooLarge': 'That file is too large to attach.',
  'attach.error.notRegularFile': 'That is not a regular file, so it cannot be attached.',
  'attach.error.unavailable': 'Could not read this file: {message}',
  'candidate.noCwd': '(no cwd)',
  'crumb.root': 'Workspace',
  'listing.empty': 'Empty folder',
  'listing.noResults': 'No results',
  'listing.truncated': 'Too many entries, showing only some of them.',
  'listing.error.notFound': 'That folder is gone. It may have been moved or deleted.',
  'listing.error.outsideWorkspace': 'That folder is outside the workspace, so its contents are not listed.',
  'listing.error.notDirectory': 'That is not a folder.',
  'listing.error.unavailable': 'Could not list this folder: {message}',
  'time.now': 'now',
  'time.minutes': '{n}min',
  'time.hours': '{n}h',
  'time.days': '{n}d',
  'time.months': '{n}mo',
  'time.years': '{n}y',
} satisfies Record<ReferenceKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'section.files': 'Archivos y carpetas',
  'section.sessions': 'Sesiones',
  'candidate.attach': 'Adjuntar {name}',
  'attach.error.notFound': 'Ese archivo ya no existe. Es posible que se haya movido o eliminado.',
  'attach.error.tooLarge': 'Ese archivo es demasiado grande para adjuntarlo.',
  'attach.error.notRegularFile': 'Eso no es un archivo normal, así que no se puede adjuntar.',
  'attach.error.unavailable': 'No se pudo leer este archivo: {message}',
  'candidate.noCwd': '(sin directorio de trabajo)',
  'crumb.root': 'Espacio de trabajo',
  'listing.empty': 'Carpeta vacía',
  'listing.noResults': 'Sin resultados',
  'listing.truncated': 'Hay demasiados elementos; solo se muestra una parte.',
  'listing.error.notFound': 'Esa carpeta ya no existe. Es posible que se haya movido o eliminado.',
  'listing.error.outsideWorkspace': 'Esa carpeta está fuera del workspace, así que no se lista su contenido.',
  'listing.error.notDirectory': 'Eso no es una carpeta.',
  'listing.error.unavailable': 'No se pudo listar esta carpeta: {message}',
  'time.now': 'ahora',
  'time.minutes': '{n}min',
  'time.hours': '{n}h',
  'time.days': '{n}d',
  'time.months': '{n}mes',
  'time.years': '{n}a',
} satisfies Record<ReferenceKey, string>
