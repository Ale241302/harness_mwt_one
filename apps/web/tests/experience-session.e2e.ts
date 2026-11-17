// O5-05 · E2: the assembled product session, with a real model, its persona
// section, its tool plane and its history. The three cases of the experience
// inspection run as three turns of one conversation, so the model sees the scope
// grow (no base, one fact, two facts that contradict) with the earlier turns in
// its history. Model calls are real; the receiver and the model are the only
// external services involved.
//
// Self-skips without a key, and only runs in `DSH_SNAPSHOT=record`, whose boot
// mounts the real DeepSeek adapter instead of a replay fixture.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

// The product rows read these at load: keep every external console and provider
// out of the run, except the model itself.
process.env.FABERLOOM_LOCAL = '1'
process.env.SICOP_MCP_URL = ''
process.env.FABERLOOM_MIRROR_ENABLED = '0'
process.env.FABERLOOM_CLASSIFIER = '0'
process.env.FABERLOOM_CHECKS_MWT = '0'
process.env.FABERLOOM_EFFECT_MAIL = '0'

const BUNDLE = fileURLToPath(new URL('../../../packages/bundle/faberloom-app/package.json', import.meta.url))
const BUNDLE_PATCH = fileURLToPath(new URL('../../../packages/bundle/faberloom-app/cordis.patch.yml', import.meta.url))
const SHOTS = fileURLToPath(new URL('../../../docs/scratch/faberloom-daily-work/e1/visual/', import.meta.url))

const QUESTION = 'Cliente Eguisa. ¿Qué incoterm aplica y quién paga el flete? Responde en dos frases con lo que consta en el Space; no hace falta que abras archivos.'
const PERSONA = 'Cotizaciones y condiciones comerciales de Eguisa: incoterm, flete y precios.'
const FACT_DDP = 'Eguisa trabaja DDP y el flete va incluido en el precio.'
const FACT_SEPARATE = 'Eguisa no paga el flete: el flete lo paga el cliente por separado.'

