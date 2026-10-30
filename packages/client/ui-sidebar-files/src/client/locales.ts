/**
 * `sidebarFiles` namespace dictionaries, and the namespace's declaration.
 *
 * The failure lines name what the tree could not list, one code each, because a
 * directory that is gone, one outside the workspace, and a path that is not a
 * directory each suggest a different next step.
 *
 * The namespace merge lives with its key set so that any module naming
 * `TranslateNS<'sidebarFiles'>` or `PropsLocale<'sidebarFiles'>` needs only this
 * file, whichever entry a program loads first.
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** File-tree type name, guide entry, row states, mutation menus and dialogs, and failure lines. */
    sidebarFiles: SidebarFilesKey
  }
}

/** Simplified Chinese dictionary and key-set source of truth. */
export const zh = {
  'type.label': '文件',
  'guide.title': '工作区文件',
  'guide.description': '浏览会话工作区的文件',
  loading: '正在读取…',
  empty: '空目录',
  truncated: '条目太多，只显示了一部分。',
  noWorkspace: '这个会话没有工作区目录。',
  reload: '重新读取',
  new: '新建',
  'menu.more': '更多操作',
  'menu.newFile': '新建文件',
  'menu.newFolder': '新建文件夹',
  'menu.rename': '重命名',
  'menu.delete': '删除',
  'dialog.newFileTitle': '新建文件',
  'dialog.newFolderTitle': '新建文件夹',
  'dialog.renameTitle': '重命名',
  'dialog.deleteTitle': '删除',
  'dialog.nameLabel': '名称',
  'dialog.deleteBody': '将删除“{name}”。此操作无法撤销。',
  'dialog.recursive': '连同其中的内容一起删除',
  'dialog.create': '创建',
  'dialog.rename': '重命名',
  'dialog.delete': '删除',
  cancel: '取消',
  close: '关闭',
  'entry.other': '这不是文件或目录，没法打开。',
  'error.notFound': '这个目录不在了。可能已被移动或删除。',
  'error.outsideWorkspace': '这个目录在工作区之外，侧栏不会读取它。',
  'error.notDirectory': '这不是一个目录。',
  'error.alreadyExists': '这个名称已被占用。',
  'error.directoryNotEmpty': '这个文件夹里还有内容，所以没有删除。',
  'error.rootRefused': '这是工作区根目录，不能重命名或删除。',
  'error.symlinkRefused': '这是一个符号链接，侧栏不会跟随它操作。',
  'error.badTarget': '这个目标位置无效。',
  'error.unsupportedBackend': '当前文件系统不支持这个操作。',
  'error.tooLarge': '内容太大，无法写入。',
  'error.unavailable': '读取失败：{message}',
} satisfies Record<string, string>

/** Files dictionary key union. */
export type SidebarFilesKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en = {
  'type.label': 'Files',
  'guide.title': 'Workspace files',
  'guide.description': 'Browse files in this session\'s workspace',
  loading: 'Reading…',
  empty: 'Empty directory',
  truncated: 'Too many entries, showing only some of them.',
  noWorkspace: 'This session has no workspace directory.',
  reload: 'Reload',
  new: 'New',
  'menu.more': 'More actions',
  'menu.newFile': 'New file',
  'menu.newFolder': 'New folder',
  'menu.rename': 'Rename',
  'menu.delete': 'Delete',
  'dialog.newFileTitle': 'New file',
  'dialog.newFolderTitle': 'New folder',
  'dialog.renameTitle': 'Rename',
  'dialog.deleteTitle': 'Delete',
  'dialog.nameLabel': 'Name',
  'dialog.deleteBody': 'This deletes "{name}". It cannot be undone.',
  'dialog.recursive': 'Delete everything inside it too',
  'dialog.create': 'Create',
  'dialog.rename': 'Rename',
  'dialog.delete': 'Delete',
  cancel: 'Cancel',
  close: 'Close',
  'entry.other': 'Not a file or a directory, so it cannot be opened.',
  'error.notFound': 'That directory is gone. It may have been moved or deleted.',
  'error.outsideWorkspace': 'That directory is outside the workspace, so the sidebar will not read it.',
  'error.notDirectory': 'That is not a directory.',
  'error.alreadyExists': 'That name is already taken.',
  'error.directoryNotEmpty': 'That folder still has contents, so it was not deleted.',
  'error.rootRefused': 'That is the workspace root, which cannot be renamed or deleted.',
  'error.symlinkRefused': 'That is a symbolic link, so the sidebar will not follow it.',
  'error.badTarget': 'That destination is not valid.',
  'error.unsupportedBackend': 'This filesystem does not support that operation.',
  'error.tooLarge': 'The content is too large to write.',
  'error.unavailable': 'Read failed: {message}',
} satisfies Record<SidebarFilesKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'type.label': 'Archivos',
  'guide.title': 'Archivos del workspace',
  'guide.description': 'Explora los archivos del workspace de esta sesión',
  loading: 'Cargando…',
  empty: 'Directorio vacío',
  truncated: 'Hay demasiados elementos; solo se muestra una parte.',
  noWorkspace: 'Esta sesión no tiene un directorio de workspace.',
  reload: 'Recargar',
  new: 'Nuevo',
  'menu.more': 'Más acciones',
  'menu.newFile': 'Nuevo archivo',
  'menu.newFolder': 'Nueva carpeta',
  'menu.rename': 'Cambiar nombre',
  'menu.delete': 'Eliminar',
  'dialog.newFileTitle': 'Nuevo archivo',
  'dialog.newFolderTitle': 'Nueva carpeta',
  'dialog.renameTitle': 'Cambiar nombre',
  'dialog.deleteTitle': 'Eliminar',
  'dialog.nameLabel': 'Nombre',
  'dialog.deleteBody': 'Se eliminará «{name}». No se puede deshacer.',
  'dialog.recursive': 'Eliminar también su contenido',
  'dialog.create': 'Crear',
  'dialog.rename': 'Cambiar nombre',
  'dialog.delete': 'Eliminar',
  cancel: 'Cancelar',
  close: 'Cerrar',
  'entry.other': 'No es un archivo ni un directorio, así que no se puede abrir.',
  'error.notFound': 'Ese directorio ya no existe. Es posible que se haya movido o eliminado.',
  'error.outsideWorkspace': 'Ese directorio está fuera del workspace, así que la barra lateral no lo leerá.',
  'error.notDirectory': 'Eso no es un directorio.',
  'error.alreadyExists': 'Ese nombre ya está en uso.',
  'error.directoryNotEmpty': 'Esa carpeta todavía tiene contenido, así que no se eliminó.',
  'error.rootRefused': 'Esa es la raíz del workspace, no se puede renombrar ni eliminar.',
  'error.symlinkRefused': 'Es un enlace simbólico, así que la barra lateral no lo seguirá.',
  'error.badTarget': 'Ese destino no es válido.',
  'error.unsupportedBackend': 'Este sistema de archivos no admite esa operación.',
  'error.tooLarge': 'El contenido es demasiado grande para escribirlo.',
  'error.unavailable': 'No se pudo leer: {message}',
} satisfies Record<SidebarFilesKey, string>
