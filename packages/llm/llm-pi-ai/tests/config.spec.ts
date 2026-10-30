import { describe, expect, it } from 'vitest'
import { assertServiceable, Config, resolveProfiles } from '../src/config.ts'

/** Validate one hand-declared route, with the caller's fields layered onto it. */
const routeWith = (profile: Record<string, unknown>): (() => unknown) =>
  () => Config({
    providers: {
      'acme-gateway': {
        api: 'openai-completions',
        baseURL: 'https://acme.test',
        models: [{ id: 'm' }],
        ...profile,
      },
    },
  })

/** Validate that route with the caller's fields on its single model entry. */
const configWith = (model: Record<string, unknown>): (() => unknown) =>
  routeWith({ models: [{ id: 'm', ...model }] })

describe('reasoning schema boundary', () => {
  it('accepts an empty provider section and propagates unexpected catalog failures', () => {
    expect(() => { assertServiceable({}) }).not.toThrow()
    const failure = new TypeError('model metadata lookup failed')
    expect(() => resolveProfiles({ openrouter: { models: [{
      id: '111',
      get name(): string { throw failure },
    }], api: 'openai-completions' } }, 'deferred')).toThrow(failure)
  })

  it('rejects a level pi-ai does not know at the write that produced it', () => {
    expect(configWith({ reasoningEfforts: { ultra: 'x' } })).toThrow(/"off"/)
    expect(configWith({ reasoningEfforts: { high: 42 } })).toThrow()
  })

  it('keeps false distinguishable from an absent declaration', () => {
    type Materialized = { providers: Record<string, { models?: { reasoningEfforts?: unknown }[] }> }
    const withFalse = configWith({ reasoningEfforts: false })() as Materialized
    expect(withFalse.providers['acme-gateway']?.models?.[0]?.reasoningEfforts).toBe(false)
    const absent = configWith({})() as Materialized
    expect(absent.providers['acme-gateway']?.models?.[0]?.reasoningEfforts).toBeUndefined()
  })

  it('rejects a thinking format outside the offered set', () => {
    expect(configWith({ compat: { thinkingFormat: 'quantum' } })).toThrow(/expected/)
  })

  it('accepts Baseten template arguments and completion controls', () => {
    expect(configWith({
      compat: {
        supportsFinishReason: false,
        thinkingFormat: 'baseten',
        chatTemplateArgs: { enable_thinking: { $var: 'thinking.enabled' } },
        supportsThinkingTokenBudget: true,
      },
    })).not.toThrow()
  })
})

describe('modality schema boundary', () => {
  it('rejects a modality pi-ai does not know, at either level', () => {
    expect(configWith({ input: ['audio'] })).toThrow(/expected/)
    expect(routeWith({ defaultInput: ['text', 'audio'] })).toThrow(/expected/)
  })

  it('refuses a route whose models could accept nothing', () => {
    // The pair the settings seam runs: the schema accepts the empty list as
    // well-typed, and the namespace validator is what refuses it. Asserting
    // only the schema would report this route as writable.
    expect(routeWith({ defaultInput: [] })).not.toThrow()
    expect(() => { assertServiceable(routeWith({ defaultInput: [] })() as Config) })
      .toThrow(/defaultInput must name at least one modality/)
  })

  type Materialized = {
    providers: Record<string, { defaultInput?: unknown; models?: { input?: unknown }[] }>
  }

  it('materializes an absent entry list as empty and an absent route list as text', () => {
    // The empty-list inheritance rule exists because of exactly this: an entry
    // that declares nothing reaches resolution as `[]`, not as `undefined`.
    const absent = configWith({})() as Materialized
    expect(absent.providers['acme-gateway']?.models?.[0]?.input).toEqual([])
    expect(absent.providers['acme-gateway']?.defaultInput).toEqual(['text'])
  })
})

