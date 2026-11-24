/**
 * Executable entry and configuration-file boundary for an external MCP client.
 *
 * The client launches `node lib/startup.js --config <file>`; this module reads
 * the JSON configuration, opens the upstream connections, and serves stdio.
 * Diagnostics go to stderr because stdout carries the MCP protocol.
 * @module @deepseek-ai/dsh-mcp-codemode/startup
 */

import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { messageOf } from './errors.ts'
import { createCodeModeFacade } from './index.ts'
import { createCodeModeServer } from './server.ts'
import type { FacadeConfig, UpstreamConfig } from './types.ts'

/** Configured server-name grammar, shared with the harness MCP client. */
const SERVER_NAME = /^[A-Za-z0-9_-]{1,32}$/

/** Printed by `--help`; the only stdout write outside the protocol. */
export const USAGE = `Usage: node lib/startup.js --config <file>

The config file is JSON:
{
  "upstreams": [
    { "serverName": "mwt", "transport": "http", "url": "https://…/mcp", "headers": { "Authorization": "Bearer …" } },
    { "serverName": "local", "transport": "stdio", "command": "node", "args": ["server.js"] }
  ],
  "timeoutMs": 60000
}
`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object`)
  return value
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${path} must be a non-empty string`)
  return value
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) throw new Error(`${path} must be an array of strings`)
  return value as string[]
}

function stringMap(value: unknown, path: string): Record<string, string> {
  const record = requireRecord(value, path)
  const entries: [string, string][] = []
  for (const [key, entry] of Object.entries(record)) {
    if (typeof entry !== 'string') throw new Error(`${path}.${key} must be a string`)
    entries.push([key, entry])
  }
  return Object.fromEntries(entries)
}

function parseUpstream(value: unknown, path: string): UpstreamConfig {
  const record = requireRecord(value, path)
  const serverName = requireString(record.serverName, `${path}.serverName`)
  if (!SERVER_NAME.test(serverName)) throw new Error(`${path}.serverName must match ${String(SERVER_NAME)}`)
  const transport = record.transport
  if (transport === 'stdio') {
    return {
      serverName,
      transport,
      command: requireString(record.command, `${path}.command`),
      ...record.args === undefined ? {} : { args: stringArray(record.args, `${path}.args`) },
      ...record.env === undefined ? {} : { env: stringMap(record.env, `${path}.env`) },
      ...record.cwd === undefined ? {} : { cwd: requireString(record.cwd, `${path}.cwd`) },
    }
  }
  if (transport === 'http') {
    const url = requireString(record.url, `${path}.url`)
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch (error: unknown) {
      throw new Error(`${path}.url is not a valid URL: ${messageOf(error)}`)
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error(`${path}.url must use http or https`)
    return {
      serverName,
      transport,
      url,
      ...record.headers === undefined ? {} : { headers: stringMap(record.headers, `${path}.headers`) },
    }
  }
  throw new Error(`${path}.transport must be "stdio" or "http"`)
}

function optionalPositiveInteger(record: Record<string, unknown>, key: string, path: string): number | undefined {
  const value = record[key]
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${path}.${key} must be a positive integer`)
  return value as number
}

/**
 * Validate one parsed configuration document. Values are checked here because
 * the file is written by a human and read by a process, not by TypeScript.
 * @param value - Parsed JSON from the config file.
 * @returns A facade configuration with every declared field validated.
 */
export function parseFacadeConfig(value: unknown): FacadeConfig {
  const record = requireRecord(value, 'config')
  const upstreams = record.upstreams
  if (!Array.isArray(upstreams) || upstreams.length === 0) throw new Error('config.upstreams must be a non-empty array')
  const names = new Set<string>()
  const parsed = upstreams.map((entry: unknown, index: number) => {
    const upstream = parseUpstream(entry, `config.upstreams[${String(index)}]`)
    if (names.has(upstream.serverName)) throw new Error(`config.upstreams[${String(index)}].serverName "${upstream.serverName}" is duplicated`)
    names.add(upstream.serverName)
    return upstream
  })
  const timeoutMs = optionalPositiveInteger(record, 'timeoutMs', 'config')
  const maxOutputBytes = optionalPositiveInteger(record, 'maxOutputBytes', 'config')
  const maxUpstreamResultBytes = optionalPositiveInteger(record, 'maxUpstreamResultBytes', 'config')
  const maxCatalogBytes = optionalPositiveInteger(record, 'maxCatalogBytes', 'config')
  const maxPendingCalls = optionalPositiveInteger(record, 'maxPendingCalls', 'config')
  const maxOldGenerationSizeMb = optionalPositiveInteger(record, 'maxOldGenerationSizeMb', 'config')
  return {
    upstreams: parsed,
    ...timeoutMs === undefined ? {} : { timeoutMs },
    ...maxOutputBytes === undefined ? {} : { maxOutputBytes },
    ...maxUpstreamResultBytes === undefined ? {} : { maxUpstreamResultBytes },
    ...maxCatalogBytes === undefined ? {} : { maxCatalogBytes },
    ...maxPendingCalls === undefined ? {} : { maxPendingCalls },
    ...maxOldGenerationSizeMb === undefined ? {} : { maxOldGenerationSizeMb },
    ...record.nodeExecutable === undefined ? {} : { nodeExecutable: requireString(record.nodeExecutable, 'config.nodeExecutable') },
    ...record.cwd === undefined ? {} : { cwd: requireString(record.cwd, 'config.cwd') },
  }
}

/**
 * Read and validate one configuration file.
 * @param path - Absolute or relative path to the JSON document.
 * @returns The validated facade configuration.
 */
export function loadFacadeConfigFile(path: string): FacadeConfig {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error: unknown) {
    throw new Error(`mcp-codemode: cannot read config ${path}: ${messageOf(error)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error: unknown) {
    throw new Error(`mcp-codemode: config ${path} is not valid JSON: ${messageOf(error)}`)
  }
  return parseFacadeConfig(parsed)
}

/** Parsed command line of the executable entry. */
export type StartupArgs = { readonly help: true } | { readonly help: false; readonly configPath: string }

/**
 * Parse `--config <file>`, `--config=<file>`, `-h`, and `--help`.
 * @param argv - Arguments after the script path.
 * @returns The requested action.
 */
export function parseStartupArgs(argv: readonly string[]): StartupArgs {
  let configPath: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === undefined) continue
    if (argument === '--help' || argument === '-h') return { help: true }
    if (argument.startsWith('--config=')) {
      configPath = requireString(argument.slice('--config='.length), '--config')
      continue
    }
    if (argument === '--config') {
      const value = argv[index + 1]
      configPath = requireString(value, '--config')
      index += 1
      continue
    }
    throw new Error(`unrecognized argument ${JSON.stringify(argument)}\n\n${USAGE}`)
  }
  if (configPath === undefined) throw new Error(`--config is required\n\n${USAGE}`)
  return { help: false, configPath }
}

