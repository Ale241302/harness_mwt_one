import { createServer, type Server } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { MemoryMediaPool, MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'
import FaberLoomAccess from '../../access/src/index.ts'
import FaberLoomMirror, { MIRROR_ROUTE_PATH } from '../src/index.ts'
import { FABERLOOM_MIRROR_FORMAT_VERSION, deriveMirrorOrigin } from '../src/document.ts'
import type { FaberLoomMirrorDocument } from '../src/types.ts'

const OWNER = 'compras2@sondelsa.com'
const KEY = 'mirror-key-1'
const TOKEN = 'consola-token-1'

/** One remote grant row plus one skill, as a pull document. */
function remoteDocument(note: string): FaberLoomMirrorDocument {
  return {
    version: FABERLOOM_MIRROR_FORMAT_VERSION,
    platform: 'web',
    domains: {
      faberloom_grants: {
        tables: { grants: { g1: { deleted: false, value: { id: 'g1', action: 'mail.send', note } } } },
      },
    },
    skills: { 'informe-diario': '# Informe\n\nCuerpo.' },
  }
}

/** The document the fake gateway is currently holding. */
interface FakeGateway {
  document: FaberLoomMirrorDocument
  received: unknown[]
  keyAccepted: boolean
  /** When set, every answer is this status and text instead of a document. */
  failure?: { status: number; text: string } | undefined
  /** When set, an apply request answers this status and text. */
  applyFailure?: { status: number; text: string } | undefined
  /** Extra fields merged into every successful answer, for malformed-list cases. */
  extras?: Record<string, unknown> | undefined
  /** When set, a pushed document is reported as applied without being merged. */
  refuseMerge?: boolean | undefined
}

/** The mutable form of the fake gateway's document, used to apply one push. */
interface MutableDocument {
  version: number
  platform: 'web' | 'desktop'
  domains: Record<string, { version?: number; tables: Record<string, Record<string, unknown>> }>
  skills: Record<string, string | null>
}

/**
 * Apply one pushed document onto the fake gateway's own, as the gateway route
 * does before it answers: rows land, a tombstone removes the key, and the
 * version the emitting side stamped is kept when the target had none.
 * @param target - the fake's document, mutated in place.
 * @param pushed - the document a client sent.
 */
function mergeInto(target: FaberLoomMirrorDocument, pushed: FaberLoomMirrorDocument): void {
  const mutable = target as unknown as MutableDocument
  for (const [domain, domainDocument] of Object.entries(pushed.domains)) {
    const held = mutable.domains[domain] ?? { tables: {} }
    if (held.version === undefined && domainDocument.version !== undefined) held.version = domainDocument.version
    for (const [table, rows] of Object.entries(domainDocument.tables)) {
      const records = held.tables[table] ?? {}
      for (const [key, row] of Object.entries(rows)) {
        if (row.deleted) Reflect.deleteProperty(records, key)
        else records[key] = { deleted: false, value: row.value }
      }
      held.tables[table] = records
    }
    mutable.domains[domain] = held
  }
  for (const [name, content] of Object.entries(pushed.skills)) {
    if (content !== null) mutable.skills[name] = content
  }
}

/** Start the fake gateway origin and return it with its URL. */
async function startGateway(document: FaberLoomMirrorDocument): Promise<{ gateway: FakeGateway; url: string; close: () => Promise<void> }> {
  const gateway: FakeGateway = { document, received: [], keyAccepted: false }
  const server: Server = createServer((request, response) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => { body += chunk })
    request.on('end', () => {
      if (request.url !== MIRROR_ROUTE_PATH) {
        response.writeHead(404).end('nope')
        return
      }
      gateway.keyAccepted = request.headers['x-faberloom-mirror-key'] === KEY
      const pushed: unknown = body === '' ? undefined : JSON.parse(body)
      gateway.received.push(pushed)
      if (gateway.failure !== undefined) {
        response.writeHead(gateway.failure.status, { 'content-type': 'text/plain' })
        response.end(gateway.failure.text)
        return
      }
      if (pushed !== undefined && gateway.applyFailure !== undefined) {
        response.writeHead(gateway.applyFailure.status, { 'content-type': 'text/plain' })
        response.end(gateway.applyFailure.text)
        return
      }
      const document = pushed as FaberLoomMirrorDocument | undefined
      // The route applies a pushed document and then answers with its own,
      // freshly exported one; the fake keeps the same promise, so a spec that
      // pushes sees the row it pushed in the next answer. A spec that needs a
      // peer which reports an apply without keeping the row turns that off.
      if (document !== undefined && gateway.refuseMerge !== true) mergeInto(gateway.document, document)
      const applied = document === undefined ? [] : Object.entries(document.domains).flatMap(([domain, domainDocument]) =>
        Object.entries(domainDocument.tables).flatMap(([table, rows]) => Object.keys(rows).map(key => ({ domain, table, key }))))
      const skillsApplied = document === undefined ? [] : Object.keys(document.skills)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ ...gateway.document, applied, skillsApplied, skipped: [], ...gateway.extras }))
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return {
    gateway,
    url: `http://127.0.0.1:${String(port)}`,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve() }) }),
  }
}