describe('shipped multi-provider routes', () => {
  /**
   * The routes the base-backed product compositions declare, each with the
   * endpoint and wire protocol the installed catalog serves it on. `deepseek`
   * is absent because the native `dsh-llm-deepseek` adapter owns that route.
   * `kimi` is the product key for Kimi's coding plan; `moonshotai` is the
   * separate Moonshot platform product.
   */
  const SHIPPED = {
    openai: { apiKeyEnv: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com/v1', api: 'openai-responses' },
    anthropic: { apiKeyEnv: 'ANTHROPIC_API_KEY', baseURL: 'https://api.anthropic.com', api: 'anthropic-messages' },
    google: { apiKeyEnv: 'GOOGLE_API_KEY', baseURL: 'https://generativelanguage.googleapis.com/v1beta', api: 'google-generative-ai' },
    kimi: { apiKeyEnv: 'KIMI_API_KEY', baseURL: 'https://api.kimi.com/coding', api: 'anthropic-messages' },
    moonshotai: { apiKeyEnv: 'MOONSHOT_API_KEY', baseURL: 'https://api.moonshot.ai/v1', api: 'openai-completions' },
  } as const

  it('resolves every shipped route with its catalog endpoint, protocol, and key reference', () => {
    const profiles = resolveProfiles(
      Object.fromEntries(Object.entries(SHIPPED).map(([route, { apiKeyEnv }]) => [route, { apiKeyEnv }])),
    )
    for (const [route, expected] of Object.entries(SHIPPED)) {
      const profile = profiles.get(route)
      expect(profile, route).toBeDefined()
      expect(profile?.apiKeyEnv, route).toBe(expected.apiKeyEnv)
      expect(profile?.piProvider?.baseUrl, route).toBe(expected.baseURL)
      const models = profile?.piProvider?.getModels() ?? []
      expect(models.length, route).toBeGreaterThan(0)
      for (const model of models) {
        expect(model.baseUrl, `${route}/${model.id}`).toBe(expected.baseURL)
        expect(model.api, `${route}/${model.id}`).toBe(expected.api)
        expect(model.provider, `${route}/${model.id}`).toBe(route)
      }
    }
  })

  it('resolves the product route key "kimi" through the installed kimi-coding catalog', () => {
    const kimi = resolveProfiles({ kimi: { apiKeyEnv: 'KIMI_API_KEY' } }).get('kimi')
    const coding = resolveProfiles({ 'kimi-coding': { apiKeyEnv: 'KIMI_API_KEY' } }).get('kimi-coding')

    expect(kimi?.catalogError).toBeUndefined()
    expect(kimi?.piProvider?.baseUrl).toBe('https://api.kimi.com/coding')
    // The coding plan publishes no models endpoint (404), so the four ids come
    // from the shipped catalog rather than from discovery.
    expect(kimi?.piProvider?.getModels().map(model => model.id).sort()).toEqual(
      ['k3', 'k3-256k', 'kimi-for-coding', 'kimi-for-coding-highspeed'],
    )
    expect(kimi?.piProvider?.getModels().every(model => model.api === 'anthropic-messages')).toBe(true)
    // Same endpoint, protocol, and model ids as the catalog id it aliases.
    expect(kimi?.piProvider?.baseUrl).toBe(coding?.piProvider?.baseUrl)
    expect(kimi?.piProvider?.getModels().map(model => [model.id, model.api]))
      .toEqual(coding?.piProvider?.getModels().map(model => [model.id, model.api]))
    // The route key, not the catalog id, is what a request and a selector see.
    expect(kimi?.piProvider?.getModels().every(model => model.provider === 'kimi')).toBe(true)
  })
})

describe('request image policy bounds', () => {
  it.each([
    ['requestImagePixelBudget', 0, /requestImagePixelBudget must be a positive safe integer/],
    ['requestImagePixelBudget', Number.MAX_SAFE_INTEGER + 1, /requestImagePixelBudget must be a positive safe integer/],
    ['requestImageMaxBytes', 0, /requestImageMaxBytes must be a positive safe integer/],
    ['requestImageMaxBytes', 1.5, /requestImageMaxBytes must be a positive safe integer/],
  ] as const)('rejects %s=%s at service resolution', (field, value, message) => {
    const programmatic = {
      providers: {
        'acme-gateway': {
          api: 'openai-completions',
          baseURL: 'https://acme.test',
          models: [{ id: 'm' }],
          [field]: value,
        },
      },
    } as unknown as Config
    expect(() => {
      assertServiceable(programmatic)
    }).toThrow(message)
  })
})
