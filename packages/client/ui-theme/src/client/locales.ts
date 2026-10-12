/** `settings.theme` namespace dictionaries (the Appearance list, font-size, and Idioma copy). */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'appearance.title': '外观',
  'appearance.dark': '深色',
  'appearance.light': '浅色',
  'fontSize.title': '字号大小',
  'fontSize.description': '仅影响会话内容的字号',
  'fontSize.unit': 'px',
  'fontSize.increase': '增大字号',
  'fontSize.decrease': '减小字号',
  'language.nav': '语言',
  'language.title': '界面语言',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.dark': 'Dark',
  'appearance.light': 'Light',
  'fontSize.title': 'Font size',
  'fontSize.description': 'Only affects conversation content',
  'fontSize.unit': 'px',
  'fontSize.increase': 'Increase font size',
  'fontSize.decrease': 'Decrease font size',
  'language.nav': 'Language',
  'language.title': 'Interface language',
} satisfies Record<ThemeKey, string>

/** Spanish dictionary, checked complete against the zh key set. */
export const es = {
  'appearance.title': 'Apariencia',
  'appearance.dark': 'Oscuros',
  'appearance.light': 'Claros',
  'fontSize.title': 'Tamaño de la letra',
  'fontSize.description': 'Solo afecta el tamaño de letra del contenido de la conversación',
  'fontSize.unit': 'px',
  'fontSize.increase': 'Aumentar el tamaño de la letra',
  'fontSize.decrease': 'Reducir el tamaño de la letra',
  'language.nav': 'Idioma',
  'language.title': 'Idioma de la interfaz',
} satisfies Record<ThemeKey, string>
