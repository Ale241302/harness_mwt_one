/**
 * Settings-surface slot stores: mirrors of the theme and locale service
 * snapshots. The plugin's apply-world change listeners are the only writers;
 * the section and row components read via props.useStore.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import { DEFAULT_FONT_SIZE } from '../theme-settings.ts'

/** One registered palette as the Appearance list renders it (a structural view of a theme definition). */
export interface AppearancePalette {
  /** Registry id (also the palette write argument). */
  id: string
  /** Brand-book name; absent falls back to the id. */
  name?: string
  /** Base palette the theme builds on; the list groups by it. */
  colorScheme: 'light' | 'dark'
  /** Alias-token overrides the row's swatch reads. */
  tokens: Record<string, string>
}

/** Store state mirrored from the theme snapshot. */
export interface AppearanceRowState {
  /** Registered themes in registry order, both color-scheme families included. */
  themes: readonly AppearancePalette[]
  /** Id of the palette currently in effect (`system` resolves to one of them). */
  active: string
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type AppearanceRowActions = {
  sync: (draft: AppearanceRowState, themes: readonly AppearancePalette[], active: string, revision: number) => void
}

/**
 * Declares the Appearance list state and write surface.
 * @returns the store handle.
 */
export function createAppearanceRowStore(): EngineStoreHandle<AppearanceRowState, AppearanceRowActions> {
  return defineStore({
    init: (): AppearanceRowState => ({ themes: [], active: '', revision: -1 }),
    actions: {
      sync: (d, themes, active, revision) => {
        if (revision <= d.revision) return
        d.themes = themes
        d.active = active
        d.revision = revision
      },
    },
  })
}

/** Store state mirrored from the theme snapshot's font size. */
export interface FontSizeRowState {
  /** Persisted content font size in px. */
  fontSize: number
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type FontSizeRowActions = {
  sync: (draft: FontSizeRowState, fontSize: number, revision: number) => void
}

/**
 * Declares the font-size row state and write surface.
 * @returns the store handle.
 */
export function createFontSizeRowStore(): EngineStoreHandle<FontSizeRowState, FontSizeRowActions> {
  return defineStore({
    init: (): FontSizeRowState => ({ fontSize: DEFAULT_FONT_SIZE, revision: -1 }),
    actions: {
      sync: (d, fontSize, revision) => {
        if (revision <= d.revision) return
        d.fontSize = fontSize
        d.revision = revision
      },
    },
  })
}

/** One selectable locale row (id plus the name written in its own language). */
export interface LanguageSectionOption {
  /** Locale id (the setLocale argument). */
  id: string
  /** Display name in its own language (中文 / English / Español). */
  label: string
}

/** Store state mirrored from the locale snapshot. */
export interface LanguageSectionState {
  /** Active locale id. */
  active: string
  /** Selectable locales in display order. */
  options: readonly LanguageSectionOption[]
  /** Service revision; -1 until first sync so revision 0 lands as a change. */
  revision: number
}

/** Declared action shape giving the exported factory a stable return type. */
type LanguageSectionActions = {
  sync: (draft: LanguageSectionState, active: string, options: readonly LanguageSectionOption[], revision: number) => void
}

/**
 * Declares the Idioma section's locale state and write surface.
 * @returns the store handle.
 */
export function createLanguageSectionStore(): EngineStoreHandle<LanguageSectionState, LanguageSectionActions> {
  return defineStore({
    init: (): LanguageSectionState => ({ active: '', options: [], revision: -1 }),
    actions: {
      sync: (d, active, options, revision) => {
        if (revision <= d.revision) return
        d.active = active
        d.options = options
        d.revision = revision
      },
    },
  })
}
