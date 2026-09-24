/**
 * Harness MWT · gateway de autenticación y supervisor de dsh por usuario.
 *
 * - Valida email/password contra la consola MWT.ONE (/api/auth/login/).
 * - Arranca y supervisa un proceso `dsh` aislado por usuario (DSH_HOME propio).
 * - Inyecta la identidad del usuario en el MCP de la consola por headers.
 * - Proxya todo (HTTP + WebSocket) al dsh del usuario autenticado.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import express from 'express'
import httpProxy from 'http-proxy'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Lee un secreto desde `<NAME>_FILE` (Docker secret / archivo montado) y, si no
// existe, desde `<NAME>` en el entorno. Los secretos nunca se escriben en los
// archivos de parche por usuario: allí se referencian como `!!js process.env.*`.
function readSecret(name) {
  const file = process.env[`${name}_FILE`]
  if (file) {
    try {
      return fs.readFileSync(file, 'utf8').trim()
    } catch (err) {
      console.error(`[gateway] FATAL: no se pudo leer ${name}_FILE (${file}): ${err.message}`)
      process.exit(1)
    }
  }
  return process.env[name] || ''
}

const cfg = {
  port: Number(process.env.PORT || 8080),
  consolaApi: (process.env.CONSOLA_API_BASE || 'https://consola.mwt.one/api').replace(/\/+$/, ''),
  publicHost: process.env.PUBLIC_HOST || 'harness.mwt.one',
  deepseekKey: readSecret('DEEPSEEK_API_KEY'),
  dataDir: process.env.DATA_DIR || '/data/users',
  dshBasePort: Number(process.env.DSH_BASE_PORT || 3100),
  dshBin: process.env.DSH_BIN || 'dsh',
  // The harness profile to launch per user. `faberloom` is this build's own
  // profile (base + web-app + the native product-module bundle).
  dshProfile: process.env.DSH_PROFILE || 'faberloom',
  mcpUrl: process.env.MWT_MCP_URL || 'http://consola-mwt-one-mcp:8765/mcp',
  mcpGatewayKey: readSecret('MWT_MCP_GATEWAY_KEY'),
  mcpClientId: process.env.MWT_MCP_CLIENT_ID || '',
  // E2 · fijar X-MWT-Client-ID con la única empresa del usuario si tiene una sola.
  mcpClientIdFromUser: process.env.MWT_MCP_CLIENT_ID_FROM_USER !== '0',
  // FaberLoom · MCP propio (espacios) por usuario.
  faberloomUrl: process.env.FABERLOOM_MCP_URL || '',
  faberloomGatewayKey: readSecret('FABERLOOM_GATEWAY_KEY'),
  sessionSecret: readSecret('SESSION_SECRET'),
  // Sesión del gateway (la del harness dura 30 días por defecto).
  cookieName: 'hgate',
  cookieTtlMs: Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000),
  dshReadyTimeoutMs: Number(process.env.DSH_READY_TIMEOUT_MS || 120000),
  // Modo estático (solo pruebas locales): usa un dsh ya en marcha en vez
  // de arrancar procesos hijos.
  staticDshPort: process.env.STATIC_DSH_PORT ? Number(process.env.STATIC_DSH_PORT) : 0,
  staticDshToken: process.env.STATIC_DSH_TOKEN || '',
  // E1 · límites por instancia dsh (aplicados con prlimit / NODE_OPTIONS).
  maxOldSpaceMb: Number(process.env.DSH_MAX_OLD_SPACE_MB || 1024),
  nofileLimit: Number(process.env.DSH_NOFILE_LIMIT || 8192),
  cpuLimitS: Number(process.env.DSH_CPU_LIMIT_S || 0),
  // Memoria de agente (TencentDB Agent Memory). Cuando está activa, cada dsh
  // enruta su modelo por el proxy del stack de memoria con la identidad del
  // usuario; el proxy inyecta L2/L3 y guarda L0.
  memoryEnabled: process.env.MEMORY_ENABLED === '1',
  memoryCoreUrl: (process.env.MEMORY_CORE_URL || 'http://memory-core:8420').replace(/\/+$/, ''),
  memoryProxyUrl: (process.env.MEMORY_PROXY_URL || 'http://proxy:8096').replace(/\/+$/, ''),
  memoryAdminKey: readSecret('MEMORY_ADMIN_KEY'),
  memoryServiceId: process.env.MEMORY_SERVICE_ID || 'default',
  memoryAgentName: process.env.MEMORY_AGENT_NAME || 'Asistente MWT',
  memoryGatewayKey: process.env.MEMORY_GATEWAY_KEY || 'local',
  memoryLimit: Number(process.env.MEMORY_LIMIT || 50),
  memoryTimeoutMs: Number(process.env.MEMORY_TIMEOUT_MS || 10000),
  // context-mode: servidor MCP de contexto (sandbox de ejecución + base FTS5).
  // Se arranca por usuario con su DSH_HOME como proyecto y almacenamiento.
  contextModeEnabled: process.env.CONTEXT_MODE_ENABLED !== '0',
  contextModeEntry: process.env.CONTEXT_MODE_ENTRY || '/usr/local/lib/node_modules/context-mode/start.mjs',
  contextModeTimeoutMs: Number(process.env.CONTEXT_MODE_TIMEOUT_MS || 120000),
  // Catálogo de skills del MCP: un directorio por rol con <skill>/SKILL.md.
  skillsCatalogRoot: process.env.SKILLS_CATALOG_ROOT || '/opt/skills-catalog',
  // Cadencia del despachador persistente de rutinas (una pasada cada N ms).
  dispatcherIntervalMs: Number(process.env.DISPATCHER_INTERVAL_MS || 60000),
  // Receptor de correo: sondeo del IMAP del usuario (desactivado por defecto
  // hasta que el usuario configure una conexion valida en Conexiones).
  inboundEnabled: process.env.INBOUND_ENABLED === '1',
  inboundIntervalMs: Number(process.env.INBOUND_INTERVAL_MS || 300000),
  inboundMailbox: process.env.INBOUND_MAILBOX || 'INBOX',
  // Ingesta de adjuntos de correo: convierte xlsx/pdf/docx a Markdown con el
  // conversor `anydoc` y lo guarda como memoria del espacio. Activa por
  // defecto; ANYDOC_ENABLED=0 la apaga. El OCR de PDFs escaneados queda en
  // `reject` (se omiten) salvo ANYDOC_OCR=hosted con firecrawl key.
  anydocEnabled: process.env.ANYDOC_ENABLED !== '0',
  anydocOcr: process.env.ANYDOC_OCR || 'reject',
  anydocApiKey: process.env.FIRECRAWL_API_KEY || '',
  // Plazo de una espera de rutina antes de pasar a revision (24 h por defecto).
  waitTimeoutMs: Number(process.env.WAIT_TIMEOUT_MS || 86400000),
  // M1 · rate limit de /mcp (peticiones por minuto por IP cliente).
  mcpRateLimitPerMin: Number(process.env.MCP_RATE_LIMIT_PER_MIN || 120),
  // M6 · rate limit de login por cuenta (además del de nginx por IP).
  loginRateLimitPerMin: Number(process.env.LOGIN_RATE_LIMIT_PER_MIN || 12),
  // M4 · cadencia del refresco del índice de tokens (ms).
  tokenIndexRefreshMs: Number(process.env.MCP_TOKEN_INDEX_REFRESH_MS || 300000),
}

// Estado durable del aprovisionamiento de memoria (identidad por usuario).
// Vive junto a los DSH_HOME para sobrevivir recreates del contenedor.
const DATA_DIR = cfg.dataDir
cfg.memoryStateFile = process.env.MEMORY_STATE_FILE || path.join(path.dirname(DATA_DIR), 'memory-users.json')
// M1 · índice token→owner y fuentes del healthcheck ampliado (M9).
cfg.mcpTokenIndexFile = process.env.MCP_TOKEN_INDEX_FILE || path.join(path.dirname(DATA_DIR), 'mcp-token-index.json')
cfg.forkShaFile = process.env.DSH_FORK_SHA_FILE || '/opt/dsh/.fork-sha'
cfg.backupStatusFile = process.env.BACKUP_STATUS_FILE || '/opt/mwt/harness_backup_status.txt'
cfg.manifestFile = process.env.MANIFEST_FILE || path.join(__dirname, '..', 'MANIFEST.md')

if (!cfg.sessionSecret) {
  console.error('[gateway] FATAL: SESSION_SECRET no está definido')
  process.exit(1)
}

// ── M4 · observabilidad: log estructurado y métricas ──────────────────
// Una línea JSON por evento relevante (quién, qué, resultado, duración) y
// contadores Prometheus en /metrics. No registra secretos ni cuerpos.
const metrics = {
  logins: { ok: 0, auth: 0, upstream: 0, limited: 0 },
  dshSpawns: 0,
  dshExits: 0,
  mcpRequests: { ok: 0, denied: 0, limited: 0, error: 0 },
  rateLimited: { login: 0, mcp: 0 },
}
function logEvent(fields) {
  try {
    console.log(JSON.stringify({ ts: new Date().toISOString(), svc: 'harness-gateway', ...fields }))
  } catch { /* logging never throws */ }
}
function prometheus(extra) {
  const lines = [
    '# HELP gateway_logins_total Login attempts by result.',
    '# TYPE gateway_logins_total counter',
    `gateway_logins_total{result="ok"} ${metrics.logins.ok}`,
    `gateway_logins_total{result="auth"} ${metrics.logins.auth}`,
    `gateway_logins_total{result="upstream"} ${metrics.logins.upstream}`,
    `gateway_logins_total{result="limited"} ${metrics.logins.limited}`,
    '# HELP gateway_dsh_spawns_total dsh instances started.',
    '# TYPE gateway_dsh_spawns_total counter',
    `gateway_dsh_spawns_total ${metrics.dshSpawns}`,
    '# HELP gateway_dsh_exits_total dsh instances that exited.',
    '# TYPE gateway_dsh_exits_total counter',
    `gateway_dsh_exits_total ${metrics.dshExits}`,
    '# HELP gateway_mcp_requests_total /mcp requests by result.',
    '# TYPE gateway_mcp_requests_total counter',
    `gateway_mcp_requests_total{result="ok"} ${metrics.mcpRequests.ok}`,
    `gateway_mcp_requests_total{result="denied"} ${metrics.mcpRequests.denied}`,
    `gateway_mcp_requests_total{result="limited"} ${metrics.mcpRequests.limited}`,
    `gateway_mcp_requests_total{result="error"} ${metrics.mcpRequests.error}`,
    '# HELP gateway_rate_limited_total Requests rejected by a rate limit.',
    '# TYPE gateway_rate_limited_total counter',
    `gateway_rate_limited_total{kind="login"} ${metrics.rateLimited.login}`,
    `gateway_rate_limited_total{kind="mcp"} ${metrics.rateLimited.mcp}`,
    '# HELP gateway_instances Live per-user dsh instances.',
    '# TYPE gateway_instances gauge',
    `gateway_instances ${extra.instances}`,
  ]
  return `${lines.join('\n')}\n`
}

