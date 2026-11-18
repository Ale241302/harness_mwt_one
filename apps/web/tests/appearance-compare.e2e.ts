/**
 * F1 appearance gate, run in a real browser against the built prototype.
 *
 * The gate cannot be satisfied by a screenshot: it needs the running page at four
 * widths, both looks, both themes, measured contrast, a keyboard walk with visible
 * focus, a clean console, and proof that a look changes paint only. This spec does
 * that and writes the captures under `docs/scratch/faberloom-daily-work/f1/`.
 */
import { createServer, type Server } from 'node:http'
import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'

const DIST = fileURLToPath(new URL('../prototype/f1/dist', import.meta.url))
const CAPTURES = fileURLToPath(new URL('../../../docs/scratch/faberloom-daily-work/f1/captures', import.meta.url))
const LOOKS = ['a', 'b'] as const
const THEMES = ['light', 'dark'] as const
const VIEWPORTS = [
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1024x768', width: 1024, height: 768 },
  { name: '390x844', width: 390, height: 844 },
] as const
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

let server: Server
let origin = ''
let browser: Browser

/** Serve the prototype build with the few MIME types it uses. */
function listen(): Promise<string> {
  return new Promise((done, fail) => {
    server = createServer((request, response) => {
      const requested = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/')
      const relative = normalize(requested === '/' ? 'index.html' : requested.replace(/^\/+/, ''))
      const target = resolve(DIST, relative)
      if (!target.startsWith(resolve(DIST)) || !existsSync(target)) {
        response.writeHead(404)
        response.end('not found')
        return
      }
      response.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream' })
      createReadStream(target).pipe(response)
    })
    server.on('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        fail(new Error('no port'))
        return
      }
      done(`http://127.0.0.1:${address.port}`)
    })
  })
}

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

/** Foreground and the first opaque background above it. */
async function colours(page: Page, selector: string): Promise<{ fg: string; bg: string }> {
  return await page.evaluate((sel: string) => {
    const element = document.querySelector(sel)
    if (element === null) throw new Error(`missing ${sel}`)
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
  }, selector)
}

beforeAll(async () => {
  if (!existsSync(join(DIST, 'index.html'))) throw new Error('prototype not built: run vite build --config prototype/f1/vite.config.ts')
  origin = await listen()
  mkdirSync(CAPTURES, { recursive: true })
  browser = await chromium.launch()
}, 120_000)

afterAll(async () => {
  await browser?.close()
  await new Promise<void>((done) => { server.close(() => { done() }) })
})

/**
 * Open the prototype with a look and a theme at one viewport.
 * @param look - look id the page must start with.
 * @param theme - colour mode.
 * @param viewport - viewport the page gets.
 * @param errors - optional collector that receives console errors from the first byte.
 */
