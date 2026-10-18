/**
 * Product MCP servers for the local harness.
 *
 * The shared gateway injects these servers per user through its own Cordis
 * patch. A local installation needs the same rows, from the environment the
 * child boots with rather than from the deployment's configuration:
 *
 * - SICOP is public and carries no identity, so it mounts unless the operator
 *   blanks its URL.
 * - The MWT.ONE and FaberLoom servers live on the deployment network. A local
 *   installation mounts one exactly when a reachable URL and a credential are
 *   both resolved, because a URL that only the container network can reach
 *   would leave a row that retries and never connects.
 * - MWT.ONE accepts two credentials. A public installation carries a
 *   `DeviceToken` in `MWT_MCP_AUTHORIZATION`: it identifies one user, binds to
 *   the machine that first uses it, and needs no shared secret. An installation
 *   inside the deployment network carries the shared gateway key instead, which
 *   the console MCP honours only for the header identity when the key matches.
 *   The device token wins when both resolve, so a copied deployment key never
 *   overrides the credential the machine was onboarded with.
 *
 * Secret values are never written here. Each header that carries one holds the
 * environment name, which the Cordis loader resolves from the child's process
 * environment when it mounts the row, exactly as the gateway's patch does.
 */

/** Name resolving the SICOP MCP URL, and the public URL used when it is unset. */
export const SICOP_MCP_URL_ENV = 'SICOP_MCP_URL'
export const DEFAULT_SICOP_MCP_URL = 'https://sicop.vlinte.work/mcp'

/** Names resolving the MWT.ONE MCP server: its URL, its device token, its gateway key. */
export const MWT_MCP_URL_ENV = 'MWT_MCP_URL'
export const MWT_MCP_AUTHORIZATION_ENV = 'MWT_MCP_AUTHORIZATION'
export const MWT_MCP_GATEWAY_KEY_ENV = 'MWT_MCP_GATEWAY_KEY'

/** Name resolving the stable id this installation presents as its device. */
export const MWT_MCP_DEVICE_ID_ENV = 'MWT_MCP_DEVICE_ID'

/** Comma-separated company keys this installation holds one credential per. */
export const MWT_MCP_COMPANIES_ENV = 'MWT_MCP_COMPANIES'

/** Prefix of the per-company credential variable: `MWT_MCP_TOKEN_<KEY>`. */
export const MWT_MCP_TOKEN_ENV_PREFIX = 'MWT_MCP_TOKEN_'

/** Names resolving the FaberLoom MCP server and the shared key its headers carry. */
export const FABERLOOM_MCP_URL_ENV = 'FABERLOOM_MCP_URL'
export const FABERLOOM_GATEWAY_KEY_ENV = 'FABERLOOM_GATEWAY_KEY'

/** Tool-call budget every product MCP server gets, matching the gateway's rows. */
const TOOL_CALL_TIMEOUT_MS = 120_000

/** One header value: a literal, or an environment name the loader resolves. */
type HeaderValue =
  | { readonly literal: string }
  | { readonly environment: string }

/** One product MCP server to mount in the local harness. */
interface ProductMcpServer {
  readonly id: string
  readonly serverName: string
  readonly url: string
  readonly headers: Readonly<Record<string, HeaderValue>>
}