// ── M1/M6 · rate limiter en memoria (ventana deslizante de 60 s) ──────
function makeLimiter(perMin) {
  const hits = new Map()
  const check = (key) => {
    const now = Date.now()
    const recent = (hits.get(key) ?? []).filter(at => at > now - 60000)
    recent.push(now)
    hits.set(key, recent)
    return recent.length <= perMin
  }
  check.hits = hits
  return check
}
const mcpLimiter = makeLimiter(cfg.mcpRateLimitPerMin)
const loginAccountLimiter = makeLimiter(cfg.loginRateLimitPerMin)
const loginIpLimiter = makeLimiter(Math.max(cfg.loginRateLimitPerMin * 4, 40))
// Poda periódica para que los mapas no crezcan sin límite.
setInterval(() => {
  const cutoff = Date.now() - 60000
  for (const limiter of [mcpLimiter, loginAccountLimiter, loginIpLimiter]) {
    for (const [key, times] of limiter.hits) {
      const kept = times.filter(at => at > cutoff)
      if (kept.length === 0) limiter.hits.delete(key)
      else limiter.hits.set(key, kept)
    }
  }
}, 60000).unref()

// ── M7 · CSRF de doble envío para el formulario de login ──────────────
// GET /login fija una cookie aleatoria y la incrusta como campo oculto; POST
// exige que ambos coincidan. Un tercero no puede leer la cookie ni el formulario.
const CSRF_COOKIE = 'hcsrf'
function newCsrfToken() {
  return crypto.randomBytes(24).toString('hex')
}
function csrfCookieValue(value) {
  return `${CSRF_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax${cookieSecureFlag()}`
}
/** Every `hcsrf` value the request carries (stale duplicates included). */
function csrfCookies(req) {
  const header = req.get('cookie') || ''
  return header.split(';')
    .map(part => part.trim())
    .filter(part => part.startsWith(`${CSRF_COOKIE}=`))
    .map(part => part.slice(CSRF_COOKIE.length + 1))
}
/** Constant-time equality over two tokens. */
function equalToken(left, right) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
function verifyCsrf(req) {
  const field = String(req.body?._csrf || '')
  if (!field) return false
  return csrfCookies(req).some(cookie => equalToken(cookie, field))
}

// ── Firmas de cookie (HMAC-SHA256) ────────────────────────────────────
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
function signSession(payload) {
  const body = b64url(JSON.stringify(payload))
  const sig = b64url(crypto.createHmac('sha256', cfg.sessionSecret).update(body).digest())
  return `${body}.${sig}`
}
function verifySession(value) {
  if (typeof value !== 'string') return undefined
  const parts = value.split('.')
  if (parts.length !== 2) return undefined
  const [body, sig] = parts
  const expected = b64url(crypto.createHmac('sha256', cfg.sessionSecret).update(body).digest())
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return undefined
  try {
    const payload = JSON.parse(Buffer.from(body.replaceAll('-', '+').replaceAll('_', '/'), 'base64').toString('utf8'))
    if (!payload || typeof payload.uid !== 'string' || !Number.isSafeInteger(payload.exp)) return undefined
    if (payload.exp <= Date.now()) return undefined
    return payload
  } catch {
    return undefined
  }
}
function readCookie(req, name) {
  const raw = req.headers.cookie
  if (!raw) return undefined
  for (const seg of raw.split(';')) {
    const at = seg.indexOf('=')
    if (at === -1) continue
    if (seg.slice(0, at).trim() === name) return decodeURIComponent(seg.slice(at + 1).trim())
  }
  return undefined
}
function getSession(req) {
  return verifySession(readCookie(req, cfg.cookieName))
}
// `Secure` va activo por defecto (el gateway siempre sirve por HTTPS tras
// mwt-nginx); `COOKIE_SECURE=0` lo desactiva solo para pruebas locales por HTTP.
function cookieSecureFlag() {
  return process.env.COOKIE_SECURE === '0' ? '' : '; Secure'
}
function sessionCookieValue(payload) {
  const maxAge = Math.max(0, Math.floor((payload.exp - Date.now()) / 1000))
  return `${cfg.cookieName}=${encodeURIComponent(signSession(payload))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cookieSecureFlag()}`
}
function setSessionCookie(res, payload) {
  res.setHeader('Set-Cookie', sessionCookieValue(payload))
}
// Canjea el token de proceso de dsh por su cookie firmada del lado servidor,
// para que el token no viaje en la URL del navegador (logs, historial, Referer).
// `host` debe ser el host público: la cookie queda ligada a esa autoridad.
function exchangeDshToken(port, token) {
  return new Promise((resolve) => {
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: 'GET',
      path: `/?token=${encodeURIComponent(token)}`,
      headers: { host: cfg.publicHost },
    }, (res) => {
      const cookies = res.headers['set-cookie'] ?? []
      res.resume()
      resolve({ cookies })
    })
    req.on('error', () => resolve({ cookies: [] }))
    req.setTimeout(5000, () => { req.destroy(); resolve({ cookies: [] }) })
    req.end()
  })
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${cfg.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${cookieSecureFlag()}`)
}

// ── Render del overlay de dsh (MCP por usuario) ───────────────────────
function yamlScalar(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}
// Valor resuelto por el loader desde el entorno del proceso dsh al montar la
// fila. El secreto nunca queda escrito en el archivo de parche del usuario.
function yamlEnv(name) {
  return { js: `process.env.${name} ?? ''` }
}
function isEnvValue(value) {
  return typeof value === 'object' && value !== null && typeof value.js === 'string'
}
// E2 · Resuelve la empresa del usuario para X-MWT-Client-ID.
// Solo se fija si el usuario tiene UNA sola empresa: el MCP valida que el valor
// esté entre sus legal_entity_ids (verify_tenant) y con varias no hay una única
// empresa correcta. MWT_MCP_CLIENT_ID fuerza un valor global para todos.
// La consola no envía un booleano `read_only`: se deriva de las acciones del
// login. Un usuario sin ninguna acción mutadora (solo .view/.download_doc) es
// de solo lectura para los módulos de producto.
const MUTATING_ACTION = /\.(create|edit|update|delete|manage|write|activate|close|send|approve)/
function deriveReadOnly(user) {
  if (user.permissions?.read_only === true) return true
  const actions = user.permissions?.actions
  if (Array.isArray(actions) && actions.length > 0) {
    return !actions.some(action => typeof action === 'string' && MUTATING_ACTION.test(action))
  }
  return user.role === 'viewer' || user.role === 'client_b2b'
}
function resolveClientId(user) {
  if (cfg.mcpClientId) return cfg.mcpClientId
  if (!cfg.mcpClientIdFromUser) return ''
  // E2 · entidad elegida por el usuario cuando tiene varias (G7): el selector de
  // /entity la persiste y el parche del dsh la usa como X-MWT-Client-ID.
  if (user && typeof user.entityId === 'string' && user.entityId.length > 0) return user.entityId.toLowerCase()
  const ents = (user && (user.legalEntityIds || user.legal_entity_ids)) || []
  return ents.length === 1 ? String(ents[0]).toLowerCase() : ''
}
function renderEntry({ id, serverName, url, headers, toolTimeoutMs }) {
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `          ${k}: ${isEnvValue(v) ? `!!js ${v.js}` : yamlScalar(v)}`)
    .join('\n')
  return [
    `    - id: ${id}`,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    `        serverName: ${serverName}`,
    '        transport: streamable-http',
    `        url: ${yamlScalar(url)}`,
    '        headers:',
    headerLines,
    '        failOnStartupError: false',
    '        reconnect:',
    '          enabled: true',
    '          maxAttempts: 30',
    `        toolCallTimeoutMs: ${toolTimeoutMs}`,
  ].join('\n')
}

// Entrada MCP por proceso hijo (stdio). El servidor se arranca dentro del
// contenedor con el DSH_HOME del usuario como directorio de trabajo, de modo
// que su estado (SQLite/FTS5) queda por usuario y no se comparte.
function renderStdioEntry({ id, serverName, command, args, env, cwd, toolTimeoutMs }) {
  const argLines = args.map(a => `          - ${yamlScalar(a)}`).join('\n')
  const envLines = Object.entries(env)
    .map(([k, v]) => `          ${k}: ${yamlScalar(v)}`)
    .join('\n')
  return [
    `    - id: ${id}`,
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    `        serverName: ${serverName}`,
    '        transport: stdio',
    `        command: ${yamlScalar(command)}`,
    '        args:',
    argLines,
    '        env:',
    envLines,
    `        cwd: ${yamlScalar(cwd)}`,
    '        failOnStartupError: false',
    '        reconnect:',
    '          enabled: true',
    '          maxAttempts: 10',
    `        toolCallTimeoutMs: ${toolTimeoutMs}`,
  ].join('\n')
}

// ── Memoria por usuario (TencentDB Agent Memory) ──────────────────────
// La consola de memoria gestiona usuarios, equipos y agentes por HTTP. El
// gateway aprovisiona una identidad por usuario del harness la primera vez y
// la persiste; el `user_key` resultante es lo único que viaja al dsh.
function memoryUsername(email) {
  const base = String(email).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return (base || 'usuario').slice(0, 56)
}

function readMemoryState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(cfg.memoryStateFile, 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.users && typeof parsed.users === 'object') return parsed
  } catch { /* ausente o ilegible: se reconstruye */ }
  return { users: {} }
}

function writeMemoryState(state) {
  fs.mkdirSync(path.dirname(cfg.memoryStateFile), { recursive: true })
  const tmp = `${cfg.memoryStateFile}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, cfg.memoryStateFile)
}

