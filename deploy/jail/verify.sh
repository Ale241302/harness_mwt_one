#!/bin/sh
# verify.sh · comprueba, DESDE DENTRO de una corrida enjaulada, que la jaula hace
# lo que promete. Es el artefacto de evidencia de `node-jail`: cada caso imprime
# PASS o FAIL y el script sale ≠0 si alguno falla.
#
#   a) escribe en su propio home
#   b) no puede leer /data/users/<otro>/storages
#   c) no resuelve DNS ni abre un socket TCP
#   d) no ve procesos de otros
#   e) no puede escribir fuera de su home
#
# Uso, en el contenedor del gateway:
#
#   docker exec -it mwt-one-harness-gateway /opt/dsh/bin/verify.sh <inquilino> [<otro>]
#
# <inquilino> es el nombre del directorio bajo /data/users; sin argumentos se
# toma el del directorio de trabajo. <otro> se autodetecta como el primer
# inquilino distinto que exista en el host.
#
# El chequeo corre dentro de la MISMA jaula que usa producción: este script
# resuelve las rutas fuera y ejecuta el comprobador con `node-jail`, así que un
# fallo del enjaulado (bwrap sin namespaces, seccomp del contenedor, perfil mal
# aplicado) falla aquí y no en una prueba paralela que no toca el camino real.

set -eu

USERS=/data/users
JAIL=/opt/dsh/bin/node-jail

die() {
  printf 'verify: %s\n' "$1" >&2
  exit 2
}

[ -x "$JAIL" ] || die "no existe $JAIL"
[ "$(uname -s)" = Linux ] || die 'esto debe correr en Linux (el contenedor del gateway)'

