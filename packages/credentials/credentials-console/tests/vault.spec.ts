import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { CredentialVault, derivedKeyRef, type VaultContext, type VaultSettingsDescriptor } from '../src/vault.ts'

/** Local store double: one source, synchronous listener fan-out like the seam. */
class FakeCredentials {
  readonly values = new Map<string, string>()
  private readonly listeners = new Set<(ref: CredentialRef) => void>()

  resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    const value = this.values.get(String(ref))
    return Promise.resolve(value === undefined ? undefined : { value, source: 'file' })
  }

  set(ref: CredentialRef, value: string): Promise<void> {
    this.values.set(String(ref), value)
    return this.notify(ref)
  }

  unset(ref: CredentialRef): Promise<void> {
    this.values.delete(String(ref))
    return this.notify(ref)
  }

  on(listener: (ref: CredentialRef) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notify(ref: CredentialRef): Promise<void> {
    for (const listener of this.listeners) listener(ref)
    return Promise.resolve()
  }
}

function bench(overrides: {
  settings?: readonly VaultSettingsDescriptor[]
  fetch?: (input: string, init?: RequestInit) => Promise<Response>
} = {}) {
  const credentials = new FakeCredentials()
  const warn = vi.fn()
  const settings = overrides.settings
  const ctx: VaultContext = {
    credentials,
    logger: { warn },
    get: name => name === 'settings' && settings !== undefined ? { describe: () => settings } : undefined,
    on: (_event, listener) => credentials.on(listener),
  }
  const requests: { url: string; init: RequestInit | undefined }[] = []
  const fetchImpl = overrides.fetch
    ?? (() => Promise.resolve(new Response(JSON.stringify({ keys: [] }), { status: 200 })))
  const vault = new CredentialVault(ctx, {
    consoleBase: 'https://console.test/api',
    consoleToken: 'token',
    intervalMs: 60_000,
    refSuffix: '_API_KEY',
  }, (url, init) => {
    requests.push({ url, init })
    return fetchImpl(url, init)
  })
  return { credentials, ctx, vault, requests, warn }
}

const remote = (keys: readonly { ref: string; value: string }[]): Response =>
  new Response(JSON.stringify({ keys: keys.map(key => ({ ...key, updatedAt: '2026-10-23T00:00:00Z' })) }), { status: 200 })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('CredentialVault', () => {
  it('applies remote provider keys and leaves non-provider refs alone', async () => {
    const b = bench({
      fetch: () => Promise.resolve(remote([
        { ref: 'OPENAI_API_KEY', value: 'remote-openai' },
        { ref: 'SOME_SESSION_TOKEN', value: 'ignored' },
      ])),
    })
    await b.vault.sync()

    expect(b.credentials.values.get('OPENAI_API_KEY')).toBe('remote-openai')
    expect(b.credentials.values.has('SOME_SESSION_TOKEN')).toBe(false)
  })

  it('does not overwrite a local value while its push is still failing', async () => {
    const b = bench({
      fetch: (_url, init) => {
        if (init?.method === 'POST') return Promise.reject(new Error('offline'))
        return Promise.resolve(remote([{ ref: 'OPENAI_API_KEY', value: 'remote-old' }]))
      },
    })
    b.credentials.values.set('OPENAI_API_KEY', 'local-new')
    await b.vault.publish('OPENAI_API_KEY', 'local-new')
    expect(b.warn).toHaveBeenCalled()

    await b.vault.pull()
    expect(b.credentials.values.get('OPENAI_API_KEY')).toBe('local-new')
  })

  it('applies a tombstone as a local unset so deletions reach the other device', async () => {
    const tombstone = new Response(JSON.stringify({
      keys: [{ ref: 'OPENAI_API_KEY', deleted: true, updatedAt: '2026-10-24T00:00:00Z' }],
    }), { status: 200 })
    const b = bench({ fetch: () => Promise.resolve(tombstone) })
    b.credentials.values.set('OPENAI_API_KEY', 'old-local')
    await b.vault.sync()

    expect(b.credentials.values.has('OPENAI_API_KEY')).toBe(false)
  })

  it('does not apply a tombstone over a local edit whose push is failing', async () => {
    const b = bench({
      fetch: (_url, init) => {
        if (init?.method === 'POST') return Promise.reject(new Error('offline'))
        return Promise.resolve(new Response(JSON.stringify({
          keys: [{ ref: 'OPENAI_API_KEY', deleted: true, updatedAt: '2026-10-24T00:00:00Z' }],
        }), { status: 200 }))
      },
    })
    b.credentials.values.set('OPENAI_API_KEY', 'local-new')
    await b.vault.publish('OPENAI_API_KEY', 'local-new')
    await b.vault.pull()

    expect(b.credentials.values.get('OPENAI_API_KEY')).toBe('local-new')
  })

  it('seeds provider keys that exist only in the local store', async () => {
    const b = bench({
      settings: [{
        ns: 'llm-pi-ai',
        value: { providers: { openai: { apiKeyEnv: 'OPENAI_API_KEY' }, acme: {} } },
      }],
    })
    b.credentials.values.set('OPENAI_API_KEY', 'local-openai')
    b.credentials.values.set('ACME_API_KEY', 'local-acme')
    await b.vault.sync()

    const posts = b.requests.filter(request => request.init?.method === 'POST')
    expect(posts.map(post => JSON.parse(String(post.init?.body)))).toEqual([
      { ref: 'OPENAI_API_KEY', value: 'local-openai' },
      { ref: 'ACME_API_KEY', value: 'local-acme' },
    ])
    expect(derivedKeyRef('acme')).toBe('ACME_API_KEY')
  })

  it('pushes a local set and deletes on unset once the value is gone', async () => {
    const b = bench()
    b.vault.start()
    await b.credentials.set('OPENAI_API_KEY' as CredentialRef, 'written')
    await vi.waitFor(() => {
      expect(b.requests.some(request => request.init?.method === 'POST')).toBe(true)
    })
    await b.credentials.unset('OPENAI_API_KEY' as CredentialRef)
    await vi.waitFor(() => {
      expect(b.requests.some(request => request.init?.method === 'DELETE')).toBe(true)
    })
  })

  it('stays inert without a console endpoint or token', async () => {
    const b = bench()
    const inert = new CredentialVault(b.ctx, {
      consoleBase: '', consoleToken: '', intervalMs: 60_000, refSuffix: '_API_KEY',
    }, () => {
      throw new Error('fetch must not run')
    })
    await inert.sync()
    await inert.publish('OPENAI_API_KEY', 'local')
    expect(b.requests).toHaveLength(0)
  })

  it('polls on the configured interval and stops on disposal', async () => {
    vi.useFakeTimers()
    try {
      const b = bench()
      const dispose = b.vault.start()
      await vi.advanceTimersByTimeAsync(0)
      expect(b.requests.length).toBe(1)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(b.requests.length).toBe(2)
      dispose()
      await vi.advanceTimersByTimeAsync(120_000)
      expect(b.requests.length).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
