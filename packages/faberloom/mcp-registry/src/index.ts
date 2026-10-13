/**
 * Native MCP server registry (`ctx.faberloomMcpRegistry`): the durable
 * per-owner configuration of a user's MCP servers, the isolated probe that
 * proves one works before it is saved, and the process-global mounting that
 * makes an enabled server's tools available to every session and Space without
 * a restart.
 *
 * A saved server is one record in the `faberloom_mcp_registry` domain. Every
 * header or environment value is a secret: `save` writes it to the credential
 * seam (`ctx.credentials`) under a reference derived from the owner, the server,
 * and the entry name, and the record keeps only the entry name and that
 * reference. `probe` mounts the server's MCP client inside an isolated scope,
 * lists the tools it registers, always disposes the scope, and reports `{ ok }`
 * or a named failure carrying the server's own words with every secret
 * redacted. An enabled server mounts in-process through the same
 * `ctx.plugin(mcp-client, ...)` mechanism ACP uses; the model therefore sees its
 * `mcp__<serverName>__<tool>` tools through the global tool registry on the next
 * request of any running session.
 *
 * @module @deepseek-ai/dsh-faberloom-mcp-registry
 */

import { validateHeaderName, validateHeaderValue } from 'node:http'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { mcpRegistryDomainSpec } from './spec.ts'
import type { McpServerRecord } from './spec.ts'
import type {
  FaberLoomMcpRegistry,
  FaberLoomMcpServer,
  McpProbeFailure,
  McpSecretRef,
  McpTransport,
  McpTransportInput,
} from './types.ts'
// Side-effect type import: declaration-merges `ctx.tools` onto Context.
import type {} from '@deepseek-ai/dsh-tools'

export type * from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'faberloom-mcp-registry'

/** Services this plugin requires before it can mount a server. */
export const inject = ['storageDomain', 'tools']

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The durable MCP server registry, its probe, and its process-global mounts. */
    faberloomMcpRegistry: FaberLoomMcpRegistry
  }
}

/** Diagnostics prefix shared by every error this package throws. */
const PACKAGE = 'faberloom-mcp-registry'

/** One entry the durable record keeps: the name and its credential reference. */
type SecretEntry = McpServerRecord['env'][number]

/** Longest server-derived error excerpt a probe detail carries; a bound on the emitted text, not a deployment choice. */
const MAX_DETAIL_CHARS = 300

/** Server names the MCP client accepts, kept below the public tool-name budget. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** Scheme prefix of the credential reference derived from an owner, server, and entry name. */
export const MCP_SECRET_REF_PREFIX = 'FABERLOOM_MCP_SECRET_'

/** Milliseconds a probe waits before it abandons the server, when the configuration names none. */
export const DEFAULT_PROBE_TIMEOUT_MS = 10_000

/** Milliseconds allowed per tool call on a mounted server, when the configuration names none. */
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000

/**
 * Deployment configuration for the MCP registry.
 */
export interface Config {
  /**
   * Milliseconds a probe waits for one server before it is abandoned. Defaults
   * to {@link DEFAULT_PROBE_TIMEOUT_MS}; validated to 1 through the maximum
   * timer delay so a probe cannot hold a surface open.
   */
  probeTimeoutMs?: number
  /**
   * Milliseconds allowed per tool call on a mounted server, passed to the MCP
   * client. Defaults to {@link DEFAULT_TOOL_CALL_TIMEOUT_MS}.
   */
  toolCallTimeoutMs?: number
}

/** Schemastery configuration; both timeouts are deployment choices. */
export const Config: z<Config> = z.object({
  probeTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS),
  toolCallTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS),
})

/** Encode one string's UTF-8 bytes as uppercase hexadecimal, so no two parts can collide in a reference. */
function hexOf(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex').toUpperCase()
}