// Identidad mínima de cada usuario que ha entrado, para poder arrancar su dsh
// cuando una petición MCP llega sin sesión de navegador abierta.
cfg.userStateFile = process.env.USER_STATE_FILE || path.join(path.dirname(DATA_DIR), 'gateway-users.json')

function rememberUser(user) {
  let state = { users: {} }
  try {
    const parsed = JSON.parse(fs.readFileSync(cfg.userStateFile, 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.users) state = parsed
  } catch { /* ausente o ilegible: se reconstruye */ }
  state.users[user.email] = {
    email: user.email,
    id: user.id,
    role: user.role,
    readOnly: user.readOnly === true,
    legalEntityIds: Array.isArray(user.legalEntityIds) ? user.legalEntityIds : [],
    ...(typeof user.entityId === 'string' && user.entityId.length > 0 ? { entityId: user.entityId } : {}),
    ...(user.entNames !== null && typeof user.entNames === 'object' ? { entNames: user.entNames } : {}),
  }
  const tmp = `${cfg.userStateFile}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, cfg.userStateFile)
  return state.users[user.email]
}

function readUserState(email) {
  try {
    const parsed = JSON.parse(fs.readFileSync(cfg.userStateFile, 'utf8'))
    const stored = parsed?.users?.[email]
    if (stored && stored.id && stored.email) {
      return {
        ...stored,
        legalEntityIds: Array.isArray(stored.legalEntityIds) ? stored.legalEntityIds : [],
        ...(stored.entNames !== null && typeof stored.entNames === 'object' ? { entNames: stored.entNames } : {}),
      }
    }
  } catch { /* ausente o ilegible */ }
  return undefined
}

// ── M1 · índice token→owner ───────────────────────────────────────────
// El gateway no guarda tokens: los localiza. Antes cada petición /mcp escaneaba
// el almacén de todos los usuarios; ahora un índice en /data (tmp+rename)
// resuelve el owner en O(1). El índice es solo enrutamiento: la revocación real
// la impone el servidor MCP del propietario (que revisa su propio almacén).
let tokenIndex
let tokenIndexBuiltAt = 0

function loadTokenIndex() {
  if (tokenIndex !== undefined) return tokenIndex
  tokenIndex = new Map()
  try {
    const parsed = JSON.parse(fs.readFileSync(cfg.mcpTokenIndexFile, 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.tokens) {
      for (const [token, hit] of Object.entries(parsed.tokens)) {
        if (hit && typeof hit.email === 'string' && typeof hit.dir === 'string') tokenIndex.set(token, hit)
      }
    }
  } catch { /* ausente o ilegible: se reconstruye */ }
  return tokenIndex
}

function persistTokenIndex() {
  const tokens = {}
  for (const [token, hit] of tokenIndex) tokens[token] = hit
  const tmp = `${cfg.mcpTokenIndexFile}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify({ updatedAt: new Date().toISOString(), tokens }), 'utf8')
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, cfg.mcpTokenIndexFile)
  } catch (err) {
    console.error(`[gateway] no se pudo escribir el índice de tokens: ${err.message}`)
  }
}

function buildTokenIndex() {
  const next = new Map()
  let dirs = []
  try { dirs = fs.readdirSync(cfg.dataDir) } catch { /* sin homes todavía */ }
  for (const id of dirs) {
    const file = path.join(cfg.dataDir, id, 'storages', 'faberloom_mcp.json')
    let parsed
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { continue }
    const records = parsed?.tables?.tokens
    if (!records || typeof records !== 'object') continue
    for (const [token, record] of Object.entries(records)) {
      if (!record || record.revokedAt !== null) continue
      next.set(token, { email: record.ownerId, dir: id })
    }
  }
  tokenIndex = next
  tokenIndexBuiltAt = Date.now()
  persistTokenIndex()
  logEvent({ ev: 'mcp_token_index', tokens: next.size, homes: dirs.length })
  return next
}

function findOwnerByMcpToken(token) {
  loadTokenIndex()
  if (Date.now() - tokenIndexBuiltAt > cfg.tokenIndexRefreshMs) buildTokenIndex()
  const hit = tokenIndex.get(token)
  if (hit) return { email: hit.email, home: path.join(cfg.dataDir, hit.dir) }
  // Un token recién emitido puede no estar en el índice cargado: reescanea una vez.
  buildTokenIndex()
  const again = tokenIndex.get(token)
  return again ? { email: again.email, home: path.join(cfg.dataDir, again.dir) } : undefined
}

