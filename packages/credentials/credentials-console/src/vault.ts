/**
 * Provider-key vault sync: keeps the keys a user saves for model providers
 * identical across the local desktop harness and the cloud web harness.
 *
 * Both installations authenticate to the same MWT.ONE console account. The
 * console stores the value encrypted and returns it only to that account, so
 * each harness pulls the set on boot and periodically, pushes every local
 * write, and leaves provider keys entered on the other installation usable
 * without re-typing them.
 *
 * @module @deepseek-ai/dsh-credentials-console/vault
 */

import type { CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'

/** The slice of the credentials seam the vault uses. */
export interface VaultCredentials {
  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined>
  set(ref: CredentialRef, value: string): Promise<void>
}

/** One namespace descriptor the seed reads; structurally the settings seam's answer. */
export interface VaultSettingsDescriptor {
  readonly ns: string
  readonly value: unknown
}

/** The slice of the host context the vault needs. */
export interface VaultContext {
  readonly credentials: VaultCredentials
  /** Optional settings seam; present in every shipped product profile. */
  readonly settings?: { describe(options: { redactSecrets: boolean }): readonly VaultSettingsDescriptor[] }
  readonly logger: { warn(...args: unknown[]): void }
  on(event: 'credentials/reference-updated', listener: (ref: CredentialRef) => void): () => void
}

/** Resolved vault configuration. */
export interface VaultConfig {
  /** Console API base, e.g. `https://consola.mwt.one/api`; empty falls back to `CONSOLA_API_BASE`. */
  readonly consoleBase: string
  /** Console bearer token; empty reads `CONSOLA_TOKEN` on every call. */
  readonly consoleToken: string
  /** How often the local store re-reads the vault, in milliseconds. */
  readonly intervalMs: number
  /** Reference suffix the vault owns; provider keys derive `<ROUTE>_API_KEY`. */
  readonly refSuffix: string
}

/** One vault row as the console returns it. */
interface VaultEntry {
  readonly ref: string
  readonly value: string
  readonly updatedAt: string
}

/** A fetch-compatible transport, injectable for tests. */
export type VaultFetch = (input: string, init?: RequestInit) => Promise<Response>

/**
 * Derive the reference the Models page uses for a route with no declared
 * `apiKeyEnv`, matching the page's own rule.
 * @param route - provider route id.
 * @returns the derived reference name.
 */
export function derivedKeyRef(route: string): string {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * Synchronize provider API keys between the local credential store and the
 * console vault.
 *
 * Remote values win on a pull; a local value that exists only locally is
 * seeded once so the first installation update does not require re-typing
 * keys. A failed push stays dirty, which stops a later pull from overwriting
 * the local edit before it reaches the vault.
 */
export class CredentialVault {
  private pulling = false
  private readonly dirty = new Set<string>()
  private readonly fetchImpl: VaultFetch

  /**
   * @param ctx - the host context slices the vault reads.
   * @param config - resolved plugin configuration.
   * @param fetchImpl - transport override for tests.
   */
  constructor(
    private readonly ctx: VaultContext,
    private readonly config: VaultConfig,
    fetchImpl: VaultFetch = (input, init) => globalThis.fetch(input, init),
  ) {
    this.fetchImpl = fetchImpl
  }

  /**
   * Install the periodic pull and the local-write listener.
   * @returns the disposer removing both.
   */
  start(): () => void {
    const timer = setInterval(() => { void this.pull() }, this.config.intervalMs)
    const off = this.ctx.on('credentials/reference-updated', (ref) => { void this.onLocalWrite(ref) })
    void this.sync()
    return () => {
      clearInterval(timer)
      off()
    }
  }

  /**
   * One convergence pass: apply remote keys, then seed keys that exist only in
   * the local store.
   * @returns settlement after both directions settle; failures are logged.
   */
  async sync(): Promise<void> {
    const entries = await this.read()
    if (entries === undefined) return
    await this.applyRemote(entries)
    await this.seed(entries)
  }

  /**
   * Apply every remote value the local store does not already hold.
   * @param entries - the vault rows.
   * @returns settlement after each local write.
   */
  async applyRemote(entries: readonly VaultEntry[]): Promise<void> {
    this.pulling = true
    try {
      for (const entry of entries) {
        if (!entry.ref.endsWith(this.config.refSuffix) || this.dirty.has(entry.ref)) continue
        const ref = entry.ref as CredentialRef
        const local = await this.ctx.credentials.resolve(ref)
        if (local?.value === entry.value) continue
        await this.ctx.credentials.set(ref, entry.value)
      }
    } catch (error) {
      this.warn('could not apply the vault', error)
    } finally {
      this.pulling = false
    }
  }

  /**
   * Publish configured local keys the vault does not have yet, so upgrading an
   * installation does not require re-entering every provider key.
   * @param entries - the vault rows already read.
   * @returns settlement after each push.
   */
  async seed(entries: readonly VaultEntry[]): Promise<void> {
    const known = new Set(entries.map(entry => entry.ref))
    for (const ref of this.candidateRefs()) {
      if (known.has(ref)) continue
      const resolved = await this.ctx.credentials.resolve(ref as CredentialRef)
      if (resolved?.source !== 'file') continue
      await this.publish(ref, resolved.value)
    }
  }

  /**
   * Push one local change; deleting removes the shared row.
   * @param ref - the reference that changed.
   * @param value - the new value, or undefined for a removal.
   * @returns settlement after the console answers; failures stay dirty.
   */
  async publish(ref: string, value: string | undefined): Promise<void> {
    if (!ref.endsWith(this.config.refSuffix)) return
    try {
      if (value === undefined) {
        await this.request(`${encodeURIComponent(ref)}/`, { method: 'DELETE' })
      } else {
        await this.request('', { method: 'POST', body: JSON.stringify({ ref, value }) })
      }
      this.dirty.delete(ref)
    } catch (error) {
      this.dirty.add(ref)
      this.warn(`could not publish ${ref}`, error)
    }
  }

  /** One periodic pull; the timer calls this path. */
  async pull(): Promise<void> {
    if (this.pulling) return
    const entries = await this.read()
    if (entries !== undefined) await this.applyRemote(entries)
  }

  /** Resolve the current console endpoint, reading the live environment for both values. */
  private console(): { base: string; token: string } | undefined {
    const base = (this.config.consoleBase || process.env['CONSOLA_API_BASE'] || '').replace(/\/+$/, '')
    const token = this.config.consoleToken || process.env['CONSOLA_TOKEN'] || ''
    return base === '' || token === '' ? undefined : { base, token }
  }

  /**
   * Read the vault.
   * @returns the rows, or undefined when the console is unwired or unavailable.
   */
  private async read(): Promise<readonly VaultEntry[] | undefined> {
    try {
      const body = await this.request('') as { keys?: VaultEntry[] } | undefined
      return body?.keys ?? []
    } catch (error) {
      this.warn('could not read the vault', error)
      return undefined
    }
  }

  /** One authenticated console call. */
  private async request(suffix: string, init: RequestInit = {}): Promise<unknown> {
    const console = this.console()
    if (console === undefined) return undefined
    const response = await this.fetchImpl(`${console.base}/harness/provider-keys/${suffix}`, {
      ...init,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${console.token}`,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
    if (response.status === 204) return undefined
    return await response.json()
  }

  /** Provider references a product profile can configure, for the one-time seed. */
  private candidateRefs(): string[] {
    const descriptors = this.ctx.settings?.describe({ redactSecrets: true }) ?? []
    const refs = new Set<string>()
    for (const descriptor of descriptors) {
      if (descriptor.ns === 'llm-pi-ai') {
        const providers = (descriptor.value as { providers?: Record<string, { apiKeyEnv?: unknown }> }).providers ?? {}
        for (const [route, profile] of Object.entries(providers)) {
          const named = typeof profile.apiKeyEnv === 'string' ? profile.apiKeyEnv : ''
          refs.add(named === '' ? derivedKeyRef(route) : named)
        }
      } else if (descriptor.ns === 'llm-deepseek') {
        const named = (descriptor.value as { apiKeyEnv?: unknown }).apiKeyEnv
        if (typeof named === 'string' && named !== '') refs.add(named)
      }
    }
    return [...refs].filter(ref => ref.endsWith(this.config.refSuffix))
  }

  /** React to a committed local write. */
  private async onLocalWrite(ref: CredentialRef): Promise<void> {
    if (this.pulling) return
    const name = String(ref)
    if (!name.endsWith(this.config.refSuffix)) return
    try {
      const resolved = await this.ctx.credentials.resolve(ref)
      await this.publish(name, resolved?.source === 'file' ? resolved.value : undefined)
    } catch (error) {
      this.dirty.add(name)
      this.warn(`could not read ${name}`, error)
    }
  }

  /** Log a contained sync failure; a vault outage must never break a turn. */
  private warn(what: string, error: unknown): void {
    this.ctx.logger.warn(`credentials-console: ${what}: ${error instanceof Error ? error.message : String(error)}`)
  }
}
