/**
 * Live probe for O5-05: the Space scope the product renders is handed to a real
 * model, and the answer is checked against the experience it was given.
 *
 * Three cases:
 *  - a Space with no memory: the model must not propose a solution;
 *  - a Space with one approved fact: the model should use and cite it;
 *  - a Space with two facts that contradict: the model must show both.
 *
 * The API key is read from the environment or the repository `.env` and never
 * printed or written to the evidence.
 */

import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import FaberLoomSpaces from '../../packages/faberloom/spaces/src/index.ts'
import { readSpaceScope } from '../../packages/faberloom/session-agent/src/scope.ts'
import { MemoryMediaPool, MemoryStorageBackend } from '../../packages/storage/storage-domain/tests/helpers/memory-backend.ts'

const ACTOR = { id: 'live@mwt.one', role: 'admin', companyId: undefined, readOnly: false } as const
const ROOT = mkdtempSync(join(tmpdir(), 'fl-experience-live-'))

/** Read the key from the environment or the repository `.env`. */
function apiKey(): string {
  const fromEnv = process.env['DEEPSEEK_API_KEY']
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv
  try {
    const line = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
      .split(/\r?\n/u)
      .find(entry => entry.startsWith('DEEPSEEK_API_KEY='))
    return line?.slice('DEEPSEEK_API_KEY='.length).trim() ?? ''
  } catch {
    return ''
  }
}

const SYSTEM = [
  'Eres el asistente de FaberLoom. Trabajas dentro de un Space y solo puedes usar el contexto que recibes.',
  'Reglas: si el contexto no contiene una base para responder, di que no tienes base y qué dato falta; no inventes.',
  'Si hay base, responde de forma concreta y cita el hecho del contexto que usaste.',
  'Si dos hechos del contexto se contradicen, muestra ambos y di que hay conflicto; no elijas uno en silencio.',
].join('\n')

/** Boot storage and the real Spaces service over one memory pool. */
async function spacesService() {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomSpaces)
  return ctx.faberloomSpaces
}

/** Render the product's Space scope for one working directory. */
async function scopeText(spaces: Awaited<ReturnType<typeof spacesService>>, workspaceId: string, path: string): Promise<string> {
  const scope = await readSpaceScope({
    actor: ACTOR,
    cwd: path,
    spaces,
    agents: { listAgents: () => Promise.resolve([]) },
    registry: { list: () => [{ id: workspaceId, path }] },
    dshHome: ROOT,
  })
  return scope?.text ?? ''
}

/** Ask the real model with the exact context the product would send. */
async function ask(key: string, context: string, question: string): Promise<{ answer: string; usage: unknown; messages: unknown[] }> {
  const messages = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Contexto del Space:\n${context}\n\nPregunta: ${question}` },
  ]
  const response = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: 'deepseek-chat', temperature: 0, max_tokens: 400, messages }),
  })
  if (!response.ok) throw new Error(`model request failed: ${String(response.status)} ${(await response.text()).slice(0, 200)}`)
  const body = await response.json() as {
    choices?: { message?: { content?: string } }[]
    usage?: unknown
  }
  return { answer: body.choices?.[0]?.message?.content ?? '', usage: body.usage, messages }
}

const key = apiKey()
if (key.length === 0) {
  console.error('no DEEPSEEK_API_KEY in the environment or .env')
  process.exit(1)
}

const spaces = await spacesService()
const emptySpace = await spaces.create(ACTOR, { title: 'Sonepar', workspaceId: 'ws-empty' })
const lessonSpace = await spaces.create(ACTOR, { title: 'Eguisa', workspaceId: 'ws-eguisa' })
const emptyPath = join(ROOT, 'empty')
const lessonPath = join(ROOT, 'eguisa')
mkdirSync(emptyPath, { recursive: true })
mkdirSync(lessonPath, { recursive: true })

const QUESTION = '¿Qué incoterm y quién paga el flete para este cliente?'
const results: { case: string; context: string; answer: string; usage: unknown }[] = []

// 1. No base.
const emptyContext = await scopeText(spaces, 'ws-empty', emptyPath)
const empty = await ask(key, emptyContext, QUESTION)
results.push({ case: 'sin-base', context: emptyContext, answer: empty.answer, usage: empty.usage })

// 2. One approved fact.
await spaces.remember(ACTOR, 'Eguisa trabaja DDP y el flete va incluido en el precio.', [lessonSpace.id])
const oneContext = await scopeText(spaces, 'ws-eguisa', lessonPath)
const one = await ask(key, oneContext, QUESTION)
results.push({ case: 'con-base', context: oneContext, answer: one.answer, usage: one.usage })

// 3. A contradicting fact.
await spaces.remember(ACTOR, 'Eguisa no paga el flete: el flete lo paga el cliente por separado.', [lessonSpace.id])
const conflictContext = await scopeText(spaces, 'ws-eguisa', lessonPath)
const conflict = await ask(key, conflictContext, QUESTION)
results.push({ case: 'conflicto', context: conflictContext, answer: conflict.answer, usage: conflict.usage })

const checks = {
  'sin-base no inventa DDP': !/DDP/iu.test(results[0]?.answer ?? ''),
  'sin-base dice que le falta base': /no tengo|no hay|no dispongo|falta|sin (?:base|informaci)/iu.test(results[0]?.answer ?? ''),
  'con-base usa el hecho': /DDP/iu.test(results[1]?.answer ?? ''),
  'conflicto muestra las dos caras': /paga/iu.test(results[2]?.answer ?? '') && /no paga|por separado|no incluye/iu.test(results[2]?.answer ?? ''),
}

const lines = [
  '# O5-05 · Inspección con modelo real',
  '',
  '- Modelo: `deepseek-chat` (temperatura 0)',
  `- Espacio vacío: ${String(emptySpace.id)} · Espacio con memoria: ${String(lessonSpace.id)}`,
  `- Pregunta: ${QUESTION}`,
  '',
]
for (const result of results) {
  lines.push(`## ${result.case}`, '', '### Contexto enviado (texto real del Space)', '', '```', result.context.trim(), '```', '', '### Respuesta', '', result.answer.trim(), '', '')
}
lines.push('## Comprobaciones', '')
for (const [name, passed] of Object.entries(checks)) lines.push(`- ${passed ? 'PASS' : 'FAIL'} · ${name}`)
lines.push('')
const { writeFile } = await import('node:fs/promises')
await writeFile(new URL('../../docs/scratch/faberloom-daily-work/e1/evidence-O5-05-live.md', import.meta.url), lines.join('\n'), 'utf8')
console.log(JSON.stringify({ checks, usage: results.map(result => result.usage) }, null, 1))
