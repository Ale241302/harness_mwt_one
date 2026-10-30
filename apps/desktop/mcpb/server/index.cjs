#!/usr/bin/env node
/**
 * FaberLoom MCPB bridge.
 *
 * Claude Desktop starts this stdio server. It reads the bearer token that the
 * open FaberLoom desktop app already minted for MCP, forwards each JSON-RPC
 * message to the public gateway with that token, and writes the response back.
 * The gateway routes the token to the same desktop app; the local socket is not
 * required (Node on Windows does not expose the app's socket path reliably).
 *
 * The extension never contains a token: it reads the local token store on every
 * request, so a revoked or rotated token is picked up without repackaging.
 */
'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')

const HOME = (process.env.DSH_HOME || '').trim() || path.join(os.homedir(), '.dsh')
const STORE = path.join(HOME, 'storages', 'faberloom_mcp.json')
const GATEWAY = (process.env.FABERLOOM_GATEWAY_URL || 'https://harness.mwt.one').replace(/\/+$/u, '')
const TIMEOUT_MS = 120_000

/** Return the best live token from the open app's store, or undefined. */
function readToken() {
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(STORE, 'utf8'))
  } catch {
    return undefined
  }
  const table = parsed && parsed.tables && parsed.tables.tokens
  if (table === null || typeof table !== 'object') return undefined
  const live = Object.entries(table)
    .filter(([, record]) => record && record.revokedAt === null)
    .map(([token, record]) => ({ token, label: String(record.label || '') }))
  if (live.length === 0) return undefined
  const preferred = live.find(entry => /claude|mcpb|desktop/i.test(entry.label))
  return (preferred || live[0]).token
}

/** Relay one JSON-RPC body through the gateway. */
async function callGateway(body, token) {
  const response = await fetch(`${GATEWAY}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  return await response.text()
}

/** Render one JSON-RPC error line for a request we could not answer. */
function writeError(id, message) {
  process.stdout.write(`${JSON.stringify({
    jsonrpc: '2.0',
    id: id === undefined ? null : id,
    error: { code: -32000, message },
  })}\n`)
}

/** Answer one line from Claude Desktop. */
async function handleLine(line) {
  let parsed
  try {
    parsed = JSON.parse(line)
  } catch {
    writeError(null, 'parse error')
    return
  }
  const id = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.id : undefined
  const token = readToken()
  if (token === undefined) {
    writeError(id, 'Abrí FaberLoom en este equipo y creá un token MCP en Configuración → Conexiones → Servidor MCP.')
    return
  }
  try {
    const answer = await callGateway(line, token)
    if (answer.trim().length > 0) process.stdout.write(`${answer.trim()}\n`)
  } catch (error) {
    writeError(id, `No se pudo conectar con FaberLoom: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
let pending = 0
let inputClosed = false

lines.on('line', (line) => {
  const text = line.trim()
  if (text.length === 0) return
  pending += 1
  void handleLine(text).finally(() => {
    pending -= 1
    if (inputClosed && pending === 0) process.exit(0)
  })
})

lines.on('close', () => {
  inputClosed = true
  if (pending === 0) process.exit(0)
})

process.on('uncaughtException', (error) => {
  console.error(`faberloom-mcpb: ${error instanceof Error ? error.message : String(error)}`)
})
process.on('unhandledRejection', (error) => {
  console.error(`faberloom-mcpb: ${error instanceof Error ? error.message : String(error)}`)
})