/** Render one YAML single-quoted scalar. */
function yamlScalar(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

/** Render one header line, resolving an environment name through the loader. */
function headerLine(name: string, value: HeaderValue): string {
  const rendered = 'literal' in value ? yamlScalar(value.literal) : `!!js process.env.${value.environment} ?? ''`
  return `          ${name}: ${rendered}`
}

/**
 * Render one `insert` entry mounting a streamable-HTTP MCP server. The fields
 * match the rows the gateway's per-user patch carries, so the two deployments
 * mount the same servers with the same reconnect and timeout behavior.
 * @param server - the resolved server to mount.
 * @returns the YAML block for one patch entry.
 */
function renderEntry(server: ProductMcpServer): string {
  const headers = Object.entries(server.headers).map(([name, value]) => headerLine(name, value))
  return [
    `    - id: ${server.id}`,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    `        serverName: ${server.serverName}`,
    '        transport: streamable-http',
    `        url: ${yamlScalar(server.url)}`,
    ...(headers.length === 0 ? [] : ['        headers:', ...headers]),
    '        failOnStartupError: false',
    '        reconnect:',
    '          enabled: true',
    '          maxAttempts: 30',
    `        toolCallTimeoutMs: ${TOOL_CALL_TIMEOUT_MS}`,
  ].join('\n')
}

/** Whether the environment resolves a usable value for one name. */
function resolved(environment: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = environment[name]
  return value === undefined || value === '' ? undefined : value
}

/**
 * Environment name holding one company's credential.
 * @param key - the company key the console returned.
 * @returns the variable name, e.g. `MWT_MCP_TOKEN_SONDEL_S_A`.
 */
export function companyTokenEnv(key: string): string {
  return `${MWT_MCP_TOKEN_ENV_PREFIX}${key.toUpperCase().replaceAll('-', '_')}`
}

/** Company keys from a comma-separated value, keeping the variables safe. */
function parseCompanies(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(part => part.trim().toLowerCase())
    .filter(part => /^[a-z0-9-]{1,24}$/u.test(part))
}

/**
 * Resolve the product MCP servers a local installation mounts.
 * @param environment - the environment the child boots with, with the Harness-home `.env` layer under the launching environment.
 * @returns the servers to mount, in patch order.
 */
export function resolveProductMcpServers(
  environment: NodeJS.ProcessEnv,
  ownerId: string,
): ProductMcpServer[] {
  const servers: ProductMcpServer[] = []
  const mwtUrl = resolved(environment, MWT_MCP_URL_ENV)
  const mwtAuthorization = resolved(environment, MWT_MCP_AUTHORIZATION_ENV)
  const mwtDeviceId = resolved(environment, MWT_MCP_DEVICE_ID_ENV)
  // The console issues one credential per company this user can reach, each
  // bound to this device. The first company keeps the unsuffixed row so an
  // installation with one company reads the same as before.
  const companies = mwtUrl === undefined
    ? []
    : parseCompanies(environment[MWT_MCP_COMPANIES_ENV])
      .filter(key => resolved(environment, companyTokenEnv(key)) !== undefined)
  if (mwtUrl !== undefined && companies.length > 0) {
    for (const [position, key] of companies.entries()) {
      servers.push({
        id: position === 0 ? 'mcp-mwt' : `mcp-mwt-${key}`,
        serverName: position === 0 ? 'mwt' : `mwt-${key}`,
        url: mwtUrl,
        headers: {
          Authorization: { environment: companyTokenEnv(key) },
          ...(mwtDeviceId === undefined ? {} : { 'X-MWT-Device-Id': { literal: mwtDeviceId } }),
        },
      })
    }
  } else if (mwtUrl !== undefined && mwtAuthorization !== undefined) {
    servers.push({
      id: 'mcp-mwt',
      serverName: 'mwt',
      url: mwtUrl,
      headers: {
        Authorization: { environment: MWT_MCP_AUTHORIZATION_ENV },
        // The console binds the token to this id, not to the public address,
        // so a network change keeps working and a copied token does not.
        ...(mwtDeviceId === undefined ? {} : { 'X-MWT-Device-Id': { literal: mwtDeviceId } }),
      },
    })
  } else if (mwtUrl !== undefined && resolved(environment, MWT_MCP_GATEWAY_KEY_ENV) !== undefined) {
    servers.push({
      id: 'mcp-mwt',
      serverName: 'mwt',
      url: mwtUrl,
      headers: {
        'X-Forwarded-User-Email': { literal: ownerId },
        'X-MWT-Gateway-Key': { environment: MWT_MCP_GATEWAY_KEY_ENV },
        // The console MCP answers an OAuth challenge without a bearer value.
        Authorization: { literal: 'Bearer dsh-gateway' },
      },
    })
  }
  const sicopUrl = environment[SICOP_MCP_URL_ENV] ?? DEFAULT_SICOP_MCP_URL
  if (sicopUrl !== '') {
    servers.push({ id: 'mcp-sicop', serverName: 'sicop', url: sicopUrl, headers: {} })
  }
  const faberloomUrl = resolved(environment, FABERLOOM_MCP_URL_ENV)
  if (faberloomUrl !== undefined && resolved(environment, FABERLOOM_GATEWAY_KEY_ENV) !== undefined) {
    servers.push({
      id: 'mcp-faberloom',
      serverName: 'faberloom',
      url: faberloomUrl,
      headers: {
        'X-Faberloom-User-Id': { literal: ownerId },
        'X-Faberloom-Gateway-Key': { environment: FABERLOOM_GATEWAY_KEY_ENV },
      },
    })
  }
  return servers
}

/**
 * Render the `- insert:` entries the local harness mounts for the product's MCP
 * servers.
 * @param environment - the environment the child boots with, with the Harness-home `.env` layer under the launching environment.
 * @param ownerId - the signed-in owner the mounted servers act for.
 * @returns one rendered entry per mounted server, in patch order.
 */
export function renderProductMcpEntries(environment: NodeJS.ProcessEnv, ownerId: string): string[] {
  return resolveProductMcpServers(environment, ownerId).map(renderEntry)
}