let context: Context | undefined
const extraContexts: Context[] = []
let home: string | undefined
let closeGateway: (() => Promise<void>) | undefined

afterEach(async () => {
  if (context !== undefined) {
    context.faberloomMirror.stop()
    await context.fiber.dispose()
  }
  context = undefined
  for (const extra of extraContexts.splice(0)) await extra.fiber.dispose()
  if (closeGateway !== undefined) await closeGateway()
  closeGateway = undefined
  if (home !== undefined) rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  home = undefined
  delete process.env.FABERLOOM_MIRROR_URL
  delete process.env.FABERLOOM_MIRROR_OWNER
  delete process.env.FABERLOOM_MIRROR_KEY
  delete process.env.CONSOLA_TOKEN
  delete process.env.CONSOLA_API_BASE
})

/** Boot storage, the access domain, and the mirror against one fake gateway. */
async function harness(document: FaberLoomMirrorDocument, debounceMs = 60_000) {
  home = mkdtempSync(join(tmpdir(), 'faberloom-mirror-sync-'))
  process.env.DSH_HOME = home
  const fake = await startGateway(document)
  closeGateway = fake.close
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  await ctx.plugin(FaberLoomAccess)
  // The access service opens its domain on the first write, which is what a real
  // boot does for the modules the mirror carries. The seeded row is removed — it
  // carries a generated id, so the key comes from the grant the service returned
  // — so the remote document is the only source of the first pull.
  const seeded = await ctx.faberloomAccess.grant(OWNER, { action: 'mail.send' })
  await grants(facility).delete(seeded.id)
  const mirror = new FaberLoomMirror(ctx, {
    enabled: true,
    gatewayUrl: fake.url,
    consoleBase: `http://consola.${new URL(fake.url).host}/api`,
    ownerId: OWNER,
    consoleToken: TOKEN,
    mirrorKey: KEY,
    intervalMs: 10_000_000,
    debounceMs,
  })
  mirror.clearTimers()
  await mirror.sync()
  // The flush the seeded row scheduled is dropped, so every spec drives its own
  // cycle and the debounce timer it wants.
  mirror.clearTimers()
  context = ctx
  return { mirror: mirror, gateway: fake.gateway, facility, ctx }
}

/** The grants table the real access domain writes. */
function grants(facility: DomainFacility) {
  return facility.get('faberloom_grants')?.table('grants') as unknown as {
    get(key: string): unknown
    put(key: string, value: unknown): Promise<void>
    delete(key: string): Promise<boolean>
  }
}

/** Poll a condition up to a second, so a spec waits for its own effect. */
async function waitFor(condition: () => boolean): Promise<boolean> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (condition()) return true
    await new Promise((resolve) => { setTimeout(resolve, 10) })
  }
  return false
}

/** The pushed documents one fake gateway received; a pull carries no body. */
function pushedDocuments(gateway: FakeGateway): FaberLoomMirrorDocument[] {
  return gateway.received.filter(entry => entry !== undefined) as FaberLoomMirrorDocument[]
}

/** Build a fresh storage/domain context, for a spec that needs more than one. */
async function bootContext(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
  const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  extraContexts.push(ctx)
  return ctx
}

