/** Browser save of the file a preview tab is showing. */

/**
 * Hand one Host file to the browser download manager.
 *
 * The Host route serves bytes it is authorized to read and turns the response
 * into a save when `download` is present; the browser owns the destination, so
 * this needs no desktop on the Host.
 * @param absolutePath - the file's absolute Host path, as the resource metadata reports it.
 * @param name - browser save filename.
 * @returns Nothing; the browser download manager owns the save.
 */
export function downloadHostFile(absolutePath: string, name: string): void {
  const query = new URLSearchParams({ path: absolutePath, download: '1' })
  const anchor = document.createElement('a')
  anchor.href = `/api/file?${query.toString()}`
  anchor.download = name
  anchor.click()
}