async function memCall(step, key, body) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), cfg.memoryTimeoutMs)
  try {
    const resp = await fetch(`${cfg.memoryCoreUrl}/v3/meta/${step}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-tdai-user-key': key,
        'x-tdai-service-id': cfg.memoryServiceId,
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    })
    const text = await resp.text()
    let data
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      throw new Error(`${step}: respuesta no JSON`)
    }
    if (!resp.ok || (typeof data.code === 'number' && data.code !== 0)) {
      throw new Error(`${step}: ${data.message || `HTTP ${resp.status}`}`)
    }
    return data.data ?? {}
  } finally {
    clearTimeout(timer)
  }
}

/** Crea usuario + equipo + agente del espacio de memoria y devuelve su user_key. */
async function provisionMemory(email) {
  const username = memoryUsername(email)
  const user = await memCall('user/create', cfg.memoryAdminKey, { username })
  if (!user.user_id || !user.default_user_key) throw new Error('user/create sin user_id/default_user_key')
  const team = await memCall('team/create', user.default_user_key, {
    name: `${username} · MWT`,
    owner_user_id: user.user_id,
  })
  if (!team.team_id) throw new Error('team/create sin team_id')
  let agentId = ''
  try {
    const agent = await memCall('agent/create', user.default_user_key, {
      team_id: team.team_id,
      owner_user_id: user.user_id,
      name: cfg.memoryAgentName,
      description: 'Asistente general del espacio de trabajo',
    })
    agentId = agent.agent_id || ''
  } catch (err) {
    // El espacio sigue siendo utilizable sin agente; el picker de la sesión
    // mostrará la lista vacía en vez de fallar el arranque.
    console.error(`[gateway] memoria: agente no creado para ${email}: ${err.message}`)
  }
  return { userId: user.user_id, userKey: user.default_user_key, teamId: team.team_id, agentId, createdAt: new Date().toISOString() }
}

/**
 * Devuelve la identidad de memoria del usuario, aprovisionándola si hace falta.
 * Cualquier fallo del stack de memoria degrada a DeepSeek directo: la memoria
 * es una mejora, nunca un bloqueo del inicio de sesión.
 */
async function ensureMemoryIdentity(user) {
  if (!cfg.memoryEnabled || !cfg.memoryAdminKey) return undefined
  const state = readMemoryState()
  const cached = state.users[user.email]
  if (cached && cached.userKey) return cached
  try {
    const identity = await provisionMemory(user.email)
    state.users[user.email] = identity
    writeMemoryState(state)
    console.log(`[gateway] memoria lista para ${user.email} (team ${identity.teamId}, agent ${identity.agentId || 'sin agente'})`)
    return identity
  } catch (err) {
    console.error(`[gateway] memoria no disponible para ${user.email}: ${err.message}; se usa DeepSeek directo`)
    return undefined
  }
}

function renderPatch(home, user, memory) {
  const clientId = resolveClientId(user)
  // Multi-empresa: todas las legal_entity_ids del usuario viajan a las tools y
  // a la vista, para que el enrutador de tenant (faberloom_mwt_find/_call)
  // pueda consultar cualquiera de sus empresas sin salirse de su alcance.
  const allClientIds = (Array.isArray(user.legalEntityIds) ? user.legalEntityIds : []).map(String)
  const companyIdsYaml = allClientIds.length === 0
    ? []
    : ['    companyIds:', ...allClientIds.map(id => `      - ${yamlScalar(id)}`)]
  // Nombres de empresa resueltos en el login (portal/me/), id -> nombre.
  const entNames = user.entNames !== null && typeof user.entNames === 'object' ? user.entNames : {}
  const companyNamesYaml = Object.keys(entNames).length === 0
    ? []
    : ['    companyNames:', ...Object.entries(entNames).map(([id, name]) => `      ${yamlScalar(id)}: ${yamlScalar(name)}`)]
  const entries = []

  // MCP de MWT.ONE (identidad por cabecera).
  {
    const headers = {
      'X-Forwarded-User-Email': user.email,
      // Secreto resuelto por el loader desde el entorno del dsh; no se escribe
      // en el archivo de parche.
      'X-MWT-Gateway-Key': yamlEnv('MWT_MCP_GATEWAY_KEY'),
      // Salta el challenge OAuth del MCP (MWT_MCP_OAUTH=1). No es un JWT.
      Authorization: 'Bearer dsh-gateway',
    }
    if (clientId) headers['X-MWT-Client-ID'] = clientId
    entries.push(renderEntry({ id: 'mcp-mwt', serverName: 'mwt', url: cfg.mcpUrl, headers, toolTimeoutMs: 120000 }))
  }

  // context-mode (MCP stdio): mantiene los datos crudos fuera del contexto del
  // modelo y guarda su índice FTS5 por usuario bajo su DSH_HOME.
  if (cfg.contextModeEnabled) {
    entries.push(renderStdioEntry({
      id: 'mcp-context-mode',
      serverName: 'context-mode',
      command: process.execPath,
      args: [cfg.contextModeEntry],
      env: {
        CONTEXT_MODE_DIR: path.join(home, 'context-mode'),
        CONTEXT_MODE_PROJECT_DIR: home,
      },
      cwd: home,
      toolTimeoutMs: cfg.contextModeTimeoutMs,
    }))
  }

  // Skills del rol: el catálogo del MCP (<rol>/<skill>/SKILL.md) se expone como
  // skills nativas del harness, sin raíces por defecto para no duplicar el
  // catálogo que ya aporta cada preset.
  const role = String(user.role || '').toLowerCase()
  const roleDir = path.join(cfg.skillsCatalogRoot, role)
  if (role.length > 0 && fs.existsSync(roleDir)) {
    entries.push([
      '    - id: faberloom-skills',
      "      name: '@deepseek-ai/dsh-skill-filesystem'",
      '      config:',
      '        providerName: faberloom-role',
      '        includeDefaultRoots: false',
      '        watch: false',
      '        customSkillDirs:',
      `          - ${yamlScalar(roleDir)}`,
    ].join('\n'))
  }

  // MCP de FaberLoom (espacios), con la identidad y la empresa del usuario.
  if (cfg.faberloomUrl && cfg.faberloomGatewayKey) {
    const headers = {
      'X-Faberloom-User-Id': user.email,
      'X-Faberloom-Gateway-Key': yamlEnv('FABERLOOM_GATEWAY_KEY'),
    }
    if (clientId) headers['X-MWT-Client-ID'] = clientId
    entries.push(renderEntry({ id: 'mcp-faberloom', serverName: 'faberloom', url: cfg.faberloomUrl, headers, toolTimeoutMs: 120000 }))
  }

  // Identidad por usuario para los módulos nativos: el bundle monta
  // `tool-faberloom`; aquí se le inyecta el email autenticado como ownerId, de
  // modo que las tools de producto actúan con la identidad de este usuario.
  const lines = [
    '- insert:',
    ...entries,
    '',
    '- id: tool-faberloom',
    '  config:',
    `    ownerId: ${yamlScalar(user.email)}`,
    `    role: ${yamlScalar(user.role || 'client_b2b')}`,
    ...(clientId ? [`    companyId: ${yamlScalar(clientId)}`] : []),
    ...companyIdsYaml,
    `    readOnly: ${user.readOnly === true ? 'true' : 'false'}`,
    `    mcpUrl: ${yamlScalar(cfg.mcpUrl)}`,
    '    mcpGatewayKey: !!js process.env.MWT_MCP_GATEWAY_KEY ?? \'\'',
    // El conversor de adjuntos que usa `faberloom_mail_read` para leer pdf/xlsx.
    `    anydoc: ${cfg.anydocEnabled ? 'true' : 'false'}`,
    `    anydocOcr: ${yamlScalar(cfg.anydocOcr)}`,
    ...(cfg.anydocApiKey ? [`    anydocApiKey: ${yamlScalar(cfg.anydocApiKey)}`] : []),
    '',
    // La vista de FaberLoom para el navegador recibe la misma identidad que las
    // tools; el actor se resuelve en el host y nunca viaja desde el cliente.
    '- id: faberloom-view',
    '  config:',
    `    ownerId: ${yamlScalar(user.email)}`,
    `    role: ${yamlScalar(user.role || 'client_b2b')}`,
    ...(clientId ? [`    companyId: ${yamlScalar(clientId)}`] : []),
    ...companyIdsYaml,
    ...companyNamesYaml,
    `    readOnly: ${user.readOnly === true ? 'true' : 'false'}`,
    // Catálogo de skills del rol, para el panel Skills.
    `    skillsCatalogRoot: ${yamlScalar(cfg.skillsCatalogRoot)}`,
    // Ingesta de adjuntos: el conversor `anydoc` ya viene instalado en el árbol.
    `    anydoc: ${cfg.anydocEnabled ? 'true' : 'false'}`,
    `    anydocOcr: ${yamlScalar(cfg.anydocOcr)}`,
    ...(cfg.anydocApiKey ? [`    anydocApiKey: ${yamlScalar(cfg.anydocApiKey)}`] : []),
    ...(memory && memory.userId
      ? [
          `    memoryCoreUrl: ${yamlScalar(cfg.memoryCoreUrl)}`,
          `    memoryServiceId: ${yamlScalar(cfg.memoryServiceId)}`,
          `    memoryUserId: ${yamlScalar(memory.userId)}`,
          `    memoryGatewayKey: ${yamlScalar(cfg.memoryGatewayKey)}`,
          `    memoryLimit: ${cfg.memoryLimit}`,
        ]
      : []),
    '',
    // La siembra inicial usa la misma identidad y la misma raíz de skills: crea
    // una vez los agentes y la rutina del plan, con las skills del rol.
    '- id: faberloom-defaults',
    '  config:',
    `    ownerId: ${yamlScalar(user.email)}`,
    `    role: ${yamlScalar(user.role || 'client_b2b')}`,
    `    readOnly: ${user.readOnly === true ? 'true' : 'false'}`,
    `    skillsCatalogRoot: ${yamlScalar(cfg.skillsCatalogRoot)}`,
    '',
    // El despachador persistente: sin el nadie inicia las rutinas con
    // disparador de fecha o recurrencia cuando el usuario no tiene el panel abierto.
    '- id: faberloom-execution',
    '  config:',
    `    ownerId: ${yamlScalar(user.email)}`,
    '    enabled: true',
    `    intervalMs: ${cfg.dispatcherIntervalMs}`,
    '',
    // Receptor de correo: sondea el IMAP que el propio usuario configuro en
    // Conexiones y convierte los mensajes nuevos en eventos de rutina.
    '- id: faberloom-inbound',
    '  config:',
    `    ownerId: ${yamlScalar(user.email)}`,
    `    enabled: ${cfg.inboundEnabled ? 'true' : 'false'}`,
    `    intervalMs: ${cfg.inboundIntervalMs}`,
    `    mailbox: ${yamlScalar(cfg.inboundMailbox)}`,
    '',
    // Plazo de las esperas: una espera sin respuesta pasa a revision en el
    // despachador en vez de quedarse parada para siempre.
    '- id: faberloom-routines',
    '  config:',
    `    waitTimeoutMs: ${cfg.waitTimeoutMs}`,
    '',
    // Servidor MCP propio: escucha en un socket del home del usuario y el
    // gateway lo publica en /mcp autenticando con el token de cada cliente.
    '- id: faberloom-mcp-server',
    '  config:',
    `    ownerId: ${yamlScalar(user.email)}`,
    '    enabled: true',
    `    socketPath: ${yamlScalar(path.join(home, 'faberloom-mcp.sock'))}`,
  ]

  // Memoria: el modelo deja de ir directo a DeepSeek y pasa por el proxy de
  // TencentDB Agent Memory, que resuelve la identidad con el `PROXY_USER_KEY`
  // del proceso y añade la inyección/registro de memoria.
  if (memory && memory.userKey) {
    lines.push(
      '',
      '- id: llm-deepseek',
      '  config:',
      '    protocol: chat-completions',
      `    baseURL: ${yamlScalar(`${cfg.memoryProxyUrl}/dsh/${cfg.memoryServiceId}`)}`,
      '    apiKeyEnv: PROXY_USER_KEY',
      '    reasoningEffort: high',
    )
  }

  return `${lines.join('\n')}\n`
}

// ── Supervisión de instancias dsh por usuario ─────────────────────────
/** @type {Map<string, {uid:string,email:string,port:number,child:import('node:child_process').ChildProcess,alive:boolean,token:string|null}>} */
const instances = new Map()
const usedPorts = new Set()

function allocatePort() {
  for (let p = cfg.dshBasePort; p < cfg.dshBasePort + 500; p++) {
    if (!usedPorts.has(p)) {
      usedPorts.add(p)
      return p
    }
  }
  throw new Error('sin puertos libres para dsh')
}

function writeUserPatch(home, user, memory) {
  const file = path.join(home, 'harness.patch.yml')
  fs.writeFileSync(file, renderPatch(home, user, memory), 'utf8')
  return file
}

// Instrucciones permanentes del espacio de trabajo. `agent-instructions` lee el
// AGENTS.md del directorio de trabajo, así que este archivo es la forma nativa
// de fijar la política de FaberLoom para cada usuario.
const FABERLOOM_INSTRUCTIONS = `# FaberLoom · reglas del espacio de trabajo

## Fuente de verdad: el MCP de MWT.ONE

- Toda la información de negocio (pedidos, expedientes, clientes, productos, precios, marcas,
  tallas, inventario, pagos, cartera, documentos, analytics) llega **exclusivamente** por las
  herramientas del MCP \`mwt\`.
- **No navegues por internet.** No uses búsquedas ni descargas web para responder. Si te piden
  algo que no está en el MCP (por ejemplo el clima), dilo y ofrece lo que sí está.
- Si el MCP no tiene el dato, **no lo inventes**: pídelo al usuario o propone la tool que falte.

## Cómo trabajar

- Antes de operar sobre un módulo, usa la **skill** del módulo y la acción (por ejemplo
  \`mwt-compras-expedientes-leer\`). Respeta el rol y los permisos: usa solo las tools
  permitidas; otra tool devuelve 403.
- Lee con \`*_listar\`/\`*_obtener\` antes de escribir, y comprueba el resultado después.
- Documentos y reportes (proformas, listados, informes) se construyen con datos del MCP;
  si piden formato, colores o plantilla, aplícalos sobre esos datos.
- **Correo**: para leer, identificar o resumir correo y sus adjuntos usa **exclusivamente** las
  tools \`faberloom_mail_search\` (imprime el \`uid\` en cada línea) y \`faberloom_mail_read\`
  (con ese \`uid\`). No adivines ni recorras uids en bucle. **No** llames a \`mwt_whoami\`,
  \`correo_mensaje_listar\`, \`expediente_buscar\`, \`cliente_listar\`, \`oc_listar\` ni a otras
  \`mcp__mwt__*\` para tareas de correo: solo contienen datos de negocio ya registrados y no
  aportan a leer el buzón. Usa las tools \`mcp__mwt__*\` **solo** cuando el usuario pida
  explícitamente consultar o crear datos de negocio (expediente, OC, cliente, factura).
  \`faberloom_mail_read\` devuelve el **texto** de los adjuntos, no el archivo: si piden el
  PDF/documento adjunto original, **no lo reconstruyas** con reportes; el original se descarga
  desde el panel Email (fila del adjunto), indícalo.
- Responde en español, con el resultado y las tools usadas.
`

function writeUserInstructions(home) {
  const file = path.join(home, 'AGENTS.md')
  fs.writeFileSync(file, FABERLOOM_INSTRUCTIONS, 'utf8')
  return file
}

function waitForToken(child, timeoutMs, onLog) {
  return new Promise((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('timeout esperando el token de dsh'))
    }, timeoutMs)
    const onData = (chunk) => {
      const text = chunk.toString('utf8')
      buf += text
      onLog(text)
      const m = buf.match(/dsh web:\s+\S*?[?&]token=([A-Za-z0-9_-]+)/)
      if (m) {
        const token = m[1]
        cleanup()
        resolve(token)
      }
    }
    const onExit = (code) => {
      cleanup()
      reject(new Error(`dsh terminó antes de estar listo (code ${code})`))
    }
    function cleanup() {
      clearTimeout(timer)
      child.stdout.off('data', onData)
      child.stderr.off('data', onData)
      child.off('exit', onExit)
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', onExit)
  })
}

