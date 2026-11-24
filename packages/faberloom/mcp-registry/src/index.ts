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
import { GOVERNED_RAW_TOOLS, isOwnerMailAction, mcpToolDecision } from './policy.ts'
import type {
  FaberLoomMcpRegistry,
  FaberLoomMcpServer,
  McpProbeFailure,
  McpSecretRef,
  McpTransport,
  McpTransportInput,
} from './types.ts'
// Type import from the tools package: it also declaration-merges `ctx.tools` onto Context.
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

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
 * Shortest budget a caller may request per call. A panel read passes a few
 * seconds; the floor keeps one network round trip from being cut before it can
 * answer, and no caller may raise the budget above the deployment timeout.
 */
export const MIN_TOOL_CALL_BUDGET_MS = 1_000

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

/** The server name encoded in one {@link keyOf} key. */
function serverNameOfKey(key: string): string {
  const separator = key.indexOf('\u0000')
  return separator === -1 ? key : key.slice(separator + 1)
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

/** Narrow one untrusted JSON value to a string-keyed object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The text blocks of one MCP `CallToolResult`, in server order. */
function toolResultTexts(result: unknown): string[] {
  if (!isRecord(result) || !Array.isArray(result['content'])) return []
  const texts: string[] = []
  for (const block of result['content']) {
    if (!isRecord(block) || block['type'] !== 'text' || typeof block['text'] !== 'string') continue
    texts.push(block['text'])
  }
  return texts
}

/**
 * The JSON payload of one successful MCP tool result: `structuredContent` when
 * the server sends it, else the first text block that parses as JSON, else the
 * whole result. A tool-level failure (`isError`) resolves as a thrown error
 * carrying the server's own words, because a caller cannot distinguish data
 * from an error payload by shape.
 * @param result - the raw `CallToolResult` from the live client.
 * @param toolName - the raw tool name, for the failure message.
 * @returns the untrusted payload the caller narrows.
 */
function toolPayload(result: unknown, toolName: string): unknown {
  if (toolResultFailed(result)) {
    const detail = toolResultTexts(result).join('\n').trim()
    throw new Error(`${PACKAGE}: the tool "${toolName}" reported a failure${detail.length === 0 ? '' : `: ${detail}`}`)
  }
  if (isRecord(result) && result['structuredContent'] !== undefined) return result['structuredContent']
  for (const text of toolResultTexts(result)) {
    try {
      return JSON.parse(text) as unknown
    } catch (_notJson) {
      // A non-JSON text block is not the payload; keep looking.
    }
  }
  return result
}

/** Whether one MCP result is the tool-level error variant. */
function toolResultFailed(result: unknown): boolean {
  return isRecord(result) && result['isError'] === true
}

/** Raised by {@link bounded} when a probe exceeds its timeout. */
class ProbeTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`${PACKAGE}: the probe did not complete within ${String(timeoutMs)}ms`)
    this.name = 'ProbeTimeoutError'
  }
}

/** Raised by {@link bounded} when a mounted tool call exceeds its timeout. */
class ToolCallTimeoutError extends Error {
  constructor(serverName: string, toolName: string, timeoutMs: number) {
    super(`${PACKAGE}: "${toolName}" on server "${serverName}" did not complete within ${String(timeoutMs)}ms`)
    this.name = 'ToolCallTimeoutError'
  }
}

/**
 * Await one activation, rejecting with the caller's timeout error when it exceeds the bound.
 * @param work - the activation to bound.
 * @param timeoutMs - milliseconds allowed before the activation is abandoned.
 * @param expired - builds the named error reported on expiry.
 * @returns the activation's result.
 */