describe.skipIf(process.env.DEEPSEEK_API_KEY === undefined || process.env.DSH_SNAPSHOT !== 'record')(
  'product session: the experience inspection with a real model',
  () => {
    let scaffold: WebScaffold
    let browser: Browser
    let page: Page
    let folder: string
    let spaceId: string
    let sessionId: string
    let tripwire: ReturnType<typeof watchConsole>

    /** The session this scenario drives: a root session whose cwd is the Space folder. */
    function spaceSession() {
      return scaffold.ctx.sessions.list()
        .filter(session => session.header.cwd === folder && session.header.parentSession === undefined)
        .at(-1)
    }

    /** Assistant messages the session log holds; one per model reply. */
    function assistantMessages(): readonly SessionEvent[] {
      const events = spaceSession()?.snapshotEvents() ?? []
      return events.filter(event => event.type === 'assistant/message')
    }

    /** Text of the last model reply, as the log records it. */
    function lastAnswer(): string {
      const last = assistantMessages().at(-1)
      const blocks = last?.type === 'assistant/message' ? last.data.message.content : []
      return blocks
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('\n')
    }

    /** One turn typed in the composer, settled on the visible turn boundary. */
    async function ask(question: string): Promise<string> {
      const input = page.locator('[data-composer-input]').first()
      await input.waitFor({ timeout: 30_000 })
      const before = assistantMessages().length
      await input.fill(question)
      await input.press('Enter')
      const stop = page.getByRole('button', { name: 'Stop generating' })
      await stop.waitFor({ timeout: 30_000 })
      await expect.poll(() => stop.count(), { timeout: 180_000, interval: 500 }).toBe(0)
      const session = spaceSession()
      if (session !== undefined) {
        sessionId = String(session.id)
        await scaffold.ctx.sessions.flush(session)
      }
      await expect.poll(() => assistantMessages().length, { timeout: 30_000 }).toBeGreaterThan(before)
      return lastAnswer()
    }

    beforeAll(async () => {
      mkdirSync(SHOTS, { recursive: true })
      scaffold = await launchWebScaffold({ extraOverlayPath: BUNDLE_PATCH, extraInstallAnchors: [BUNDLE] })
      folder = join(scaffold.workspaceCwd, 'workspace')
      mkdirSync(folder, { recursive: true })
      const view = (scaffold.ctx as unknown as {
        faberloomView: {
          createSpaceFromFolder: (title: string, path: string, parentId?: string) => Promise<unknown>
          createAgent: (name: string, responsibility: string, provider?: string, model?: string, apiKey?: string,
            webAccess?: boolean, mwtMcp?: boolean, sicopMcp?: boolean) => Promise<unknown>
          saveSpace: (id: string, input: { agentId?: string | null }) => Promise<unknown>
          remember: (text: string, spaceId?: string) => Promise<unknown>
        }
      }).faberloomView
      const spaces = (scaffold.ctx as unknown as {
        faberloomSpaces: { list: (actor: unknown) => Promise<readonly { id: string; title: string }[]> }
      }).faberloomSpaces
      await view.createSpaceFromFolder('Eguisa', folder)
      const created = (await spaces.list({ id: 'anonymous', role: 'admin', readOnly: false }))
        .find(space => space.title === 'Eguisa')
      if (created === undefined) throw new Error('the Space created from the folder is missing')
      spaceId = created.id
      await view.createAgent('Comercial Eguisa', PERSONA, undefined, undefined, undefined, false, false, false)
      const agents = (scaffold.ctx as unknown as {
        faberloomAgents: { listAgents: () => Promise<readonly { id: string; name: string }[]> }
      }).faberloomAgents
      const agent = (await agents.listAgents()).find(candidate => candidate.name === 'Comercial Eguisa')
      if (agent === undefined) throw new Error('the created agent is missing from the catalog')
      await view.saveSpace(spaceId, { agentId: agent.id })

      browser = await chromium.launch()
      page = await newEnglishPage(browser)
      page.setDefaultTimeout(20_000)
      tripwire = watchConsole(page)
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await connectFreshWorkspace(page, scaffold.workspaceCwd)
    }, 300_000)

    afterAll(async () => {
      try { await browser?.close() } finally { await scaffold?.close() }
    })

    it('runs the Space session as its agent, with the scope and the tool plane', async () => {
      const text = await ask(QUESTION)
      await page.screenshot({ path: `${SHOTS}session-01-no-base.png` })
      // The turn's own system prompt, opened in the transcript: the persona
      // section and the Space scope are what the request carried.
      await page.getByRole('button', { name: 'System prompt', exact: true }).first().click()
      const prompt = page.locator('[data-context-text]').first()
      await prompt.waitFor({ timeout: 15_000 })
      const composed = await prompt.innerText()
      await page.screenshot({ path: `${SHOTS}session-01-system-prompt.png` })
      expect(composed).toContain(PERSONA)
      expect(composed).toContain('Eguisa')
      // The tool plane reached the request: the header carries the tool set.
      const session = scaffold.ctx.sessions.get(sessionId as never)
      const header = session?.requestHeader()
      expect(JSON.stringify(header?.tools ?? null).length).toBeGreaterThan(20)
      // No approved fact yet: the answer names what it lacks instead of inventing DDP.
      expect(text).not.toMatch(/\bDDP\b/u)
      expect(text).toMatch(/no tengo|no hay|no consta|no dispongo|falta|vac[ií]|sin (?:base|informaci)/iu)
      expect(tripwire.pageErrors).toEqual([])
    })

    it('cites the approved fact once the Space remembers it', async () => {
      const view = (scaffold.ctx as unknown as {
        faberloomView: { remember: (text: string, spaceId?: string) => Promise<unknown> }
      }).faberloomView
      await view.remember(FACT_DDP, spaceId)
      const text = await ask(`Repito para el mismo cliente. ${QUESTION}`)
      await page.screenshot({ path: `${SHOTS}session-02-with-base.png` })
      expect(text).toMatch(/DDP/u)
      expect(text).toMatch(/incluido|incluye/iu)
    })

    it('shows both sides when two approved facts contradict, with the earlier turns as history', async () => {
      const view = (scaffold.ctx as unknown as {
        faberloomView: { remember: (text: string, spaceId?: string) => Promise<unknown> }
      }).faberloomView
      await view.remember(FACT_SEPARATE, spaceId)
      const text = await ask(
        'Para el flete de Eguisa, compará los hechos que constan en el Space y decime si coinciden o se contradicen. '
        + 'Si no coinciden, mostrame los dos sin elegir uno.',
      )
      await page.screenshot({ path: `${SHOTS}session-03-conflict.png` })
      const session = spaceSession()
      const agent = scaffold.ctx.agents.list().find(candidate => candidate.session.id === session?.id)
      const sessionAgent = (scaffold.ctx as unknown as {
        faberloomSessionAgent: { scopeFor: (agent: unknown) => Promise<{ readonly text: string } | undefined> }
      }).faberloomSessionAgent
      const scope = agent === undefined ? undefined : await sessionAgent.scopeFor(agent)
      // The Space hands the model both facts on the same prompt section.
      expect(scope?.text).toContain(FACT_DDP)
      expect(scope?.text).toContain(FACT_SEPARATE)
      expect(text).toMatch(/DDP|incluido/iu)
      expect(text).toMatch(/por separado|no paga|no incluye/iu)
      expect(text).toMatch(/contradic|conflict|discrepan|dos hechos/iu)
    })
  },
)