describe('FaberLoomMirror', () => {
  it('stays off, with no request, when the wiring is missing', async () => {
    const fake = await startGateway(remoteDocument('sin tocar'))
    closeGateway = fake.close
    // The status document goes to the medium's home, which this spec owns, so
    // nothing a mirror writes lands outside its own temporary directory.
    home = mkdtempSync(join(tmpdir(), 'faberloom-mirror-nowiring-'))
    const storagesRoot = join(home, 'storages')
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    context = ctx
    const mirror = new FaberLoomMirror(ctx, { enabled: true, gatewayUrl: fake.url, storagesRoot })
    mirror.clearTimers()
    expect(await mirror.sync()).toBeUndefined()
    expect(await mirror.pull()).toBeUndefined()
    expect(fake.gateway.received).toEqual([])

    // No gateway origin at all (and no console base to derive one from) names
    // that one in the log and stays off.
    const orphanCtx = await bootContext()
    const orphan = new FaberLoomMirror(orphanCtx, { enabled: true, ownerId: OWNER, consoleToken: TOKEN, mirrorKey: KEY, storagesRoot })
    orphan.clearTimers()
    expect(await orphan.sync()).toBeUndefined()

    // No interval and no skills root configured use their defaults, which do
    // not start a real cycle here.
    const defaultCtx = await bootContext()
    const defaults = new FaberLoomMirror(defaultCtx, {
      enabled: true,
      gatewayUrl: fake.url,
      ownerId: OWNER,
      consoleToken: TOKEN,
      mirrorKey: KEY,
      storagesRoot,
    })
    defaults.clearTimers()
    expect(defaults.skillsRoot().endsWith('skills')).toBe(true)

    // Without a Harness home the skills root falls back to the process directory.
    const savedHome = process.env.DSH_HOME
    delete process.env.DSH_HOME
    expect(defaults.skillsRoot()).toBe(join(process.cwd(), 'skills'))
    process.env.DSH_HOME = savedHome
    defaults.stop()
  })

  it('pulls the remote rows into the local domains and writes the skill file', async () => {
    const { mirror, gateway, facility } = await harness(remoteDocument('desde la web'))
    expect(deriveMirrorOrigin('https://consola.mwt.one/api')).toBe('https://mwt.one/_/harness/mirror')
    expect(grants(facility).get('g1')).toMatchObject({ note: 'desde la web' })
    expect(gateway.keyAccepted).toBe(true)
    expect(await mirror.readSkills()).toMatchObject({ skills: { 'informe-diario': '# Informe\n\nCuerpo.' } })
  })

  it('pushes a local edit once, and a remote move lands on a row the local side never touched', async () => {
    const { mirror, gateway, facility } = await harness(remoteDocument('remoto'))
    await grants(facility).put('g1', { id: 'g1', action: 'mail.send', note: 'editado en el escritorio' })
    const pushed = await mirror.sync()
    expect(pushed?.pushed).toEqual([{ domain: 'faberloom_grants', table: 'grants', key: 'g1' }])
    const body = pushedDocuments(gateway).at(-1)
    expect(body?.domains['faberloom_grants']?.tables['grants']?.['g1']).toEqual({
      deleted: false,
      value: { id: 'g1', action: 'mail.send', note: 'editado en el escritorio' },
    })

    // The journal now records the pushed pair, so an idle cycle sends nothing
    // and the stale remote row does not come back.
    const idle = await mirror.sync()
    expect(idle?.pushed).toEqual([])
    expect(idle?.applied).toEqual([])
    expect(grants(facility).get('g1')).toMatchObject({ note: 'editado en el escritorio' })

    // The other side moves the row while the local side leaves it alone.
    gateway.document = remoteDocument('movido en la web')
    const pulled = await mirror.sync()
    expect(pulled?.applied).toEqual([{ domain: 'faberloom_grants', table: 'grants', key: 'g1' }])
    expect(grants(facility).get('g1')).toMatchObject({ note: 'movido en la web' })
  })

  it('keeps a locally changed row the other side also changed, and reports it', async () => {
    const { mirror, gateway, facility } = await harness(remoteDocument('base'))
    await grants(facility).put('g1', { id: 'g1', action: 'mail.send', note: 'mio' })
    gateway.document = remoteDocument('suyo')
    const result = await mirror.sync()
    expect(result?.keptLocal).toEqual([{ domain: 'faberloom_grants', table: 'grants', key: 'g1' }])
    expect(grants(facility).get('g1')).toMatchObject({ note: 'mio' })
    expect(result?.pushed).toEqual([{ domain: 'faberloom_grants', table: 'grants', key: 'g1' }])
  })

  it('applies a remote tombstone and pushes a local deletion as its own tombstone', async () => {
    const { mirror, gateway, facility } = await harness(remoteDocument('conocido'))
    expect(grants(facility).get('g1')).toBeDefined()

    gateway.document = {
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'web',
      domains: { faberloom_grants: { tables: { grants: { g1: { deleted: true } } } } },
      skills: {},
    }
    await mirror.sync()
    expect(grants(facility).get('g1')).toBeUndefined()

    await grants(facility).put('g2', { id: 'g2', action: 'mail.send', note: 'creado aqui' })
    await mirror.sync()
    // A pull carries no body; only a pushed document does, so the pushed
    // subset is the entries that are defined.
    expect(pushedDocuments(gateway).at(-1)?.domains['faberloom_grants']?.tables['grants']?.['g2']).toBeDefined()

    await grants(facility).delete('g2')
    await mirror.sync()
    expect(pushedDocuments(gateway).at(-1)?.domains['faberloom_grants']?.tables['grants']?.['g2']).toEqual({ deleted: true })
  })

  it('takes its wiring from the environment names the deployment injects', async () => {
    home = mkdtempSync(join(tmpdir(), 'faberloom-mirror-env-'))
    process.env.DSH_HOME = home
    const fake = await startGateway(remoteDocument('desde el entorno'))
    closeGateway = fake.close
    // The deployment names the mirror URL and the console base; the client reads
    // both from the environment when its Config is silent.
    const host = new URL(fake.url).host
    process.env.FABERLOOM_MIRROR_URL = fake.url
    process.env.CONSOLA_API_BASE = `http://consola.${host}/api`
    process.env.FABERLOOM_MIRROR_OWNER = OWNER
    process.env.CONSOLA_TOKEN = TOKEN
    process.env.FABERLOOM_MIRROR_KEY = KEY
    const ctx = new Context()
    await ctx.plugin(Storage)
    ctx.storage.backend.register('memory', new MemoryStorageBackend(new MemoryMediaPool()))
    const facility = new DomainFacility(ctx, { backend: 'memory', routes: {} })
    ctx.storage.mount('domain', facility)
    ctx.provide('storageDomain', facility)
    await ctx.plugin(FaberLoomAccess)
    const seeded = await ctx.faberloomAccess.grant(OWNER, { action: 'mail.send' })
    await grants(facility).delete(seeded.id)
    context = ctx
    const mirror = new FaberLoomMirror(ctx, { enabled: true, intervalMs: 10_000_000 })
    mirror.clearTimers()
    await mirror.sync()
    expect(fake.gateway.keyAccepted).toBe(true)
    expect(grants(facility).get('g1')).toMatchObject({ note: 'desde el entorno' })
  })

  it('schedules a debounced push from a local change', async () => {
    const { mirror, gateway, facility, ctx } = await harness(remoteDocument('timer'), 10)
    expect(mirror).toBeDefined()
    // The cycle that follows the local write, and only it, carries the new value.
    const before = gateway.received.length
    await grants(facility).put('g1', { id: 'g1', action: 'mail.send', note: 'empujado tras el retardo' })
    expect(gateway.received.length).toBe(before)
    ctx.emit('domain/changed', { domain: 'faberloom_grants', table: 'grants', key: 'g1', operation: 'put', value: grants(facility).get('g1') })
    const carries = (entry: unknown) => typeof entry === 'object' && entry !== null && JSON.stringify(entry).includes('empujado tras el retardo')
    const pushed = await waitFor(() => gateway.received.some(carries))
    expect(pushed).toBe(true)
    const body = gateway.received.filter(carries).at(-1) as FaberLoomMirrorDocument
    expect(body.domains['faberloom_grants']?.tables['grants']?.['g1']).toMatchObject({
      value: { note: 'empujado tras el retardo' },
    })
  })

  it('ignores a change of a domain the mirror does not carry', async () => {
    const { gateway, ctx, mirror } = await harness(remoteDocument('ajeno'))
    await mirror.sync()
    ctx.emit('domain/changed', { domain: 'not_a_product_domain', table: 'rows', key: 'k1', operation: 'put', value: {} })
    ctx.emit('domain/changed', { domain: 'faberloom_grants', table: '', key: '', operation: 'put', value: {} })
    await new Promise((resolve) => { setTimeout(resolve, 40) })
    // Neither event names a mirrored table, so no pushed document carries the
    // foreign domain and no cycle was scheduled by them.
    const pushedDomains = gateway.received.flatMap(entry => Object.keys((entry as FaberLoomMirrorDocument | undefined)?.domains ?? {}))
    expect(pushedDomains).not.toContain('not_a_product_domain')
  })

  it('logs and retries when the gateway does not answer', async () => {
    const { mirror } = await harness(remoteDocument('sin red'))
    await closeGateway?.()
    closeGateway = undefined
    expect(await mirror.sync()).toBeUndefined()
  })

  it('logs and retries when the gateway refuses or answers an unusable body', async () => {
    const { mirror, gateway } = await harness(remoteDocument('rechazado'))
    gateway.failure = { status: 401, text: 'token desconocido' }
    expect(await mirror.sync()).toBeUndefined()
    gateway.failure = { status: 200, text: JSON.stringify({ version: 99, platform: 'web', domains: {}, skills: {} }) }
    expect(await mirror.sync()).toBeUndefined()
    gateway.failure = { status: 200, text: 'no es json' }
    expect(await mirror.sync()).toBeUndefined()
  })

  it('answers a list that is not a list as empty, and an empty body as no document', async () => {
    const { mirror, gateway, facility } = await harness(remoteDocument('listas no listas'))
    gateway.extras = { applied: [{ domain: 1 }], skillsApplied: [7], skipped: ['no-es-objeto'] }
    await grants(facility).put('g1', { id: 'g1', action: 'mail.send', note: 'listas no listas' })
    const result = await mirror.sync()
    expect(result?.pushed).toEqual([])
    // The fake harness opens only the grants domain; the other declared domains
    // are reported as `domain-not-open` on every cycle and are not this case.
    expect(result?.skipped.filter(skip => skip.reason !== 'domain-not-open')).toEqual([])
    // A skip entry without its three strings is dropped too.
    gateway.extras = { applied: [], skillsApplied: [], skipped: [{ domain: 'x' }, { domain: 'd', table: 't', reason: 'r' }] }
    await grants(facility).put('g1', { id: 'g1', action: 'mail.send', note: 'listas no listas 2' })
    const second = await mirror.sync()
    expect(second?.skipped.filter(skip => skip.reason !== 'domain-not-open')).toEqual([{ domain: 'd', table: 't', reason: 'r' }])
    gateway.extras = { applied: 'no-es-lista', skillsApplied: 'no-es-lista', skipped: null }
    await grants(facility).put('g1', { id: 'g1', action: 'mail.send', note: 'listas no listas 3' })
    const third = await mirror.sync()
    expect(third?.pushed).toEqual([])
    gateway.extras = undefined
    gateway.failure = { status: 200, text: '' }
    expect(await mirror.sync()).toBeUndefined()
  })

  it('runs one cycle from the configured interval', async () => {
    const fake = await startGateway(remoteDocument('por intervalo'))
    closeGateway = fake.close
    const ctx = await bootContext()
    const mirror = new FaberLoomMirror(ctx, {
      enabled: true,
      gatewayUrl: fake.url,
      ownerId: OWNER,
      consoleToken: TOKEN,
      mirrorKey: KEY,
      intervalMs: 10,
      debounceMs: 10,
    })
    const cycled = await waitFor(() => fake.gateway.received.length > 0)
    expect(cycled).toBe(true)
    mirror.stop()
  })

  it('names an invalid skill bundle and refuses to write it', async () => {    const { mirror } = await harness(remoteDocument('skills'))
    const written = await mirror.writeMirroredSkills({ '../escape': '# Cuerpo\n', 'otro-ok': '# Cuerpo\n' })
    expect(written.written).toEqual(['otro-ok'])
    expect(written.skipped).toEqual([{ domain: 'skills', table: '../escape', reason: 'Error: invalid skill bundle name' }])
  })

  it('ignores a malformed entry in an answer list instead of failing the cycle', async () => {
    const { mirror, gateway, facility } = await harness(remoteDocument('listas'))
    gateway.extras = { applied: ['no-es-una-fila'], skillsApplied: [7], skipped: [{ domain: 'x' }] }
    await grants(facility).put('g1', { id: 'g1', action: 'mail.send', note: 'con listas rotas' })
    const result = await mirror.sync()
    // The pushed row is reported as addressed, but the malformed answer list
    // confirms nothing, so it stays pending for the next cycle.
    expect(result?.pushed).toEqual([])
    expect(result?.rows).toContainEqual({ domain: 'faberloom_grants', table: 'grants', key: 'g1' })
    expect(result?.skipped.filter(skip => skip.reason !== 'domain-not-open')).toEqual([])
  })

  it('logs a push the gateway refuses after a successful pull', async () => {
    const { mirror, gateway, facility } = await harness(remoteDocument('empuje rechazado'))
    await grants(facility).put('g1', { id: 'g1', action: 'mail.send', note: 'se rechazara' })
    gateway.applyFailure = { status: 500, text: 'el servidor del propietario fallo' }
    const result = await mirror.sync()
    expect(result?.pushed).toEqual([])
    expect(result?.rows).toContainEqual({ domain: 'faberloom_grants', table: 'grants', key: 'g1' })
    // The journal keeps the row pending, so the next cycle retries it.
    gateway.applyFailure = undefined
    const retried = await mirror.sync()
    expect(retried?.pushed).toEqual([{ domain: 'faberloom_grants', table: 'grants', key: 'g1' }])
  })

  it('reads the owner skill bundles, naming one without a SKILL.md', async () => {
    const { mirror } = await harness(remoteDocument('skills'))
    expect(mirror.skillsRoot()).toBe(join(home ?? '', 'skills'))
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(mirror.skillsRoot(), 'sin-cuerpo'), { recursive: true })
    mkdirSync(join(mirror.skillsRoot(), 'No-Es-Bundle'), { recursive: true })
    writeFileSync(join(mirror.skillsRoot(), 'flat.md'), '# Plano\n')
    const read = await mirror.readSkills()
    // A directory named outside the skill-name rule and a flat Markdown file are
    // not bundles, so neither is read or reported.
    expect(read.skills).toEqual({ 'informe-diario': '# Informe\n\nCuerpo.' })
    expect(read.skipped).toEqual([{ domain: 'skills', table: 'sin-cuerpo', reason: 'SKILL.md-not-readable' }])
    writeFileSync(join(mirror.skillsRoot(), 'sin-cuerpo', 'SKILL.md'), '# Cuerpo\n')
    expect(await mirror.readSkills()).toMatchObject({ skills: { 'sin-cuerpo': '# Cuerpo\n' } })
  })

  it('pushes a local skill bundle and skips a null entry in a written document', async () => {
    const { mirror, gateway } = await harness(remoteDocument('skills locales'))
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(join(mirror.skillsRoot(), 'propio'), { recursive: true })
    writeFileSync(join(mirror.skillsRoot(), 'propio', 'SKILL.md'), '# Propio\n')
    const pushed = await mirror.sync()
    expect(pushed?.skillsApplied).toContain('propio')
    expect(pushedDocuments(gateway).at(-1)?.skills).toEqual({ propio: '# Propio\n' })
    // A locally deleted bundle is not sent, and a null entry means the same.
    const written = await mirror.writeMirroredSkills({ 'solo-remoto': null, remoto: '# Remoto\n' })
    expect(written).toEqual({ written: ['remoto'], skipped: [] })
  })

  it('skips a null skill entry a pulled document carries', async () => {
    const document = remoteDocument('skill nula')
    const { mirror } = await harness({ ...document, skills: { ...document.skills, 'borrada': null } })
    const pulled = await mirror.sync()
    // The null entry is a deletion marker, not a bundle to write, so the mirror
    // reports the pulled bundle and never creates one named `borrada`.
    expect(pulled?.skillsApplied).toEqual(['informe-diario'])
    expect((await mirror.readSkills()).skills).toEqual({ 'informe-diario': '# Informe\n\nCuerpo.' })
  })

  it('re-sends a row the peer reported as applied but its own document does not hold', async () => {
    const empty = {
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'web' as const,
      domains: { faberloom_grants: { version: 1, tables: { grants: {} } } },
      skills: {},
    }
    const { mirror, gateway, facility } = await harness(empty)
    gateway.refuseMerge = true
    await grants(facility).put('g1', { id: 'g1', action: 'mail.send' })
    const first = await mirror.sync()
    expect(first?.pushed).toEqual([{ domain: 'faberloom_grants', table: 'grants', key: 'g1' }])
    // The peer confirmed the row and answered a document without it, so the
    // journal keeps it unconfirmed and the next cycle sends it again.
    const retried = await mirror.sync()
    expect(retried?.pushed).toEqual([{ domain: 'faberloom_grants', table: 'grants', key: 'g1' }])
  })

  it('reports a cycle that rejected with something that is not an error', async () => {
    const { mirror, ctx } = await harness(remoteDocument('rechazo raro'), 10)
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    vi.spyOn(mirror, 'sync').mockRejectedValue('no soy un error')
    ctx.emit('domain/changed', {
      domain: 'faberloom_grants',
      table: 'grants',
      key: 'g1',
      operation: 'put',
      value: { id: 'g1' },
    })
    const reported = await waitFor(() => warn.mock.calls.flat().join(' ').includes('no soy un error'))
    expect(reported).toBe(true)
    expect(mirror.status()['lastError']).toBe('no soy un error')
  })

  it('records a row both sides already agree on instead of sending it back', async () => {
    const fake = await startGateway(remoteDocument('de acuerdo'))
    closeGateway = fake.close
    home = mkdtempSync(join(tmpdir(), 'faberloom-mirror-agree-'))
    process.env.DSH_HOME = home
    const ctx = await bootContext()
    await ctx.plugin(FaberLoomAccess)
    const seeded = await ctx.faberloomAccess.grant(OWNER, { action: 'mail.send' })
    const table = ctx.storageDomain.get('faberloom_grants')?.table('grants') as unknown as {
      delete(key: string): Promise<boolean>
      put(key: string, value: unknown): Promise<void>
    }
    await table.delete(seeded.id)
    // La casa local ya tiene la misma fila que la remota y el journal esta
    // vacio: el ciclo anota el acuerdo en vez de devolver la fila al par.
    await table.put('g1', { id: 'g1', action: 'mail.send', note: 'de acuerdo' })
    const mirror = new FaberLoomMirror(ctx, {
      enabled: true,
      gatewayUrl: fake.url,
      ownerId: OWNER,
      consoleToken: TOKEN,
      mirrorKey: KEY,
      intervalMs: 10_000_000,
    })
    mirror.clearTimers()
    // El arranque lanza su propio ciclo; con la regla vieja esa fila se quedaba
    // como cambio local y volvia al par, con la nueva se anota el acuerdo.
    const cycled = await waitFor(() => mirror.status()['lastCycle'] !== null)
    expect(cycled).toBe(true)
    expect(mirror.status()['lastCycle']).toMatchObject({ applied: 1, keptLocal: 0, pushed: 0 })
    const idle = await mirror.sync()
    expect(idle?.pushed).toEqual([])
    expect(idle?.keptLocal).toEqual([])
    mirror.stop()
  })

  it('says it is off, and where its state lives, when it is not wired', async () => {
    home = mkdtempSync(join(tmpdir(), 'faberloom-mirror-off-'))
    process.env.DSH_HOME = home
    const ctx = await bootContext()
    const info = vi.spyOn(ctx.logger, 'info').mockImplementation(() => ctx.logger)
    const mirror = new FaberLoomMirror(ctx)
    mirror.clearTimers()
    // The state document is what an operator opens instead of guessing from the
    // panels, so it is written even when the mirror does nothing at all.
    await mirror.refreshStatus()
    const said = info.mock.calls.flat().join(' ')
    expect(said).toContain('mirror off (enabled is not true)')
    expect(said).toContain('state in')
    expect(mirror.status()).toMatchObject({
      enabled: false,
      active: false,
      missing: ['gatewayUrl', 'ownerId', 'consoleToken'],
      home,
    })
    // A wired mirror says the other word, so the line reads the real state.
    const wiredCtx = await bootContext()
    const wiredInfo = vi.spyOn(wiredCtx.logger, 'info').mockImplementation(() => wiredCtx.logger)
    const wired = new FaberLoomMirror(wiredCtx, {
      enabled: true,
      gatewayUrl: 'https://harness.example/_/harness/mirror',
      ownerId: OWNER,
      consoleToken: TOKEN,
      mirrorKey: KEY,
      intervalMs: 10_000_000,
    })
    wired.clearTimers()
    await wired.refreshStatus()
    expect(wired.status()).toMatchObject({ active: true })
    expect(wiredInfo.mock.calls.flat().join(' ')).toContain('mirror active')
  })

  it('runs without an internal credential, because the gateway validates the console token', async () => {
    const fake = await startGateway(remoteDocument('sin clave interna'))
    closeGateway = fake.close
    const ctx = await bootContext()
    const mirror = new FaberLoomMirror(ctx, {
      enabled: true,
      gatewayUrl: fake.url,
      ownerId: OWNER,
      consoleToken: TOKEN,
    })
    mirror.clearTimers()
    expect(mirror.status()).toMatchObject({ enabled: true, active: true, missing: [] })
    expect(await mirror.sync()).toBeDefined()
    mirror.stop()
  })

  it('reports which side it is and refuses a document of another format', async () => {
    home = mkdtempSync(join(tmpdir(), 'faberloom-mirror-side-'))
    process.env.DSH_HOME = home
    const configured = new FaberLoomMirror(await bootContext(), { platform: 'web' })
    configured.clearTimers()
    expect(configured.status()).toMatchObject({ platform: 'web' })
    const inherited = new FaberLoomMirror(await bootContext(), {})
    inherited.clearTimers()
    expect(inherited.status()).toMatchObject({ platform: 'desktop' })
    process.env.FABERLOOM_MIRROR_PLATFORM = 'web'
    try {
      const named = new FaberLoomMirror(await bootContext(), {})
      named.clearTimers()
      expect(named.status()).toMatchObject({ platform: 'web' })
      await expect(named.importDocument({ version: 99 })).rejects.toThrow(/mirror document refused/u)
      await expect(named.importDocument({
        version: FABERLOOM_MIRROR_FORMAT_VERSION,
        platform: 'web',
        domains: { faberloom_grants: { version: 1.5, tables: {} } },
        skills: {},
      })).rejects.toThrow(/domains.faberloom_grants.version/u)
      expect(await named.exportDocument()).toMatchObject({ document: { platform: 'web' } })
    } finally {
      delete process.env.FABERLOOM_MIRROR_PLATFORM
    }
  })

  it('re-sends a row the peer answered for but no longer holds', async () => {
    const { mirror, gateway } = await harness(remoteDocument('se cura'))
    // The peer answers for the domain without the row: it held the row once and
    // its medium no longer does, so the next cycle sends it again.
    gateway.document = {
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'web',
      domains: { faberloom_grants: { version: 1, tables: { grants: {} } } },
      skills: {},
    }
    const healed = await mirror.sync()
    expect(healed?.pushed).toEqual([{ domain: 'faberloom_grants', table: 'grants', key: 'g1' }])
    // A peer that does not answer for the domain at all proves nothing, so the
    // row is not re-sent from that silence.
    gateway.document = {
      version: FABERLOOM_MIRROR_FORMAT_VERSION,
      platform: 'web',
      domains: {},
      skills: {},
    }
    const silent = await mirror.sync()
    expect(silent?.pushed).toEqual([])
  })

  it('records a cycle it could not run and a state document it could not write', async () => {
    const fake = await startGateway(remoteDocument('medio roto'))
    closeGateway = fake.close
    const ctx = await bootContext()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    home = mkdtempSync(join(tmpdir(), 'faberloom-mirror-status-'))
    const storagesRoot = join(home, 'storages')
    mkdirSync(join(storagesRoot, 'faberloom_spaces.json'), { recursive: true })
    const mirror = new FaberLoomMirror(ctx, {
      enabled: true,
      gatewayUrl: fake.url,
      ownerId: OWNER,
      consoleToken: TOKEN,
      mirrorKey: KEY,
      intervalMs: 10,
      storagesRoot,
    })
    const failed = await waitFor(() => (mirror.status()['failedCycles'] as number) >= 1)
    expect(failed).toBe(true)
    expect(warn.mock.calls.flat().join(' ')).toContain('mirror cycle failed')
    // The reason survives in the state document, which is what makes a broken
    // medium a line an operator can read instead of a silent stop.
    expect(mirror.status()['lastError']).toMatch(/EISDIR|EPERM|EBADF|UNKNOWN/u)
    mirror.stop()
  })

  it('names a state document it cannot write', async () => {
    const fake = await startGateway(remoteDocument('estado imposible'))
    closeGateway = fake.close
    const ctx = await bootContext()
    const warn = vi.spyOn(ctx.logger, 'warn').mockImplementation(() => ctx.logger)
    home = mkdtempSync(join(tmpdir(), 'faberloom-mirror-status-file-'))
    const blocker = join(home, 'no-es-directorio')
    writeFileSync(blocker, 'x', 'utf8')
    const mirror = new FaberLoomMirror(ctx, {
      enabled: true,
      gatewayUrl: fake.url,
      ownerId: OWNER,
      consoleToken: TOKEN,
      mirrorKey: KEY,
      intervalMs: 10,
      storagesRoot: join(blocker, 'storages'),
    })
    await mirror.refreshStatus()
    const cycled = await waitFor(() => warn.mock.calls.flat().join(' ').includes('could not write its state'))
    expect(cycled).toBe(true)
    mirror.stop()
  })
})
