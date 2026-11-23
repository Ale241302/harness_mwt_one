/**
 * The mail-download tool treats a sender's link as untrusted input: the host is
 * resolved and checked before any connection, the socket is pinned to that
 * address, redirects repeat the check, and the body is bounded while it streams.
 */
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAIL_DOWNLOAD_MAX_BYTES,
  downloadMailLink,
  isBlockedAddress,
  publicAddress,
  readLimited,
  safeDownloadName,
  writeUniqueFile,
  type DownloadResponse,
  type ResolvedAddress,
} from '../src/download.ts'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

/** One response with a static body. */
function answer(status: number, body: string, headers: Record<string, string> = {}): DownloadResponse {
  return { status, headers, body: Readable.from([Buffer.from(body)]) }
}

/** A resolver that answers every host with the same address. */
function resolver(address: string, family = 4) {
  return vi.fn(async () => [{ address, family }] as readonly ResolvedAddress[])
}

describe('blocked addresses', () => {
  it('refuses loopback, private, link-local, carrier and reserved ranges', () => {
    for (const address of [
      '127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1',
      '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', 'fe80::1', 'fc00::1', 'ff02::1', '::ffff:127.0.0.1',
    ]) {
      expect(isBlockedAddress(address), address).toBe(true)
    }
  })

  it('allows public addresses', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
      expect(isBlockedAddress(address), address).toBe(false)
    }
  })
})

describe('publicAddress', () => {
  it('refuses a loopback literal without resolving it', async () => {
    const resolve = resolver('8.8.8.8')
    await expect(publicAddress('127.0.0.1', resolve)).rejects.toThrow('private address')
    expect(resolve).not.toHaveBeenCalled()
  })

  it('refuses a name when any answer is private', async () => {
    const resolve = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ] as readonly ResolvedAddress[])
    await expect(publicAddress('mail.example', resolve)).rejects.toThrow('resolves to a private address')
  })

  it('returns the checked address for a public name', async () => {
    await expect(publicAddress('mail.example', resolver('93.184.216.34')))
      .resolves.toEqual({ address: '93.184.216.34', family: 4 })
  })
})

describe('readLimited', () => {
  it('accepts a body exactly at the bound', async () => {
    await expect(readLimited(Readable.from([Buffer.alloc(10)]), 10)).resolves.toHaveLength(10)
  })

  it('refuses the chunk that passes the bound', async () => {
    await expect(readLimited(Readable.from([Buffer.alloc(6), Buffer.alloc(6)]), 10)).rejects.toThrow('more than 10 bytes')
  })
})

describe('downloadMailLink', () => {
  it('returns the bounded body, media type and name', async () => {
    const send = vi.fn(async (_url: URL, _address: ResolvedAddress) =>
      answer(200, 'hola', { 'content-type': 'application/pdf; charset=binary' }))
    const result = await downloadMailLink('https://mail.example/files/oc.pdf', { resolve: resolver('93.184.216.34'), send })

    expect(result.bytes.toString()).toBe('hola')
    expect(result.mediaType).toBe('application/pdf')
    expect(result.name).toBe('oc.pdf')
    expect(result.finalUrl).toBe('https://mail.example/files/oc.pdf')
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[1]).toEqual({ address: '93.184.216.34', family: 4 })
  })

  it('refuses a redirect that lands on a private address', async () => {
    const send = vi.fn(async () => answer(302, '', { location: 'http://127.0.0.1/secret' }))
    await expect(downloadMailLink('https://mail.example/go', { resolve: resolver('93.184.216.34'), send }))
      .rejects.toThrow('private address')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('follows a redirect while re-checking the destination', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce(answer(302, '', { location: '/files/oc.pdf' }))
      .mockResolvedValueOnce(answer(200, 'pdf', { 'content-type': 'application/pdf' }))
    const resolve = resolver('93.184.216.34')

    const result = await downloadMailLink('https://mail.example/go', { resolve, send })

    expect(result.bytes.toString()).toBe('pdf')
    expect(result.finalUrl).toBe('https://mail.example/files/oc.pdf')
    expect(resolve).toHaveBeenCalledTimes(2)
  })

  it('refuses a declared length over the cap before reading it', async () => {
    const send = vi.fn(async () => answer(200, '', { 'content-length': String(MAIL_DOWNLOAD_MAX_BYTES + 1) }))
    await expect(downloadMailLink('https://mail.example/big', { resolve: resolver('93.184.216.34'), send }))
      .rejects.toThrow(`more than ${String(MAIL_DOWNLOAD_MAX_BYTES)} bytes`)
  })

  it('refuses a stream that passes the cap without a length header', async () => {
    const body = Readable.from([Buffer.alloc(MAIL_DOWNLOAD_MAX_BYTES), Buffer.alloc(1)])
    const send = vi.fn(async () => ({ status: 200, headers: {}, body }))
    await expect(downloadMailLink('https://mail.example/big', { resolve: resolver('93.184.216.34'), send }))
      .rejects.toThrow(`more than ${String(MAIL_DOWNLOAD_MAX_BYTES)} bytes`)
  })

  it('refuses more redirects than the chain allows', async () => {
    const send = vi.fn(async () => answer(302, '', { location: '/again' }))
    await expect(downloadMailLink('https://mail.example/loop', { resolve: resolver('93.184.216.34'), send }))
      .rejects.toThrow('redirects too many times')
  })

  it('refuses a non-http scheme', async () => {
    await expect(downloadMailLink('file:///etc/passwd')).rejects.toThrow('only http(s) links')
  })
})

describe('download file names', () => {
  it('drops traversal and keeps a plain name', () => {
    expect(safeDownloadName('..')).toBe('descarga')
    expect(safeDownloadName('../../etc/passwd')).toBe('passwd')
    expect(safeDownloadName('a/b.pdf')).toBe('b.pdf')
    expect(safeDownloadName('..\\evil.exe')).toBe('evil.exe')
    expect(safeDownloadName('x'.repeat(200))).toHaveLength(120)
  })

  it('writes beside an existing name instead of overwriting it', () => {
    const home = mkdtempSync(join(tmpdir(), 'mail-download-'))
    homes.push(home)
    writeFileSync(join(home, 'oc.pdf'), 'first')

    const path = writeUniqueFile(home, 'oc.pdf', Buffer.from('second'))

    expect(path).toBe(join(home, 'oc (2).pdf'))
    expect(readFileSync(join(home, 'oc.pdf'), 'utf8')).toBe('first')
    expect(readFileSync(path, 'utf8')).toBe('second')
  })

  it('never follows a symlink placed under the download name', () => {
    const home = mkdtempSync(join(tmpdir(), 'mail-download-'))
    homes.push(home)
    const target = join(home, 'target.txt')
    writeFileSync(target, 'keep')
    try {
      symlinkSync(target, join(home, 'oc.pdf'))
    } catch {
      return
    }

    const path = writeUniqueFile(home, 'oc.pdf', Buffer.from('new'))

    expect(existsSync(join(home, 'oc (2).pdf'))).toBe(true)
    expect(readFileSync(target, 'utf8')).toBe('keep')
    expect(readFileSync(path, 'utf8')).toBe('new')
  })
})