/**
 * The credential reference under which one header or environment value of one
 * server is stored. The reference is derived solely from the owner identity, the
 * server name, and the entry name, and is always a valid POSIX
 * environment-variable name ({@link MCP_SECRET_REF_PREFIX} followed by the
 * hexadecimal UTF-8 encodings of the three parts), so distinct entries can never
 * collide on one reference.
 * @param ownerId - the identity that owns the server.
 * @param serverName - the server's local name.
 * @param entryName - the environment-variable or header name.
 * @returns the branded reference.
 */
export function mcpSecretCredentialRef(ownerId: string, serverName: string, entryName: string): CredentialRef {
  return credentialRef(`${MCP_SECRET_REF_PREFIX}${hexOf(ownerId)}_${hexOf(serverName)}_${hexOf(entryName)}`)
}

/** The table key for one owner and server name. */
function keyOf(ownerId: string, name: string): string {
  return `${ownerId}\u0000${name}`
}

/** Require a server name the MCP client's namespace grammar accepts. */
function validateServerName(name: string): string {
  if (!SERVER_NAME_PATTERN.test(name)) {
    throw new Error(`${PACKAGE}: server name "${name}" must match ${String(SERVER_NAME_PATTERN)}`)
  }
  return name
}

/** Require the absolute HTTP(S) URL the Streamable HTTP transport needs. */
function assertHttpUrl(value: string): void {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
  } catch (_invalidUrl) {
    throw new Error(`${PACKAGE}: url "${value}" must be an absolute HTTP(S) URL`)
  }
}

/** Validate one header or environment entry's name and value at the caller boundary. */
function validateSecretEntry(kind: 'environment' | 'header', name: string, value: string): void {
  if (kind === 'header') {
    try {
      validateHeaderName(name)
      validateHeaderValue(name, value)
    } catch (_invalidHeader) {
      throw new Error(`${PACKAGE}: header entry "${name}" is not a valid HTTP header name and value`)
    }
    return
  }
  if (name.length === 0 || name.includes('=') || name.includes('\0') || value.includes('\0')) {
    throw new Error(`${PACKAGE}: environment entry "${name}" is not a valid environment-variable name and value`)
  }
}

/** Validate and order one caller-supplied secret map into the record the transport receives. */
function validatedSecrets(kind: 'environment' | 'header', values: Readonly<Record<string, string>>): Record<string, string> {
  // A null prototype keeps a name such as "__proto__" as data.
  const result = Object.create(null) as Record<string, string>
  for (const [name, value] of Object.entries(values).sort(([left], [right]) => left.localeCompare(right))) {
    validateSecretEntry(kind, name, value)
    result[name] = value
  }
  return result
}

/** Resolve one caller transport input into the durable transport, rejecting an unusable one. */
function normalizeTransport(input: McpTransportInput): McpServerRecord['transport'] {
  if (input.transport === 'stdio') {
    if (input.command.length === 0) throw new Error(`${PACKAGE}: a stdio server needs a non-empty command`)
    return { transport: 'stdio', command: input.command, args: [...input.args ?? []], cwd: input.cwd ?? '' }
  }
  assertHttpUrl(input.url)
  return { transport: 'streamable-http', url: input.url }
}

/** The deepest message in an error's `cause` chain, or the rendered value when it is not an error. */
function deepestMessage(error: unknown): string {
  let message = String(error)
  let current: unknown = error
  while (current instanceof Error) {
    message = current.message
    current = current.cause
  }
  return message
}

/** The first HTTP status named in an error's `cause` chain, or `undefined` when none is. */
function httpStatusOf(error: unknown): number | undefined {
  let current: unknown = error
  while (current instanceof Error) {
    const match = /HTTP (\d{3})/.exec(current.message)
    if (match !== null) return Number(match[0].slice(5))
    current = current.cause
  }
  return undefined
}

/** Whether a message names a failure to reach the endpoint at all. */
function isNetworkFailure(message: string): boolean {
  return /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed|other side closed/i.test(message)
}

