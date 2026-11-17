// @vitest-environment jsdom
/**
 * F1 appearance keeps three promises: a stored look survives a reload, an
 * unknown stored value is rejected instead of half-applied, and switching looks
 * touches only the class the look owns.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOOK,
  LOOK_STORAGE_KEY,
  applyLook,
  isLookId,
  lookClassName,
  nextLook,
  readStoredLook,
  resolveLookPreference,
  writeStoredLook,
} from '../src/client/appearance.ts'

/** Minimal in-memory storage, so each case starts from a known entry. */
function memoryStorage(initial: Record<string, string> = {}): Storage {
  const entries = new Map(Object.entries(initial))
  return {
    get length() { return entries.size },
    clear: () => { entries.clear() },
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => { entries.delete(key) },
    setItem: (key: string, value: string) => { entries.set(key, value) },
  }
}

describe('appearance', () => {
  it('accepts only the shipped looks', () => {
    expect(isLookId('a')).toBe(true)
    expect(isLookId('b')).toBe(true)
    for (const value of ['c', '', 'A', 'neon', null, undefined, 2, {}]) {
      expect({ value, valid: isLookId(value) }).toEqual({ value, valid: false })
      expect(resolveLookPreference(value)).toBe(DEFAULT_LOOK)
    }
  })

  it('stores and restores the chosen look across a reload', () => {
    const storage = memoryStorage()
    writeStoredLook(storage, 'b')
    expect(storage.getItem(LOOK_STORAGE_KEY)).toBe('b')
    expect(readStoredLook(storage)).toBe('b')
  })

  it('rejects an unknown stored look and repairs the entry', () => {
    const storage = memoryStorage({ [LOOK_STORAGE_KEY]: 'neon' })
    expect(readStoredLook(storage)).toBe(DEFAULT_LOOK)
    expect(storage.getItem(LOOK_STORAGE_KEY)).toBe(DEFAULT_LOOK)
  })

  it('survives storage that refuses to read', () => {
    const blocked = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
    } as unknown as Storage
    expect(readStoredLook(blocked)).toBe(DEFAULT_LOOK)
    expect(() => { writeStoredLook(blocked, 'b') }).not.toThrow()
  })

  it('cycles between the two looks', () => {
    expect(nextLook('a')).toBe('b')
    expect(nextLook('b')).toBe('a')
    expect(nextLook(nextLook('a'))).toBe('a')
  })

  it('names a distinct class per look and swaps it on the element', () => {
    const classA = lookClassName('a')
    const classB = lookClassName('b')
    expect(classA).not.toBe('')
    expect(classB).not.toBe('')
    expect(classA).not.toBe(classB)

    const element = document.createElement('section')
    element.className = 'surface'
    applyLook(element, 'a')
    expect(element.classList.contains(classA)).toBe(true)
    expect(element.classList.contains(classB)).toBe(false)

    applyLook(element, 'b')
    expect(element.classList.contains(classB)).toBe(true)
    expect(element.classList.contains(classA)).toBe(false)
    expect(element.classList.contains('surface')).toBe(true)
  })

  it('does nothing when the surface is not mounted', () => {
    expect(() => { applyLook(null, 'b') }).not.toThrow()
  })

  it('loads no external stylesheet of its own', () => {
    expect(document.querySelectorAll('link[rel="stylesheet"]')).toHaveLength(0)
  })
})
