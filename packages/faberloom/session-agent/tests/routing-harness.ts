/**
 * Real-composition harness for the per-agent routing specs: a test-only
 * `cordis.yml` booted through the actual Loader with the real `dsh-llm`,
 * `dsh-agent-loop`, `dsh-session`, `dsh-system-prompt`, `dsh-tools`,
 * `dsh-credentials-local`, `dsh-faberloom-agent-plane`, and
 * `dsh-faberloom-session-agent`.
 *
 * The provider endpoint and its catalog are the only doubles: the endpoint is
 * the external system the routing seam selects (a local stub, or a real
 * provider origin for the live smoke), and the catalog, workspace registry, and
 * Space list are the durable product stores outside the routing seam.
 */

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import LocalCredentials from '@deepseek-ai/dsh-credentials-local'
import { agentCredentialRef } from '@deepseek-ai/dsh-faberloom-agents'
import type { FaberLoomAgent, FaberLoomAgentId } from '@deepseek-ai/dsh-faberloom-agents'
import FaberLoomAgentPlane from '@deepseek-ai/dsh-faberloom-agent-plane'
import FaberLoomSessionAgent from '../src/index.ts'
import { stubProviderPlugin } from './routing-provider.ts'
import type { ProviderCall, StubRoute } from './routing-provider.ts'

/** One catalog agent as the routing fixture exposes it. */
export interface CatalogAgentSpec {
  /** Catalog agent id; also the key reference's payload. */
  readonly id: string
  /** Display name the `@Name` mention matches. */
  readonly name: string
  /** Persona the composition installs. */
  readonly responsibility: string
  /** Declared provider route. */
  readonly provider?: string
  /** Declared model id. */
  readonly model?: string
  /** Whether the agent stores an API key in the credential seam. */
  readonly hasApiKey: boolean
}

/** One workspace mirrored by a Space the composition resolves through. */
export interface WorkspaceSpec {
  /** Workspace id. */
  readonly id: string
  /** Working directory a session matches. */
  readonly path: string
}

/** One Space holding a responsible agent. */
export interface SpaceSpec {
  /** The workspace the Space mirrors. */
  readonly workspaceId: string
  /** The Space's responsible catalog agent. */
  readonly agentId: string
  /** The owner's directive for sessions of this Space. */
  readonly prompt: string
}

/** Everything one composition boot needs besides the routes. */
export interface RoutingFixture {
  /** Catalog agents the mention route resolves. */
  readonly agents: readonly CatalogAgentSpec[]
  /** Provider routes the double adapter serves. */
  readonly routes: readonly StubRoute[]
  /** Raw key values to store under each keyed agent's credential reference. */
  readonly keys: ReadonlyMap<string, string>
  /** Registered workspaces. */
  readonly workspaces?: readonly WorkspaceSpec[]
  /** Spaces with a responsible agent. */
  readonly spaces?: readonly SpaceSpec[]
}

/** A booted composition and the driver a spec uses on it. */
export interface RoutingHarness {
  /** Live context owning the whole composition. */
  readonly ctx: Context
  /** Create one production Agent and Session through the real loop. */
  readonly create: (id: string, options?: Record<string, unknown>, meta?: Record<string, unknown>) => Promise<Agent>
}

/** A Loader-loadable fixture plugin: a name, its injected services, and an apply body. */
interface FixturePlugin {
  readonly name: string
  readonly inject: readonly string[]
  readonly apply: (ctx: Context) => void
}

const live: Context[] = []
const homes: string[] = []

