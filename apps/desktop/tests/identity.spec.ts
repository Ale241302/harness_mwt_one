import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  readIdentity,
  refreshIdentityPatch,
  renderIdentityPatch,
  signInToConsole,
  signOut,
  writeIdentity,
  IDENTITY_PATCH_FILENAME,
} from '../src/identity.ts'

const roots: string[] = []
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-identity-'))
  roots.push(root)
  return root
}

afterEach(() => {
  vi.unstubAllGlobals()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const identity = {
  email: 'alejandro@muitowork.com',
  role: 'admin',
  readOnly: false,
  consolaBase: 'https://consola.mwt.one/api',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

it('signs in and derives identity and credentials from the console answer', async () => {
  const fetchMock = vi.fn(async () => jsonResponse({
    user: { id: 'u1', email: '  alejandro@muitowork.com ', full_name: 'Alejandro', role: 'admin', permissions: { actions: ['doc.view', 'doc.create'] } },
    access: 'tok-1',
    refresh: 'ref-1',
  }))
  vi.stubGlobal('fetch', fetchMock)
  const result = await signInToConsole('https://consola.mwt.one/api/', 'alejandro', 'secret')
  expect(result.identity).toEqual({ email: 'alejandro@muitowork.com', role: 'admin', readOnly: false, consolaBase: 'https://consola.mwt.one/api', fullName: 'Alejandro' })
  expect(result.credentials).toEqual({ token: 'tok-1', refresh: 'ref-1' })
  expect(fetchMock).toHaveBeenCalledWith('https://consola.mwt.one/api/auth/login/', expect.objectContaining({ method: 'POST' }))
})

it.each([
  [{ role: 'viewer' }, true],
  [{ role: 'client_b2b' }, true],
  [{ role: 'admin', permissions: { actions: ['doc.view'] } }, true],
  [{ role: 'admin', permissions: { actions: ['doc.view', 'doc.edit'] } }, false],
  [{ role: 'admin', permissions: { read_only: true } }, true],
  [{ role: 'admin' }, false],
])('derives read-only %o as %s', async (account, expected) => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ user: { id: 'u', email: 'a@b.c', ...account }, access: 't' })))
  const result = await signInToConsole('https://consola.mwt.one/api', 'a', 'p')
  expect(result.identity.readOnly).toBe(expected)
})

it('reports refused credentials and unreachable consoles distinctly', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({}, 401)))
  await expect(signInToConsole('https://consola.mwt.one/api', 'a', 'p')).rejects.toThrow('Usuario o contraseña incorrectos.')
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
  await expect(signInToConsole('https://consola.mwt.one/api', 'a', 'p')).rejects.toThrow(/No se pudo contactar la consola/u)
})

it('renders the identity patch with the signed-in owner, the public MCP server, and no token', () => {
  const patch = renderIdentityPatch(identity, 'C:/home/.dsh', {})
  expect(patch).toContain('ownerId: "alejandro@muitowork.com"')
  expect(patch).toContain('role: "admin"')
  expect(patch).toContain('- id: faberloom-defaults')
  expect(patch).toContain('- id: mcp-sicop')
  expect(patch).not.toContain('X-Forwarded-User-Email')
  expect(patch).not.toContain('sk-')
})

it('mounts the deployment MCP servers only when a URL and its key are resolved', () => {
  const environment = {
    MWT_MCP_URL: 'https://harness.mwt.one/mwt/mcp',
    MWT_MCP_GATEWAY_KEY: 'gateway-key',
    FABERLOOM_MCP_URL: 'https://harness.mwt.one/faberloom/mcp',
    FABERLOOM_GATEWAY_KEY: 'faberloom-key',
  }
  const patch = renderIdentityPatch(identity, 'C:/home/.dsh', environment)
  expect(patch).toContain('- id: mcp-mwt')
  expect(patch).toContain("X-Forwarded-User-Email: 'alejandro@muitowork.com'")
  expect(patch).toContain("X-MWT-Gateway-Key: !!js process.env.MWT_MCP_GATEWAY_KEY ?? ''")
  expect(patch).toContain("Authorization: 'Bearer dsh-gateway'")
  expect(patch).toContain('- id: mcp-faberloom')
  expect(patch).not.toContain('gateway-key')
  expect(patch).not.toContain('faberloom-key')
})

it('omits every MCP entry when the operator blanks their URLs', () => {
  const patch = renderIdentityPatch(identity, 'C:/home/.dsh', { SICOP_MCP_URL: '' })
  expect(patch).not.toContain('- insert:')
  expect(patch).not.toContain('dsh-mcp-client')
})

