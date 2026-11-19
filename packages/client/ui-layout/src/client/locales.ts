/** `layout` namespace dictionaries: the drawer toggle and drawer dismissal. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'float.title': '对话',
  'float.close': '关闭浮动对话',
  'float.promote': '在聊天中打开',
  'rail.left.open': '显示左侧面板',
  'drawer.dismiss': '关闭导航抽屉',
} satisfies Record<string, string>

/** The layout namespace key union. */
export type LayoutKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'float.title': 'Conversation',
  'float.close': 'Close the floating conversation',
  'float.promote': 'Open in chat',
  'rail.left.open': 'Show the left panel',
  'drawer.dismiss': 'Close the navigation drawer',
} satisfies Record<LayoutKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'float.title': 'Conversación',
  'float.close': 'Cerrar la conversación flotante',
  'float.promote': 'Abrir en el chat',
  'rail.left.open': 'Mostrar el panel izquierdo',
  'drawer.dismiss': 'Cerrar el panel de navegación',
} satisfies Record<LayoutKey, string>
