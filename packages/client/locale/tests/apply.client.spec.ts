/** locale apply wiring: service provision with the base and settings
 * dictionaries, installation of the locale face backing the `t` seat, and
 * adoption of a Host-backed preference through the settings scope. The
 * interface-language choice is a Settings section owned by ui-theme, so this
 * package contributes nothing to `settings.general.item`. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { apply as settingsApply, inject as settingsInject } from '@deepseek-ai/dsh-client-ui-settings/client'
import { TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import {
  apply, inject, COMMON_NS, SETTINGS_NS,
} from '@deepseek-ai/dsh-client-locale/client'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { LOCALE_SETTINGS_NAMESPACE, LocaleSettingsSchema } from '../src/locale-settings.ts'

const SLOT = 'settings.general.item'

/** Stand in for the settings shell: declare the General item slot from root. */
const ITEM_SLOT_DECLARATION = {
  name: 'root',
  children: { [SLOT]: { kind: 'list', scope: 'root' } },
} as never

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  let preference: string | undefined
  let revision = 0
  const namespace = () => ({
    ns: LOCALE_SETTINGS_NAMESPACE,
    schema: LocaleSettingsSchema.toJSON(),
    value: preference === undefined ? {} : { preference },
    applies: 'live' as const,
    secrets: [],
    revision,
  })
  const describe = vi.fn(async () => ({
    ok: true as const,
    value: { writable: true, hasDocument: true, namespaces: [namespace()] },
  }))
  const mutate = vi.fn(async (_ns: string, ops: { value: string }[]) => {
    preference = ops[0]!.value
    revision += 1
    return { ok: true as const, value: namespace() }
  })
  const events = new TestRemote(ctx, { settings: { describe, mutate } })
  await ctx.plugin({ inject: [...settingsInject], apply: settingsApply }).await()
  return {
    ctx, slots: ctx.get('slots') as SlotRegistry, describe, mutate, events,
    setHostPreference: (next: string | undefined) => { preference = next; revision += 1 },
  }
}

describe('locale apply', () => {
  // These are wiring specs, not default-language specs. A fresh LocaleRuntime
  // with no jsdom `window` skips browser detection and opens on FALLBACK_LOCALE
  // (en); each test that reads localized copy stages its locale explicitly via
  // setLocale/Host preference instead of leaning on a dead browser pin.

  it('declares the slots, remote, and settings scope services', () => {
    expect(inject).toEqual(['slots', 'remote', 'settingsScope'])
  })

  it('provides the service with the base and settings dictionaries and a readable snapshot', async () => {
    const b = await bench()
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const locale = b.ctx.get('locale') as LocaleRuntime
    // Both shipped dictionary sets are registered: the (ns, locale) seats are
    // occupied, so a second occupant of the same seat fails loud.
    expect(() => locale.register(COMMON_NS, 'zh', {})).toThrow('already has locale')
    expect(() => locale.register(SETTINGS_NS, 'en', {})).toThrow('already has locale')
    // The lane has no jsdom `window`, so detection never runs and a fresh
    // service opens on FALLBACK_LOCALE (en); read each dictionary explicitly.
    expect(locale.getLocale().active).toBe('en')
    expect(locale.getLocale().locales.map(definition => definition.id)).toEqual(['zh', 'en', 'es'])
    expect(locale.bind(COMMON_NS)('cancel')).toBe('Cancel')
    // The settings namespace the package still ships resolves its own keys.
    expect(locale.bind(SETTINGS_NS)('language.title')).toBe('Language')
    locale.setLocale('zh')
    expect(locale.bind(COMMON_NS)('cancel')).toBe('取消')
    expect(locale.bind(SETTINGS_NS)('language.title')).toBe('语言')
  })

  it('contributes nothing to settings.general.item, before or after the slot is declared', async () => {
    // The interface-language choice moved to ui-theme's Idioma section. The
    // apply-before-declaration bench rules out a bare `slots.register` (it
    // would throw at activation); declaring the slot first and still reading
    // no entries rules out the declaration-aware `slots.inject` path.
    const before = await bench()
    const declared = before.slots.register(ITEM_SLOT_DECLARATION, () => null)
    await before.ctx.plugin({ inject: [...inject], apply }).await()
    expect(before.slots.entries(SLOT)).toHaveLength(0)

    // Collapsing and redeclaring the shell's declaration cannot reinstate a
    // contribution the package never made.
    declared()
    before.slots.register(ITEM_SLOT_DECLARATION, () => null)
    await Promise.resolve()
    expect(before.slots.entries(SLOT)).toHaveLength(0)

    const after = await bench()
    const fiber = after.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    after.slots.register(ITEM_SLOT_DECLARATION, () => null)
    await Promise.resolve()
    expect(after.slots.entries(SLOT)).toHaveLength(0)
  })

  it('loads and refreshes the explicit Host preference after nonblocking activation', async () => {
    const b = await bench()
    // The shared mirror read once at bench time; a Host-side change reaches it
    // through the document invalidation, exactly as production announces one.
    // Preference must differ from the provisional locale (FALLBACK_LOCALE = en
    // with no window), or clearing it below would be unobservable.
    b.setHostPreference('zh')
    b.events.emit('settings/document-updated', [LOCALE_SETTINGS_NAMESPACE, 0])
    await b.ctx.plugin({ inject: [...inject], apply }).await()
    const locale = b.ctx.get('locale') as LocaleRuntime
    await vi.waitFor(() => { expect(locale.getLocale().active).toBe('zh') })
    // Cleared preference falls back to the provisional locale.
    b.setHostPreference(undefined)
    b.events.emit('settings/document-updated', [LOCALE_SETTINGS_NAMESPACE, 0])
    await vi.waitFor(() => { expect(locale.getLocale().active).toBe('en') })
    // Re-selecting zh after the clear is an explicit pick of the provisional
    // value and must persist as a written preference.
    b.setHostPreference('zh')
    b.events.emit('settings/document-updated', [LOCALE_SETTINGS_NAMESPACE, 0])
    await vi.waitFor(() => { expect(locale.getLocale().active).toBe('zh') })
    expect(b.describe).toHaveBeenCalledTimes(4)
  })
})
