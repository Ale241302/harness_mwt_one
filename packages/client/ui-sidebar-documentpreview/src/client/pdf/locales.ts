/** Copy owned by the PDF renderer. */
export const zh = {
  title: 'PDF',
  pageImage: 'PDF 第 {page} 页',
  loading: '正在读取…',
  rendering: '正在绘制页面…',
  failed: '无法显示 PDF：{message}',
  password: '此 PDF 需要密码，暂不支持预览',
  workerFailed: 'PDF 渲染进程无法继续，请重试',
  unsupported: 'PDF 预览需要完整文件内容',
  retry: '重试',
} satisfies Record<string, string>

/** PDF translation keys shared by both dictionaries. */
export type PdfLocaleKey = keyof typeof zh

/** English PDF-renderer dictionary. */
export const en = {
  title: 'PDF',
  pageImage: 'PDF page {page}',
  loading: 'Reading…',
  rendering: 'Rendering page…',
  failed: 'Cannot display PDF: {message}',
  password: 'This PDF requires a password; password-protected previews are not supported.',
  workerFailed: 'The PDF rendering process could not continue. Please retry.',
  unsupported: 'PDF preview requires the complete file contents.',
  retry: 'Retry',
} satisfies Record<PdfLocaleKey, string>

/** Spanish PDF-renderer dictionary. */
export const es = {
  title: 'PDF',
  pageImage: 'Página {page} del PDF',
  loading: 'Cargando…',
  rendering: 'Dibujando la página…',
  failed: 'No se pudo mostrar el PDF: {message}',
  password: 'Este PDF requiere contraseña; no se admiten vistas previas protegidas con contraseña.',
  workerFailed: 'El proceso de renderizado del PDF no pudo continuar. Inténtalo de nuevo.',
  unsupported: 'La vista previa del PDF requiere el contenido completo del archivo.',
  retry: 'Reintentar',
} satisfies Record<PdfLocaleKey, string>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** PDF page, loading, and failure messages. */
    sidebarPdf: PdfLocaleKey
  }
}
