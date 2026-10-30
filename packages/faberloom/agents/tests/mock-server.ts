/**
 * Local models endpoint for the agents reconciliation specs: it replays one
 * scripted OpenAI-compatible body per request and records the paths it saw.
 */

import { createServer } from 'node:http'
import type { Server } from 'node:http'

/** One scripted models response, returned verbatim for the next request. */
export interface ScriptedModels {
  /** OpenAI-compatible body carrying a `data` array. */
  readonly body: string
  /** HTTP status; defaults to 200. */
  readonly status?: number
}

/** A running models endpoint and the request paths it received. */
export interface ModelsEndpoint {
  /** Origin to point the catalog's `origins` override at. */
  readonly origin: string
  /** Request paths received, in order. */
  readonly paths: string[]
}

const servers: Server[] = []

/** Close every endpoint opened since the last call; run from a spec's afterEach. */
export async function closeModelsEndpoints(): Promise<void> {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
}

/**
 * Start a models endpoint that replays one scripted body per request.
 * @param script - bodies to return, in order; a request past the script gets 500.
 * @returns the origin to mount, and the request paths received so far.
 */
export async function modelsEndpoint(script: ScriptedModels[]): Promise<ModelsEndpoint> {
  const paths: string[] = []
  const server = createServer((request, response) => {
    paths.push(request.url ?? '')
    request.resume()
    const next = script.shift()
    if (next === undefined) {
      response.writeHead(500).end('mock script exhausted')
      return
    }
    response.writeHead(next.status ?? 200, { 'content-type': 'application/json' }).end(next.body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('the models endpoint has no port')
  return { origin: `http://127.0.0.1:${String(address.port)}`, paths }
}