/**
 * Decide whether this module is the process entry rather than an import.
 * @param moduleUrl - `import.meta.url` of this module.
 * @param entry - `process.argv[1]`, or `undefined` under a non-file launcher.
 * @returns Whether the entry path resolves to this module.
 */
export function isProcessEntry(moduleUrl: string, entry: string | undefined): boolean {
  if (entry === undefined) return false
  try {
    return realpathSync.native(entry) === realpathSync.native(fileURLToPath(moduleUrl))
  } catch (error: unknown) {
    // A non-resolvable entry path means this module was imported, not launched.
    void error
    return false
  }
}

/**
 * Serve the facade over stdio until the client disconnects.
 * @param argv - Arguments after the script path.
 * @returns `0` after a clean shutdown, `1` when startup or configuration failed.
 */
export async function main(argv: readonly string[]): Promise<number> {
  try {
    const args = parseStartupArgs(argv)
    if (args.help) {
      process.stdout.write(USAGE)
      return 0
    }
    const config = loadFacadeConfigFile(args.configPath)
    const facade = await createCodeModeFacade(config)
    const handle = serveStdio(() => createCodeModeServer(facade), {
      onerror: (error: Error) => { process.stderr.write(`mcp-codemode: ${error.message}\n`) },
    })
    const finished = Promise.withResolvers<void>()
    let closing = false
    const shutdown = (): void => {
      if (closing) return
      closing = true
      void handle.close()
        .then(() => facade.close(), () => facade.close())
        .then(() => { finished.resolve() })
    }
    process.once('SIGINT', shutdown)
    process.once('SIGTERM', shutdown)
    process.stdin.once('end', shutdown)
    process.stdin.once('close', shutdown)
    await finished.promise
    return 0
  } catch (error: unknown) {
    process.stderr.write(`mcp-codemode: ${messageOf(error)}\n`)
    return 1
  }
}

/* v8 ignore next 3 -- the guard is true only when this file is the process entry; main() is covered directly. */
if (isProcessEntry(import.meta.url, process.argv[1])) {
  void main(process.argv.slice(2)).then((code) => { process.exitCode = code })
}
