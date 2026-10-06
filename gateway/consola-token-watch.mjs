/**
 * Harness MWT · keep a long-lived dsh's console JWT current.
 *
 * The gateway injects `CONSOLA_TOKEN` when it spawns a user's dsh, but a dsh
 * process outlives the 30-minute console access token; the faberloom services
 * read `process.env.CONSOLA_TOKEN` on every console call, so once the injected
 * token expires those calls 401. This preload runs inside the dsh (loaded from
 * NODE_OPTIONS) and re-reads the token the gateway keeps fresh in
 * `CONSOLA_TOKEN_FILE`, so the environment the services read never goes stale.
 * Best effort: a missing or unreadable file leaves the spawn-time token intact.
 */
import { readFileSync } from 'node:fs'

const file = process.env.CONSOLA_TOKEN_FILE
if (file !== undefined && file.length > 0) {
  const sync = () => {
    try {
      const token = readFileSync(file, 'utf8').trim()
      if (token.length > 0 && token !== process.env.CONSOLA_TOKEN) process.env.CONSOLA_TOKEN = token
    } catch { /* el gateway aún no escribió el archivo; se conserva el token de arranque */ }
  }
  sync()
  setInterval(sync, 60_000).unref()
}
