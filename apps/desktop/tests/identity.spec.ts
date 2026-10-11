import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  readIdentity,
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

it('renders the identity patch with the signed-in owner and no token', () => {
  const patch = renderIdentityPatch(identity, 'C:/home/.dsh')
  expect(patch).toContain('ownerId: "alejandro@muitowork.com"')
  expect(patch).toContain('role: "admin"')
  expect(patch).toContain('- id: faberloom-defaults')
  expect(patch).not.toContain('sk-')
})

it('writes the env layer, the patch, and the identity record', () => {
  const home = fixture()
  writeFileSync(join(home, '.env'), 'DEEPSEEK_API_KEY=sk-keep\n')
  writeIdentity(home, identity, { token: 'tok-1' })
  expect(readFileSync(join(home, '.env'), 'utf8')).toBe('DEEPSEEK_API_KEY=sk-keep\nCONSOLA_API_BASE=https://consola.mwt.one/api\nCONSOLA_TOKEN=tok-1\n')
  expect(readFileSync(join(home, IDENTITY_PATCH_FILENAME), 'utf8')).toContain('ownerId: "alejandro@muitowork.com"')
  expect(readIdentity(home)).toEqual(identity)
})

it('replaces an existing console token instead of duplicating it', () => {
  const home = fixture()
  writeFileSync(join(home, '.env'), 'CONSOLA_TOKEN=old\nOTHER=1\n')
  writeIdentity(home, identity, { token: 'new' })
  const env = readFileSync(join(home, '.env'), 'utf8')
  expect(env).toBe('CONSOLA_TOKEN=new\nOTHER=1\nCONSOLA_API_BASE=https://consola.mwt.one/api\n')
})

it('signs out by clearing the record, the patch, and the console token only', () => {
  const home = fixture()
  writeIdentity(home, identity, { token: 'tok-1' })
  writeFileSync(join(home, '.env'), 'DEEPSEEK_API_KEY=sk-keep\nCONSOLA_API_BASE=https://consola.mwt.one/api\nCONSOLA_TOKEN=tok-1\n')
  expect(signOut(home)).toEqual(['CONSOLA_TOKEN'])
  expect(readIdentity(home)).toBeUndefined()
  expect(() => readFileSync(join(home, IDENTITY_PATCH_FILENAME), 'utf8')).toThrow()
  expect(readFileSync(join(home, '.env'), 'utf8')).toBe('DEEPSEEK_API_KEY=sk-keep\nCONSOLA_API_BASE=https://consola.mwt.one/api\n')
})
