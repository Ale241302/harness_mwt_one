// @vitest-environment jsdom
/** Browser save of a tool call's file through the authenticated Host route. */
import { afterEach, expect, it, vi } from 'vitest'
import { downloadWorkspaceFile } from '../src/client/download.ts'

afterEach(vi.restoreAllMocks)

/** Run `downloadWorkspaceFile` and return the anchor it clicked. */
function anchorFor(cwd: string | undefined, path: string): HTMLAnchorElement {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  downloadWorkspaceFile(cwd, path)
  const anchor = click.mock.contexts[0] as HTMLAnchorElement | undefined
  if (anchor === undefined) throw new Error('no anchor was clicked')
  return anchor
}

it('resolves the call path against the Session root', () => {
  const anchor = anchorFor('/w/app', 'src/a.ts')
  expect(anchor.getAttribute('href')).toBe('/api/file?path=%2Fw%2Fapp%2Fsrc%2Fa.ts&download=1')
  expect(anchor.download).toBe('a.ts')
})

it('keeps an absolute path and its basename when no workspace root is known', () => {
  const anchor = anchorFor(undefined, '/srv/docs/report.pdf')
  expect(anchor.getAttribute('href')).toBe('/api/file?path=%2Fsrv%2Fdocs%2Freport.pdf&download=1')
  expect(anchor.download).toBe('report.pdf')
})