/** Dispose every booted composition and its harness home; run from a spec's afterEach. */
export async function cleanupRoutingHarness(): Promise<void> {
  for (const ctx of live.splice(0)) await ctx.fiber.dispose()
  for (const root of homes.splice(0)) await rm(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
}

/** The fixture agent's catalog entry, expanded with the fields the plane reads. */
function catalogAgent(spec: CatalogAgentSpec): FaberLoomAgent {
  return {
    id: spec.id as FaberLoomAgentId,
    name: spec.name,
    responsibility: spec.responsibility,
    spaceId: undefined,
    detached: false,
    ownerId: 'owner@test',
    seeded: false,
    origin: 'scratch',
    originRef: undefined,
    baseAgentId: undefined,
    skills: [],
    tools: [],
    subagents: [],
    provider: spec.provider,
    model: spec.model,
    webAccess: true,
    mwtMcp: true,
    sicopMcp: true,
    hasApiKey: spec.hasApiKey,
    mailConnectionIds: [],
    policy: { primary: undefined, exclusive: false, fallbacks: [], escalation: undefined, budget: undefined },
    lessons: [],
    active: true,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

/** The catalog, workspace registry, and Space list the composition reads. */
function supportPlugin(fixture: RoutingFixture): FixturePlugin {
  const agents = fixture.agents.map(catalogAgent)
  const workspaces = fixture.workspaces ?? []
  const spaces = fixture.spaces ?? []
  return {
    name: 'test-faberloom-routing-support',
    inject: [],
    apply: (ctx: Context): void => {
      ctx.provide('faberloomAgents', {
        listAgents: async () => agents,
        getAgent: async (id: string) => agents.find(agent => agent.id === id),
      })
      ctx.provide('workspaceRegistry', { list: () => workspaces })
      ctx.provide('faberloomSpaces', { list: async () => spaces })
    },
  }
}

/**
 * The consumer the session controller is: read the Space agent's route and use
 * it as the session default while no request header is logged yet.
 */
function spaceRouteConsumer(): FixturePlugin {
  return {
    name: 'test-faberloom-space-default-route',
    inject: ['agents'],
    apply: (ctx: Context): void => {
      const attach = (agent: Agent): void => {
        agent.ctx.on('agent/request', async (_payload, next) => {
          const resolved = await next()
          if (agent.session.requestHeader() !== undefined) return resolved
          const route = ctx.get('faberloomSessionAgent')?.routeFor(agent)
          if (route === undefined) return resolved
          return { ...resolved, provider: route.provider, model: route.model, credentialRef: route.credentialRef }
        })
      }
      for (const agent of ctx.agents.list()) attach(agent)
      ctx.on('agent/created', ({ agent }) => { attach(agent) })
    },
  }
}

/**
 * Boot the routing composition through the Loader against the fixture's routes.
 * @param fixture - catalog, routes, stored keys, and Space records.
 * @param environment - extra environment variables to stub for the boot (the harness home is set automatically).
 * @param onProviderCall - optional recorder of every provider exchange, for a live spec's evidence.
 * @returns the live context and the loop driver.
 */
export async function bootRoutingHarness(
  fixture: RoutingFixture,
  environment: Readonly<Record<string, string>> = {},
  onProviderCall?: (call: ProviderCall) => void,
): Promise<RoutingHarness> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-faberloom-routing-'))
  homes.push(home)
  vi.stubEnv('DSH_HOME', home)
  for (const [name, value] of Object.entries(environment)) vi.stubEnv(name, value)
  const credentialsPath = join(home, '.credentials.yaml')
  await writeFile(credentialsPath, 'version: 1\nrefs: {}\n', { mode: 0o600 })

  const configPath = join(home, 'cordis.yml')
  await writeFile(configPath, [
    '- id: llm',
    "  name: '@deepseek-ai/dsh-llm'",
    '- id: session',
    "  name: '@deepseek-ai/dsh-session'",
    '- id: session-projection',
    "  name: '@deepseek-ai/dsh-session-projection'",
    '- id: system-prompt',
    "  name: '@deepseek-ai/dsh-system-prompt'",
    '- id: tools',
    "  name: '@deepseek-ai/dsh-tools'",
    '- id: agents',
    "  name: '@deepseek-ai/dsh-agent'",
    '- id: agent-loop',
    "  name: '@deepseek-ai/dsh-agent-loop'",
    '  config:',
    '    agents: []',
    '- id: credentials',
    "  name: '@deepseek-ai/dsh-credentials-local'",
    '  config:',
    `    path: ${JSON.stringify(credentialsPath)}`,
    '    watch: false',
    '- id: faberloom-agent-plane',
    "  name: '@deepseek-ai/dsh-faberloom-agent-plane'",
    '- id: faberloom-session-agent',
    "  name: '@deepseek-ai/dsh-faberloom-session-agent'",
    '  config:',
    "    ownerId: 'owner@test'",
    "    role: 'admin'",
    "    companyId: 'company-1'",
    '- id: routing-support',
    "  name: 'test-faberloom-routing-support'",
    '- id: routing-provider',
    "  name: 'test-faberloom-routing-provider'",
    '- id: routing-consumer',
    "  name: 'test-faberloom-space-default-route'",
    '',
  ].join('\n'))

  const ctx = new Context()
  live.push(ctx)
  ctx.baseUrl = pathToFileURL(home).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-llm', LlmRuntime],
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-session-projection', SessionProjectionRegistry],
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-agent', AgentRegistry],
    ['@deepseek-ai/dsh-agent-loop', AgentLoop],
    ['@deepseek-ai/dsh-credentials-local', LocalCredentials],
    ['@deepseek-ai/dsh-faberloom-agent-plane', FaberLoomAgentPlane],
    ['@deepseek-ai/dsh-faberloom-session-agent', FaberLoomSessionAgent],
    ['test-faberloom-routing-support', supportPlugin(fixture)],
    ['test-faberloom-routing-provider', stubProviderPlugin(fixture.routes, onProviderCall)],
    ['test-faberloom-space-default-route', spaceRouteConsumer()],
  ])
  // The custom importer bypasses Node resolution; mirror the package manifests
  // a deployed cordis.yml has beside its declared dependencies.
  await Promise.all([...modules.keys()].map(async (name) => {
    const directory = join(home, 'node_modules', ...name.split('/'))
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), `${JSON.stringify({ name, version: '0.1.0-rc.8', type: 'module' })}\n`)
  }))
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()

  const credentials = ctx.get('credentials')
  for (const [id, key] of fixture.keys) await credentials?.set(agentCredentialRef(id as FaberLoomAgentId), key)

  return {
    ctx,
    create: async (id, options = {}, meta = {}) => ctx.agentLoop.create(SessionId(id), options, meta),
  }
}

/** Send one user prompt and wait for its turn to settle. */
export async function driveTurn(agent: Agent, text: string): Promise<void> {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
  await agent.whenIdle()
}

/** One `turn/end` reason, reduced to the fields the routing specs assert on. */
export interface TurnEnd {
  /** Terminal kind: `completed`, `error`, `aborted`, or a bound like `max-tokens`. */
  readonly kind: string
  /** Structured failure when the kind is `error`. */
  readonly error?: { readonly code?: string; readonly message?: string }
}

/**
 * Read the `turn/end` reasons recorded for one session.
 * @param agent - live Agent whose log to read.
 * @returns the reasons, oldest first.
 */
export function turnEnds(agent: Agent): readonly TurnEnd[] {
  return agent.session.snapshotEvents()
    .filter(event => event.type === 'turn/end')
    .map(event => (event.data as { reason: TurnEnd }).reason)
}
