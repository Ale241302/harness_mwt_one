// Web e2e: the Chat panel explains what grounds a proposal. The real Space
// services back the view, so the three cases of the experience filter are read
// from real memory and real shared context: no base (no proposal at all), one
// approved fact (cited with its origin), and two approved facts that disagree
// (both shown). No model call is involved.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { newEnglishPage } from './support.ts'

const OVERLAY = fileURLToPath(new URL('./experience-panel.overlay.yml', import.meta.url))
const BUNDLE = fileURLToPath(new URL('../../../packages/bundle/faberloom-app/package.json', import.meta.url))
const SHOTS = fileURLToPath(new URL('../../../docs/scratch/faberloom-daily-work/e1/visual/', import.meta.url))

const ACTOR = { id: 'e2e@mwt.one', role: 'admin', readOnly: false }
const REQUEST = 'Preparar la cotización de Eguisa con el incoterm y el flete que ya sabemos.'
const FACT_DDP = 'Eguisa trabaja DDP y el flete va incluido en el precio.'

describe('web e2e: the Chat panel explains what grounds a proposal', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let spaceId: string

  /** The product services this scenario seeds through. */
  function services() {
    return scaffold.ctx as unknown as {
      faberloomView: { remember: (text: string, spaceId?: string) => Promise<unknown> }
      faberloomContext: {
        create: (actor: unknown, input: { title: string; body: string; spaceId: string }) => Promise<{ id: string }>
        approve: (actor: unknown, id: string) => Promise<unknown>
      }
      faberloomSpaces: { list: (actor: unknown) => Promise<readonly { id: string; title: string }[]> }
    }
  }

  /** Ask the panel to ground the request and wait for the answer to settle. */
  async function propose(): Promise<void> {
    await page.getByRole('button', { name: 'Propose' }).click()
    await expect.poll(async () => await page.getByRole('button', { name: 'Propose' }).isEnabled()).toBe(true)
  }

  beforeAll(async () => {
    mkdirSync(SHOTS, { recursive: true })
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: [BUNDLE] })
    const folder = join(scaffold.workspaceCwd, 'eguisa')
    mkdirSync(folder, { recursive: true })
    const view = scaffold.ctx as unknown as {
      faberloomView: { createSpaceFromFolder: (title: string, path: string) => Promise<unknown> }
    }
    await view.faberloomView.createSpaceFromFolder('Eguisa', folder)
    const created = (await services().faberloomSpaces.list(ACTOR)).find(space => space.title === 'Eguisa')
    if (created === undefined) throw new Error('the Space created from the folder is missing')
    spaceId = created.id

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    page.setDefaultTimeout(20_000)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    // The Chat landing owns the proposal gesture; it lives in the Work group.
    const chat = page.getByRole('button', { name: /^Chat/u }).first()
    if (await chat.count() === 0) await page.getByRole('button', { name: /^Work/u }).first().click()
    await chat.click()
    await page.getByRole('heading', { name: 'What do you want to solve today?' }).waitFor({ timeout: 20_000 })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.getByRole('textbox', { name: 'Describe the work' }).fill(REQUEST)
    await page.getByRole('combobox').first().selectOption({ label: 'Eguisa' })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('shows no proposal when the Space has no approved base', async () => {
    await propose()
    await page.getByText('No base: nothing is proposed').waitFor()
    await page.screenshot({ path: `${SHOTS}panel-01-no-base.png` })
    expect(await page.getByText('Proposed result').count()).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  })

  it('cites the approved fact with its origin', async () => {
    await services().faberloomView.remember(FACT_DDP, spaceId)
    await propose()
    await page.getByText('With base: what supports it is cited').waitFor()
    await page.getByText(FACT_DDP).waitFor()
    await page.getByText(/^memory:/u).waitFor()
    await page.getByText('Proposed result').waitFor()
    await page.screenshot({ path: `${SHOTS}panel-02-with-base.png` })
  })

  it('shows both approved values when the same topic disagrees', async () => {
    const context = services().faberloomContext
    for (const body of ['Eguisa trabaja DDP con el flete incluido.', 'Eguisa trabaja FOB y el flete se cobra aparte.']) {
      const entry = await context.create(ACTOR, { title: 'Incoterm', body, spaceId })
      await context.approve(ACTOR, entry.id)
    }
    await propose()
    await page.getByText('Differences').waitFor()
    await page.getByText('Incoterm: Eguisa trabaja DDP con el flete incluido.').first().waitFor()
    await page.getByText('Incoterm: Eguisa trabaja FOB y el flete se cobra aparte.').first().waitFor()
    await page.getByText('Differences').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}panel-03-conflict.png` })
    // The block reflows with the panel: no page-level horizontal overflow.
    await page.setViewportSize({ width: 420, height: 800 })
    await page.waitForTimeout(400)
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)
    await page.getByText('Differences').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `${SHOTS}panel-04-narrow.png` })
    await page.setViewportSize({ width: 1440, height: 900 })
  })
})
