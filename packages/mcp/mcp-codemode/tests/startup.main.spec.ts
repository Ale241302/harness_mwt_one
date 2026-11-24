import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  serveStdio: vi.fn(),
  createFacade: vi.fn(),
  handleClose: vi.fn(),
  facadeClose: vi.fn(),
}))

vi.mock('@modelcontextprotocol/server/stdio', () => ({ serveStdio: mocks.serveStdio }))
vi.mock('../src/index.ts', () => ({ createCodeModeFacade: mocks.createFacade }))

import { main } from '../src/startup.ts'

const directory = mkdtempSync(join(tmpdir(), 'codemode-main-'))
const configPath = join(directory, 'codemode.json')

writeFileSync(configPath, JSON.stringify({
  upstreams: [{ serverName: 'fx', transport: 'stdio', command: process.execPath }],
  timeoutMs: 1000,
}))

afterAll(() => { rmSync(directory, { recursive: true, force: true }) })

beforeEach(() => {
  mocks.serveStdio.mockReset().mockReturnValue({ close: mocks.handleClose })
  mocks.createFacade.mockReset().mockResolvedValue({
    run: vi.fn(),
    catalog: vi.fn(),
    servers: [],
    close: mocks.facadeClose,
  })
  mocks.handleClose.mockReset().mockResolvedValue(undefined)
  mocks.facadeClose.mockReset().mockResolvedValue(undefined)
})

describe('main serving loop', () => {
  it('serves stdio, exposes the server factory, and closes on stdin end', async () => {
    const running = main(['--config', configPath])
    await vi.waitFor(() => { expect(mocks.serveStdio).toHaveBeenCalledTimes(1) })
    const [factory, options] = mocks.serveStdio.mock.calls[0] as [() => unknown, { onerror: (error: Error) => void }]
    const server = factory()
    expect(server).toBeDefined()

    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    options.onerror(new Error('transport broke'))
    expect(stderr).toHaveBeenCalledWith('mcp-codemode: transport broke\n')
    stderr.mockRestore()

    process.stdin.emit('end')
    process.stdin.emit('close')
    await expect(running).resolves.toBe(0)
    expect(mocks.handleClose).toHaveBeenCalledTimes(1)
    expect(mocks.facadeClose).toHaveBeenCalledTimes(1)
  })

  it('still closes upstreams when the transport close rejects', async () => {
    mocks.handleClose.mockRejectedValueOnce(new Error('close failed'))
    const running = main(['--config', configPath])
    await vi.waitFor(() => { expect(mocks.serveStdio).toHaveBeenCalledTimes(1) })
    process.stdin.emit('end')
    await expect(running).resolves.toBe(0)
    expect(mocks.facadeClose).toHaveBeenCalledTimes(1)
  })

  it('reports a non-Error startup failure', async () => {
    mocks.serveStdio.mockImplementationOnce(() => { throw 'plain failure' })
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    await expect(main(['--config', configPath])).resolves.toBe(1)
    expect(stderr).toHaveBeenCalledWith('mcp-codemode: plain failure\n')
    stderr.mockRestore()
  })
})
