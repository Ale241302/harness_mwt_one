// Web e2e: the WorkLoom Mesa over the assembled product. It boots the real
// FaberLoom rows in the shipped Web composition, seeds one board item through
// the real service, and decides it from Foco: edit the draft, save a new
// version, approve, and confirm the stored state. No model call is involved.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import type { ReplayOverrideDoc } from '@deepseek-ai/dsh-llm-replay'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'
import type { FaberLoomBoard, FaberLoomBoardItemId } from '@deepseek-ai/dsh-faberloom-board'
import type { FaberLoomSpaces } from '@deepseek-ai/dsh-faberloom-spaces'
import type { FaberLoomCorrection, FaberLoomMemory } from '@deepseek-ai/dsh-faberloom-learning'
import { DECLARED_CHECKS } from '@deepseek-ai/dsh-faberloom-board'

const OVERLAY = fileURLToPath(new URL('./mesa-panel.overlay.yml', import.meta.url))
const BUNDLE = fileURLToPath(new URL('../../../packages/bundle/faberloom-app/package.json', import.meta.url))
const TITLE = 'PF 9001-2026 · Cuenta Demo'
const ITERATION_TITLE = 'PF 9002-2026 · Cuenta Demo'
const RESIDUE_TITLE = 'PF 9003-2026 · Cuenta Demo'
const EFFECT_TITLE = 'PF 9004-2026 · Cuenta Demo'
const SPACE_TITLE = 'Marluvas'

/**
 * The iteration chat opens one session per attempt, so the scenario supplies a
 * deterministic closing turn for each instead of a live model. The reply is
 * never asserted: the work happens in the panel. The recorded fixture is
 * deliberately absent — the override is the whole script — which the scaffold
 * accepts for an override-only replay.
 */
function iterationReplay(): { fixture: string; override: string; dir: string } {
  const script: ReplayOverrideDoc = [{
    kind: 'chunks',
    chunks: [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Iteración preparada.' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Iteración preparada.' } },
      { type: 'usage', usage: { inputTokens: 32, outputTokens: 4 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ],
  }]
  const dir = mkdtempSync(join(tmpdir(), 'mesa-iteration-replay-'))
  const override = join(dir, 'replay.override.json')
  writeFileSync(override, JSON.stringify(script))
  return { fixture: join(dir, 'session.jsonl'), override, dir }
}

/**
 * Mount the controls a deployment supplies. Without an adapter the board
 * refuses every proforma approval with CHECK_UNAVAILABLE (ADR-003), so this
 * scenario composes a passing source the way the shipped profile must.
 */