function startInstance(user, memory) {
  const startedAt = Date.now()
  const home = path.join(cfg.dataDir, user.id)
  fs.mkdirSync(home, { recursive: true })
  const patchFile = writeUserPatch(home, user, memory)
  writeUserInstructions(home)
  // El perfil materializa enlaces de módulos en `<home>/profiles`; si ese
  // almacén se creó antes que un paquete nuevo (una fila añadida después), la
  // fila falla al importarse. Se retira para que el launcher lo reconstruya.
  for (const stale of [path.join(home, 'profiles', 'node_modules'), path.join(home, 'profiles', cfg.dshProfile, '.dsh-module-fallback')]) {
    try { fs.rmSync(stale, { recursive: true, force: true }) } catch { /* el launcher lo recrea igualmente */ }
  }
  const port = allocatePort()
  const dshArgs = ['--profile', cfg.dshProfile, '--patch', patchFile, '--no-open', '--port', String(port), '--trusted-host', cfg.publicHost]
  // E1 · límites por proceso. --nofile y --cpu son por proceso (seguros);
  // no se usa --as (V8 reserva mucha memoria virtual y rompería Node) ni
  // --nproc (RLIMIT_NPROC es por UID y afectaría a todas las instancias).
  const limits = []
  if (cfg.nofileLimit > 0) limits.push(`--nofile=${cfg.nofileLimit}`)
  if (cfg.cpuLimitS > 0) limits.push(`--cpu=${cfg.cpuLimitS}`)
  const spawnCmd = limits.length ? 'prlimit' : cfg.dshBin
  const spawnArgs = limits.length ? [...limits, '--', cfg.dshBin, ...dshArgs] : dshArgs
  // Cap de heap de Node por instancia (evita que un usuario agote la RAM).
  const nodeOptions = `${process.env.NODE_OPTIONS || ''} --max-old-space-size=${cfg.maxOldSpaceMb}`.trim()
  const child = spawn(
    spawnCmd,
    spawnArgs,
    {
      cwd: home,
      env: {
        ...process.env,
        DSH_HOME: home,
        DEEPSEEK_API_KEY: cfg.deepseekKey,
        // El parche referencia estos secretos como `!!js process.env.*`, así que
        // el proceso hijo debe recibir el valor resuelto (env o *_FILE).
        ...(cfg.mcpGatewayKey ? { MWT_MCP_GATEWAY_KEY: cfg.mcpGatewayKey } : {}),
        ...(cfg.faberloomGatewayKey ? { FABERLOOM_GATEWAY_KEY: cfg.faberloomGatewayKey } : {}),
        // Con memoria activa el proveedor lee este credencial-ref; el dsh sigue
        // teniendo DEEPSEEK_API_KEY como respaldo del arranque.
        ...(memory && memory.userKey ? { PROXY_USER_KEY: memory.userKey } : {}),
        DSH_WEB_URL: `https://${cfg.publicHost}/`,
        // `context-mode` otherwise falls back to Chinese in an image without a
        // system locale; the session-init form must read in English.
        CONTEXT_MODE_LOCALE: process.env.CONTEXT_MODE_LOCALE || 'en-US',
        NODE_OPTIONS: nodeOptions,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const inst = { uid: user.id, email: user.email, port, child, alive: true, token: null }
  metrics.dshSpawns += 1
  logEvent({ ev: 'dsh_spawn', account: user.email, port, memory: Boolean(memory && memory.userKey) })
  child.on('exit', (code) => {
    inst.alive = false
    usedPorts.delete(port)
    metrics.dshExits += 1
    logEvent({ ev: 'dsh_exit', account: user.email, port, code, uptimeMs: Date.now() - startedAt })
    console.error(`[gateway] dsh de ${user.email} terminó (code ${code})`)
  })
  inst.ready = waitForToken(child, cfg.dshReadyTimeoutMs, (t) => process.stdout.write(`[dsh:${user.id.slice(0, 8)}] ${t}`))
    .then((token) => {
      inst.token = token
      return inst
    })
    .catch((err) => {
      inst.alive = false
      usedPorts.delete(port)
      try { child.kill('SIGKILL') } catch { /* noop */ }
      instances.delete(user.id)
      throw err
    })
  instances.set(user.id, inst)
  return inst
}

async function ensureInstance(user) {
  if (cfg.staticDshPort) {
    const existing = instances.get(user.id)
    if (existing) return existing
    const inst = {
      uid: user.id,
      email: user.email,
      port: cfg.staticDshPort,
      token: cfg.staticDshToken,
      alive: true,
      child: { kill() {} },
    }
    instances.set(user.id, inst)
    return inst
  }
  const existing = instances.get(user.id)
  if (existing) {
    if (existing.alive && existing.token) return existing
    if (existing.alive) return existing.ready
    instances.delete(user.id)
  }
  const memory = await ensureMemoryIdentity(user)
  return startInstance(user, memory).ready
}

// ── Proxy ─────────────────────────────────────────────────────────────
const proxy = httpProxy.createProxyServer({ ws: true, changeOrigin: false, secure: false, xfwd: false })
proxy.on('error', (err, req, res) => {
  console.error('[gateway] proxy error:', err.message)
  if (res && typeof res.writeHead === 'function' && !res.headersSent) {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('upstream dsh no disponible\n')
  } else if (res && typeof res.destroy === 'function') {
    res.destroy()
  }
})

const app = express()
app.disable('x-powered-by')
app.set('trust proxy', true)

// ── M9 · fuentes del healthcheck ampliado ─────────────────────────────
function readFileSafe(file, max = 4096) {
  try { return fs.readFileSync(file, 'utf8').slice(0, max) } catch { return null }
}
function backupStatus() {
  try {
    const stat = fs.statSync(cfg.backupStatusFile)
    return { file: cfg.backupStatusFile, at: stat.mtime.toISOString(), text: (readFileSafe(cfg.backupStatusFile, 300) || '').trim() }
  } catch {
    return { file: cfg.backupStatusFile, at: null, text: null }
  }
}
function buildIdentity() {
  const forkSha = (readFileSafe(cfg.forkShaFile, 64) || '').trim() || null
  const manifest = readFileSafe(cfg.manifestFile, 8000)
  // "Drift": el manifiesto debe citar el SHA construido; si no, la imagen y lo
  // declarado divergen. Null cuando falta el SHA o el manifiesto (no hay señal).
  const manifestDrift = forkSha === null || manifest === null ? null : !manifest.includes(forkSha)
  return { forkSha, manifest: cfg.manifestFile, manifestPresent: manifest !== null, manifestDrift }
}

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    publicHost: cfg.publicHost,
    consolaApi: cfg.consolaApi,
    mcpConfigured: Boolean(cfg.mcpGatewayKey),
    faberloomConfigured: Boolean(cfg.faberloomUrl && cfg.faberloomGatewayKey),
    memoryEnabled: cfg.memoryEnabled,
    memoryConfigured: cfg.memoryEnabled && Boolean(cfg.memoryAdminKey),
    contextModeEnabled: cfg.contextModeEnabled,
    dispatcher: {
      intervalMs: cfg.dispatcherIntervalMs,
      inboundEnabled: cfg.inboundEnabled,
      inboundIntervalMs: cfg.inboundEnabled ? cfg.inboundIntervalMs : null,
      waitTimeoutMs: cfg.waitTimeoutMs,
    },
    lastBackup: backupStatus(),
    build: buildIdentity(),
    rateLimits: { loginPerMin: cfg.loginRateLimitPerMin, mcpPerMin: cfg.mcpRateLimitPerMin },
    instances: instances.size,
  })
})

