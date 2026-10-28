// Web e2e: the WorkLoom Mesa over the assembled product. It boots the real
// FaberLoom rows in the shipped Web composition, seeds one board item through
// the real service, and decides it from Foco: edit the draft, save a new
// version, approve, and confirm the stored state. No model call is involved.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'
import type { FaberLoomBoard, FaberLoomBoardItemId } from '@deepseek-ai/dsh-faberloom-board'
import { DECLARED_CHECKS } from '@deepseek-ai/dsh-faberloom-board'

const OVERLAY = fileURLToPath(new URL('./mesa-panel.overlay.yml', import.meta.url))
const BUNDLE = fileURLToPath(new URL('../../../packages/bundle/faberloom-app/package.json', import.meta.url))
const TITLE = 'PF 9001-2026 · Cuenta Demo'

/**
 * Mount the controls a deployment supplies. Without an adapter the board
 * refuses every proforma approval with CHECK_UNAVAILABLE (ADR-003), so this
 * scenario composes a passing source the way the shipped profile must.
 */
function mountChecks(board: FaberLoomBoard): void {
  const passing = {
    status: 'ok' as const,
    source: 'e2e.source',
    sourceVersion: '1',
    checkedAt: new Date().toISOString(),
    fields: [],
  }
  for (const definition of DECLARED_CHECKS['proforma'] ?? []) {
    board.registerCheck('proforma', definition.id, async () => passing, { class: definition.class })
  }
}

describe('web e2e: WorkLoom Mesa', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let board: FaberLoomBoard
  const actor = { id: 'e2e@mwt.one', companyId: 'mwt' }
  let itemId: FaberLoomBoardItemId

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: OVERLAY, extraInstallAnchors: [BUNDLE] })
    board = (scaffold.ctx as unknown as { faberloomBoard: FaberLoomBoard }).faberloomBoard
    mountChecks(board)
    const item = await board.submit(actor, {
      runId: 'run-pf-2520',
      idempotencyKey: 'pf-2520-2026',
      businessKey: 'PF 2520-2026',
      title: TITLE,
      summary: 'Proforma DDP, 100 pares, USD 1.000,00, crédito 30 días.',
      evidence: ['OC 9001', 'PO 9001', 'PF 9001-2026'],
      artifactType: 'proforma',
      accountRef: 'Cuenta Demo',
    })
    itemId = item.id
    await board.setSeverity(actor, item.id, 'HIGH', 'HUMAN')

    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('edits the draft and approves the exact version', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mesa-panel'))
    await page.getByRole('button', { name: /Mesa de trabajo|Work bench/u }).first().click()
    await page.getByText(TITLE, { exact: false }).first().waitFor({ timeout: 20_000 })
    await page.getByText('③ Draft').waitFor()
    expect(await page.getByText('Cuenta Demo', { exact: false }).count()).toBeGreaterThan(0)

    const editor = page.locator('textarea').first()
    await editor.fill('Revisado: precio DDP y crédito a 120 días confirmados.')
    await page.getByRole('button', { name: 'Save' }).click()
    // Saving publishes a new version and rowVersion; wait until the editor
    // rehydrates from that version before approving it.
    await page.waitForFunction(() => {
      const save = [...document.querySelectorAll('button')].find(button => button.textContent === 'Save')
      return save instanceof HTMLButtonElement && save.disabled
    }, undefined, { timeout: 20_000 })

    await page.getByRole('button', { name: 'Approve' }).click()
    await page.getByRole('button', { name: 'Confirm' }).click()
    await page.waitForFunction(title => !document.body.innerText.includes(title), TITLE, { timeout: 20_000 })

    const stored = await board.get(actor, itemId)
    expect(stored.state).toBe('APROBADO')
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
