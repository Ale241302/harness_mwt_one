/**
 * Behavior of the model catalog: the fixed provider table, discovery and
 * normalization for each provider response, credential resolution through the
 * named reference and the ambient environment, probe classification, and the
 * cached snapshot. The mock server records the outgoing request so the
 * credential transport is asserted on the wire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as ModelCatalog from '../src/index.ts'
import { closeModelsServers, modelsServer } from './mock-server.ts'

/** Credential value every leak assertion looks for. */
const KEY = 'sk-catalog-test-marker-7f3'

/** The rich DeepSeek models response, verbatim. */
const DEEPSEEK_BODY = '{"object":"list","data":[{"id":"deepseek-flash","name":"DeepSeek-V4.1-Flash","context_window":1048576,"max_output_tokens":393216,"input_modalities":["text","image"],"output_modalities":["text"],"effort":{"supported_levels":["low","high","max"],"default_level":"high"}}]}'

afterEach(async () => {
  vi.unstubAllEnvs()
  await closeModelsServers()
})

beforeEach(() => {
  // The default credential every spec resolves through the ambient environment;
  // the credential-resolution specs override or clear it explicitly.
  vi.stubEnv('DEEPSEEK_API_KEY', KEY)
})

/** Mount the catalog plugin, redirecting provider egress at mock origins. */
async function mountCatalog(config: { origins?: Record<string, string>; requestTimeoutMs?: number } = {}): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(ModelCatalog, config)
  return ctx
}

/** Provide a credentials service whose reference map the spec controls. */
function provideCredentials(ctx: Context, values: Readonly<Record<string, string>>): void {
  ctx.provide('credentials', {
    resolve: async (ref: string) => {
      const value = values[ref]
      return value === undefined ? undefined : { value, source: 'test' }
    },
  } as never)
}

describe('provider table', () => {
  it('lists the fixed protocol table and freezes it', async () => {
    const ctx = await mountCatalog()
    const providers = ctx.faberloomModelCatalog.providers()

    expect(providers.map(provider => provider.id)).toEqual(['deepseek', 'openai', 'anthropic', 'kimi', 'google'])
    expect(Object.isFrozen(providers)).toBe(true)
    expect(providers.find(provider => provider.id === 'anthropic')).toEqual({
      id: 'anthropic',
      label: 'Anthropic',
      origin: 'https://api.anthropic.com',
      protocol: 'messages',
      modelsPath: '/v1/models',
    })
    expect(providers.find(provider => provider.id === 'google')).toEqual({
      id: 'google',
      label: 'Google Gemini',
      origin: 'https://generativelanguage.googleapis.com/v1beta',
      protocol: 'google',
      modelsPath: '/models',
    })
  })

  it('keeps reporting the protocol table while an egress override changes only the request origin', async () => {
    const ctx = await mountCatalog({ origins: { deepseek: 'http://127.0.0.1:9/catalog' } })

    expect(ctx.faberloomModelCatalog.providers().find(provider => provider.id === 'deepseek')?.origin)
      .toBe('https://api.deepseek.com/v1')
  })
})