async function openPage(
  look: string,
  theme: string,
  viewport: { width: number; height: number },
  errors?: string[],
): Promise<Page> {
  const page = await browser.newPage({ viewport })
  // Listening before `goto` is the difference between "la consola está limpia"
  // and "no oí los errores del arranque".
  if (errors !== undefined) {
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${look}/${theme}: ${message.text()}`)
    })
    page.on('pageerror', (error) => { errors.push(`${look}/${theme}: ${String(error)}`) })
  }
  await page.goto(`${origin}/?look=${look}&theme=${theme}`)
  await page.getByRole('listbox').waitFor()
  return page
}

/** One cell of the size × theme matrix the appearance gate has to fill. */
interface MatrixCell {
  readonly look: string
  readonly theme: string
  readonly view: string
  readonly shot: string
  readonly overflow: boolean
  readonly minTarget: number | null
}

describe('appearance gate', () => {
  it('renders the same screen in both looks, at three widths and two themes', async () => {
    const consoleErrors: string[] = []
    const cells: MatrixCell[] = []
    for (const theme of THEMES) {
      for (const look of LOOKS) {
        for (const viewport of VIEWPORTS) {
          const page = await openPage(look, theme, viewport, consoleErrors)
          const shot = `${look}-${theme}-${viewport.name}.png`
          await page.screenshot({ path: join(CAPTURES, shot), fullPage: true })
          const text = await page.locator('section[aria-label]').first().innerText()
          expect(text, `${look}/${theme}/${viewport.name} keeps the same content`).toContain('Proforma 2026-014')
          const overflow = await page.evaluate(() => document.scrollingElement !== null
            && document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 1)
          expect({ look, theme, view: viewport.name, overflow }).toEqual({ look, theme, view: viewport.name, overflow: false })
          // Targets are measured on the narrow width, where a miss costs a tap;
          // the wide layout keeps the house density.
          const minTarget = viewport.width <= 390
            ? await page.evaluate(() => [...document.querySelectorAll('button')]
              .map(button => button.getBoundingClientRect().height)
              .reduce((lowest, height) => Math.min(lowest, height), Number.POSITIVE_INFINITY))
            : null
          if (minTarget !== null) expect(minTarget, `${look}/${theme}/${viewport.name} tap target`).toBeGreaterThanOrEqual(44)
          cells.push({ look, theme, view: viewport.name, shot, overflow, minTarget })
          await page.close()
        }
      }
    }
    await writeFile(
      join(CAPTURES, 'matrix.json'),
      JSON.stringify({ renderedAt: new Date().toISOString(), cells }, null, 2),
    )
    expect(cells).toHaveLength(12)
    expect(consoleErrors).toEqual([])
  }, 180_000)

  it('paints the loading and error phases in the browser, not only in jsdom', async () => {
    const phases = [
      { phase: 'loading', title: 'Cargando la bandeja', retry: false },
      { phase: 'error', title: 'No se pudo cargar la bandeja', retry: true },
    ] as const
    for (const entry of phases) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
      const errors: string[] = []
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
      page.on('pageerror', (error) => { errors.push(String(error)) })
      await page.goto(`${origin}/?look=a&theme=light&phase=${entry.phase}`)
      const surface = page.locator('section[aria-label]').first()
      await surface.waitFor()
      const text = await surface.innerText()
      expect(text, `${entry.phase} title`).toContain(entry.title)
      expect({ phase: entry.phase, busy: await surface.getAttribute('aria-busy') })
        .toEqual({ phase: entry.phase, busy: entry.phase === 'loading' ? 'true' : 'false' })
      expect({ phase: entry.phase, retry: await page.getByRole('button', { name: 'Reintentar' }).count() })
        .toEqual({ phase: entry.phase, retry: entry.retry ? 1 : 0 })
      await page.screenshot({ path: join(CAPTURES, `phase-${entry.phase}.png`), fullPage: true })
      expect(errors).toEqual([])
      await page.close()
    }
  }, 120_000)

  it('measures contrast in both looks and both themes', async () => {
    const failures: string[] = []
    const measurements: { look: string; theme: string; pair: string; ratio: number; minimum: number }[] = []
    for (const theme of THEMES) {
      for (const look of LOOKS) {
        const page = await openPage(look, theme, { width: 1440, height: 900 })
        await page.getByRole('option').first().click()
        await page.getByRole('textbox', { name: 'Borrador' }).waitFor()
        const pairs: { name: string; selector: string; minimum: number }[] = [
          { name: 'título', selector: 'h1', minimum: 4.5 },
          { name: 'remitente', selector: '[role="option"] span', minimum: 4.5 },
          { name: 'fecha', selector: 'span[class*="rowDate"]', minimum: 4.5 },
          { name: 'primario', selector: 'button[class*="primary"]', minimum: 4.5 },
          { name: 'aviso de datos', selector: 'p[class*="synthetic"]', minimum: 4.5 },
          { name: 'estado', selector: 'p[class*="status"]', minimum: 4.5 },
        ]
        for (const pair of pairs) {
          const { fg, bg } = await colours(page, pair.selector)
          const value = ratio(fg, bg)
          measurements.push({ look, theme, pair: pair.name, ratio: Number(value.toFixed(2)), minimum: pair.minimum })
          if (value < pair.minimum) failures.push(`${look}/${theme} ${pair.name}: ${value.toFixed(2)} < ${pair.minimum}`)
        }
        await page.close()
      }
    }
    await writeFile(
      join(CAPTURES, 'measurements.json'),
      JSON.stringify({ measuredAt: new Date().toISOString(), measurements }, null, 2),
    )
    expect(failures).toEqual([])
  }, 180_000)

  it('walks with the keyboard, keeps focus visible, and moves it with the screen', async () => {
    const page = await openPage('a', 'light', { width: 1440, height: 900 })
    const stops: { step: number; tag: string; label: string; inList: boolean; ring: boolean }[] = []
    const seen = new Set<string>()
    let openedFromList = false
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press('Tab')
      const stop = await page.evaluate((index: number) => {
        const element = document.activeElement as HTMLElement | null
        if (element === null) return { step: index, tag: 'none', label: 'none', inList: false, ring: false }
        const style = getComputedStyle(element)
        return {
          step: index,
          tag: element.tagName,
          label: (element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40),
          inList: element.closest('[role="listbox"]') !== null,
          // A focus ring is an outline; "it has focus" is not the same as
          // "a person can see where the focus is".
          ring: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0,
        }
      }, step)
      // Stop when the walk comes back to a stop it already visited, or when the
      // browser hands focus to the document at the end of the tab order: a
      // second pass would double-count the list, and BODY has nothing to paint.
      if (stop.tag === 'BODY') break
      const key = `${stop.tag}:${stop.label}`
      if (seen.has(key)) break
      seen.add(key)
      stops.push(stop)
      if (stop.inList && !openedFromList) {
        // Opening with Enter moves focus to the message; Escape closes it and
        // returns focus to the row, so the keyboard never has to guess.
        await page.keyboard.press('Enter')
        await expect.poll(async () => await page.evaluate(() => (document.activeElement?.textContent ?? '').includes('Proforma 2026-014'))).toBe(true)
        const readingRing = await page.evaluate(() => {
          const element = document.activeElement as HTMLElement | null
          if (element === null) return false
          const style = getComputedStyle(element)
          return style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0
        })
        expect(readingRing).toBe(true)
        await page.keyboard.press('Escape')
        await expect.poll(async () => await page.evaluate(() => document.activeElement?.getAttribute('role') ?? '')).toBe('option')
        openedFromList = true
      }
    }
    await writeFile(join(CAPTURES, 'keyboard.json'), JSON.stringify({ stops }, null, 2))
    // The list is one tab stop: one full pass lands inside it once, never twice.
    expect(stops.filter(stop => stop.inList)).toHaveLength(1)
    expect(stops.filter(stop => !stop.ring)).toEqual([])
    expect(stops.length).toBeGreaterThanOrEqual(5)
    expect(openedFromList).toBe(true)
    await page.close()
  }, 120_000)

  it('closes the iteration window with Escape and returns focus to its launcher', async () => {
    const page = await openPage('a', 'light', { width: 1440, height: 900 })
    const launcher = page.getByRole('button', { name: 'Iterar sobre este correo' })
    await launcher.click()
    await page.getByRole('dialog').waitFor()
    await page.screenshot({ path: join(CAPTURES, 'window-open.png'), fullPage: true })
    await page.keyboard.press('Escape')
    await expect.poll(async () => await page.getByRole('dialog').count()).toBe(0)
    const focused = await page.evaluate(() => (document.activeElement as HTMLElement | null)?.textContent ?? '')
    expect(focused).toContain('Iterar sobre este correo')
    await page.close()
  }, 120_000)

  it('holds at 200 % zoom in both looks and both themes without horizontal scroll', async () => {
    const zoomCells: MatrixCell[] = []
    for (const theme of THEMES) {
      for (const look of LOOKS) {
        const page = await browser.newPage({ viewport: { width: 720, height: 450 } })
        const errors: string[] = []
        page.on('console', (message) => {
          if (message.type() === 'error') errors.push(`${look}/${theme}: ${message.text()}`)
        })
        page.on('pageerror', (error) => { errors.push(`${look}/${theme}: ${String(error)}`) })
        await page.goto(`${origin}/?look=${look}&theme=${theme}`)
        await page.getByRole('listbox').waitFor()
        await page.evaluate(() => { document.documentElement.style.zoom = '2' })
        await page.waitForTimeout(200)
        const text = await page.locator('section[aria-label]').first().innerText()
        expect(text, `${look}/${theme}/zoom200 keeps the same content`).toContain('Proforma 2026-014')
        const overflow = await page.evaluate(() => document.scrollingElement !== null
          && document.scrollingElement.scrollWidth > document.scrollingElement.clientWidth + 2)
        expect({ look, theme, overflow }).toEqual({ look, theme, overflow: false })
        const shot = `${look}-${theme}-zoom200.png`
        await page.screenshot({ path: join(CAPTURES, shot), fullPage: true })
        zoomCells.push({ look, theme, view: 'zoom200', shot, overflow, minTarget: null })
        expect(errors).toEqual([])
        await page.close()
      }
    }
    // One matrix, sixteen rows: the zoom cells are not a footnote of the capture
    // set, and a reader must not have to join two files to see the whole gate.
    const path = join(CAPTURES, 'matrix.json')
    const current = existsSync(path)
      ? JSON.parse(await readFile(path, 'utf8')) as { cells: MatrixCell[] }
      : { cells: [] }
    const viewportCells = current.cells.filter(cell => cell.view !== 'zoom200')
    await writeFile(
      path,
      JSON.stringify({ renderedAt: new Date().toISOString(), cells: [...viewportCells, ...zoomCells] }, null, 2),
    )
    expect(zoomCells).toHaveLength(4)
  }, 120_000)

  it('shows the same approval snapshot in both looks', async () => {
    const snapshots: string[] = []
    for (const look of LOOKS) {
      const page = await openPage(look, 'light', { width: 1440, height: 900 })
      await page.getByRole('option').first().click()
      await page.getByRole('button', { name: 'Revisar y aprobar' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      // `textContent`, not `innerText`: one look renders labels in upper case, and
      // that transform is presentation, not a different snapshot.
      snapshots.push(((await dialog.evaluate(element => element.textContent)) ?? '').replace(/\s+/g, ' ').trim())
      await page.close()
    }
    expect(snapshots[0]).toBe(snapshots[1])
    expect(snapshots[0]).toContain('proforma-2026-014.pdf')
  }, 120_000)

  it('keeps the chosen look after a reload', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(`${origin}/?theme=light`)
    await page.getByRole('listbox').waitFor()
    const before = await page.locator('section[aria-label]').first().getAttribute('class')
    await page.getByRole('button', { name: /Cambiar look/ }).click()
    const after = await page.locator('section[aria-label]').first().getAttribute('class')
    expect(after).not.toBe(before)

    await page.reload()
    await page.getByRole('listbox').waitFor()
    const reloaded = await page.locator('section[aria-label]').first().getAttribute('class')
    expect(reloaded).toBe(after)
    await page.close()
  }, 120_000)

  it('keeps both looks inside presentation: only custom properties', async () => {
    for (const look of LOOKS) {
      const css = await readFile(fileURLToPath(new URL(`../../../packages/client/ui-faberloom/src/client/looks/look-${look}.module.css`, import.meta.url)), 'utf8')
      const declarations = css
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.endsWith(';'))
      expect(declarations.length).toBeGreaterThan(5)
      for (const declaration of declarations) expect(declaration.startsWith('--fl-look-')).toBe(true)
      expect(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(css)).toBe(false)
    }
  })
})
