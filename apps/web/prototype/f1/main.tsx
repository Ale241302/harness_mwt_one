/**
 * F1 prototype page: the email surface and the iteration window with synthetic
 * messages, both looks and both themes, so the appearance gate can run in a real
 * browser instead of being described.
 *
 * Query: `?look=a|b&theme=light|dark`. The look persists in localStorage through
 * `appearance.ts`, exactly as the product will; the query is only there to make a
 * capture deterministic.
 */
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { EmailLayout } from '../../../../packages/client/ui-faberloom/src/client/email-layout.tsx'
import { TaskChatWindow } from '../../../../packages/client/ui-faberloom/src/client/task-chat-window.tsx'
import { emailEs, taskChatEs } from '../../../../packages/client/ui-faberloom/src/client/locales/email.ts'
import {
  readStoredLook,
  resolveLookPreference,
  writeStoredLook,
  type LookId,
} from '../../../../packages/client/ui-faberloom/src/client/appearance.ts'
import { paletteById } from '../../../../packages/client/ui-theme/src/theme-palettes.ts'
import type { EmailRow } from '../../../../packages/client/ui-faberloom/src/client/email-store.ts'
import '../../../../packages/client/ui-theme/src/styles/design-platform.css'
import '../../../../packages/client/ui-theme/src/styles/base.css'

const rows: readonly EmailRow[] = [
  {
    id: 'r1',
    from: 'Distribuidora Central (sintético)',
    to: ['compras@ejemplo.test'],
    cc: ['gerencia@ejemplo.test'],
    bcc: [],
    subject: 'Proforma 2026-014, 240 pares de botas',
    body: 'Adjunto la proforma 2026-014 con 240 pares de botas de seguridad. El precio unitario es de 48 dólares y el flete se cotiza aparte.',
    attachments: ['proforma-2026-014.pdf'],
    received: '09:12',
    unread: true,
    revision: 2,
    synthetic: true,
    suggestion: 'Adjunto la proforma 2026-014 con 240 pares de botas de seguridad. El precio unitario queda en 46 dólares y el flete se cotiza aparte.',
  },
  {
    id: 'r2',
    from: 'Ferretería del Valle (sintético)',
    to: ['compras@ejemplo.test'],
    cc: [],
    bcc: [],
    subject: 'Consulta por 60 cascos y 20 arneses',
    body: 'Necesitamos cotizar 60 cascos y 20 arneses para el segundo semestre. Te paso el detalle en el cuerpo del correo.',
    attachments: [],
    received: '10:41',
    unread: false,
    revision: 1,
    synthetic: true,
  },
  {
    id: 'r3',
    from: 'Importadora Pacífico (sintético)',
    to: ['compras@ejemplo.test'],
    cc: ['auditoria@ejemplo.test'],
    bcc: ['archivo@ejemplo.test'],
    subject: 'Cambio de precio en el pedido 882',
    body: 'El pedido 882 cambio de precio por flete marítimo. Quedo pendiente de tu criterio para confirmar.',
    attachments: ['pedido-882.xlsx', 'flete.pdf'],
    received: '11:05',
    unread: false,
    revision: 4,
    synthetic: true,
  },
]

const params = new URLSearchParams(window.location.search)
const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
const forced = params.get('look')
// The gate must see the loading and error screens in a real browser, not only in
// jsdom; the phase is a query so the capture is deterministic and labelled synthetic.
const phaseParam = params.get('phase')
const phase = phaseParam === 'loading' || phaseParam === 'error' ? phaseParam : 'ready'

function Root() {
  const [look, setLook] = useState<LookId>(() =>
    forced === null ? readStoredLook(window.localStorage) : resolveLookPreference(forced),
  )

  useEffect(() => {
    const palette = paletteById(theme) ?? paletteById('light')
    if (palette === undefined) return
    for (const [name, value] of Object.entries(palette.tokens)) {
      document.body.style.setProperty(name, value)
    }
    document.body.style.backgroundColor = palette.ground
    document.body.toggleAttribute('data-ds-dark-theme', palette.colorScheme === 'dark')
    document.documentElement.style.colorScheme = palette.colorScheme
  }, [])

  return (
    <>
      <EmailLayout
        rows={rows}
        labels={emailEs}
        look={look}
        phase={phase}
        onRetry={() => { window.location.reload() }}
        onLookChange={(next) => {
          setLook(next)
          writeStoredLook(window.localStorage, next)
        }}
      />
      {phase === 'ready' ? (
        <div style={{ padding: '0 16px 16px' }}>
          <TaskChatWindow
            labels={taskChatEs}
            context={{ title: rows[0]?.subject ?? '', detail: rows[0]?.from ?? '' }}
          />
        </div>
      ) : null}
    </>
  )
}

const container = document.getElementById('root')
if (container === null) throw new Error('missing #root')
createRoot(container).render(<Root />)