/** Render one failed probe's detail: the deepest message, every secret redacted, bounded. */
function probeDetail(error: unknown, secrets: readonly string[]): string {
  let detail = deepestMessage(error)
  for (const secret of secrets) {
    if (secret.length > 0) detail = detail.split(secret).join('[redacted]')
  }
  return detail.slice(0, MAX_DETAIL_CHARS)
}

/** Classify one failed probe into the named kind it reports. */
function classifyProbeFailure(error: unknown): McpProbeFailure {
  if (error instanceof ProbeTimeoutError) return 'unreachable'
  const status = httpStatusOf(error)
  if (status === 401 || status === 403) return 'bad-credential'
  if (status !== undefined) return 'protocol'
  return isNetworkFailure(deepestMessage(error)) ? 'unreachable' : 'protocol'
}

/** Raised by {@link bounded} when a probe exceeds its timeout. */
class ProbeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`${PACKAGE}: the probe did not complete within ${String(timeoutMs)}ms`)
    this.name = 'ProbeTimeoutError'
  }
}

/**
 * Await one activation, rejecting with {@link ProbeTimeoutError} when it exceeds the bound.
 * @param work - the activation to bound.
 * @param timeoutMs - milliseconds allowed before the activation is abandoned.
 * @returns the activation's result.
 */
