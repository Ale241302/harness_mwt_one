/**
 * F1 appearance: which look the email surface paints with, how that choice is
 * stored, and how an invalid stored value is rejected instead of half-applied.
 *
 * A look is a set of `--fl-look-*` variables scoped to the surface, so switching
 * looks changes paint and density only. Nothing here touches a colour value, a
 * behaviour, or a service.
 */
import lookAModule from './looks/look-a.module.css'
import lookBModule from './looks/look-b.module.css'

/** The two looks F1 ships. */
export const LOOKS = ['a', 'b'] as const

/** One look id. */
export type LookId = typeof LOOKS[number]

/** Look the product opens with when nothing valid is stored. */
export const DEFAULT_LOOK: LookId = 'a'

/** Storage key for the look preference. */
export const LOOK_STORAGE_KEY = 'faberloom.email.look'

/** Class each look applies to the surface root. */
const LOOK_CLASS: Readonly<Record<LookId, string>> = {
  a: lookAModule['lookA'] ?? 'lookA',
  b: lookBModule['lookB'] ?? 'lookB',
}

/** Every class a surface may carry, so switching can remove the other one. */
const ALL_LOOK_CLASSES: readonly string[] = Object.values(LOOK_CLASS)

/**
 * Narrow a value to a shipped look.
 * @param value - value crossing storage, a URL, or a settings row.
 * @returns whether the value is a look this build ships.
 */
export function isLookId(value: unknown): value is LookId {
  return value === 'a' || value === 'b'
}

/**
 * Resolve a stored preference to a shipped look.
 *
 * An unknown value is not coerced: it resolves to {@link DEFAULT_LOOK}, which is
 * what "a theme that is not reviewed does not get enabled" means in practice.
 * @param raw - whatever was stored.
 * @returns the look to paint with.
 */
export function resolveLookPreference(raw: unknown): LookId {
  return isLookId(raw) ? raw : DEFAULT_LOOK
}

/**
 * Read the stored look, repairing an invalid entry.
 * @param storage - optional storage; tests pass a fake, the browser passes `localStorage`.
 * @returns the look to paint with.
 */
export function readStoredLook(storage: Storage | undefined): LookId {
  if (storage === undefined) return DEFAULT_LOOK
  let raw: string | null = null
  try {
    raw = storage.getItem(LOOK_STORAGE_KEY)
  } catch {
    // Storage can be blocked (private mode, denied origin); the default look is
    // the honest answer, and no other code has to know why.
    return DEFAULT_LOOK
  }
  const look = resolveLookPreference(raw)
  if (raw !== null && raw !== look) writeStoredLook(storage, look)
  return look
}

/**
 * Persist the chosen look.
 * @param storage - storage to write to.
 * @param look - look the user chose.
 */
export function writeStoredLook(storage: Storage | undefined, look: LookId): void {
  if (storage === undefined) return
  try {
    storage.setItem(LOOK_STORAGE_KEY, look)
  } catch {
    // A blocked storage keeps the in-memory choice for this session; failing
    // here must not break the surface.
  }
}

/**
 * The other look, for a single switch control.
 * @param look - current look.
 * @returns the look a switch would apply.
 */
export function nextLook(look: LookId): LookId {
  return look === 'a' ? 'b' : 'a'
}

/**
 * Class a surface root carries for a look.
 * @param look - look to paint with.
 * @returns the CSS module class name.
 */
export function lookClassName(look: LookId): string {
  return LOOK_CLASS[look]
}

/**
 * Apply a look to a mounted surface, removing the previous one.
 * @param element - surface root, or null when it is not mounted.
 * @param look - look to paint with.
 */
export function applyLook(element: Element | null, look: LookId): void {
  if (element === null) return
  for (const className of ALL_LOOK_CLASSES) {
    if (className !== LOOK_CLASS[look]) element.classList.remove(className)
  }
  element.classList.add(LOOK_CLASS[look])
}
