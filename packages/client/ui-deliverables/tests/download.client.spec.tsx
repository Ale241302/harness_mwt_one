// @vitest-environment jsdom
/** Browser save of one workspace file through the authenticated Host route. */
import { afterEach, expect, it, vi } from 'vitest'
import { downloadWorkspaceFile, WORKSPACE_FILE_PATH } from '../src/client/download.ts'

afterEach(vi.restoreAllMocks)

/** Run `downloadWorkspaceFile` and return the anchor it clicked. */
function anchorFor(cwd: string | undefined, path: string): HTMLAnchorElement {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  downloadWorkspaceFile(cwd, path)
  const anchor = click.mock.contexts[0] as HTMLAnchorElement | undefined
  if (anchor === undefined) throw new Error('no anchor was clicked')
  return anchor
}

it('resolves a workspace-relative path against the Session root', () => {
  const anchor = anchorFor('/work', 'out/report.pdf')
  expect(anchor.download).toBe('report.pdf')
  expect(anchor.getAttribute('href')).toBe(`${WORKSPACE_FILE_PATH}?path=%2Fwork%2Fout%2Freport.pdf&download=1`)
})

it('keeps an absolute path and its basename when the workspace root is unknown', () => {
  const anchor = anchorFor(undefined, '/root/SICOP/graficos/01-concentracion.svg')
  expect(anchor.download).toBe('01-concentracion.svg')
  expect(anchor.getAttribute('href'))
    .toBe(`${WORKSPACE_FILE_PATH}?path=%2Froot%2FSICOP%2Fgraficos%2F01-concentracion.svg&download=1`)
})