home_arg=${1:-}
if [ -n "$home_arg" ]; then
  case $home_arg in
    /*) home=$home_arg ;;
    *) home=$USERS/$home_arg ;;
  esac
else
  cwd=$(pwd -P)
  case $cwd in
    "$USERS"/*) ;;
    *) die "ejecuta desde $USERS/<inquilino> o pasa el inquilino como primer argumento" ;;
  esac
  rest=${cwd#"$USERS"/}
  home=$USERS/${rest%%/*}
fi

case $home in
  "$USERS"/*/*) die "el inquilino debe ser $USERS/<id>, no $home" ;;
  "$USERS"/*) ;;
  *) die "el inquilino debe estar bajo $USERS: $home" ;;
esac
[ -d "$home" ] || die "el home no es un directorio: $home"

other=${2:-}
if [ -z "$other" ]; then
  for candidate in "$USERS"/*; do
    if [ -d "$candidate" ] && [ "$candidate" != "$home" ]; then
      other=$candidate
      break
    fi
  done
fi
if [ -z "$other" ]; then
  other=$USERS/__inquilino-de-prueba__
fi

printf 'verify: inquilino=%s otro=%s\n' "$home" "$other"

cd "$home" || die "no se pudo entrar en $home"

# El comprobador viaja por stdin para no dejar ningún archivo en el home ni
# depender de una ruta escribible dentro de la jaula.
exec "$JAIL" - "$other" <<'PTC_VERIFY'
'use strict'

const fs = require('node:fs')
const net = require('node:net')
const dns = require('node:dns').promises

const other = process.argv[2] || ''
const home = process.env.HOME || ''
const cwd = process.cwd()
const results = []

function record (name, ok, detail) {
  results.push({ name, ok })
  process.stdout.write((ok ? 'PASS  ' : 'FAIL  ') + name + (detail ? ' · ' + detail : '') + '\n')
}

function errorCode (error) {
  if (error === null || error === undefined) return 'sin error'
  return String(error.code || error.message || error)
}

// Una lectura que debe fallar: solo ENOENT/ENOTDIR/EACCES/EPERM prueban que el
// camino no existe para este inquilino. Cualquier otra cosa es "sin veredicto".
function readBlocked (path) {
  try {
    fs.readFileSync(path)
    return { blocked: false, detail: 'LEÍDO' }
  } catch (error) {
    const code = errorCode(error)
    const conclusive = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(code)
    return { blocked: conclusive, detail: code }
  }
}

function writeBlocked (path) {
  try {
    fs.writeFileSync(path, 'x')
    return { blocked: false, detail: 'ESCRITO' }
  } catch (error) {
    const code = errorCode(error)
    const conclusive = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EROFS'].includes(code)
    return { blocked: conclusive, detail: code }
  }
}

function tcpProbe (host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const settle = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(3000, () => settle({ blocked: false, detail: host + ':' + port + ' sin veredicto (timeout)' }))
    socket.once('connect', () => settle({ blocked: false, detail: host + ':' + port + ' CONECTÓ' }))
    socket.once('error', (error) => settle({ blocked: true, detail: host + ':' + port + ' ' + errorCode(error) }))
  })
}

async function dnsProbe () {
  const attempt = dns.lookup('mwt.one').then(
    (value) => ({ blocked: false, detail: 'resolvió a ' + JSON.stringify(value) }),
    (error) => ({ blocked: true, detail: errorCode(error) }),
  )
  const timeout = new Promise((resolve) => setTimeout(
    () => resolve({ blocked: true, detail: 'sin respuesta del resolutor' }),
    8000,
  ))
  return Promise.race([attempt, timeout])
}

function visibleProcesses () {
  let entries
  try {
    entries = fs.readdirSync('/proc')
  } catch (error) {
    return { visible: false, detail: errorCode(error) }
  }
  const pids = entries.filter((entry) => /^\d+$/.test(entry))
  const cmdlines = pids.map((pid) => {
    try {
      return fs.readFileSync('/proc/' + pid + '/cmdline', 'utf8').replace(/\0/g, ' ').trim()
    } catch {
      return ''
    }
  })
  return { visible: true, pids, cmdlines }
}

async function main () {
  // 0 · la corrida está realmente enjaulada. Sin esto, un PASS posterior no
  // probaría nada.
  record('jaula activa', process.env.DSH_PTC_JAIL === '1', 'DSH_PTC_JAIL=' + String(process.env.DSH_PTC_JAIL))

  const homeUnderUsers = /^\/data\/users\/[^/]+$/.test(home)
  record('home propio en /data/users/<id>', homeUnderUsers, home || '(HOME vacío)')

  // a · escribe en su propio home
  const probe = cwd + '/.verify-' + process.pid
  try {
    fs.writeFileSync(probe, 'verify\n')
    const back = fs.readFileSync(probe, 'utf8')
    fs.unlinkSync(probe)
    record('a · escribe en su home', back === 'verify\n', probe)
  } catch (error) {
    record('a · escribe en su home', false, errorCode(error) + ' en ' + probe)
  }

  // b · no lee los storages de otro inquilino
  const otherPaths = other === '' ? [] : [other, other + '/storages', other + '/storages/faberloom_mcp.json']
  const otherResults = otherPaths.map((path) => ({ path, ...readBlocked(path) }))
  const otherLeak = otherResults.find((result) => !result.blocked)
  record(
    'b · no lee otro inquilino',
    otherLeak === undefined,
    otherLeak === undefined
      ? otherResults.map((result) => result.path.replace('/data/users/', '') + '=' + result.detail).join(' ')
      : 'LEYÓ ' + otherLeak.path,
  )

  let usersListing = ''
  try {
    usersListing = fs.readdirSync('/data/users').join(',')
  } catch (error) {
    usersListing = 'error:' + errorCode(error)
  }
  const ownId = home.replace('/data/users/', '')
  record('/data/users solo contiene el inquilino', usersListing === ownId, usersListing || '(vacío)')

  // c · sin red
  const dnsResult = await dnsProbe()
  record('c1 · DNS no resuelve', dnsResult.blocked, dnsResult.detail)
  const tcpRemote = await tcpProbe('1.1.1.1', 443)
  record('c2 · TCP saliente cerrado', tcpRemote.blocked, tcpRemote.detail)
  const tcpLoopback = await tcpProbe('127.0.0.1', 9)
  record('c3 · TCP loopback cerrado', tcpLoopback.blocked, tcpLoopback.detail)

  // d · no ve procesos de otros
  const proc = visibleProcesses()
  const foreign = proc.visible ? proc.cmdlines.filter((line) => /gateway\/server\.mjs|context-mode|mwt-one-harness|dsh --profile/.test(line)) : []
  record(
    'd · no ve procesos ajenos',
    proc.visible && foreign.length === 0,
    proc.visible
      ? proc.pids.length + ' pid(s)' + (foreign.length > 0 ? ' · ajenos: ' + foreign.join(' | ') : '')
      : '/proc ilegible: ' + proc.detail,
  )

  // e · no escribe fuera de su home
  const readOnlyTarget = writeBlocked('/opt/dsh/.verify-' + process.pid)
  const otherTarget = other === '' ? { blocked: true, detail: 'sin otro inquilino' } : writeBlocked(other + '/.verify-' + process.pid)
  record('e1 · no escribe en /opt/dsh', readOnlyTarget.blocked, readOnlyTarget.detail)
  record('e2 · no escribe en otro inquilino', otherTarget.blocked, otherTarget.detail)

  const failed = results.filter((result) => !result.ok)
  process.stdout.write('\nverify: ' + (results.length - failed.length) + '/' + results.length + ' PASS\n')
  process.exitCode = failed.length === 0 ? 0 : 1
}

main().catch((error) => {
  process.stdout.write('FAIL  comprobador interrumpido · ' + errorCode(error) + '\n')
  process.exitCode = 1
})
PTC_VERIFY
