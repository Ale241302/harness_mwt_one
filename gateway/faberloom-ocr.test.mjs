/**
 * `FABERLOOM_OCR`: el interruptor de OCR que el gateway escribe como `ocr:`
 * en `tool-faberloom` y `faberloom-view`. Arrancar el gateway exige el entorno
 * del despliegue, así que se recortan del fuente el validador y `renderPatch` y
 * se ejecutan con dobles; el cableado de arranque queda asertado sobre el texto.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'

const source = readFileSync(new URL('./server.mjs', import.meta.url), 'utf8')

/** Slice `function <name>(...) { ... }` out of the shipped source. */
function shippedFunction(name) {
  const start = source.indexOf(`function ${name}(`)
  assert.notEqual(start, -1, `server.mjs no define ${name}()`)
  // El cuerpo empieza tras la lista de parámetros: buscar `{` desde el `(` no
  // sirve cuando el parámetro desestructura (`function renderEntry({ id })`).
  const open = source.indexOf('{', source.indexOf(') {', start))
  let depth = 0
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++
    else if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1)
  }
  throw new Error(`server.mjs: ${name}() no cierra`)
}

const modes = source.match(/const OCR_MODES = new Set\(\[[^\]]*\]\)/u)
assert.ok(modes, 'server.mjs no declara OCR_MODES')
const parseFaberloomOcr = new Function(`${modes[0]}
${shippedFunction('parseFaberloomOcr')}
return parseFaberloomOcr
`)()

/**
 * `renderPatch` contra dobles: la salida real de las dos filas del producto, sin
 * arrancar el gateway. `anydocOcr` queda fijo en `reject` para probar que la
 * fila `ocr` no se deriva de `ANYDOC_OCR`.
 */
function patchRendererFor(ocr) {
  const cfg = {
    faberloomOcr: ocr,
    faberloomUrl: 'https://faberloom.test/mcp',
    faberloomGatewayKey: 'gateway-key',
    mcpUrl: 'https://mwt.test/mcp',
    sicopUrl: '',
    contextModeEnabled: false,
    anydocEnabled: true,
    anydocOcr: 'reject',
    anydocApiKey: '',
    skillsCatalogRoot: '/opt/skills/catalog',
    skillsSharedRoot: '/opt/skills/shared',
    globalSkillsRoot: '/opt/skills/global',
    agentsSharedRoot: '/opt/agents',
    agentProvider: 'deepseek',
    agentModel: 'deepseek-flash',
    agentApiKeyEnv: 'DEEPSEEK_API_KEY',
    globalAgentsFile: '/opt/agents.json',
    dispatcherIntervalMs: 60000,
    inboundEnabled: false,
    inboundIntervalMs: 300000,
    inboundMailbox: 'INBOX',
    waitTimeoutMs: 86400000,
    mirrorIntervalMs: 120000,
    publicHost: 'dsh.test',
    mcpClientId: '',
    mcpClientIdFromUser: true,
  }
  return new Function('path', 'fs', `
const cfg = ${JSON.stringify(cfg)}
${shippedFunction('isEnvValue')}
${shippedFunction('yamlScalar')}
${shippedFunction('yamlEnv')}
${shippedFunction('renderEntry')}
${shippedFunction('renderStdioEntry')}
${shippedFunction('resolveClientId')}
function allKnownEntityIds() { return [] }
function hasUserMwtServer() { return false }
function toolsModeFor() { return 'native' }
function renderToolsEntry() { return '' }
function faberloomRole() { return 'member' }
function faberloomKeyUnrestricted() { return false }
${shippedFunction('renderPatch')}
return renderPatch
`)(path, { mkdirSync() {}, existsSync: () => false, writeFileSync() {} })
}

const user = { email: 'ana@mwt.one', role: 'member', readOnly: false, legalEntityIds: [] }

/** Líneas de la entrada `- id: <id>` del parche, hasta la siguiente entrada. */
function sectionOf(patch, id) {
  const lines = patch.split('\n')
  const start = lines.indexOf(`- id: ${id}`)
  assert.notEqual(start, -1, `el parche no trae la entrada ${id}`)
  const next = lines.findIndex((line, index) => index > start && line.startsWith('- id: '))
  return lines.slice(start, next === -1 ? lines.length : next)
}

test('sin FABERLOOM_OCR el modo es local', () => {
  assert.equal(parseFaberloomOcr(undefined), 'local')
  assert.equal(parseFaberloomOcr(''), 'local')
  assert.equal(parseFaberloomOcr('  LOCAL  '), 'local')
})

test('un valor explícito se acepta sin distinguir mayúsculas', () => {
  assert.equal(parseFaberloomOcr('off'), 'off')
  assert.equal(parseFaberloomOcr('local'), 'local')
  assert.equal(parseFaberloomOcr('Hosted'), 'hosted')
})

test('un valor inválido lanza en vez de caer a local', () => {
  assert.throws(() => parseFaberloomOcr('ocr'), /FABERLOOM_OCR no válido/u)
  assert.throws(() => parseFaberloomOcr('host'), /FABERLOOM_OCR no válido/u)
  assert.throws(() => parseFaberloomOcr('off,local'), /FABERLOOM_OCR no válido/u)
})

test('las dos filas del parche llevan ocr junto a anydocOcr', () => {
  for (const [ocr, expected] of [['local', "    ocr: 'local'"], ['hosted', "    ocr: 'hosted'"]]) {
    const patch = patchRendererFor(ocr)(path.join('/data/users', 'ana'), user, null)
    for (const id of ['tool-faberloom', 'faberloom-view']) {
      const section = sectionOf(patch, id)
      const row = section.indexOf(expected)
      assert.notEqual(row, -1, `${id} no emite ${expected}`)
      // Viaja pegado a anydocOcr, que sigue siendo el de ANYDOC_OCR.
      assert.equal(section[row - 1], "    anydocOcr: 'reject'")
    }
  }
})

test('el arranque valida FABERLOOM_OCR dentro del bloque FATAL', () => {
  assert.match(source, /cfg\.faberloomOcr = parseFaberloomOcr\(process\.env\.FABERLOOM_OCR\)/u)
  assert.match(source,
    /try \{\s*(\/\/[^\n]*\n\s*)*cfg\.faberloomOcr = parseFaberloomOcr\(process\.env\.FABERLOOM_OCR\)[\s\S]*?\} catch \(error\) \{\s*console\.error\(`\[gateway\] FATAL: \$\{error\.message\}`\)\s*process\.exit\(1\)/u)
})