// M4 · métricas Prometheus para observabilidad por instancia.
app.get('/metrics', (_req, res) => {
  res.type('text/plain; version=0.0.4').send(prometheus({ instances: instances.size }))
})

app.get('/login', (req, res) => {
  const sess = getSession(req)
  if (sess) {
    const ents = Array.isArray(sess.ents) ? sess.ents : []
    // G7 · una sesión con varias empresas y sin entidad elegida va al selector.
    if (ents.length > 1 && (typeof sess.ent !== 'string' || sess.ent.length === 0)) return res.redirect(303, '/entity')
    return res.redirect(303, '/')
  }
  // M7 · el token se reutiliza si ya existe. Rotarlo en cada GET invalidaba el
  // formulario de otra pestaña o el de una petición posterior del navegador a
  // /login (favicon/extensión), que es lo que producía "sesión del formulario
  // expiró" con un token que el usuario acababa de recibir.
  const carried = csrfCookies(req)
  const csrf = carried[0] ?? newCsrfToken()
  if (carried.length === 0) res.setHeader('Set-Cookie', csrfCookieValue(csrf))
  res.type('html').send(loginPage(req.query.e, csrf))
})

app.post('/login', express.urlencoded({ extended: false }), async (req, res) => {
  const usuario = String(req.body.usuario || '').trim()
  const password = String(req.body.password || '')
  if (!usuario || !password) return res.redirect(303, '/login?e=missing')
  // M6 · rate limit por cuenta además del de nginx por IP (protección tras NAT).
  if (!loginAccountLimiter(usuario.toLowerCase()) || !loginIpLimiter(req.ip || 'unknown')) {
    metrics.logins.limited += 1
    metrics.rateLimited.login += 1
    logEvent({ ev: 'login', result: 'limited', account: usuario })
    return res.redirect(303, '/login?e=limited')
  }
  // M7 · CSRF: el campo oculto debe coincidir con la cookie fijada en GET /login.
  if (!verifyCsrf(req)) {
    metrics.logins.auth += 1
    logEvent({ ev: 'login', result: 'csrf', account: usuario })
    return res.redirect(303, '/login?e=csrf')
  }
  let resp
  try {
    resp = await fetch(`${cfg.consolaApi}/auth/login/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ usuario, password }),
    })
  } catch (err) {
    console.error('[gateway] consola login inalcanzable:', err.message)
    metrics.logins.upstream += 1
    return res.redirect(303, '/login?e=upstream')
  }
  if (!resp.ok) {
    metrics.logins.auth += 1
    logEvent({ ev: 'login', result: 'auth', account: usuario })
    return res.redirect(303, `/login?e=auth`)
  }
  let data
  try {
    data = await resp.json()
  } catch {
    metrics.logins.auth += 1
    return res.redirect(303, '/login?e=auth')
  }
  const user = data.user
  if (!user || !user.id || !user.email) {
    metrics.logins.auth += 1
    return res.redirect(303, '/login?e=auth')
  }

  const legalEntityIds = Array.isArray(user.legal_entity_ids) ? user.legal_entity_ids : []
  // G7 · tenant automático: se conserva la empresa elegida antes y, si no hay, se
  // usa la principal de la cuenta (`legal_entity_id` de la ficha del usuario). Solo
  // se ofrece el selector cuando ninguna de las dos existe.
  const allowed = legalEntityIds.map(String)
  const priorEntity = readUserState(user.email)?.entityId
  const defaultEntity = await resolveDefaultEntity(data.access, String(user.id))
  const entityId = [priorEntity, defaultEntity]
    .find(candidate => typeof candidate === 'string' && allowed.includes(candidate))
  // G7 · nombres de empresa para el selector manual y para el parche del dsh.
  // Best-effort: si la consola no responde, se muestra el id y nada más.
  const entNames = await resolveEntityNames(data.access, allowed)
  const sessionUser = {
    id: user.id,
    email: user.email,
    legalEntityIds,
    ...(entityId === undefined ? {} : { entityId }),
    ...(Object.keys(entNames).length === 0 ? {} : { entNames }),
    role: typeof user.role === 'string' ? user.role : '',
    readOnly: deriveReadOnly(user),
  }

  let inst
  try {
    rememberUser(sessionUser)
    inst = await ensureInstance(sessionUser)
  } catch (err) {
    console.error('[gateway] no se pudo arrancar dsh:', err.message)
    return res.redirect(303, '/login?e=harness')
  }
  const payload = {
    uid: user.id,
    email: user.email,
    name: user.full_name || '',
    ents: legalEntityIds,
    ...(Object.keys(entNames).length === 0 ? {} : { entNames }),
    ...(entityId === undefined ? {} : { ent: entityId }),
    exp: Date.now() + cfg.cookieTtlMs,
  }
  const exchange = await exchangeDshToken(inst.port, inst.token)
  res.setHeader('Set-Cookie', [sessionCookieValue(payload), ...exchange.cookies])
  metrics.logins.ok += 1
  logEvent({ ev: 'login', result: 'ok', account: user.email, role: sessionUser.role, entity: entityId ?? null })
  // G7 · el tenant se resolvió solo; el selector (/entity) queda como cambio
  // manual, no como paso obligatorio.
  const home = '/'
  if (exchange.cookies.length > 0) {
    res.redirect(303, home)
  } else {
    // Respaldo: si el canje interno falla, conserva el comportamiento anterior.
    console.error('[gateway] canje de cookie de dsh vacio; se usa el token en la URL')
    res.redirect(303, `${home}?token=${encodeURIComponent(inst.token)}`)
  }
})

// G7 · Empresa por defecto del usuario según la consola (`legal_entity_id` de su
// ficha). Es best-effort: sin ella se conserva la elegida antes o no se fija
// tenant. Evita obligar a elegir cuando la cuenta ya tiene una empresa principal.
async function resolveDefaultEntity(accessToken, userId) {
  if (typeof accessToken !== 'string' || accessToken.length === 0 || typeof userId !== 'string') return undefined
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  try {
    const response = await fetch(`${cfg.consolaApi}/users/${encodeURIComponent(userId)}/`, {
      headers: { authorization: `Bearer ${accessToken}`, accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return undefined
    const record = await response.json()
    return typeof record?.legal_entity_id === 'string' && record.legal_entity_id.length > 0 ? record.legal_entity_id : undefined
  } catch {
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

// G7 · Resuelve id de empresa → nombre comercial para etiquetar el selector.
// Devuelve un mapa (posiblemente vacío); nunca lanza. `is_parent=all` incluye las
// subsidiarias, que también pueden ser el `legal_entity_id` de un usuario.
async function resolveEntityNames(accessToken, ids) {
  if (typeof accessToken !== 'string' || accessToken.length === 0 || ids.length === 0) return {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 4000)
  const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/json' }
  const wanted = new Set(ids.map(String))
  const names = {}
  /** Keep only the wanted ids, preferring the first non-empty label. */
  const add = (id, ...labels) => {
    const key = id === undefined || id === null ? '' : String(id)
    if (key.length === 0 || !wanted.has(key) || names[key] !== undefined) return
    const label = labels.find(value => typeof value === 'string' && value.trim().length > 0)
    if (typeof label === 'string') names[key] = label.trim()
  }
  try {
    // `portal/me/` works for every role (client_b2b gets 403 on `clientes/`);
    // it returns `empresas: [{ id, nombre, razon_social }]`.
    try {
      const me = await fetch(`${cfg.consolaApi}/portal/me/`, { headers, signal: controller.signal })
      if (me.ok) {
        const data = await me.json()
        for (const empresa of data?.empresas ?? []) {
          if (empresa === null || typeof empresa !== 'object') continue
          add(empresa.id, empresa.nombre, empresa.razon_social)
        }
      }
    } catch {
      // Fall through to the clientes/ fallback.
    }
    if (Object.keys(names).length === 0) {
      const response = await fetch(`${cfg.consolaApi}/clientes/?is_parent=all`, { headers, signal: controller.signal })
      if (response.ok) {
        const payload = await response.json()
        const rows = Array.isArray(payload) ? payload : (payload?.results ?? [])
        for (const row of rows) {
          if (row === null || typeof row !== 'object') continue
          add(row.id, row.nombre_comercial, row.razon_social)
        }
      }
    }
    return names
  } catch {
    return names
  } finally {
    clearTimeout(timer)
  }
}

// G7 · Selector de entidad: con varias empresas no hay tenant único. El usuario
// elige una, el gateway reinicia su dsh con el parche que fija X-MWT-Client-ID.
app.get('/entity', (req, res) => {
  const sess = getSession(req)
  if (!sess) return res.redirect(303, '/login')
  const ents = Array.isArray(sess.ents) ? sess.ents.map(String) : []
  if (ents.length <= 1) return res.redirect(303, '/')
  // Los nombres también quedan en el estado del gateway, así una cookie emitida
  // antes de resolverlos no obliga a reiniciar sesión para verlos.
  const names = sess.entNames !== undefined ? sess.entNames : readUserState(sess.email)?.entNames
  res.type('html').send(entityPage({ ...sess, entNames: names }, req.query.e))
})

app.post('/entity', express.urlencoded({ extended: false }), async (req, res) => {
  const sess = getSession(req)
  if (!sess) return res.redirect(303, '/login')
  const ents = Array.isArray(sess.ents) ? sess.ents.map(String) : []
  const chosen = String(req.body.entidad || '').trim()
  if (chosen !== '' && !ents.includes(chosen)) return res.redirect(303, '/entity?e=invalid')
  const entityId = chosen === '' ? undefined : chosen
  const inst = instances.get(sess.uid)
  if (inst) {
    try { inst.child.kill('SIGTERM') } catch { /* noop */ }
    instances.delete(sess.uid)
    usedPorts.delete(inst.port)
  }
  const stored = readUserState(sess.email) || { id: sess.uid, email: sess.email, role: 'client_b2b', readOnly: false }
  let exchange = { cookies: [] }
  try {
    const restarted = await ensureInstance({ ...stored, legalEntityIds: ents, ...(entityId === undefined ? {} : { entityId }) })
    exchange = await exchangeDshToken(restarted.port, restarted.token)
  } catch (err) {
    console.error('[gateway] no se pudo reiniciar dsh al elegir entidad:', err.message)
    return res.redirect(303, '/entity?e=harness')
  }
  rememberUser({ ...stored, legalEntityIds: ents, ...(entityId === undefined ? {} : { entityId }) })
  const payload = {
    uid: sess.uid,
    email: sess.email,
    name: sess.name || '',
    ents,
    ...(sess.entNames === undefined ? {} : { entNames: sess.entNames }),
    ...(entityId === undefined ? {} : { ent: entityId }),
    exp: Date.now() + cfg.cookieTtlMs,
  }
  res.setHeader('Set-Cookie', [sessionCookieValue(payload), ...exchange.cookies])
  res.redirect(303, '/')
})

// Servidor MCP de FaberLoom: el cliente se autentica con el token que el
// propietario le dio, y el gateway enruta al dsh de ese propietario por el
// socket de su home. El gateway no guarda tokens: los localiza en el almacén
// del producto y sólo reenvía.
app.post('/mcp', express.raw({ type: '*/*', limit: '512kb' }), async (req, res) => {
  const started = Date.now()
  // M1 · rate limit por IP cliente antes de tocar el almacén o arrancar un dsh.
  if (!mcpLimiter(req.ip || 'unknown')) {
    metrics.mcpRequests.limited += 1
    metrics.rateLimited.mcp += 1
    logEvent({ ev: 'mcp', result: 'limited', ip: req.ip })
    return res.status(429).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'demasiadas peticiones' } })
  }
  const header = req.get('authorization') || ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  const refuse = (status, message) => {
    metrics.mcpRequests.denied += 1
    logEvent({ ev: 'mcp', result: 'denied', status, ip: req.ip })
    return res.status(status).json({ jsonrpc: '2.0', id: null, error: { code: -32000, message } })
  }
  if (!token) return refuse(401, 'falta el token Bearer')
  const owner = findOwnerByMcpToken(token)
  if (!owner) return refuse(401, 'token desconocido o revocado')
  const stored = readUserState(owner.email)
  if (!stored) return refuse(503, 'el propietario debe entrar una vez en FaberLoom')
  try {
    await ensureInstance({ ...stored, legalEntityIds: stored.legalEntityIds || [] })
  } catch (error) {
    console.error('[gateway] no se pudo arrancar dsh para MCP:', error.message)
    return refuse(503, 'no se pudo arrancar el harness del propietario')
  }
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}))
  const upstream = http.request({
    socketPath: path.join(owner.home, 'faberloom-mcp.sock'),
    path: '/mcp',
    method: 'POST',
    headers: { authorization: header, 'content-type': 'application/json', 'content-length': body.length, accept: req.get('accept') || 'application/json' },
  }, (reply) => {
    metrics.mcpRequests.ok += 1
    logEvent({ ev: 'mcp', result: 'ok', status: reply.statusCode || 502, owner: owner.email, ms: Date.now() - started })
    res.status(reply.statusCode || 502)
    for (const [name, value] of Object.entries(reply.headers)) {
      if (name.toLowerCase() === 'transfer-encoding') continue
      if (value !== undefined) res.setHeader(name, value)
    }
    reply.pipe(res)
  })
  upstream.on('error', () => refuse(502, 'el servidor MCP del propietario no responde'))
  upstream.end(body)
})

app.get('/logout', (req, res) => {
  const sess = getSession(req)
  if (sess) {
    const inst = instances.get(sess.uid)
    if (inst) {
      try { inst.child.kill('SIGTERM') } catch { /* noop */ }
      instances.delete(sess.uid)
      usedPorts.delete(inst.port)
    }
  }
  clearSessionCookie(res)
  res.redirect(303, '/login?e=bye')
})

// Catch-all: exige sesión y proxya al dsh del usuario. M3 · si la sesión firmada
// sigue viva pero el proceso dsh se perdió (p. ej. tras un redeploy), se vuelve a
// arrancar en el momento desde gateway-users.json, sin obligar a re-login.
app.use(async (req, res) => {
  const sess = getSession(req)
  if (!sess) return res.redirect(303, '/login')
  let inst = instances.get(sess.uid)
  if (!inst || !inst.alive || !inst.token) {
    const stored = readUserState(sess.email)
    if (stored) {
      try {
        await ensureInstance({
          ...stored,
          legalEntityIds: stored.legalEntityIds || [],
          ...(typeof sess.ent === 'string' && sess.ent.length > 0 ? { entityId: sess.ent } : {}),
        })
        logEvent({ ev: 'session_respawn', account: sess.email })
      } catch (err) {
        console.error('[gateway] no se pudo reanudar el dsh de la sesión:', err.message)
      }
    }
    inst = instances.get(sess.uid) ?? inst
    if (!inst || !inst.alive || !inst.token) {
      clearSessionCookie(res)
      return res.redirect(303, '/login?e=expired')
    }
  }
  proxy.web(req, res, { target: `http://127.0.0.1:${inst.port}` })
})

const server = http.createServer(app)

server.on('upgrade', (req, socket, head) => {
  const sess = getSession(req)
  const inst = sess ? instances.get(sess.uid) : undefined
  if (!inst || !inst.alive || !inst.token) {
    socket.destroy()
    return
  }
  proxy.ws(req, socket, head, { target: `http://127.0.0.1:${inst.port}` })
})

// ── Apagado ordenado ──────────────────────────────────────────────────
function shutdown() {
  console.log('[gateway] apagando…')
  for (const inst of instances.values()) {
    try { inst.child.kill('SIGTERM') } catch { /* noop */ }
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

server.listen(cfg.port, '0.0.0.0', () => {
  console.log(`[gateway] escuchando en :${cfg.port} · host=${cfg.publicHost} · consola=${cfg.consolaApi}`)
  if (!cfg.mcpGatewayKey) console.warn('[gateway] MWT_MCP_GATEWAY_KEY vacío: el MCP no confiará la identidad')
  if (!cfg.deepseekKey) console.warn('[gateway] DEEPSEEK_API_KEY vacío: el harness no tendrá modelo')
  if (cfg.memoryEnabled) {
    if (!cfg.memoryAdminKey) console.warn('[gateway] memoria activada sin MEMORY_ADMIN_KEY: se usa DeepSeek directo')
    else console.log(`[gateway] memoria activa · core=${cfg.memoryCoreUrl} · proxy=${cfg.memoryProxyUrl} · serviceId=${cfg.memoryServiceId}`)
  }
})

// ── Página de login ───────────────────────────────────────────────────
/** Escape text interpolated into HTML (names and ids come from the console). */
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

// G7 · Página del selector de entidad (tenant). La etiqueta es el nombre de la
// empresa cuando el gateway pudo resolverlo (`entNames`), con el id debajo para
// soporte; el usuario también puede no fijar ninguna.
function entityPage(sess, errCode) {
  const ents = Array.isArray(sess.ents) ? sess.ents.map(String) : []
  const names = sess.entNames !== null && typeof sess.entNames === 'object' ? sess.entNames : {}
  const current = typeof sess.ent === 'string' ? sess.ent : ''
  const messages = {
    invalid: 'Esa entidad no pertenece a tu cuenta.',
    harness: 'No se pudo reiniciar tu espacio de trabajo con la entidad elegida. Reintenta.',
  }
  const msg = messages[errCode] || ''
  const option = (id) => {
    const name = names[id]
    const label = typeof name === 'string' && name.length > 0
      ? `<span class="name">${escapeHtml(name)}</span><span class="id">${escapeHtml(id)}</span>`
      : `<span class="name">${escapeHtml(id)}</span><span class="id">sin nombre en la consola</span>`
    return `
      <label class="opt"><input type="radio" name="entidad" value="${escapeHtml(id)}"${id === current ? ' checked' : ''}> ${label}</label>`
  }
  const options = ents.map(option).join('')
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cambiar de empresa · Harness MWT.ONE</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0B1E3A;color:#E8EDF3}
  .card{width:420px;max-width:92vw;background:#102846;border:1px solid #1d3a5f;border-radius:14px;
        padding:28px;box-shadow:0 10px 40px rgba(0,0,0,.35)}
  h1{font-size:18px;margin:0 0 4px}
  p.sub{margin:0 0 16px;font-size:13px;color:#94A7B8}
  .opt{display:flex;gap:10px;align-items:center;padding:11px 12px;border:1px solid #274a72;border-radius:9px;
       margin-top:8px;background:#0B1E3A;font-size:14px}
  .name{font-weight:600}
  .id{display:block;font-size:11px;color:#94A7B8;margin-top:2px;font-family:ui-monospace,Consolas,monospace}
  button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:9px;background:#13B98A;color:#04231a;
         font-weight:700;font-size:14px;cursor:pointer}
  button:hover{background:#17c997}
  .err{margin-top:16px;padding:10px 12px;border-radius:8px;background:#3a1720;border:1px solid #7a2b3a;
       color:#ffb4c0;font-size:13px}
</style></head>
<body>
  <form class="card" method="post" action="/entity">
    <h1>Cambiar de empresa</h1>
    <p class="sub">Tu cuenta tiene varias empresas y FaberLoom ya trabaja con tu empresa principal. Cámbiala solo si necesitas operar como otra: el tenant viaja al MCP en cada llamada.</p>
    ${options}
    <label class="opt"><input type="radio" name="entidad" value=""${current === '' ? ' checked' : ''}> Sin entidad (no fijar tenant)</label>
    <button type="submit">Usar esta entidad</button>
    ${msg ? `<div class="err">${msg}</div>` : ''}
  </form>
</body></html>`
}

function loginPage(errCode, csrf = '') {
  const messages = {
    missing: 'Escribe usuario y contraseña.',
    auth: 'Usuario o contraseña incorrectos.',
    upstream: 'La consola no responde. Intenta de nuevo.',
    harness: 'No se pudo iniciar tu espacio de trabajo. Reintenta.',
    expired: 'Tu sesión expiró. Inicia de nuevo.',
    bye: 'Sesión cerrada.',
    limited: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
    csrf: 'La sesión del formulario expiró. Recarga la página e inténtalo de nuevo.',
  }
  const msg = messages[errCode] || ''
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Harness MWT.ONE</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
       font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0B1E3A;color:#E8EDF3}
  .card{width:360px;max-width:92vw;background:#102846;border:1px solid #1d3a5f;border-radius:14px;
        padding:28px;box-shadow:0 10px 40px rgba(0,0,0,.35)}
  h1{font-size:18px;margin:0 0 4px}
  p.sub{margin:0 0 20px;font-size:13px;color:#94A7B8}
  label{display:block;font-size:12px;color:#94A7B8;margin:14px 0 6px}
  input{width:100%;padding:11px 12px;border-radius:9px;border:1px solid #274a72;background:#0B1E3A;color:#E8EDF3;font-size:14px}
  input:focus{outline:none;border-color:#13B98A}
  .secret{position:relative;display:block}
  .secret input{padding-right:40px}
  /* The card's rule styles every button; the toggle is an icon, not the submit. */
  #secret-toggle{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:28px;height:28px;padding:0;margin:0;
                 border:0;border-radius:8px;background:transparent;color:#94A7B8;cursor:pointer;
                 display:inline-flex;align-items:center;justify-content:center}
  #secret-toggle:hover{background:#16304f;color:#E8EDF3}
  button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:9px;background:#13B98A;color:#04231a;
         font-weight:700;font-size:14px;cursor:pointer}
  button:hover{background:#17c997}
  .err{margin-top:16px;padding:10px 12px;border-radius:8px;background:#3a1720;border:1px solid #7a2b3a;
       color:#ffb4c0;font-size:13px}
</style></head>
<body>
  <form class="card" method="post" action="/login">
    <h1>Harness MWT.ONE</h1>
    <p class="sub">Entra con tu usuario de la consola</p>
    <input type="hidden" name="_csrf" value="${csrf}">
    <label for="usuario">Usuario o correo</label>
    <input id="usuario" name="usuario" autocomplete="username" autofocus required>
    <label for="password">Contraseña</label>
    <span class="secret">
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="button" id="secret-toggle" aria-label="Mostrar la contraseña" aria-pressed="false" title="Mostrar la contraseña"></button>
    </span>
    <button type="submit">Entrar</button>
    ${msg ? `<div class="err">${msg}</div>` : ''}
  </form>
  <script>
    // Reveal/hide the password without leaving the form.
    (function () {
      var toggle = document.getElementById('secret-toggle')
      var field = document.getElementById('password')
      if (toggle === null || field === null) return
      var eye = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">'
        + '<path fill="none" stroke="currentColor" stroke-width="1.3" d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4Z"/>'
        + '<circle cx="8" cy="8" r="1.9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>'
      var eyeOff = eye.replace('</svg>', '<path fill="none" stroke="currentColor" stroke-width="1.3" d="M3 13 13 3"/></svg>')
      var setState = function (visible) {
        var label = visible ? 'Ocultar la contraseña' : 'Mostrar la contraseña'
        toggle.innerHTML = visible ? eyeOff : eye
        toggle.setAttribute('aria-label', label)
        toggle.setAttribute('title', label)
        toggle.setAttribute('aria-pressed', visible ? 'true' : 'false')
      }
      setState(false)
      toggle.addEventListener('click', function () {
        var visible = field.type === 'password'
        field.type = visible ? 'text' : 'password'
        setState(visible)
        field.focus()
      })
    })()
  </script>
</body></html>`
}