async function bounded<T>(work: PromiseLike<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(new ProbeTimeoutError(timeoutMs)) }, timeoutMs)
    timer.unref()
  })
  try {
    return await Promise.race([work, expired])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Build one registry over the plugin's own context. Every mount fiber and the
 * domain-closing effect anchor on `ctx` (the plugin's fiber), so a caller that
 * reads the service from a descendant context can never move the mount or the
 * teardown to itself.
 * @param ctx - the plugin's Cordis context.
 * @param config - validated deployment configuration.
 * @returns the published service and the boot step that mounts the enabled records.
 */
function createRegistry(ctx: Context, config: Config): { service: FaberLoomMcpRegistry; boot: () => Promise<void> } {
  const probeTimeoutMs = config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
  const toolCallTimeoutMs = config.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS
  /** Live MCP client fibers, keyed by owner and server name; only mount/unmount touch it. */
  const mounts = new Map<string, Fiber>()
  /** The redacted reason each server's last mount attempt failed, keyed like `mounts`. */
  const mountErrors = new Map<string, string>()
  let domainPromise: Promise<Domain<typeof mcpRegistryDomainSpec>> | undefined

  /** Open the MCP-registry domain once and keep its handle, closing it with the plugin. */
  const domain = (): Promise<Domain<typeof mcpRegistryDomainSpec>> => {
    domainPromise ??= (async () => {
      const opened = await ctx.storageDomain.open(mcpRegistryDomainSpec)
      ctx.effect(() => () => opened.close(), 'faberloom.mcpRegistryDomainClose')
      return opened
    })()
    return domainPromise
  }

  /** The saved-server table handle. */
  const servers = async (): Promise<KvTable<string, McpServerRecord>> => (await domain()).table('servers')

  /** Project one record's entries, each carrying whether the seam holds a value. */
  const secretViews = async (entries: readonly SecretEntry[]): Promise<readonly McpSecretRef[]> => {
    const credentials = ctx.get('credentials')
    const views: McpSecretRef[] = []
    for (const entry of entries) {
      const info = credentials === undefined ? undefined : await credentials.describe(credentialRef(entry.credentialRef))
      views.push({ name: entry.name, credentialRef: entry.credentialRef, present: info?.configured ?? false })
    }
    return views
  }

  /** Project one durable record into the caller-facing server. */
  const view = async (record: McpServerRecord): Promise<FaberLoomMcpServer> => ({
    name: record.name,
    transport: record.transport,
    env: await secretViews(record.env),
    headers: await secretViews(record.headers),
    enabled: record.enabled,
    mounted: mounts.has(keyOf(record.ownerId, record.name)),
    error: mountErrors.get(keyOf(record.ownerId, record.name)) ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  })

  /** Write one map of secret values to the seam and return the entries the record keeps. */
  const storeSecrets = async (
    ownerId: string,
    serverName: string,
    kind: 'environment' | 'header',
    values: Readonly<Record<string, string>>,
  ): Promise<SecretEntry[]> => {
    const secrets = validatedSecrets(kind, values)
    if (Object.keys(secrets).length === 0) return []
    const credentials = ctx.get('credentials')
    if (credentials === undefined) {
      throw new Error(`${PACKAGE}: no credential service is mounted, so ${kind} values for server "${serverName}" cannot be stored outside the record`)
    }
    const entries: SecretEntry[] = []
    for (const [entryName, value] of Object.entries(secrets)) {
      const ref = mcpSecretCredentialRef(ownerId, serverName, entryName)
      await credentials.set(ref, value)
      entries.push({ name: entryName, credentialRef: ref })
    }
    return entries
  }

  /** Resolve one server's entry references into the values the transport receives. */
  const resolveSecrets = async (serverName: string, entries: readonly SecretEntry[]): Promise<Record<string, string>> => {
    const values = Object.create(null) as Record<string, string>
    if (entries.length === 0) return values
    const credentials = ctx.get('credentials')
    for (const entry of entries) {
      const hit = credentials === undefined ? undefined : await credentials.resolve(credentialRef(entry.credentialRef))
      if (hit === undefined) {
        throw new Error(`${PACKAGE}: the credential "${entry.credentialRef}" for server "${serverName}" is not configured`)
      }
      values[entry.name] = hit.value
    }
    return values
  }

  /** Unset the seam values one list of entries names, tolerating a composition without a seam. */
  const unsetSecrets = async (entries: readonly SecretEntry[]): Promise<void> => {
    for (const entry of entries) {
      await ctx.get('credentials')?.unset(credentialRef(entry.credentialRef))
    }
  }

  /** Build the MCP client configuration for one server, filling its defaults. */
  const transportConfig = (
    serverName: string,
    transport: McpTransport,
    secrets: { env: Record<string, string>; headers: Record<string, string> },
    failOnStartupError: boolean,
  ): McpClient.Config => {
    if (transport.transport === 'stdio') {
      return McpClient.Config({
        transport: 'stdio',
        serverName,
        command: transport.command,
        args: [...transport.args],
        cwd: transport.cwd,
        env: secrets.env,
        toolCallTimeoutMs,
        failOnStartupError,
      })
    }
    return McpClient.Config({
      transport: 'streamable-http',
      serverName,
      url: transport.url,
      headers: secrets.headers,
      toolCallTimeoutMs,
      failOnStartupError,
    })
  }

  /** Mount one enabled server's MCP client at the plugin's scope, awaiting its setup. */
  const mount = async (record: McpServerRecord): Promise<void> => {
    const key = keyOf(record.ownerId, record.name)
    let secrets: string[] = []
    try {
      const env = await resolveSecrets(record.name, record.env)
      const headers = await resolveSecrets(record.name, record.headers)
      secrets = [...Object.values(env), ...Object.values(headers)]
      const fiber = ctx.plugin(McpClient, transportConfig(record.name, record.transport, { env, headers }, false))
      mounts.set(key, fiber)
      try {
        await fiber
      } catch (error) {
        mounts.delete(key)
        throw error
      }
      mountErrors.delete(key)
    } catch (error) {
      // Failures stay visible per server: a later `list` reports this server as
      // unproven with the redacted reason, and never as working.
      mountErrors.set(key, probeDetail(error, secrets))
      throw error
    }
  }

  /** Dispose one server's mount, when it has one. */
  const unmount = async (key: string): Promise<void> => {
    mountErrors.delete(key)
    const fiber = mounts.get(key)
    if (fiber === undefined) return
    mounts.delete(key)
    await fiber.dispose()
  }

  /** Dispose every live mount; the plugin fiber's teardown. */
  const closeMounts = async (): Promise<void> => {
    for (const fiber of mounts.values()) await fiber.dispose()
    mounts.clear()
    mountErrors.clear()
  }

  ctx.effect(() => () => closeMounts(), 'faberloom.mcpRegistryMounts')

  /** Drop the stored credentials of entries a save replaced. */
  const dropSecrets = async (
    previous: McpServerRecord | undefined,
    env: readonly SecretEntry[],
    headers: readonly SecretEntry[],
  ): Promise<void> => {
    if (previous === undefined) return
    const kept = new Set([...env, ...headers].map(entry => entry.credentialRef))
    await unsetSecrets([...previous.env, ...previous.headers].filter(entry => !kept.has(entry.credentialRef)))
  }

  const service: FaberLoomMcpRegistry = {
    async list(ownerId) {
      const rows: FaberLoomMcpServer[] = []
      for (const [, record] of (await servers()).entries()) {
        if (record.ownerId !== ownerId) continue
        rows.push(await view(record))
      }
      return rows.sort((left, right) => left.name.localeCompare(right.name))
    },

    async save(ownerId, input) {
      const table = await servers()
      const serverName = validateServerName(input.name)
      const key = keyOf(ownerId, serverName)
      const previous = table.get(key)
      const transport = normalizeTransport(input.transport)
      const env = input.env === undefined ? previous?.env ?? [] : await storeSecrets(ownerId, serverName, 'environment', input.env)
      const headers = input.headers === undefined ? previous?.headers ?? [] : await storeSecrets(ownerId, serverName, 'header', input.headers)
      const now = new Date().toISOString()
      const record: McpServerRecord = {
        ownerId,
        name: serverName,
        transport,
        env,
        headers,
        enabled: input.enabled ?? previous?.enabled ?? true,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
      }
      await unmount(key)
      await table.put(key, record)
      await dropSecrets(previous, env, headers)
      if (record.enabled) await mount(record)
      return await view(record)
    },

    async remove(ownerId, serverName) {
      const table = await servers()
      const key = keyOf(ownerId, serverName)
      const record = table.get(key)
      if (record === undefined) return false
      await unmount(key)
      await table.delete(key)
      await unsetSecrets([...record.env, ...record.headers])
      return true
    },

    async probe(input) {
      const serverName = validateServerName(input.name)
      const transport = normalizeTransport(input.transport)
      const env = validatedSecrets('environment', input.env ?? {})
      const headers = validatedSecrets('header', input.headers ?? {})
      const key: ScopeKey = {}
      const scope = createScope(ctx, key)
      try {
        await bounded(scope.ctx.plugin(McpClient, transportConfig(serverName, transport, { env, headers }, true)), probeTimeoutMs)
        const prefix = `mcp__${serverName}__`
        const tools = ctx.tools.schemas(key)
          .map(tool => tool.name)
          .filter(toolName => toolName.startsWith(prefix))
          .sort()
        return { ok: true, tools }
      } catch (error) {
        return { ok: false, failure: classifyProbeFailure(error), detail: probeDetail(error, Object.values({ ...env, ...headers })) }
      } finally {
        await scope.dispose()
      }
    },
  }

  /**
   * Mount every enabled saved server, logging and skipping one that cannot
   * mount (an unconfigured credential, or a name another owner already
   * mounted); the record stays so a later save or boot retries.
   */
  const boot = async (): Promise<void> => {
    for (const [, record] of (await servers()).entries()) {
      if (!record.enabled) continue
      try {
        await mount(record)
      } catch (error) {
        ctx.logger.error(`${PACKAGE}: mounting the saved MCP server "${record.name}" failed`)
        ctx.logger.error(error)
      }
    }
  }

  return { service, boot }
}

/**
 * Publish the MCP registry as `ctx.faberloomMcpRegistry` and mount every enabled
 * saved server before the plugin reports ready, so its tools exist in the global
 * registry before the first request.
 * @param ctx - the plugin's Cordis context.
 * @param config - validated plugin configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const { service, boot } = createRegistry(ctx, config)
  ctx.provide('faberloomMcpRegistry', service)
  await boot()
}