describe('discovery normalization', () => {
  it('keeps the rich DeepSeek row field for field', async () => {
    const server = await modelsServer([{ body: DEEPSEEK_BODY }])
    const ctx = await mountCatalog({ origins: { deepseek: server.origin } })

    const models = await ctx.faberloomModelCatalog.discover('deepseek', credentialRef('DEEPSEEK_API_KEY'))

    expect(models).toEqual([{
      id: 'deepseek-flash',
      name: 'DeepSeek-V4.1-Flash',
      contextWindow: 1048576,
      maxOutputTokens: 393216,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      effortLevels: ['low', 'high', 'max'],
    }])
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]?.url).toBe('/models')
  })

  it('normalizes a plain OpenAI row and drops entries without an id', async () => {
    const server = await modelsServer([{
      body: JSON.stringify({
        object: 'list',
        data: [
          { id: 'gpt-x', object: 'model' },
          { object: 'model' },
          null,
          'unexpected',
          { id: '' },
          { id: 'gpt-y', name: 7, context_window: 0, max_output_tokens: -5, input_modalities: ['text', '', 7], output_modalities: [], effort: null },
        ],
      }),
    }])
    const ctx = await mountCatalog({ origins: { openai: server.origin } })

    const models = await ctx.faberloomModelCatalog.discover('openai', credentialRef('DEEPSEEK_API_KEY'))

    expect(models).toEqual([
      { id: 'gpt-x' },
      { id: 'gpt-y', inputModalities: ['text'] },
    ])
  })

  it('normalizes an Anthropic row through display_name', async () => {
    const server = await modelsServer([{
      body: JSON.stringify({
        data: [{ id: 'claude-x', display_name: 'Claude X', type: 'model' }, null, 'unexpected', { type: 'model' }],
        has_more: false,
      }),
    }])
    const ctx = await mountCatalog({ origins: { anthropic: server.origin } })

    const models = await ctx.faberloomModelCatalog.discover('anthropic', credentialRef('DEEPSEEK_API_KEY'))

    expect(models).toEqual([{ id: 'claude-x', name: 'Claude X' }])
  })

  it('normalizes a Google row and strips the models/ prefix', async () => {
    const server = await modelsServer([{
      body: JSON.stringify({
        models: [
          { name: 'models/gemini-x', displayName: 'Gemini X', inputTokenLimit: 1_000, outputTokenLimit: 100 },
          null,
          'unexpected',
          { displayName: 'no name' },
        ],
      }),
    }])
    const ctx = await mountCatalog({ origins: { google: server.origin } })

    const models = await ctx.faberloomModelCatalog.discover('google', credentialRef('DEEPSEEK_API_KEY'))

    expect(models).toEqual([{ id: 'gemini-x', name: 'Gemini X', contextWindow: 1_000, maxOutputTokens: 100 }])
  })

  it('reports a provider body with no model list as malformed', async () => {
    const server = await modelsServer([{ body: '{}' }, { body: '{}' }])
    const ctx = await mountCatalog({ origins: { anthropic: server.origin, google: server.origin } })

    await expect(ctx.faberloomModelCatalog.discover('anthropic', credentialRef('DEEPSEEK_API_KEY')))
      .rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
    await expect(ctx.faberloomModelCatalog.discover('google', credentialRef('DEEPSEEK_API_KEY')))
      .rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })
})

