/**
 * Source of the program process. The facade spawns `node -e CHILD_BOOTSTRAP`
 * with an empty environment and one IPC channel; this module ships no runtime
 * import of its own, so the string is the complete child program.
 *
 * Protocol, parent to child: `boot` once (`code`, `bindings`, `maxOutputBytes`)
 * and one `reply` per `call`. Child to parent: `call`, `log`, and one terminal
 * `done`. The child wipes `process.env` before running the program so user code
 * never observes ambient credentials, including the Windows machine defaults
 * Node adds to an empty spawn environment.
 * @module @deepseek-ai/dsh-mcp-codemode/src/child
 */

/**
 * Program executed by the child process. The program is wrapped in an async
 * function whose parameters are the `tools` namespace and a console shim, so
 * the model writes the body exactly as it would for the harness `run_code` tool.
 */
export const CHILD_BOOTSTRAP = String.raw`
'use strict'
const { stripTypeScriptTypes } = require('node:module')
const { inspect } = require('node:util')

const NEWLINE = String.fromCharCode(10)
const ERROR_PREFIX = '[error] '
const MAX_INSPECT_DEPTH = 4
const MAX_INSPECT_STRING = 10000

let boot = null
let settled = false
let nextId = 0
let logBytes = 0
const pending = new Map()

function messageOf(error) {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch (nested) {
    return '[unrenderable error]'
  }
}

function send(frame, callback) {
  if (typeof process.send !== 'function') {
    if (callback) callback(new Error('no IPC channel'))
    return
  }
  try {
    process.send(frame, callback)
  } catch (error) {
    if (callback) callback(error)
  }
}

function finish(frame) {
  if (settled) return
  settled = true
  for (const entry of pending.values()) entry.reject(new Error('program run is over'))
  pending.clear()
  send(frame, () => { process.exit(0) })
}

function fail(kind, message) {
  finish({ type: 'done', error: { kind: kind, message: message } })
}

function writeLog(level, args) {
  if (settled || boot === null) return
  const parts = args.map(argument => typeof argument === 'string'
    ? argument
    : inspect(argument, { depth: MAX_INSPECT_DEPTH, breakLength: 120, maxArrayLength: 100, maxStringLength: MAX_INSPECT_STRING }))
  const line = (level === 'error' ? ERROR_PREFIX : '') + parts.join(' ')
  logBytes += Buffer.byteLength(line, 'utf8') + 1
  if (logBytes > boot.maxOutputBytes) {
    fail('output-limit', 'program output exceeded ' + boot.maxOutputBytes + ' bytes')
    return
  }
  send({ type: 'log', level: level, text: line })
}

const consoleShim = Object.freeze({
  log: function (...args) { writeLog('log', args) },
  info: function (...args) { writeLog('log', args) },
  debug: function (...args) { writeLog('log', args) },
  warn: function (...args) { writeLog('log', args) },
  error: function (...args) { writeLog('error', args) },
  trace: function (...args) { writeLog('error', args) },
  table: function (...args) { writeLog('log', args) },
  dir: function (...args) { writeLog('log', args) },
})

function callTool(name, args) {
  return new Promise((resolve, reject) => {
    if (settled) {
      reject(new Error('program run is over; ' + name + ' was not dispatched'))
      return
    }
    const id = ++nextId
    pending.set(id, { resolve: resolve, reject: reject })
    try {
      send({ type: 'call', id: id, name: name, args: args === undefined ? {} : args }, undefined)
    } catch (error) {
      pending.delete(id)
      reject(new Error('arguments for ' + name + ' are not JSON-serializable: ' + messageOf(error)))
    }
  })
}

function wipeEnvironment() {
  for (const key of Object.keys(process.env)) delete process.env[key]
}

async function run(code) {
  wipeEnvironment()
  const tools = Object.create(null)
  for (const name of boot.bindings) {
    tools[name] = function (args) { return callTool(name, args) }
  }
  let program
  try {
    const source = stripTypeScriptTypes('async function __codemode_program__(tools, console) {' + NEWLINE + code + NEWLINE + '}')
    program = new Function('return (' + source + ')')()
  } catch (error) {
    fail('exception', 'program does not compile: ' + messageOf(error))
    return
  }
  try {
    const value = await program(tools, consoleShim)
    if (value === undefined) {
      finish({ type: 'done' })
      return
    }
    let encoded
    try {
      encoded = JSON.stringify(value)
    } catch (error) {
      fail('invalid-output', 'the program returned a value that is not JSON: ' + messageOf(error))
      return
    }
    if (encoded === undefined) {
      fail('invalid-output', 'the program returned a value that is not JSON')
      return
    }
    finish({ type: 'done', value: value })
  } catch (error) {
    fail('exception', messageOf(error))
  }
}

process.on('message', (frame) => {
  if (!frame || typeof frame !== 'object') {
    fail('protocol', 'invalid frame from the facade')
    return
  }
  if (boot === null) {
    if (frame.type !== 'boot' || typeof frame.code !== 'string' || !Array.isArray(frame.bindings) || !Number.isSafeInteger(frame.maxOutputBytes)) {
      fail('protocol', 'the first frame must be boot')
      return
    }
    boot = frame
    void run(frame.code)
    return
  }
  if (frame.type !== 'reply' || !Number.isSafeInteger(frame.id)) {
    fail('protocol', 'unexpected frame from the facade')
    return
  }
  const entry = pending.get(frame.id)
  if (entry === undefined) {
    fail('protocol', 'reply for an unknown call id')
    return
  }
  pending.delete(frame.id)
  if (frame.ok === true) entry.resolve(frame.value)
  else entry.reject(new Error(typeof frame.message === 'string' ? frame.message : 'tool call failed'))
})

process.on('unhandledRejection', (reason) => { fail('exception', 'unhandled rejection: ' + messageOf(reason)) })
process.on('uncaughtException', (error) => { fail('exception', messageOf(error)) })
process.on('disconnect', () => { process.exit(0) })
`
