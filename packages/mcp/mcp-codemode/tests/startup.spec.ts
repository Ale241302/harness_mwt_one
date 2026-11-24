import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { isProcessEntry, loadFacadeConfigFile, main, parseFacadeConfig, parseStartupArgs } from '../src/startup.ts'

const SELF = fileURLToPath(import.meta.url)
const directory = mkdtempSync(join(tmpdir(), 'codemode-startup-'))

afterAll(() => { rmSync(directory, { recursive: true, force: true }) })

describe('config file boundary', () => {
  it('accepts one stdio and one http upstream', () => {
    const config = parseFacadeConfig({
      upstreams: [
        { serverName: 'local', transport: 'stdio', command: 'node', args: ['server.js'], env: { TOKEN: 'x' } },
        { serverName: 'mwt', transport: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } },
      ],
      timeoutMs: 120_000,
    })
    expect(config.upstreams).toHaveLength(2)
    expect(config.timeoutMs).toBe(120_000)
    expect(config.upstreams[1]).toEqual({
      serverName: 'mwt',
      transport: 'http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: 'Bearer t' },
    })
  })

  it('rejects a document without upstreams', () => {
    expect(() => parseFacadeConfig({ upstreams: [] })).toThrow('config.upstreams must be a non-empty array')
  })

  it('rejects an unknown transport', () => {
    expect(() => parseFacadeConfig({ upstreams: [{ serverName: 'x', transport: 'sse' }] }))
      .toThrow('config.upstreams[0].transport must be "stdio" or "http"')
  })

  it('rejects a duplicated server name', () => {
    expect(() => parseFacadeConfig({
      upstreams: [
        { serverName: 'x', transport: 'stdio', command: 'node' },
        { serverName: 'x', transport: 'stdio', command: 'node' },
      ],
    })).toThrow('config.upstreams[1].serverName "x" is duplicated')
  })

  it('rejects a non-http URL and a non-string header', () => {
    expect(() => parseFacadeConfig({ upstreams: [{ serverName: 'x', transport: 'http', url: 'ftp://example.com' }] }))
      .toThrow('config.upstreams[0].url must use http or https')
    expect(() => parseFacadeConfig({ upstreams: [{ serverName: 'x', transport: 'http', url: 'https://e.com', headers: { a: 1 } }] }))
      .toThrow('config.upstreams[0].headers.a must be a string')
  })

  it('rejects a non-positive limit', () => {
    expect(() => parseFacadeConfig({
      upstreams: [{ serverName: 'x', transport: 'stdio', command: 'node' }],
      timeoutMs: 0,
    })).toThrow('config.timeoutMs must be a positive integer')
  })

  it('rejects an upstream entry that is not an object and a malformed argument list', () => {
    expect(() => parseFacadeConfig({ upstreams: [5] })).toThrow('config.upstreams[0] must be an object')
    expect(() => parseFacadeConfig({ upstreams: [{ serverName: 'x', transport: 'stdio', command: 'node', args: 'x' }] }))
      .toThrow('config.upstreams[0].args must be an array of strings')
    expect(() => parseFacadeConfig({ upstreams: [{ serverName: 'x', transport: 'stdio', command: 'node', args: [1] }] }))
      .toThrow('config.upstreams[0].args must be an array of strings')
  })

  it('rejects a server name outside the shared grammar', () => {
    expect(() => parseFacadeConfig({ upstreams: [{ serverName: 'bad name', transport: 'stdio', command: 'node' }] }))
      .toThrow('config.upstreams[0].serverName must match')
  })

  it('rejects a malformed URL and accepts an HTTP upstream without headers', () => {
    expect(() => parseFacadeConfig({ upstreams: [{ serverName: 'x', transport: 'http', url: 'not a url' }] }))
      .toThrow('config.upstreams[0].url is not a valid URL')
    expect(parseFacadeConfig({
      upstreams: [{ serverName: 'x', transport: 'http', url: 'https://e.com' }],
    }).upstreams[0]).toEqual({ serverName: 'x', transport: 'http', url: 'https://e.com' })
  })

  it('accepts a stdio working directory and every optional limit', () => {
    const config = parseFacadeConfig({
      upstreams: [{ serverName: 'x', transport: 'stdio', command: 'node', cwd: 'C:/work' }],
      maxOutputBytes: 1,
      maxUpstreamResultBytes: 2,
      maxCatalogBytes: 3,
      maxPendingCalls: 4,
      maxOldGenerationSizeMb: 5,
      nodeExecutable: 'C:/node.exe',
      cwd: 'C:/work',
    })
    expect(config).toMatchObject({
      maxOutputBytes: 1,
      maxUpstreamResultBytes: 2,
      maxCatalogBytes: 3,
      maxPendingCalls: 4,
      maxOldGenerationSizeMb: 5,
      nodeExecutable: 'C:/node.exe',
      cwd: 'C:/work',
    })
  })

  it('reports an unreadable file and invalid JSON by name', () => {
    expect(() => loadFacadeConfigFile(join(directory, 'absent.json'))).toThrow('cannot read config')
    const broken = join(directory, 'broken.json')
    writeFileSync(broken, '{ nope')
    expect(() => loadFacadeConfigFile(broken)).toThrow('is not valid JSON')
  })

  it('reads a valid file', () => {
    const path = join(directory, 'ok.json')
    writeFileSync(path, JSON.stringify({ upstreams: [{ serverName: 'local', transport: 'stdio', command: 'node' }] }))
    expect(loadFacadeConfigFile(path).upstreams).toHaveLength(1)
  })
})

describe('command line', () => {
  it('accepts both config spellings and help', () => {
    expect(parseStartupArgs(['--config', 'a.json'])).toEqual({ help: false, configPath: 'a.json' })
    expect(parseStartupArgs(['--config=a.json'])).toEqual({ help: false, configPath: 'a.json' })
    expect(parseStartupArgs(['--help'])).toEqual({ help: true })
    expect(parseStartupArgs(['-h'])).toEqual({ help: true })
  })

  it('requires --config and rejects unknown arguments', () => {
    expect(() => parseStartupArgs([])).toThrow('--config is required')
    expect(() => parseStartupArgs(['--verbose'])).toThrow('unrecognized argument')
    expect(() => parseStartupArgs(['--config'])).toThrow('--config must be a non-empty string')
  })

  it('skips a hole in the argument list', () => {
    expect(parseStartupArgs([undefined, '--help'] as unknown as string[])).toEqual({ help: true })
  })
})

describe('process entry guard', () => {
  it('recognizes this module and rejects other paths', () => {
    expect(isProcessEntry(pathToFileURL(SELF).href, SELF)).toBe(true)
    expect(isProcessEntry(pathToFileURL(SELF).href, undefined)).toBe(false)
    expect(isProcessEntry(pathToFileURL(SELF).href, join(directory, 'missing.js'))).toBe(false)
  })
})

describe('main', () => {
  it('prints usage without starting a server', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    await expect(main(['--help'])).resolves.toBe(0)
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('--config <file>'))
    stdout.mockRestore()
  })

  it('fails loud on a missing config and writes to stderr', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(main(['--config', join(directory, 'absent.json')])).resolves.toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('cannot read config'))
    stderr.mockRestore()
  })

  it('fails loud without arguments', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(main([])).resolves.toBe(1)
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('--config is required'))
    stderr.mockRestore()
  })
})