it('writes the env layer, the patch, and the identity record', () => {
  const home = fixture()
  writeFileSync(join(home, '.env'), 'DEEPSEEK_API_KEY=sk-keep\n')
  writeIdentity(home, identity, { token: 'tok-1' }, {})
  expect(readFileSync(join(home, '.env'), 'utf8')).toBe('DEEPSEEK_API_KEY=sk-keep\nCONSOLA_API_BASE=https://consola.mwt.one/api\nCONSOLA_TOKEN=tok-1\n')
  expect(readFileSync(join(home, IDENTITY_PATCH_FILENAME), 'utf8')).toContain('ownerId: "alejandro@muitowork.com"')
  expect(readIdentity(home)).toEqual(identity)
})

it('mounts the catalogs an installation ships instead of an empty local directory', () => {
  const home = fixture()
  const catalogRoot = join(home, 'catalogs')
  const sharedRoot = join(catalogRoot, 'shared')
  const agentsRoot = join(catalogRoot, 'agents')
  const role = (identity.role.length > 0 ? identity.role : 'client_b2b').toLowerCase()
  mkdirSync(join(catalogRoot, role), { recursive: true })
  mkdirSync(sharedRoot, { recursive: true })
  const patch = renderIdentityPatch(identity, home, {}, {
    skillsCatalogRoot: catalogRoot,
    skillsSharedRoot: sharedRoot,
    agentsSharedRoot: agentsRoot,
  })
  expect(patch).toContain(`skillsCatalogRoot: ${JSON.stringify(catalogRoot)}`)
  expect(patch).toContain(`skillsSharedRoot: ${JSON.stringify(sharedRoot)}`)
  expect(patch).toContain(`agentsSharedRoot: ${JSON.stringify(agentsRoot)}`)
  expect(patch).toContain('- id: faberloom-skills')
  expect(patch).toContain(`      - ${JSON.stringify(join(catalogRoot, role))}`)
  expect(patch).toContain(`      - ${JSON.stringify(sharedRoot)}`)
})

it('mounts no catalog directory that the installation does not carry', () => {
  const home = fixture()
  const patch = renderIdentityPatch(identity, home, {}, {
    skillsCatalogRoot: join(home, 'absent'),
    skillsSharedRoot: join(home, 'absent-too'),
    agentsSharedRoot: join(home, 'absent-agents'),
  })
  expect(patch).not.toContain('- id: faberloom-skills')
})

it('rewrites the patch for a stored identity without touching the console token', () => {
  const home = fixture()
  writeIdentity(home, identity, { token: 'tok-1' }, {})
  const catalogRoot = join(home, 'catalogs')
  const role = (identity.role.length > 0 ? identity.role : 'client_b2b').toLowerCase()
  mkdirSync(join(catalogRoot, role), { recursive: true })
  expect(refreshIdentityPatch(home, {}, {
    skillsCatalogRoot: catalogRoot,
    skillsSharedRoot: join(catalogRoot, 'shared'),
    agentsSharedRoot: join(catalogRoot, 'agents'),
  })).toBe(true)
  expect(readFileSync(join(home, IDENTITY_PATCH_FILENAME), 'utf8')).toContain(`skillsCatalogRoot: ${JSON.stringify(catalogRoot)}`)
  expect(readFileSync(join(home, '.env'), 'utf8')).toContain('CONSOLA_TOKEN=tok-1')
  expect(refreshIdentityPatch(join(home, 'empty'), {}, undefined)).toBe(false)
})

it('replaces an existing console token instead of duplicating it', () => {
  const home = fixture()
  writeFileSync(join(home, '.env'), 'CONSOLA_TOKEN=old\nOTHER=1\n')
  writeIdentity(home, identity, { token: 'new' }, {})
  const env = readFileSync(join(home, '.env'), 'utf8')
  expect(env).toBe('CONSOLA_TOKEN=new\nOTHER=1\nCONSOLA_API_BASE=https://consola.mwt.one/api\n')
})

it('signs out by clearing the record, the patch, and the console token only', () => {
  const home = fixture()
  writeIdentity(home, identity, { token: 'tok-1' }, {})
  writeFileSync(join(home, '.env'), 'DEEPSEEK_API_KEY=sk-keep\nCONSOLA_API_BASE=https://consola.mwt.one/api\nCONSOLA_TOKEN=tok-1\n')
  expect(signOut(home)).toEqual(['CONSOLA_TOKEN'])
  expect(readIdentity(home)).toBeUndefined()
  expect(() => readFileSync(join(home, IDENTITY_PATCH_FILENAME), 'utf8')).toThrow()
  expect(readFileSync(join(home, '.env'), 'utf8')).toBe('DEEPSEEK_API_KEY=sk-keep\nCONSOLA_API_BASE=https://consola.mwt.one/api\n')
})
