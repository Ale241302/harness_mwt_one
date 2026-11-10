/**
 * Coarse file glyph for the tree and attachment lists. The host's FileTypeIcon
 * carries a type table and artwork the plugin has no business shipping; these
 * rows only need to tell a folder, a sheet, code, or a plain document apart.
 */
import type { ReactNode } from 'react'

/** File categories these lists distinguish. */
export type FileKind = 'folder' | 'excel' | 'code' | 'image' | 'document'

/** Extensions that read as a spreadsheet. */
const EXCEL = /\.(?:csv|xlsx?|ods)$/iu
/** Extensions that read as source. */
const CODE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|php|cs|cpp|hpp|sh|sql|ya?ml|toml|json)$/iu
/** Extensions that read as a picture. */
const IMAGE = /\.(?:png|jpe?g|gif|webp|avif|svg|bmp|ico)$/iu

/**
 * Coarse kind of a file name.
 * @param name - the file name as listed.
 * @returns the category the row glyph shows.
 */
export function fileKindOf(name: string): FileKind {
  if (EXCEL.test(name)) return 'excel'
  if (CODE.test(name)) return 'code'
  if (IMAGE.test(name)) return 'image'
  return 'document'
}

/**
 * Draw the row glyph for a table file, a source file, a picture, or a document.
 * @param props.kind - category from {@link fileKindOf}.
 * @param props.size - square edge in px.
 * @returns the glyph svg.
 */
export function FileKindIcon({ kind, size = 16 }: { kind: FileKind; size?: number }): ReactNode {
  const shared = {
    width: size,
    height: size,
    viewBox: '0 0 16 16',
    fill: 'none',
    'aria-hidden': true,
    focusable: 'false' as const,
  }
  if (kind === 'folder') {
    return (
      <svg {...shared}>
        <path d="M1.6 3.9c0-.6.5-1.1 1.1-1.1h3.1l1.2 1.4h6.3c.6 0 1.1.5 1.1 1.1v6.6c0 .6-.5 1.1-1.1 1.1H2.7c-.6 0-1.1-.5-1.1-1.1V3.9Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg {...shared}>
      <path d="M3.5 1.8h5.2l3.8 3.8v8.6H3.5V1.8Z" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8.7 1.8v3.8h3.8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      {kind === 'excel' && (
        <path d="M5.4 8.4h5.2M5.4 10.6h5.2M7.8 7v5.2" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      )}
      {kind === 'code' && (
        <path d="M6.6 8.2 5 9.9l1.6 1.7M9.4 8.2 11 9.9l-1.6 1.7" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
      )}
      {kind === 'image' && (
        <>
          <circle cx="6.2" cy="8.2" r="1" fill="currentColor" />
          <path d="M4.2 12.6 6.9 9.9l1.4 1.4 1.2-1.2 2.1 2.5" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {kind === 'document' && (
        <path d="M5.4 8.4h5.2M5.4 10.6h5.2" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
      )}
    </svg>
  )
}
