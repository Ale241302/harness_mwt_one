/** `layout` namespace dictionaries: the shell top bar's rail toggles and drawer dismissal. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'topbar.label': '顶部工具栏',
  'rail.left.open': '显示左侧面板',
  'rail.left.close': '隐藏左侧面板',
  'rail.right.open': '显示右侧面板',
  'rail.right.close': '隐藏右侧面板',
  'drawer.dismiss': '关闭导航抽屉',
} satisfies Record<string, string>

/** The layout namespace key union. */
export type LayoutKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'topbar.label': 'Top bar',
  'rail.left.open': 'Show the left panel',
  'rail.left.close': 'Hide the left panel',
  'rail.right.open': 'Show the right panel',
  'rail.right.close': 'Hide the right panel',
  'drawer.dismiss': 'Close the navigation drawer',
} satisfies Record<LayoutKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'topbar.label': 'Barra superior',
  'rail.left.open': 'Mostrar el panel izquierdo',
  'rail.left.close': 'Ocultar el panel izquierdo',
  'rail.right.open': 'Mostrar el panel derecho',
  'rail.right.close': 'Ocultar el panel derecho',
  'drawer.dismiss': 'Cerrar el panel de navegación',
} satisfies Record<LayoutKey, string>
