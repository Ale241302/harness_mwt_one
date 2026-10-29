import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { apply, parseAnswer, type Config } from '../src/index.ts'

/** One fake LLM runtime whose stream yields the scripted chunks. */
function fakeLlm(script: (options: unknown) => StreamChunk[] | Error | string) {
  const calls: unknown[] = []
  const llm = {
    stream(options: unknown) {
      calls.push(options)
      return (async function* () {
        const chunks = script(options)
        if (!Array.isArray(chunks)) throw chunks
        for (const chunk of chunks) yield chunk
      })()
    },
  }
  return { llm, calls }
}

/** Boot the plugin over a fake LLM and return the provided port. */
function mount(script: (options: unknown) => StreamChunk[] | Error | string, config: Config = {}) {
  const { llm, calls } = fakeLlm(script)
  const ctx = new Context()
  ;(ctx.provide as (name: string, value: unknown) => void)('llm', llm)
  apply(ctx, config)
  const port = (ctx.get('faberloomBoardClassifier')) as {
    modelVersion: string
    classifySeverity: (request: unknown, options: { signal: AbortSignal; confidenceThreshold: number }) => Promise<unknown>
  }
  return { port, calls, ctx }
}

/** A text answer wrapped in the chunks one model call produces. */
function answer(text: string): StreamChunk[] {
  return [
    { type: 'text-delta', index: 0, text },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

const REQUEST = {
  artifactType: 'proforma',
  accountRef: 'eguisa',
  contentHash: 'abc',
  summary: 'Proforma de 100 pares',
}

const SIGNAL = { signal: new AbortController().signal, confidenceThreshold: 0.8 }

describe('faberloom classifier over ctx.llm', () => {
  it('classifies one item with the declared provider and model', async () => {
    const { port, calls } = mount(() => answer('{"severity":"HIGH","confidence":0.91}'), {
      provider: 'test-provider', model: 'test-model',
    })
    expect(port.modelVersion).toBe('test-provider/test-model@v1')
    await expect(port.classifySeverity(REQUEST, SIGNAL))
      .resolves.toEqual({ status: 'classified', severity: 'HIGH', confidence: 0.91 })

    const options = calls[0] as {
      provider: string
      model: string
      system: string
      maxTokens: number
      temperature: number
      messages: { content: { text: string }[] }[]
    }
    expect(options).toMatchObject({ provider: 'test-provider', model: 'test-model', maxTokens: 200, temperature: 0 })
    const prompt = options.messages[0]?.content[0]?.text ?? ''
    expect(prompt).toContain('proforma')
    expect(prompt).toContain('eguisa')
    expect(prompt).toContain('Proforma de 100 pares')
    expect(prompt.startsWith('<item>')).toBe(true)
    expect(options.system).toContain('untrusted data')
  })

  it('reads an answer wrapped in prose or a code fence', async () => {
    const { port } = mount(() => answer('Claro:\n```json\n{"severity":"LOW","confidence":1}\n```'))
    await expect(port.classifySeverity(REQUEST, SIGNAL))
      .resolves.toEqual({ status: 'classified', severity: 'LOW', confidence: 1 })
  })

  it('reports an invalid answer instead of throwing into the board', async () => {
    const cases = [
      ['sin json', 'no sé'],
      ['objeto roto', '{severity:'],
      ['json inválido', '{oops}'],
      ['severidad desconocida', '{"severity":"URGENT","confidence":0.9}'],
      ['confianza fuera de rango', '{"severity":"LOW","confidence":2}'],
      ['confianza no numérica', '{"severity":"LOW","confidence":"alta"}'],
    ] as const
    for (const [, text] of cases) {
      const { port } = mount(() => answer(text))
      const result = await port.classifySeverity(REQUEST, SIGNAL) as { status: string }
      expect(result.status).toBe('invalid')
    }
    expect(parseAnswer('null')).toEqual({ status: 'invalid', detail: 'no JSON object in the answer' })
  })

  it('names a missing account and never assumes one', async () => {
    const { port, calls } = mount(() => answer('{"severity":"LOW","confidence":1}'))
    await port.classifySeverity({ ...REQUEST, accountRef: null }, SIGNAL)
    const options = calls[0] as { messages: { content: { text: string }[] }[] }
    expect(options.messages[0]?.content[0]?.text ?? '').toContain('Account: none')
  })

  it('reports timeout and provider failures without throwing', async () => {
    const aborted = mount(() => [
      { type: 'finish', reason: { kind: 'aborted', failure: { message: 'aborted', code: 'ABORTED' } as never } },
    ])
    await expect(aborted.port.classifySeverity(REQUEST, SIGNAL)).resolves.toEqual({ status: 'timeout' })

    const failed = mount(() => [
      { type: 'finish', reason: { kind: 'error', failure: { message: 'boom', code: 'UNKNOWN' } as never } },
    ])
    await expect(failed.port.classifySeverity(REQUEST, SIGNAL)).resolves.toMatchObject({ status: 'invalid' })

    const thrown = mount(() => new Error('provider down'))
    const nonError = mount(() => 'boom' as never)
    await expect(thrown.port.classifySeverity(REQUEST, SIGNAL))
      .resolves.toEqual({ status: 'invalid', detail: 'provider down' })
    await expect(nonError.port.classifySeverity(REQUEST, SIGNAL))
      .resolves.toEqual({ status: 'invalid', detail: 'boom' })

    const controller = new AbortController()
    controller.abort()
    const cancelled = mount(() => new Error('aborted'))
    await expect(cancelled.port.classifySeverity(REQUEST, { ...SIGNAL, signal: controller.signal }))
      .resolves.toEqual({ status: 'timeout' })
  })

  it('settles a stream that ignores the abort at the deadline', async () => {
    const ctx = new Context()
    ;(ctx.provide as (name: string, value: unknown) => void)('llm', {
      stream() {
        return (async function* () {
          yield { type: 'text-delta', index: 0, text: '{' }
          await new Promise(() => {})
        })()
      },
    })
    apply(ctx, { timeoutMs: 10 })
    const port = ctx.get('faberloomBoardClassifier') as {
      classifySeverity: (request: unknown, options: { signal: AbortSignal; confidenceThreshold: number }) => Promise<unknown>
    }
    await expect(port.classifySeverity(REQUEST, SIGNAL)).resolves.toEqual({ status: 'timeout' })
  })

  it('refuses an answer that keeps growing past the bound', async () => {
    const { port } = mount(() => answer('x'.repeat(5_000)))
    await expect(port.classifySeverity(REQUEST, SIGNAL))
      .resolves.toEqual({ status: 'invalid', detail: 'answer exceeds the bound' })
  })
  it('bounds the summary it forwards', async () => {
    const { port, calls } = mount(() => answer('{"severity":"LOW","confidence":1}'))
    await port.classifySeverity({ ...REQUEST, summary: 'x'.repeat(9_000) }, SIGNAL)
    const options = calls[0] as { messages: { content: { text: string }[] }[] }
    const prompt = options.messages[0]?.content[0]?.text ?? ''
    expect(prompt.length).toBeLessThan(5_000)
  })
})
