/**
 * The gateway's tools-presentation switch (`HARNESS_TOOLS_MODE`): a user outside
 * the pilot keeps the base patch byte for byte, and a listed user receives the
 * `tools` row with the mode the deployment chose. Booting the gateway needs the
 * deployment environment (secret, console, supervisor), so the pure helpers are
 * sliced out of the shipped source and run directly; the wiring that calls them
 * from `renderPatch` stays asserted on the source text.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8')

/** Slice `function <name>(...) { ... }` out of the shipped source. */
function shippedFunction(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `server.mjs no define ${name}()`)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`server.mjs: ${name}() no cierra`)
}

const modes = source.match(/const TOOLS_MODES = new Set\(\[[^\]]*\]\)/u)
assert.ok(modes, 'server.mjs no declara TOOLS_MODES')
/** Build the tools helpers against a given ptcJail value. */
function toolsHelpersFor(ptcJail) {
  return new Function(`${modes[0]}
const cfg = { ptcJail: ${JSON.stringify(ptcJail)} }
${shippedFunction('yamlScalar')}
${shippedFunction('parseToolsMode')}
${shippedFunction('parseToolsModeUsers')}
${shippedFunction('toolsModeFor')}
${shippedFunction('renderToolsEntry')}
return { parseToolsMode, parseToolsModeUsers, toolsModeFor, renderToolsEntry }
`)()
}
const helpers = toolsHelpersFor('/opt/dsh/bin/node-jail')
const { parseToolsMode, parseToolsModeUsers, toolsModeFor, renderToolsEntry } = helpers
const jailFree = toolsHelpersFor('')

test('sin HARNESS_TOOLS_MODE el modo es native y el parche no gana ninguna fila', () => {
  assert.equal(parseToolsMode(undefined), 'native')
  assert.equal(parseToolsMode(''), 'native')
  assert.equal(parseToolsMode('  Native  '), 'native')
  assert.equal(renderToolsEntry('native'), '')
  assert.equal(toolsModeFor('ana@mwt.one', 'native', new Set()), 'native')
})

test('both y ptc emiten la fila tools y la de la jaula', () => {
  const jail = ['- id: ptc-runtime', '  config:', "    nodeExecutable: '/opt/dsh/bin/node-jail'"]
  assert.deepEqual(renderToolsEntry('both').split('\n'),
    ['- id: tools', '  config:', "    mode: 'both'", ...jail])
  assert.deepEqual(renderToolsEntry('ptc').split('\n'),
    ['- id: tools', '  config:', "    mode: 'ptc'", ...jail])
})

test('sin jaula el parche pide el modo pero no nombra un nodeExecutable', () => {
  // El aislamiento por uid sustituye a bwrap: el runtime usa su
  // `process.execPath` y el programa corre con el uid del inquilino.
  assert.deepEqual(jailFree.renderToolsEntry('both').split('\n'),
    ['- id: tools', '  config:', "    mode: 'both'"])
  assert.equal(jailFree.renderToolsEntry('native'), '')
})

test('un piloto listado recibe el modo; un correo fuera de la lista queda en native', () => {
  const pilots = parseToolsModeUsers('ana@mwt.one,luis@mwt.one')
  assert.equal(pilots.size, 2)
  assert.equal(toolsModeFor('ana@mwt.one', 'both', pilots), 'both')
  assert.equal(toolsModeFor('luis@mwt.one', 'ptc', pilots), 'ptc')
  assert.equal(toolsModeFor('pedro@mwt.one', 'both', pilots), 'native')
  assert.equal(renderToolsEntry(toolsModeFor('pedro@mwt.one', 'both', pilots)), '')
})

test('una lista de pilotos vacía aplica el modo a todos', () => {
  const pilots = parseToolsModeUsers('  ,  ')
  assert.equal(pilots.size, 0)
  assert.equal(toolsModeFor('ana@mwt.one', 'both', pilots), 'both')
  assert.deepEqual(renderToolsEntry(toolsModeFor('ana@mwt.one', 'both', pilots)).split('\n').slice(0, 3),
    ["- id: tools", '  config:', "    mode: 'both'"])
})

test('los correos del piloto ignoran mayúsculas y espacios', () => {
  const pilots = parseToolsModeUsers(' Ana@MWT.one ,  LUIS@mwt.one  ')
  assert.deepEqual([...pilots], ['ana@mwt.one', 'luis@mwt.one'])
  assert.equal(toolsModeFor(' ANA@MWT.ONE ', 'ptc', pilots), 'ptc')
  assert.equal(toolsModeFor('ana@mwt.one ', 'both', pilots), 'both')
})

test('un modo inválido lanza en vez de caer a native', () => {
  assert.throws(() => parseToolsMode('everything'), /HARNESS_TOOLS_MODE no válido/u)
  assert.throws(() => parseToolsMode('nativ'), /HARNESS_TOOLS_MODE no válido/u)
  assert.throws(() => parseToolsMode('both,ptc'), /HARNESS_TOOLS_MODE no válido/u)
})

test('el gateway lee el modo del entorno y lo inserta solo fuera de native', () => {
  assert.match(source, /cfg\.toolsMode = parseToolsMode\(process\.env\.HARNESS_TOOLS_MODE\)/u)
  assert.match(source, /cfg\.toolsModeUsers = parseToolsModeUsers\(process\.env\.HARNESS_TOOLS_MODE_USERS\)/u)
  assert.match(source, /const toolsEntry = renderToolsEntry\(toolsModeFor\(user\.email, cfg\.toolsMode, cfg\.toolsModeUsers\)\)/u)
  assert.match(source, /\.\.\.\(toolsEntry \? \[toolsEntry, ''\] : \[\]\)/u)
  // La fila se reconfigura en el nivel superior del parche: `tools` ya viene
  // montada por el bundle base, así que insertarla en `- insert:` duplicaría la
  // entrada. La posición queda fijada después de la lista insertada.
  assert.match(source, /'- insert:',\s*\.\.\.entries,\s*'',\s*\.\.\.\(toolsEntry \? \[toolsEntry, ''\] : \[\]\),\s*'- id: tool-faberloom',/u)
  // Arranque fallido, no silencioso: el modo inválido sale por el bloque FATAL.
  assert.match(source, /console\.error\(`\[gateway\] FATAL: \$\{error\.message\}`\)/u)
  // Code Mode sin jaula tampoco arranca salvo que el kernel aísle: la fila de la
  // jaula viaja con el modo, y el arranque exige PTC_JAIL o el uid por inquilino.
  assert.match(source, /if \(cfg\.toolsMode !== 'native' && cfg\.ptcJail\.length === 0 && !tenantUid\.active\)/u)
  assert.match(source, /if \(cfg\.ptcJail\.length > 0\) \{\s*lines\.push\(\s*'- id: ptc-runtime',/u)
})
