/** Settings-surface row stores: snapshot-mirror actions and the revision guards. */
import { describe, expect, it } from 'vitest'
import {
  createAppearanceRowStore, createFontSizeRowStore, createLanguageSectionStore,
  type AppearancePalette,
} from '../src/client/settings-store.ts'

const PALETTES: readonly AppearancePalette[] = [
  { id: 'light', name: 'Paper', colorScheme: 'light', tokens: {} },
  { id: 'dark', name: 'Faber Warm', colorScheme: 'dark', tokens: {} },
]

describe('createAppearanceRowStore', () => {
  it('init shape: no palettes, no active id, revision at -1', () => {
    const store = createAppearanceRowStore().create()
    expect(store.getSnapshot()).toEqual({ themes: [], active: '', revision: -1 })
  })

  it('sync mirrors the palettes and the active id, and advances the revision', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync(PALETTES, 'dark', 0)
    expect(store.getSnapshot().themes).toEqual(PALETTES)
    expect(store.getSnapshot().active).toBe('dark')
    store.actions.sync(PALETTES, 'light', 2)
    expect(store.getSnapshot().active).toBe('light')
    expect(store.getSnapshot().revision).toBe(2)
  })

  it('revision guard drops stale and duplicate writes', () => {
    const store = createAppearanceRowStore().create()
    store.actions.sync(PALETTES, 'dark', 3)
    store.actions.sync(PALETTES, 'light', 2)
    store.actions.sync(PALETTES, 'light', 3)
    expect(store.getSnapshot().active).toBe('dark')
    expect(store.getSnapshot().revision).toBe(3)
  })
})

describe('createFontSizeRowStore', () => {
  it('init shape: default size with revision at -1', () => {
    const store = createFontSizeRowStore().create()
    expect(store.getSnapshot()).toEqual({ fontSize: 14, revision: -1 })
  })

  it('sync mirrors the size; the revision guard drops stale and duplicate writes', () => {
    const store = createFontSizeRowStore().create()
    store.actions.sync(16, 3)
    expect(store.getSnapshot()).toEqual({ fontSize: 16, revision: 3 })
    store.actions.sync(12, 2)
    store.actions.sync(12, 3)
    expect(store.getSnapshot().fontSize).toBe(16)
    expect(store.getSnapshot().revision).toBe(3)
  })
})

describe('createLanguageSectionStore', () => {
  it('init shape: no active locale, no options, revision at -1', () => {
    const store = createLanguageSectionStore().create()
    expect(store.getSnapshot()).toEqual({ active: '', options: [], revision: -1 })
  })

  it('sync mirrors the active locale and the options; the revision guard drops stale writes', () => {
    const store = createLanguageSectionStore().create()
    store.actions.sync('en', [{ id: 'en', label: 'English' }], 0)
    expect(store.getSnapshot()).toEqual({ active: 'en', options: [{ id: 'en', label: 'English' }], revision: 0 })
    store.actions.sync('zh', [{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }], 1)
    expect(store.getSnapshot().active).toBe('zh')
    expect(store.getSnapshot().options).toHaveLength(2)
    store.actions.sync('en', [], 0)
    expect(store.getSnapshot().active).toBe('zh')
    expect(store.getSnapshot().revision).toBe(1)
  })
})