async function bounded<T>(work: PromiseLike<T>, timeoutMs: number, expired: () => Error): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { reject(expired()) }, timeoutMs)
    timer.unref()
  })
  try {
    return await Promise.race([work, timeout])
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
  /** One live mount: the fiber that owns the client and the handle a host-side call uses. */
  interface MountedServer {
    readonly fiber: Fiber
    /** The live connection, read through the mount's own context. */
    readonly handle: () => McpClient.ConnectionHandle | undefined
  }
  /** Live MCP client fibers, keyed by owner and server name; only mount/unmount touch it. */
  const mounts = new Map<string, MountedServer>()
  /** The live connection each mounted fiber published, keyed by that fiber's context. */
  const mountHandles = new WeakMap<Context, McpClient.ConnectionHandle>()
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

  /**
   * The plugin a saved server mounts through: the same `mcp-client` body, with
   * its live connection handle captured for `callTool`. One stable callback per
   * registry keeps a single plugin runtime across mount/unmount cycles.
   */
  const mountPlugin = {
    name: 'faberloom-mcp-mount',
    inject: McpClient.inject,
    Config: McpClient.Config,
    async apply(inner: Context, clientConfig: McpClient.Config): Promise<void> {
      mountHandles.set(inner, await McpClient.mount(inner, clientConfig))
    },
  }

  /** Mount one enabled server's MCP client at the plugin's scope, awaiting its setup. */
  const mount = async (record: McpServerRecord): Promise<void> => {
    const key = keyOf(record.ownerId, record.name)
    let secrets: string[] = []
    try {
      const env = await resolveSecrets(record.name, record.env)
      const headers = await resolveSecrets(record.name, record.headers)
      secrets = [...Object.values(env), ...Object.values(headers)]
      const fiber = ctx.plugin(mountPlugin, transportConfig(record.name, record.transport, { env, headers }, false))
      // Publish the mount only after its tools are registered, so `mounted`
      // never claims a server whose client is still connecting.
      await fiber
      mounts.set(key, { fiber, handle: () => mountHandles.get(fiber.ctx) })
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
    const mounted = mounts.get(key)
    if (mounted === undefined) return
    mounts.delete(key)
    await mounted.fiber.dispose()
  }

  /** Dispose every live mount; the plugin fiber's teardown. */
  const closeMounts = async (): Promise<void> => {
    for (const mounted of mounts.values()) await mounted.fiber.dispose()
    mounts.clear()
    mountErrors.clear()
  }

  ctx.effect(() => () => closeMounts(), 'faberloom.mcpRegistryMounts')

  /**
   * The policy decision one public tool name takes, derived from the mounted
   * servers' documented `(serverName, rawName)` identity. The name is never
   * parsed back, because normalization or truncation may have changed its
   * suffix; a server this registry did not mount is not governed here.
   * @param publicName - the model-facing tool name of the call.
   * @returns the deny decision, or undefined when the call passes through.
   */
  const toolDecision = (publicName: string): PreToolDecision | undefined => {
    for (const key of mounts.keys()) {
      const serverName = serverNameOfKey(key)
      for (const rawName of GOVERNED_RAW_TOOLS) {
        if (McpClient.publicToolName(serverName, rawName) === publicName) return mcpToolDecision(rawName)
      }
    }
    return undefined
  }

  // Enforcement lives on the call, not on the model's tool list: sending and the
  // destructive mail tools stay visible and are refused here. The deployment's
  // `never` approval policy would turn an ask into an unreported rejection, so
  // the policy denies instead of attributing the refusal to a person.
  ctx.effect(
    () => ctx.on('tools/pre-execute', async (exec, next) => toolDecision(exec.name) ?? next()),
    'faberloom.mcpToolPolicy',
  )

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
        await bounded(
          scope.ctx.plugin(McpClient, transportConfig(serverName, transport, { env, headers }, true)),
          probeTimeoutMs,
          () => new ProbeTimeoutError(probeTimeoutMs),
        )
        const prefix = `mcp__${serverName}__`
        const schemas = ctx.tools.schemas(key)
          .filter(tool => tool.name.startsWith(prefix))
          .sort((left, right) => left.name.localeCompare(right.name))
        return {
          ok: true,
          tools: schemas.map(tool => tool.name),
          toolInfo: schemas.map(tool => ({ name: tool.name, description: tool.description })),
        }
      } catch (error) {
        return { ok: false, failure: classifyProbeFailure(error), detail: probeDetail(error, Object.values({ ...env, ...headers })) }
      } finally {
        await scope.dispose()
      }
    },

    async callTool(ownerId, serverName, toolName, args, budgetMs) {
      // The policy table decides before any transport work: a denied name never
      // reaches the server, and the reason is the one the model would read.
      const decision = mcpToolDecision(toolName)
      if (decision?.kind === 'deny') throw new Error(decision.reason)
      const mounted = mounts.get(keyOf(ownerId, serverName))
      const handle = mounted?.handle()
      if (handle === undefined) {
        throw new Error(`${PACKAGE}: server "${serverName}" is not mounted for this owner`)
      }
      // A caller may shorten the budget for a surface that must stay responsive;
      // the floor keeps one round trip from being cut before it can answer.
      const budget = budgetMs === undefined
        ? toolCallTimeoutMs
        : Math.min(toolCallTimeoutMs, Math.max(MIN_TOOL_CALL_BUDGET_MS, budgetMs))
      const result = await bounded(
        handle.callTool(toolName, args === undefined ? {} : { ...args }, { timeoutMs: budget }),
        budget,
        () => new ToolCallTimeoutError(serverName, toolName, budget),
      )
      return toolPayload(result, toolName)
    },

    async callOwnerAction(ownerId, serverName, toolName, args, budgetMs) {
      // The panel gesture is the approval; only the owner's mailbox actions
      // pass. The model-facing policy still refuses these names, so the same
      // tool cannot be reached by an agent turn.
      if (!isOwnerMailAction(toolName)) {
        throw new Error(`${PACKAGE}: "${toolName}" is not an owner mailbox action`)
      }
      const mounted = mounts.get(keyOf(ownerId, serverName))
      const handle = mounted?.handle()
      if (handle === undefined) {
        throw new Error(`${PACKAGE}: server "${serverName}" is not mounted for this owner`)
      }
      const budget = budgetMs === undefined
        ? toolCallTimeoutMs
        : Math.min(toolCallTimeoutMs, Math.max(MIN_TOOL_CALL_BUDGET_MS, budgetMs))
      const result = await bounded(
        handle.callTool(toolName, args === undefined ? {} : { ...args }, { timeoutMs: budget }),
        budget,
        () => new ToolCallTimeoutError(serverName, toolName, budget),
      )
      return toolPayload(result, toolName)
    },

    toolsFor(_ownerId, serverName) {
      // Public names carry the server name and then the raw tool name; the
      // public-name helper is the same one the MCP client registered with.
      const prefix = McpClient.publicToolName(serverName, '')
      return Promise.resolve(ctx.tools.schemas()
        .map(tool => tool.name)
        .filter(name => name.startsWith(prefix))
        .map(name => name.slice(prefix.length)))
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
      // The credential seam can arrive after this plugin; a later boot pass
      // must not mount the same record twice and leak its previous fiber.
      if (mounts.has(keyOf(record.ownerId, record.name))) continue
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
  // Mounting resolves the stored credential references. When the seam already
  // exists, mount before reporting ready; otherwise wait for it, because
  // booting without it failed every enabled server on process start and only a
  // later save put the server back.
  if (ctx.get('credentials') === undefined) {
    ctx.inject(['credentials'], () => boot())
  } else {
    await boot()
  }
}
