/**
 * Calendar-day formatting for the Mesa (A-48). Due instants are stored in UTC
 * and shown in the pilot's presentation zone, Costa Rica (UTC-6, no DST), so a
 * late-UTC instant does not read as the next day in the queue.
 * @module @deepseek-ai/dsh-client-faberloom/src/client/mesa-date
 */

/** Presentation time zone signed for the pilot (A-48). */
export const MESA_TIME_ZONE = 'America/Costa_Rica'

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: MESA_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Calendar day of an ISO instant in the presentation zone.
 * @param iso - ISO-8601 instant, as stored.
 * @returns `YYYY-MM-DD`; an unparseable value falls back to its date prefix.
 */
export function dayOf(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso.slice(0, 10)
  return dayFormat.format(date)
}
