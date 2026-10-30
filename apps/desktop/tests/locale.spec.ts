import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DESKTOP_LOCALES, en, es, formatDesktopMessage, resolveDesktopLocale, zh } from '../src/locale.ts'

describe('desktop locale dictionaries', () => {
  it('ships the same key set in English, Spanish and Chinese', () => {
    expect(Object.keys(zh)).toEqual(Object.keys(en))
    expect(Object.keys(es)).toEqual(Object.keys(en))
    expect(resolveDesktopLocale('zh-Hans-CN')).toEqual({ id: 'zh-CN', messages: zh, available: DESKTOP_LOCALES })
    expect(resolveDesktopLocale('en-US')).toEqual({ id: 'en', messages: en, available: DESKTOP_LOCALES })
    expect(resolveDesktopLocale('es-AR')).toEqual({ id: 'es', messages: es, available: DESKTOP_LOCALES })
    expect(resolveDesktopLocale('es')).toEqual({ id: 'es', messages: es, available: DESKTOP_LOCALES })
    // An unshipped language still opens on the fallback dictionary.
    expect(resolveDesktopLocale('fr-FR')).toEqual({ id: 'en', messages: en, available: DESKTOP_LOCALES })
  })

  it('offers every shipped locale to the switcher exactly once', () => {
    expect(DESKTOP_LOCALES.map(locale => locale.id)).toEqual(['en', 'es', 'zh-CN'])
    for (const option of DESKTOP_LOCALES) expect(option.label.length).toBeGreaterThan(0)
  })

  it('formats named values without consuming unknown placeholders', () => {
    expect(formatDesktopMessage('{name}@{version} {missing}', { name: 'plugin', version: '1.2.3' }))
      .toBe('plugin@1.2.3 {missing}')
  })

  it('names the appearance toggle action in every locale', () => {
    for (const dictionary of [en, es, zh]) {
      expect(dictionary.appearanceToDark.length).toBeGreaterThan(0)
      expect(dictionary.appearanceToLight.length).toBeGreaterThan(0)
      expect(dictionary.appearanceToDark).not.toBe(dictionary.appearanceToLight)
    }
    expect(en.appearanceToDark).not.toBe(es.appearanceToDark)
    expect(en.appearanceToDark).not.toBe(zh.appearanceToDark)
    expect(en.languageTitle).not.toBe(es.languageTitle)
    expect(es.languageTitle).not.toBe(zh.languageTitle)
  })

  it('keeps visible plugin-manager HTML copy in the locale dictionaries', () => {
    const html = readFileSync(new URL('../renderer/plugin-manager.html', import.meta.url), 'utf8')
    const staticText = [...html.matchAll(/>([^<]*\p{L}[^<]*)</gu)].map(match => match[1]?.trim())
    expect(staticText).toEqual([])
  })
})
