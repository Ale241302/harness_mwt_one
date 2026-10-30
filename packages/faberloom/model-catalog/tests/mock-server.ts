/**
 * Local models endpoint for the catalog specs: it records every request it
 * receives and replays one scripted response per request.
 */

import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/** One scripted response the mock server returns for the next request. */
export interface ModelsResponse {
  /** HTTP status; defaults to 200. */
  status?: number
  /** Response body, returned verbatim. */
  body: string
  /** Response content type; defaults to `application/json`. */
  contentType?: string
}

/** One recorded models request. */
export interface RecordedRequest {
  method: string
  url: string
  headers: IncomingMessage['headers']
}

export interface ModelsServer {
  /** Origin to point a provider override at. */
  origin: string
  /** Requests received, in order. */
  requests: RecordedRequest[]
  script: ModelsResponse[]
}

const servers: Server[] = []

/** Close every server opened since the last call; run from each spec's afterEach. */
export async function closeModelsServers(): Promise<void> {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
}

/** A models endpoint that replays `script` per request. */
export async function modelsServer(script: ModelsResponse[]): Promise<ModelsServer> {
  const requests: RecordedRequest[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    requests.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers })
    request.resume()
    const next = script.shift()
    if (next === undefined) {
      response.writeHead(500).end('mock script exhausted')
      return
    }
    response.writeHead(next.status ?? 200, { 'content-type': next.contentType ?? 'application/json' }).end(next.body)
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no port')
  return {
    origin: `http://127.0.0.1:${String(address.port)}`,
    requests,
    script,
  }
}
