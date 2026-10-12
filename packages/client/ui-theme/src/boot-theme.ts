/**
 * Theme bootstrap row for the browser's pre-plugin interval. Each index
 * render embeds the current durable preference and content font size. Head CSS
 * colors the document canvas before script execution; the body script installs
 * the palette selector and font size that the client presenters adopt.
 *
 * A built-in palette id paints that palette's own ground, so the first frame
 * already belongs to the chosen theme. `system` (and an id from a newer build)
 * falls back to the neutral pair and follows the operating system.
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'
import { paletteById } from './theme-palettes.ts'
import { DEFAULT_FONT_SIZE, DEFAULT_PREFERENCE, type ThemePreference } from './theme-settings.ts'

const LIGHT_BACKGROUND = '#fff'
const DARK_BACKGROUND = '#151517'

/** CSS that colors the document canvas before any script executes. */
function bootThemeStyle(preference: ThemePreference): string {
  const palette = paletteById(preference)
  if (palette !== undefined) {
    return `:root{color-scheme:${palette.colorScheme}}body{background-color:${palette.ground};--dsh-boot-bg:${palette.ground}}`
  }
  const light = `:root{color-scheme:light}body{background-color:${LIGHT_BACKGROUND};--dsh-boot-bg:${LIGHT_BACKGROUND}}`
  const dark = `:root{color-scheme:dark}body{background-color:${DARK_BACKGROUND};--dsh-boot-bg:${DARK_BACKGROUND}}`
  return `${light}@media(prefers-color-scheme:dark){${dark}}`
}

/** Build the body script that installs the palette selector and content size. */
function bootThemeBodyScript(preference: ThemePreference, fontSize: number): string {
  const scheme = paletteById(preference)?.colorScheme ?? null
  return `(() => {
  const preference = ${JSON.stringify(preference)}
  const paletteScheme = ${JSON.stringify(scheme)}
  const systemDark = paletteScheme === null && preference === 'system'
    && typeof matchMedia !== 'undefined'
    && matchMedia('(prefers-color-scheme: dark)').matches
  const dark = paletteScheme === 'dark' || systemDark
  document.body.toggleAttribute('data-ds-dark-theme', dark)
  document.body.style.setProperty('--dsh-content-font-size', ${JSON.stringify(`${fontSize}px`)})
})()`
}

/**
 * Theme bootstrap rows: head CSS colors the document canvas before
 * first paint, then the body script installs the palette selector and font
 * size before the shell mount and module script.
 * @param preference - Current Host-backed theme preference.
 * @param fontSize - Current Host-backed content font size in px.
 * @returns head and body script rows in execution order.
 */
export function bootThemeInjections(
  preference: ThemePreference = DEFAULT_PREFERENCE,
  fontSize: number = DEFAULT_FONT_SIZE,
): IndexInjection[] {
  return [
    { kind: 'style', text: bootThemeStyle(preference) },
    { kind: 'script', placement: 'body', text: bootThemeBodyScript(preference, fontSize) },
  ]
}
