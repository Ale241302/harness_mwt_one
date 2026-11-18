// Web e2e: the product composes its agent from a preset that has no shell,
// filesystem or web tools, and refuses to switch back to the full coding
// preset. This is the composition check the O3 security review needed: a static
// YAML assertion cannot prove what the running product advertises to the model.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchWebScaffold, watchConsole, type WebScaffold } from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage } from './support.ts'

process.env.FABERLOOM_LOCAL = '1'
process.env.SICOP_MCP_URL = ''
process.env.FABERLOOM_MIRROR_ENABLED = '0'
process.env.FABERLOOM_CLASSIFIER = '0'
process.env.FABERLOOM_CHECKS_MWT = '0'
process.env.FABERLOOM_EFFECT_MAIL = '0'

const BUNDLE = fileURLToPath(new URL('../../../packages/bundle/faberloom-app/package.json', import.meta.url))
const BUNDLE_PATCH = fileURLToPath(new URL('../../../packages/bundle/faberloom-app/cordis.patch.yml', import.meta.url))

/** Tools the product must not advertise: each can reach the network or run code. */
const FORBIDDEN = ['bash', 'pwsh', 'edit', 'read', 'read_image', 'write', 'web_fetch', 'web_search']

describe('product composition: the agent preset keeps the shell out', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  /** The preset service as the composition exposes it. */
  function presets() {
    return scaffold.ctx as unknown as {
      agentPresets: {
        defaultId: string
        remoteExportList: () => Promise<{ modeSelectionEnabled: boolean }>
        select: (agent: unknown, preset: string) => Promise<string>
      }
    }
  }

  beforeAll(async () => {
    scaffold = await launchWebScaffold({ extraOverlayPath: BUNDLE_PATCH, extraInstallAnchors: [BUNDLE] })
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

  it('composes new sessions from the faberloom preset, without shell, fs or web', async () => {
    const service = presets().agentPresets
    expect(service.defaultId).toBe('faberloom')
    expect((await service.remoteExportList()).modeSelectionEnabled).toBe(false)

    const sessions = scaffold.ctx.sessions.list()
    const newest = sessions.at(-1)
    expect(newest).toBeDefined()
    if (newest === undefined) return

    const agent = scaffold.ctx.agents.list().find(candidate => candidate.session.id === newest.id)
    expect(agent).toBeDefined()
    if (agent === undefined) return

    const names = (scaffold.ctx as unknown as { tools: { schemas: (agent: unknown) => { name: string }[] } })
      .tools.schemas(agent).map(schema => schema.name)
    // The product's own tool travels; the escape hatches do not.
    expect(names).toContain('faberloom_mail_send')
    for (const forbidden of FORBIDDEN) {
      expect({ forbidden, present: names.includes(forbidden) }).toEqual({ forbidden, present: false })
    }

    // The remote refuses even when the picker is not on screen.
    await expect(service.select(agent, 'standard')).rejects.toThrow(/disabled by this deployment/u)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)
})
