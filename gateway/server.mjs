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

const cfg = {
  port: Number(process.env.PORT || 8080),
  consolaApi: (process.env.CONSOLA_API_BASE || 'https://consola.mwt.one/api').replace(/\/+$/, ''),
  publicHost: process.env.PUBLIC_HOST || 'harness.mwt.one',
  deepseekKey: process.env.DEEPSEEK_API_KEY || '',
  dataDir: process.env.DATA_DIR || '/data/users',
  dshBasePort: Number(process.env.DSH_BASE_PORT || 3100),
  dshBin: process.env.DSH_BIN || 'dsh',
  mcpUrl: process.env.MWT_MCP_URL || 'http://consola-mwt-one-mcp:8765/mcp',
  mcpGatewayKey: process.env.MWT_MCP_GATEWAY_KEY || '',
  mcpClientId: process.env.MWT_MCP_CLIENT_ID || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  // Sesión del gateway (la del harness dura 30 días por defecto).
  cookieName: 'hgate',
  cookieTtlMs: Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000),
  dshReadyTimeoutMs: Number(process.env.DSH_READY_TIMEOUT_MS || 120000),
  // Modo estático (solo pruebas locales): usa un dsh ya en marcha en vez
  // de arrancar procesos hijos.
  staticDshPort: process.env.STATIC_DSH_PORT ? Number(process.env.STATIC_DSH_PORT) : 0,
  staticDshToken: process.env.STATIC_DSH_TOKEN || '',
}

if (!cfg.sessionSecret) {
  console.error('[gateway] FATAL: SESSION_SECRET no está definido')
  process.exit(1)
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
function setSessionCookie(res, payload) {
  const maxAge = Math.max(0, Math.floor((payload.exp - Date.now()) / 1000))
  const secure = process.env.COOKIE_SECURE === '1' ? '; Secure' : ''
  res.setHeader(
    'Set-Cookie',
    `${cfg.cookieName}=${encodeURIComponent(signSession(payload))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`,
  )
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${cfg.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`)
}

// ── Render del overlay de dsh (MCP por usuario) ───────────────────────
function yamlScalar(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}
function renderPatch(user) {
  const headers = {
    'X-Forwarded-User-Email': user.email,
    'X-MWT-Gateway-Key': cfg.mcpGatewayKey,
    // Salta el challenge OAuth del MCP (MWT_MCP_OAUTH=1). No es un JWT.
    Authorization: 'Bearer dsh-gateway',
  }
  if (cfg.mcpClientId) headers['X-MWT-Client-ID'] = cfg.mcpClientId
  const headerLines = Object.entries(headers)
    .map(([k, v]) => `          ${k}: ${yamlScalar(v)}`)
    .join('\n')
  return [
    '- insert:',
    '    - id: mcp-mwt',
    "      name: '@deepseek-ai/dsh-mcp-client'",
    '      config:',
    '        serverName: mwt',
    '        transport: streamable-http',
    `        url: ${yamlScalar(cfg.mcpUrl)}`,
    '        headers:',
    headerLines,
    '        failOnStartupError: false',
    '        reconnect:',
    '          enabled: true',
    '          maxAttempts: 30',
    '        toolCallTimeoutMs: 120000',
    '',
  ].join('\n')
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

function writeUserPatch(home, user) {
  const file = path.join(home, 'harness.patch.yml')
  fs.writeFileSync(file, renderPatch(user), 'utf8')
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

function startInstance(user) {
  const home = path.join(cfg.dataDir, user.id)
  fs.mkdirSync(home, { recursive: true })
  const patchFile = writeUserPatch(home, user)
  const port = allocatePort()
  const child = spawn(
    cfg.dshBin,
    ['--profile', 'web', '--patch', patchFile, '--no-open', '--port', String(port), '--trusted-host', cfg.publicHost],
    {
      cwd: home,
      env: {
        ...process.env,
        DSH_HOME: home,
        DEEPSEEK_API_KEY: cfg.deepseekKey,
        DSH_WEB_URL: `https://${cfg.publicHost}/`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  const inst = { uid: user.id, email: user.email, port, child, alive: true, token: null }
  child.on('exit', (code) => {
    inst.alive = false
    usedPorts.delete(port)
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
  return startInstance(user).ready
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

app.get('/healthz', (_req, res) => {
  res.json({
    ok: true,
    publicHost: cfg.publicHost,
    consolaApi: cfg.consolaApi,
    mcpConfigured: Boolean(cfg.mcpGatewayKey),
    instances: instances.size,
  })
})

app.get('/login', (req, res) => {
  const sess = getSession(req)
  if (sess) return res.redirect(303, '/')
  res.type('html').send(loginPage(req.query.e))
})

app.post('/login', express.urlencoded({ extended: false }), async (req, res) => {
  const usuario = String(req.body.usuario || '').trim()
  const password = String(req.body.password || '')
  if (!usuario || !password) return res.redirect(303, '/login?e=missing')
  let resp
  try {
    resp = await fetch(`${cfg.consolaApi}/auth/login/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ usuario, password }),
    })
  } catch (err) {
    console.error('[gateway] consola login inalcanzable:', err.message)
    return res.redirect(303, '/login?e=upstream')
  }
  if (!resp.ok) {
    return res.redirect(303, `/login?e=auth`)
  }
  let data
  try {
    data = await resp.json()
  } catch {
    return res.redirect(303, '/login?e=auth')
  }
  const user = data.user
  if (!user || !user.id || !user.email) return res.redirect(303, '/login?e=auth')

  let inst
  try {
    inst = await ensureInstance(user)
  } catch (err) {
    console.error('[gateway] no se pudo arrancar dsh:', err.message)
    return res.redirect(303, '/login?e=harness')
  }
  setSessionCookie(res, { uid: user.id, email: user.email, name: user.full_name || '', exp: Date.now() + cfg.cookieTtlMs })
  // Redirige una sola vez con el token de proceso para que dsh fije su cookie.
  res.redirect(303, `/?token=${encodeURIComponent(inst.token)}`)
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

// Catch-all: exige sesión y proxya al dsh del usuario.
app.use((req, res) => {
  const sess = getSession(req)
  if (!sess) return res.redirect(303, '/login')
  const inst = instances.get(sess.uid)
  if (!inst || !inst.alive || !inst.token) {
    clearSessionCookie(res)
    return res.redirect(303, '/login?e=expired')
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
})

// ── Página de login ───────────────────────────────────────────────────
function loginPage(errCode) {
  const messages = {
    missing: 'Escribe usuario y contraseña.',
    auth: 'Usuario o contraseña incorrectos.',
    upstream: 'La consola no responde. Intenta de nuevo.',
    harness: 'No se pudo iniciar tu espacio de trabajo. Reintenta.',
    expired: 'Tu sesión expiró. Inicia de nuevo.',
    bye: 'Sesión cerrada.',
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
    <label for="usuario">Usuario o correo</label>
    <input id="usuario" name="usuario" autocomplete="username" autofocus required>
    <label for="password">Contraseña</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Entrar</button>
    ${msg ? `<div class="err">${msg}</div>` : ''}
  </form>
</body></html>`
}
