/** `layout` namespace dictionaries: the drawer toggle and drawer dismissal. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'rail.left.open': '显示左侧面板',
  'drawer.dismiss': '关闭导航抽屉',
} satisfies Record<string, string>

/** The layout namespace key union. */
export type LayoutKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'rail.left.open': 'Show the left panel',
  'drawer.dismiss': 'Close the navigation drawer',
} satisfies Record<LayoutKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'rail.left.open': 'Mostrar el panel izquierdo',
  'drawer.dismiss': 'Cerrar el panel de navegación',
} satisfies Record<LayoutKey, string>
