import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { FaberLoomToolHost } from '../src/tools.ts'

/** A host whose mounted view records what each file tool asks of it. */
function harness(scopes: readonly string[] | null = null) {
  const writeSpaceFiles = vi.fn(async () => ({
    written: 1,
    bytes: 3,
    files: [{ path: 'B2B/uno.md', bytes: 3, sha256: 'a'.repeat(64) }],
  }))
  const spaceTree = vi.fn(async () => ({
    root: '/data/users/x/spaces/B2B',
    entries: [
      { path: 'B2B/uno.md', kind: 'file', bytes: 3, name: 'uno.md', modifiedAt: '', createdAt: '' },
    ],
  }))
  const ctx = new Context()
  ctx.provide('faberloomView', { spaceTree, writeSpaceFiles })
  return { host: new FaberLoomToolHost(ctx, 'owner@muitowork.com', scopes), writeSpaceFiles, spaceTree }
}

describe('space file tools', () => {
  it('lists a Space area without leaking the absolute root', async () => {
    const { host, spaceTree } = harness()

    const result = await host.call('faberloom_space_files', { spaceId: 'sp1' })
    const text = JSON.stringify(result)

    expect(spaceTree).toHaveBeenCalledWith('sp1')
    expect(text).toContain('B2B/uno.md')
    expect(text).not.toContain('/data/users/x/spaces/B2B')
  })

  it('forwards validated files to the view', async () => {
    const { host, writeSpaceFiles } = harness()

    await host.call('faberloom_space_files_write', {
      spaceId: 'sp1',
      files: [{ path: 'B2B/uno.md', content: 'uno' }],
    })

    expect(writeSpaceFiles).toHaveBeenCalledWith('sp1', [{ path: 'B2B/uno.md', content: 'uno' }])
  })

  it('refuses an empty file list', async () => {
    const { host, writeSpaceFiles } = harness()

    await expect(host.call('faberloom_space_files_write', { spaceId: 'sp1', files: [] }))
      .rejects.toThrow(/at least one file/u)
    expect(writeSpaceFiles).not.toHaveBeenCalled()
  })

  it('refuses an item without text content', async () => {
    const { host, writeSpaceFiles } = harness()

    await expect(host.call('faberloom_space_files_write', { spaceId: 'sp1', files: [{ path: 'B2B/uno.md' }] }))
      .rejects.toThrow(/needs text content/u)
    expect(writeSpaceFiles).not.toHaveBeenCalled()
  })

  it('refuses a token that is not scoped for the write tool', async () => {
    const { host, writeSpaceFiles } = harness(['faberloom_overview'])

    await expect(host.call('faberloom_space_files_write', { spaceId: 'sp1', files: [{ path: 'a.md', content: 'a' }] }))
      .rejects.toThrow(/not scoped/u)
    expect(writeSpaceFiles).not.toHaveBeenCalled()
  })
})