describe('credential resolution', () => {
  it('authenticates with the credential stored under the named reference', async () => {
    const server = await modelsServer([{ body: '{"data":[]}' }])
    const ctx = await mountCatalog({ origins: { openai: server.origin } })
    provideCredentials(ctx, { FABERLOOM_TEST_KEY: KEY })
    vi.stubEnv('FABERLOOM_TEST_KEY', 'ambient-must-not-win')

    await ctx.faberloomModelCatalog.discover('openai', credentialRef('FABERLOOM_TEST_KEY'))

    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`)
  })

  it('sends the Anthropic credential as x-api-key with the API version', async () => {
    const server = await modelsServer([{ body: '{"data":[]}' }])
    const ctx = await mountCatalog({ origins: { anthropic: server.origin } })
    provideCredentials(ctx, { FABERLOOM_TEST_KEY: KEY })

    await ctx.faberloomModelCatalog.discover('anthropic', credentialRef('FABERLOOM_TEST_KEY'))

    expect(server.requests[0]?.headers['x-api-key']).toBe(KEY)
    expect(server.requests[0]?.headers['anthropic-version']).toBe('2023-06-01')
    expect(server.requests[0]?.headers.authorization).toBeUndefined()
  })

  it('sends the Google credential as a query parameter', async () => {
    const server = await modelsServer([{ body: '{"models":[]}' }])
    const ctx = await mountCatalog({ origins: { google: server.origin } })
    provideCredentials(ctx, { FABERLOOM_TEST_KEY: KEY })

    await ctx.faberloomModelCatalog.discover('google', credentialRef('FABERLOOM_TEST_KEY'))

    expect(server.requests[0]?.url).toBe(`/models?key=${KEY}`)
    expect(server.requests[0]?.headers.authorization).toBeUndefined()
    expect(server.requests[0]?.headers['x-api-key']).toBeUndefined()
  })

  it('falls back to the launch environment when no credential provider is mounted', async () => {
    const server = await modelsServer([{ body: '{"data":[]}' }])
    const ctx = await mountCatalog({ origins: { deepseek: server.origin } })
    vi.stubEnv('DEEPSEEK_API_KEY', KEY)

    await ctx.faberloomModelCatalog.discover('deepseek', credentialRef('DEEPSEEK_API_KEY'))

    expect(server.requests[0]?.headers.authorization).toBe(`Bearer ${KEY}`)
  })

  it('does not fall back to the environment when a mounted provider resolves nothing', async () => {
    const ctx = await mountCatalog()
    provideCredentials(ctx, {})
    vi.stubEnv('FABERLOOM_TEST_KEY', KEY)

    await expect(ctx.faberloomModelCatalog.discover('deepseek', credentialRef('FABERLOOM_TEST_KEY')))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    await expect(ctx.faberloomModelCatalog.probe('deepseek', credentialRef('FABERLOOM_TEST_KEY')))
      .resolves.toMatchObject({ kind: 'invalid-credential' })
  })

  it('reports an unset or empty ambient credential as missing', async () => {
    const ctx = await mountCatalog()
    vi.stubEnv('FABERLOOM_EMPTY_KEY', '')

    await expect(ctx.faberloomModelCatalog.discover('deepseek', credentialRef('FABERLOOM_ABSENT_KEY')))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    await expect(ctx.faberloomModelCatalog.discover('deepseek', credentialRef('FABERLOOM_EMPTY_KEY')))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })

  it('refuses an ambient value that cannot travel in an HTTP header', async () => {
    const ctx = await mountCatalog()
    vi.stubEnv('FABERLOOM_BLANK_KEY', '   ')

    await expect(ctx.faberloomModelCatalog.discover('deepseek', credentialRef('FABERLOOM_BLANK_KEY')))
      .rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' })
  })
})

describe('probe classification', () => {
  it('answers ok with the served models and never echoes the key', async () => {
    const server = await modelsServer([{ body: DEEPSEEK_BODY }])
    const ctx = await mountCatalog({ origins: { deepseek: server.origin } })
    provideCredentials(ctx, { FABERLOOM_TEST_KEY: KEY })

    const probe = await ctx.faberloomModelCatalog.probe('deepseek', credentialRef('FABERLOOM_TEST_KEY'))

    expect(probe).toMatchObject({ kind: 'ok', status: 200 })
    expect(probe.models?.map(model => model.id)).toEqual(['deepseek-flash'])
    expect(JSON.stringify(probe)).not.toContain(KEY)
  })

  it('classifies 401 as invalid-credential and redacts the echoed key', async () => {
    const server = await modelsServer([{ status: 401, body: `{"error":{"message":"bad key ${KEY}"}}` }])
    const ctx = await mountCatalog({ origins: { openai: server.origin } })
    provideCredentials(ctx, { FABERLOOM_TEST_KEY: KEY })

    const probe = await ctx.faberloomModelCatalog.probe('openai', credentialRef('FABERLOOM_TEST_KEY'))

    expect(probe.kind).toBe('invalid-credential')
    expect(probe.status).toBe(401)
    expect(probe.detail).toContain('[redacted]')
    expect(JSON.stringify(probe)).not.toContain(KEY)
  })

  it('classifies a 403 without billing wording as invalid-credential', async () => {
    const server = await modelsServer([{ status: 403, body: '{"error":{"message":"forbidden"}}' }])
    const ctx = await mountCatalog({ origins: { openai: server.origin } })

    const probe = await ctx.faberloomModelCatalog.probe('openai', credentialRef('DEEPSEEK_API_KEY'))

    expect(probe).toMatchObject({ kind: 'invalid-credential', status: 403 })
  })

  it('classifies 402 as quota-exhausted without a detail when the body is empty', async () => {
    const server = await modelsServer([{ status: 402, body: '' }])
    const ctx = await mountCatalog({ origins: { openai: server.origin } })

    const probe = await ctx.faberloomModelCatalog.probe('openai', credentialRef('DEEPSEEK_API_KEY'))

    expect(probe).toEqual({ kind: 'quota-exhausted', status: 402 })
  })

  it('classifies a 429 carrying billing wording as quota-exhausted', async () => {
    const server = await modelsServer([{ status: 429, body: '{"error":{"type":"insufficient_quota"}}' }])
    const ctx = await mountCatalog({ origins: { openai: server.origin } })

    const probe = await ctx.faberloomModelCatalog.probe('openai', credentialRef('DEEPSEEK_API_KEY'))

    expect(probe).toMatchObject({ kind: 'quota-exhausted', status: 429 })
  })

  it('classifies a 403 carrying billing wording as quota-exhausted', async () => {
    const server = await modelsServer([{ status: 403, body: '{"error":{"message":"your account is out of credits"}}' }])
    const ctx = await mountCatalog({ origins: { openai: server.origin } })

    const probe = await ctx.faberloomModelCatalog.probe('openai', credentialRef('DEEPSEEK_API_KEY'))

    expect(probe).toMatchObject({ kind: 'quota-exhausted', status: 403 })
  })

  it('classifies a status this probe does not act on as unsupported', async () => {
    const server = await modelsServer([{ status: 500, body: 'upstream exploded' }])
    const ctx = await mountCatalog({ origins: { openai: server.origin } })

    const probe = await ctx.faberloomModelCatalog.probe('openai', credentialRef('DEEPSEEK_API_KEY'))

    expect(probe).toMatchObject({ kind: 'unsupported', status: 500, detail: 'upstream exploded' })
  })

  it('reports a 200 body with no model list as unsupported', async () => {
    const server = await modelsServer([{ body: 'not json' }])
    const ctx = await mountCatalog({ origins: { openai: server.origin } })

    const probe = await ctx.faberloomModelCatalog.probe('openai', credentialRef('DEEPSEEK_API_KEY'))

    expect(probe.kind).toBe('unsupported')
    expect(probe.status).toBe(200)
    expect(probe.detail).toContain('carried no model list')
  })

  it('classifies an unreachable host as unreachable', async () => {
    const ctx = await mountCatalog({ origins: { deepseek: 'http://127.0.0.1:1' } })
    provideCredentials(ctx, { FABERLOOM_TEST_KEY: KEY })

    const probe = await ctx.faberloomModelCatalog.probe('deepseek', credentialRef('FABERLOOM_TEST_KEY'))

    expect(probe.kind).toBe('unreachable')
    expect(probe.detail).toBeDefined()
    expect(JSON.stringify(probe)).not.toContain(KEY)
  })

  it('reports a provider outside the table as unsupported', async () => {
    const ctx = await mountCatalog()

    const probe = await ctx.faberloomModelCatalog.probe('unknown-provider', credentialRef('DEEPSEEK_API_KEY'))

    expect(probe).toMatchObject({ kind: 'unsupported' })
    expect(probe.detail).toContain('unknown-provider')
  })
})

describe('discovery failures', () => {
  it('refuses a provider outside the table', async () => {
    const ctx = await mountCatalog()

    await expect(ctx.faberloomModelCatalog.discover('unknown-provider', credentialRef('DEEPSEEK_API_KEY')))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_PROVIDER' })
  })

  it('reports an incomplete request as a transport failure', async () => {
    const ctx = await mountCatalog({ origins: { deepseek: 'http://127.0.0.1:1' } })
    provideCredentials(ctx, { FABERLOOM_TEST_KEY: KEY })

    await expect(ctx.faberloomModelCatalog.discover('deepseek', credentialRef('FABERLOOM_TEST_KEY')))
      .rejects.toMatchObject({ code: 'TRANSPORT' })
  })

  it('throws the quota code when the provider rejects the request with billing wording', async () => {
    const server = await modelsServer([{ status: 429, body: '{"error":{"type":"insufficient_quota"}}' }])
    const ctx = await mountCatalog({ origins: { openai: server.origin } })

    await expect(ctx.faberloomModelCatalog.discover('openai', credentialRef('DEEPSEEK_API_KEY')))
      .rejects.toMatchObject({ code: 'QUOTA' })
  })

  it('throws an unsupported-status code without a detail when the body is empty', async () => {
    const server = await modelsServer([{ status: 503, body: '' }])
    const ctx = await mountCatalog({ origins: { openai: server.origin } })

    const failure = await ctx.faberloomModelCatalog.discover('openai', credentialRef('DEEPSEEK_API_KEY'))
      .then(() => undefined, (error: unknown) => error as { code?: string; message?: string })

    expect(failure?.code).toBe('UNSUPPORTED')
    expect(failure?.message).toBe('faberloom-model-catalog: model discovery for "openai" failed (unsupported)')
  })

  it('reports a 200 body with no model list as malformed', async () => {
    const server = await modelsServer([{ body: '{}' }])
    const ctx = await mountCatalog({ origins: { openai: server.origin } })

    await expect(ctx.faberloomModelCatalog.discover('openai', credentialRef('DEEPSEEK_API_KEY')))
      .rejects.toMatchObject({ code: 'MALFORMED_RESPONSE' })
  })
})

describe('cached snapshots', () => {
  it('records the last discovery per provider with its timestamp', async () => {
    const server = await modelsServer([
      { body: '{"data":[{"id":"gpt-x"}]}' },
      { body: DEEPSEEK_BODY },
    ])
    const ctx = await mountCatalog({
      origins: { openai: server.origin, deepseek: server.origin },
      requestTimeoutMs: 5_000,
    })

    expect(ctx.faberloomModelCatalog.models()).toEqual([])

    await ctx.faberloomModelCatalog.discover('openai', credentialRef('DEEPSEEK_API_KEY'))
    await ctx.faberloomModelCatalog.discover('deepseek', credentialRef('DEEPSEEK_API_KEY'))
    const snapshots = ctx.faberloomModelCatalog.models()

    expect(snapshots.map(snapshot => snapshot.providerId)).toEqual(['deepseek', 'openai'])
    expect(snapshots.every(snapshot => Number.isFinite(snapshot.at) && snapshot.at > 0)).toBe(true)
    expect(snapshots.find(snapshot => snapshot.providerId === 'openai')?.models).toEqual([{ id: 'gpt-x' }])
    expect(snapshots.find(snapshot => snapshot.providerId === 'deepseek')?.models).toHaveLength(1)
    expect(Object.isFrozen(snapshots)).toBe(true)
  })
})

describe('configuration', () => {
  it('rejects a request timeout outside the validated range', async () => {
    const ctx = new Context()

    await expect(ctx.plugin(ModelCatalog, { requestTimeoutMs: 0 })).rejects.toThrow()
  })

  it('accepts the explicit request timeout and the egress origins', async () => {
    const server = await modelsServer([{ body: '{"data":[]}' }])
    const ctx = await mountCatalog({ origins: { openai: server.origin }, requestTimeoutMs: 5_000 })

    await expect(ctx.faberloomModelCatalog.discover('openai', credentialRef('DEEPSEEK_API_KEY')))
      .resolves.toEqual([])
  })
})