function mountChecks(board: FaberLoomBoard): void {
  for (const definition of DECLARED_CHECKS['proforma'] ?? []) {
    // Confirmation controls report a difference so the scenario proves the
    // acceptance step instead of approving everything silently.
    const status = definition.class === 'confirmacion' ? 'warning' as const : 'ok' as const
    board.registerCheck('proforma', definition.id, async () => ({
      status,
      source: 'e2e.source',
      sourceVersion: '1',
      checkedAt: new Date().toISOString(),
      fields: [],
    }), { class: definition.class })
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
  let iterationItemId: FaberLoomBoardItemId
  let residueItemId: FaberLoomBoardItemId
  let effectItemId: FaberLoomBoardItemId
  let iterationSpaceId: string | undefined
  let replayDir: string | undefined

  beforeAll(async () => {
    const replay = iterationReplay()
    replayDir = replay.dir
    scaffold = await launchWebScaffold({
      extraOverlayPath: OVERLAY,
      extraInstallAnchors: [BUNDLE],
      replayFixture: replay.fixture,
      replayOverride: replay.override,
    })
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

    // An iteration needs the item assigned to a space (W-31), so the scenario
    // creates a real space through the shipped service instead of a fixture.
    const spaces = (scaffold.ctx as unknown as { faberloomSpaces: FaberLoomSpaces }).faberloomSpaces
    const space = await spaces.create({ ...actor, role: 'admin', readOnly: false }, { title: SPACE_TITLE })
    iterationSpaceId = String(space.id)
    const iterationItem = await board.submit(actor, {
      runId: 'run-pf-9002',
      idempotencyKey: 'pf-9002-2026',
      businessKey: 'PF 9002-2026',
      title: ITERATION_TITLE,
      summary: 'Proforma DDP, 50 pares, USD 500,00.',
      evidence: ['OC 9002', 'PF 9002-2026'],
      artifactType: 'proforma',
      accountRef: 'Cuenta Demo',
    })
    iterationItemId = iterationItem.id
    await board.setSeverity(actor, iterationItem.id, 'HIGH', 'HUMAN')
    await board.assignWorkspace(actor, iterationItem.id, String(space.id))

    // A third item whose only work is a late answer for an attempt that ended
    // before it ever linked a draft: the case the panel must offer back.
    const residueItem = await board.submit(actor, {
      runId: 'run-pf-9003',
      idempotencyKey: 'pf-9003-2026',
      businessKey: 'PF 9003-2026',
      title: RESIDUE_TITLE,
      summary: 'Proforma DDP, 25 pares, USD 250,00.',
      evidence: ['OC 9003', 'PF 9003-2026'],
      artifactType: 'proforma',
      accountRef: 'Cuenta Demo',
    })
    residueItemId = residueItem.id
    await board.setSeverity(actor, residueItem.id, 'HIGH', 'HUMAN')
    await board.assignWorkspace(actor, residueItem.id, String(space.id))

    // The item the scenario approves with execution: its effect has a reversal
    // window, so it lands in DELEGADO_EN_VENTANA and can be reverted (W-19).
    const effectItem = await board.submit(actor, {
      runId: 'run-pf-9004',
      idempotencyKey: 'pf-9004-2026',
      businessKey: 'PF 9004-2026',
      title: EFFECT_TITLE,
      summary: 'Proforma DDP, 10 pares, USD 100,00.',
      evidence: ['OC 9004', 'PF 9004-2026'],
      artifactType: 'proforma',
      accountRef: 'Cuenta Demo',
    })
    effectItemId = effectItem.id
    await board.setSeverity(actor, effectItem.id, 'HIGH', 'HUMAN')
    // Owned by the same space as the other HIGH items, so the queue order the
    // scenario relies on does not change.
    await board.assignWorkspace(actor, effectItem.id, String(space.id))

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
    if (replayDir !== undefined) rmSync(replayDir, { recursive: true, force: true })
  })

  /** Open one item in Foco and wait for its detail. */
  async function openItem(title: string): Promise<void> {
    await page.getByRole('button', { name: /Mesa de trabajo|Work bench/u }).first().click()
    await page.getByText(title, { exact: false }).first().waitFor({ timeout: 20_000 })
    await page.getByText(title, { exact: false }).first().click()
    await page.getByText('③ Draft').waitFor({ timeout: 20_000 })
  }

  /** One item's recorded corrections, as the learning registry holds them (§6.3). */
  async function correctionsOf(item: FaberLoomBoardItemId): Promise<readonly FaberLoomCorrection[]> {
    const memory = (scaffold.ctx as unknown as { faberloomMemory: FaberLoomMemory }).faberloomMemory
    return await memory.listCorrections(
      {
        id: 'e2e@mwt.one',
        tenantId: 'mwt',
        ...iterationSpaceId === undefined ? {} : { spaceIds: [iterationSpaceId] },
        accountRefs: ['Cuenta Demo'],
      },
      { itemId: String(item) },
    )
  }

  /** Wait for the single correction one board command records; the write follows its commit. */
  async function singleCorrection(item: FaberLoomBoardItemId): Promise<FaberLoomCorrection> {
    return await vi.waitFor(async () => {
      const rows = await correctionsOf(item)
      expect(rows).toHaveLength(1)
      return rows[0] as FaberLoomCorrection
    }, { timeout: 20_000 })
  }

  /** Start an iteration from the panel and come back to the item. */
  async function startIteration(id: FaberLoomBoardItemId): Promise<void> {
    await page.getByRole('button', { name: 'Iterate', exact: true }).click()
    await vi.waitFor(async () => {
      expect((await board.iterationStatus(actor, id)).phase).toBe('active')
    }, { timeout: 20_000 })
    // Iterating opens the space chat; the scenario returns to the Mesa to work
    // the attempt from the panel.
    await returnToMesa()
  }

  /** Wait for the iteration chat to own the screen, then reopen the Mesa. */
  async function returnToMesa(): Promise<void> {
    await page.locator('[data-composer-input]').first().waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: /Mesa de trabajo|Work bench/u }).first().click()
    await page.getByText(/Iteration in progress/u).first().waitFor({ timeout: 20_000 })
  }

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
    // A confirmation control reported a difference: the approval needs the
    // human to accept it before Confirm enables.
    const confirm = page.getByRole('button', { name: 'Confirm' })
    expect(await confirm.isDisabled()).toBe(true)
    const boxes = page.getByRole('checkbox')
    const differences = await boxes.count()
    expect(differences).toBeGreaterThan(0)
    for (let index = 0; index < differences; index += 1) await boxes.nth(index).check()
    await confirm.click()
    await page.waitForFunction(title => !document.body.innerText.includes(title), TITLE, { timeout: 20_000 })

    const stored = await board.get(actor, itemId)
    expect(stored.state).toBe('APROBADO')
    // W-34: saving inline edits records the correction they are, without a step.
    const correction = await singleCorrection(itemId)
    expect(correction).toMatchObject({
      itemId: String(itemId),
      actor: 'e2e@mwt.one',
      tenantId: 'mwt',
      spaceId: null,
      accountRef: 'Cuenta Demo',
      agentId: null,
      scope: 'puntual',
      dataClasses: ['N2'],
      fieldsUsed: ['summary'],
      origin: 'edit',
      detail: {
        origin: 'edit',
        field: 'summary',
        previous: 'Proforma DDP, 100 pares, USD 1.000,00, crédito 30 días.',
        next: 'Revisado: precio DDP y crédito a 120 días confirmados.',
      },
    })
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('starts an iteration and applies it with a scope', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mesa-iteration'))
    await openItem(ITERATION_TITLE)
    await startIteration(iterationItemId)

    // The draft area edits the attempt's work, not the item summary.
    const editor = page.locator('textarea').first()
    await editor.fill('Ajustado: 50 pares DDP a 60 días.')
    await vi.waitFor(async () => {
      expect((await board.getIterationDraft(actor, iterationItemId))?.summary).toBe('Ajustado: 50 pares DDP a 60 días.')
    }, { timeout: 20_000 })

    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox').selectOption('cuenta')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await vi.waitFor(async () => {
      const stored = await board.get(actor, iterationItemId)
      expect(stored.version).toBe(2)
      expect(stored.state).toBe('PENDIENTE_CRITERIO')
    }, { timeout: 20_000 })
    expect(await board.getIterationDraft(actor, iterationItemId)).toBeUndefined()
    expect(await board.iterationStatus(actor, iterationItemId)).toMatchObject({ phase: 'idle', draft: null, rounds: 1 })
    // Every exit leaves the user on the same item with the applied version.
    await page.getByRole('button', { name: 'Approve' }).waitFor({ timeout: 20_000 })
    // W-34: the applied iteration closes with the scope the user chose, the work
    // it carried, and the lineage of the item it corrected.
    const correction = await singleCorrection(iterationItemId)
    expect(correction).toMatchObject({
      itemId: String(iterationItemId),
      actor: 'e2e@mwt.one',
      tenantId: 'mwt',
      spaceId: iterationSpaceId,
      accountRef: 'Cuenta Demo',
      scope: 'cuenta',
      dataClasses: ['N2'],
      fieldsUsed: ['summary'],
      origin: 'iterate',
      detail: {
        origin: 'iterate',
        instructions: 'Ajustado: 50 pares DDP a 60 días.',
        diffs: ['summary: Proforma DDP, 50 pares, USD 500,00. → Ajustado: 50 pares DDP a 60 días.'],
        rounds: 1,
      },
    })
    expect(tripwire.pageErrors).toEqual([])
  }, 240_000)

  it('keeps a paused draft and recovers it on return', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mesa-iteration-paused'))
    await openItem(ITERATION_TITLE)
    await startIteration(iterationItemId)

    const editor = page.locator('textarea').first()
    await editor.fill('Borrador a medio hacer.')
    await vi.waitFor(async () => {
      expect((await board.getIterationDraft(actor, iterationItemId))?.summary).toBe('Borrador a medio hacer.')
    }, { timeout: 20_000 })

    await page.getByRole('button', { name: 'Save and exit', exact: true }).click()
    await vi.waitFor(async () => {
      expect((await board.iterationStatus(actor, iterationItemId)).phase).toBe('idle')
    }, { timeout: 20_000 })
    expect((await board.get(actor, iterationItemId)).version).toBe(2)
    expect((await board.getIterationDraft(actor, iterationItemId))?.summary).toBe('Borrador a medio hacer.')

    await page.getByText('Unfinished work').first().waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Resume the iteration' }).click()
    await vi.waitFor(async () => {
      const status = await board.iterationStatus(actor, iterationItemId)
      expect(status.phase).toBe('active')
      expect(status.draft?.summary).toBe('Borrador a medio hacer.')
    }, { timeout: 20_000 })
    // Resuming opens the chat again; the panel keeps showing the attempt.
    await returnToMesa()

    // Leaving the item clean: discarding never changes the version.
    await page.getByRole('button', { name: 'Discard my changes', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: 'Discard my changes', exact: true }).click()
    await vi.waitFor(async () => {
      expect(await board.getIterationDraft(actor, iterationItemId)).toBeUndefined()
    }, { timeout: 20_000 })
    expect((await board.get(actor, iterationItemId)).version).toBe(2)
    expect(tripwire.pageErrors).toEqual([])
  }, 240_000)

  it('offers the residue of a dead attempt and resumes it', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mesa-iteration-residue'))
    // A late answer the item never linked: the attempt is paused with no draft,
    // so the write is stored as the dead attempt's draft and the item keeps
    // `iterationDraftKey` null. Before the board offered these rows, no command
    // could reach that text.
    const started = await board.iterate(actor, residueItemId, { baseVersion: 1, actorSession: 'spec-tab' })
    const dead = {
      iterationId: started.item.iterationId ?? '',
      generation: started.item.iterationLockGeneration,
      actorSession: 'spec-tab',
    }
    await board.pauseIteration(actor, residueItemId, { ...dead, reason: 'guardar-y-salir' })
    const residue = await board.saveIterationDraft(actor, residueItemId, {
      ...dead, baseVersion: 1, summary: 'Residuo de un intento muerto.',
    })
    expect(residue).toMatchObject({ linked: false, code: 'LOCK_LOST' })
    expect(residue.draft).toMatchObject({ archived: true, superseded: false, retained: true })
    expect((await board.get(actor, residueItemId)).iterationDraftKey).toBeNull()
    expect((await board.get(actor, residueItemId)).version).toBe(1)

    await openItem(RESIDUE_TITLE)
    await page.getByText('Unfinished work').first().waitFor({ timeout: 20_000 })
    await page.getByRole('button', { name: 'Resume the iteration' }).click()

    // Resuming starts an attempt over the residue without writing the artifact.
    await vi.waitFor(async () => {
      const status = await board.iterationStatus(actor, residueItemId)
      expect(status.phase).toBe('active')
      expect(status.draftLinked).toBe(true)
      expect(status.draft?.summary).toBe('Residuo de un intento muerto.')
    }, { timeout: 20_000 })
    expect((await board.get(actor, residueItemId)).version).toBe(1)
    // Returning remounts the Mesa, which selects the first row; the scenario
    // opens the residue item again to work its attempt.
    await page.locator('[data-composer-input]').first().waitFor({ timeout: 20_000 })
    await openItem(RESIDUE_TITLE)
    await page.getByText(/Iteration in progress/u).first().waitFor({ timeout: 20_000 })

    // The work reaches the item only through Apply.
    await page.getByRole('button', { name: 'Apply', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox').selectOption('puntual')
    await dialog.getByRole('button', { name: 'Apply', exact: true }).click()
    await vi.waitFor(async () => {
      const stored = await board.get(actor, residueItemId)
      expect(stored.version).toBe(2)
      expect(stored.state).toBe('PENDIENTE_CRITERIO')
      expect(stored.revisions.at(-1)?.summary).toBe('Residuo de un intento muerto.')
    }, { timeout: 20_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 240_000)

  it('approves with execution, reverts inside the window, and returns the item', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-mesa-effect'))
    await openItem(EFFECT_TITLE)

    // One panel names the action, the destination, and the amount, and the
    // acceptance is bound to them (§9.8).
    await page.getByRole('button', { name: 'Approve' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('combobox').selectOption('mail.send')
    await dialog.getByRole('textbox').fill('cliente@demo.test')
    const boxes = dialog.getByRole('checkbox')
    const differences = await boxes.count()
    for (let index = 0; index < differences; index += 1) await boxes.nth(index).check()
    await dialog.getByRole('button', { name: 'Approve and send' }).click()

    await vi.waitFor(async () => {
      expect((await board.get(actor, effectItemId)).state).toBe('DELEGADO_EN_VENTANA')
    }, { timeout: 20_000 })

    // What will happen and to whom, plus the window the board recorded (D-04).
    await page.getByText('Send email will be sent to cliente@demo.test.').waitFor({ timeout: 20_000 })
    await page.getByText(/left to revert it/u).waitFor()
    const accepted = await board.effectStatus(actor, effectItemId)
    expect(accepted?.reservation?.status).toBe('RESERVADA')
    expect(accepted?.reversalDeadline).not.toBeNull()

    // Revertir opens its reason selector; its button is a separate step.
    await page.getByRole('button', { name: 'Revert', exact: true }).click()
    const revert = page.getByRole('region', { name: 'Revert the execution' })
    await revert.getByRole('button', { name: 'Revert', exact: true }).click()

    await vi.waitFor(async () => {
      const stored = await board.get(actor, effectItemId)
      expect(stored.state).toBe('PENDIENTE_CRITERIO')
      expect(stored.effectKey).toBeNull()
    }, { timeout: 20_000 })
    // The item returns to the queue with its decision buttons.
    await page.getByRole('button', { name: 'Approve' }).waitFor({ timeout: 20_000 })
    expect(await board.effectStatus(actor, effectItemId)).toBeNull()
    expect((await board.pendingEffects(actor)).some(entry => entry.itemId === String(effectItemId))).toBe(false)

    // The effect is free again: a live reservation would refuse this
    // acceptance with EFFECT_TAKEN, so accepting it proves the release (§10.1).
    const current = await board.get(actor, effectItemId)
    const again = await board.approveWithExecution(actor, effectItemId, {
      expectedRowVersion: current.rowVersion,
      expectedArtifactVersion: current.version,
      expectedArtifactHash: current.artifactHash ?? '',
      executionId: 'exec-effect-2',
      actionType: 'mail.send',
      destination: 'cliente@demo.test',
    })
    expect(again.item.state).toBe('DELEGADO_EN_VENTANA')
    await board.revert(actor, effectItemId)
    expect(tripwire.pageErrors).toEqual([])
  }, 180_000)
})
