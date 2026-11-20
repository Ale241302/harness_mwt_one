'use strict'

const { createHash } = require('node:crypto')
const net = require('node:net')
const tls = require('node:tls')

const DATA_TERMINATOR = Buffer.from('\r\n.\r\n')

function finalSmtpStatus(buffer) {
  let start = 0
  while (start < buffer.length) {
    const end = buffer.indexOf('\r\n', start)
    if (end === -1 || end - start < 3) return null
    const digits = buffer.subarray(start, start + 3).toString('ascii')
    if (!/^\d{3}$/.test(digits)) return null
    if (end - start === 3 || buffer[start + 3] === 0x20) return Number(digits)
    start = end + 2
  }
  return null
}

function exactSubject(headers) {
  const unfolded = headers.replace(/\r\n[ \t]+/g, ' ')
  for (const line of unfolded.split('\r\n')) {
    const colon = line.indexOf(':')
    if (colon !== -1 && line.slice(0, colon).toLowerCase() === 'subject') {
      return line.slice(colon + 1).trim()
    }
  }
  return null
}

/**
 * Create a loopback SMTP proxy that withholds a successful DATA result only for
 * the configured exact Subject. Upstream connections always use implicit TLS.
 * @param {{targetSubject: string, upstreamHost?: string, upstreamPort?: number,
 * rejectUnauthorized?: boolean, writeLog?: (line: string) => void}} options
 * @returns {import('node:net').Server}
 */
function createSmtpCutProxy(options) {
  if (!options.targetSubject) throw new Error('targetSubject must not be empty')
  const upstreamHost = options.upstreamHost ?? 'smtp.hostinger.com'
  const upstreamPort = options.upstreamPort ?? 465
  const rejectUnauthorized = options.rejectUnauthorized ?? true
  const writeLog = options.writeLog ?? (line => process.stdout.write(`${line}\n`))
  const subjectHash = createHash('sha256').update(options.targetSubject, 'utf8').digest('hex')

  return net.createServer(client => {
    const upstream = tls.connect({ host: upstreamHost, port: upstreamPort, rejectUnauthorized })
    let state = 'commands'
    let commandBuffer = Buffer.alloc(0)
    let responseBuffer = Buffer.alloc(0)
    let headerBuffer = Buffer.alloc(0)
    let dataTail = Buffer.alloc(0)
    let headersComplete = false
    let target = false

    function resetData() {
      responseBuffer = Buffer.alloc(0)
      headerBuffer = Buffer.alloc(0)
      dataTail = Buffer.alloc(0)
      headersComplete = false
      target = false
    }

    function observeData(chunk) {
      if (!headersComplete) {
        headerBuffer = Buffer.concat([headerBuffer, chunk])
        const end = headerBuffer.indexOf('\r\n\r\n')
        if (end !== -1) {
          target = exactSubject(headerBuffer.subarray(0, end).toString('utf8')) === options.targetSubject
          headerBuffer = Buffer.alloc(0)
          headersComplete = true
        }
      }
      const scan = Buffer.concat([dataTail, chunk])
      dataTail = scan.subarray(Math.max(0, scan.length - DATA_TERMINATOR.length + 1))
      if (scan.indexOf(DATA_TERMINATOR) !== -1) state = 'awaitingResult'
    }

    function cutAfterAcceptedData() {
      state = 'cut'
      writeLog(JSON.stringify({
        timestamp: new Date().toISOString(),
        action: 'cut_after_data_250',
        subjectHash,
      }))
      client.destroy()
      upstream.destroy()
    }

    client.pause()
    upstream.once('secureConnect', () => client.resume())

    client.on('data', chunk => {
      if (state === 'commands') {
        upstream.write(chunk)
        commandBuffer = Buffer.concat([commandBuffer, chunk])
        let end = commandBuffer.indexOf('\r\n')
        while (end !== -1) {
          const command = commandBuffer.subarray(0, end).toString('ascii')
          commandBuffer = commandBuffer.subarray(end + 2)
          if (command.toUpperCase() === 'DATA') {
            state = 'awaitingData'
            commandBuffer = Buffer.alloc(0)
            break
          }
          end = commandBuffer.indexOf('\r\n')
        }
      } else if (state === 'data') {
        upstream.write(chunk)
        observeData(chunk)
      } else if (state === 'awaitingData') {
        upstream.write(chunk)
      }
    })

    upstream.on('data', chunk => {
      if (state !== 'awaitingData' && state !== 'awaitingResult') {
        if (state !== 'cut') client.write(chunk)
        return
      }
      responseBuffer = Buffer.concat([responseBuffer, chunk])
      const status = finalSmtpStatus(responseBuffer)
      if (status === null) return
      const response = responseBuffer
      responseBuffer = Buffer.alloc(0)
      if (state === 'awaitingData') {
        client.write(response)
        resetData()
        state = status === 354 ? 'data' : 'commands'
      } else if (status === 250 && target) {
        cutAfterAcceptedData()
      } else {
        client.write(response)
        resetData()
        state = 'commands'
      }
    })

    const disconnect = () => {
      client.destroy()
      upstream.destroy()
    }
    client.on('error', disconnect)
    upstream.on('error', disconnect)
    client.once('close', () => upstream.destroy())
    upstream.once('close', () => client.destroy())
  })
}

function startFromEnvironment() {
  const targetSubject = process.env.SMTP_CUT_PROXY_SUBJECT
  if (!targetSubject) throw new Error('SMTP_CUT_PROXY_SUBJECT must be configured')
  const rawPort = process.env.SMTP_CUT_PROXY_PORT ?? '2525'
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('SMTP_CUT_PROXY_PORT must be an integer from 0 to 65535')
  }
  const server = createSmtpCutProxy({ targetSubject })
  server.listen(port, '127.0.0.1')
  return server
}

module.exports = { createSmtpCutProxy }

if (require.main === module) startFromEnvironment()
