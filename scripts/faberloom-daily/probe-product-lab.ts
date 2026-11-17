/**
 * Mide la función de correo existente del producto contra el laboratorio.
 *
 * No crea transporte nuevo: llama a `probeSmtp` y `sendSmtp` del paquete
 * `@deepseek-ai/dsh-faberloom-connections`, que ya existen. Solo cambia el
 * destino mediante variables de entorno, para que el laboratorio no se
 * confunda con un buzón real.
 *
 * Uso: `LAB_SMTP_PORT=13025 LAB_SUBJECT=... pnpm exec tsx scripts/faberloom-daily/probe-product-lab.ts`
 */

import { probeSmtp, sendSmtp } from '../../packages/faberloom/connections/src/smtp.ts'

const host = process.env['LAB_SMTP_HOST'] ?? '127.0.0.1'
const port = Number(process.env['LAB_SMTP_PORT'] ?? '3025')
const subject = process.env['LAB_SUBJECT'] ?? `producto-lab-${Date.now()}`

const credentials = {
  id: 'lab-a',
  label: 'laboratorio piloto-a',
  host,
  port,
  secure: false,
  starttls: false,
  username: 'piloto-a',
  password: 'lab-only-a',
} as const

const report: Record<string, unknown> = { host, port, subject }

try {
  const probe = await probeSmtp(credentials)
  report['probe'] = probe
} catch (error) {
  report['probe'] = { ok: false, detail: error instanceof Error ? error.message : String(error) }
}

try {
  const sent = await sendSmtp(credentials, {
    to: ['piloto-b@faberloom.test'],
    subject,
    text: 'mensaje del producto FaberLoom contra el laboratorio, sin datos reales',
  })
  report['send'] = sent
} catch (error) {
  report['send'] = { ok: false, detail: error instanceof Error ? error.message : String(error) }
}

console.log(JSON.stringify(report, null, 2))
process.exit(report['send'] && (report['send'] as { messageId?: string }).messageId ? 0 : 1)
