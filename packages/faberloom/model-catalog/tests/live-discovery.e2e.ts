/**
 * Real-API discovery for the providers whose credentials this checkout holds.
 * Each keyed suite skips without its own variable and contains no key: DeepSeek,
 * OpenAI, and the Kimi coding plan are verified live when their variables are
 * set, while the keyless states for Kimi and Google always run. Google's
 * `API key not valid` 400 is pinned to `invalid-credential` by the local stub in
 * `model-catalog.spec.ts`, because that path needs no valid credential and must
 * not depend on Google reachability here.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as ModelCatalog from '../src/index.ts'

const HAS_DEEPSEEK_KEY = (process.env.DEEPSEEK_API_KEY ?? '').length > 0
const HAS_OPENAI_KEY = (process.env.OPENAI_API_KEY ?? '').length > 0
const HAS_KIMI_KEY = (process.env.KIMI_API_KEY ?? '').length > 0

describe.runIf(HAS_DEEPSEEK_KEY)('DeepSeek live discovery', () => {
  it('asks DeepSeek which models it serves and reports no credential failure', async () => {
    const ctx = new Context()
    await ctx.plugin(ModelCatalog, {})

    const models = await ctx.faberloomModelCatalog.discover('deepseek', credentialRef('DEEPSEEK_API_KEY'))

    expect(models.length).toBeGreaterThan(0)
    expect(models.every(model => model.id.length > 0)).toBe(true)
    // The snapshot the picker reads carries the same rows with their check time.
    const snapshot = ctx.faberloomModelCatalog.models().find(entry => entry.providerId === 'deepseek')
    expect(snapshot?.models).toEqual(models)
  })

  it('reports an absent credential reference as its own no-credential state', async () => {
    const ctx = new Context()
    await ctx.plugin(ModelCatalog, {})

    const probe = await ctx.faberloomModelCatalog.probe('deepseek', credentialRef('FABERLOOM_ABSENT_KEY'))

    expect(probe.kind).toBe('no-credential')
    expect(JSON.stringify(probe)).not.toContain(process.env.DEEPSEEK_API_KEY ?? 'unset')
  })
})

describe.runIf(HAS_OPENAI_KEY)('OpenAI live discovery', () => {
  it('lists the OpenAI models the key can route to', async () => {
    const ctx = new Context()
    await ctx.plugin(ModelCatalog, {})

    const models = await ctx.faberloomModelCatalog.discover('openai', credentialRef('OPENAI_API_KEY'))

    // The endpoint serves a large catalog; assert a real slice rather than a
    // brittle exact count.
    expect(models.length).toBeGreaterThan(100)
    expect(models.map(model => model.id)).toContain('gpt-5-mini')
  })

  it('authenticates the same key through a probe', async () => {
    const ctx = new Context()
    await ctx.plugin(ModelCatalog, {})

    const probe = await ctx.faberloomModelCatalog.probe('openai', credentialRef('OPENAI_API_KEY'))

    expect(probe.kind).toBe('ok')
    expect(probe.models?.length).toBeGreaterThan(100)
  })
})

describe.runIf(HAS_KIMI_KEY)('Kimi Code live discovery', () => {
  it('lists the coding-plan models through the product surface', async () => {
    const ctx = new Context()
    await ctx.plugin(ModelCatalog, {})

    // `kimi` points at the coding plan; the platform surface is `moonshotai`.
    const models = await ctx.faberloomModelCatalog.discover('kimi', credentialRef('KIMI_API_KEY'))

    expect(models.map(model => model.id).sort()).toEqual([
      'k3',
      'k3-256k',
      'kimi-for-coding',
      'kimi-for-coding-highspeed',
    ])
  })

  it('accepts the coding-plan key through a probe', async () => {
    const ctx = new Context()
    await ctx.plugin(ModelCatalog, {})

    const probe = await ctx.faberloomModelCatalog.probe('kimi', credentialRef('KIMI_API_KEY'))

    expect(probe.kind).toBe('ok')
    expect(probe.models).toHaveLength(4)
  })
})

describe('keyless catalog states', () => {
  it.each(['kimi', 'moonshotai', 'google'])(
    'reports an absent credential for %s as no-credential rather than a rejected key',
    async (provider) => {
      const ctx = new Context()
      await ctx.plugin(ModelCatalog, {})

      const probe = await ctx.faberloomModelCatalog.probe(provider, credentialRef('FABERLOOM_ABSENT_KEY'))

      expect(probe.kind).toBe('no-credential')
    },
  )
})
