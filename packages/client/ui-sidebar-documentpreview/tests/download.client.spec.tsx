// @vitest-environment jsdom
/** Browser save of the file a preview tab shows, through the Host route. */
import { afterEach, expect, it, vi } from 'vitest'
import { downloadHostFile } from '../src/client/download.ts'

afterEach(vi.restoreAllMocks)

it('clicks an anchor carrying the absolute path and the save flag', () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  downloadHostFile('/root/SICOP/graficos/01-concentracion.svg', '01-concentracion.svg')
  const anchor = click.mock.contexts[0] as HTMLAnchorElement | undefined
  expect(anchor).toBeDefined()
  expect(anchor!.getAttribute('href'))
    .toBe('/api/file?path=%2Froot%2FSICOP%2Fgraficos%2F01-concentracion.svg&download=1')
  expect(anchor!.download).toBe('01-concentracion.svg')
})
