/**
 * Workspace folder browsing for the `@` reference source, and the pick payload
 * every row of that source carries.
 *
 * The source's file half lists one workspace directory at a time through
 * `workspaceFiles.list`, which the Host confines to the Session's workspace
 * root, so `@` reaches any real file in the project, not only the fuzzy index's
 * capped results. This module holds the pure parts: splitting a path query
 * into the directory to list and the name filter inside it, ordering and
 * consulting one listing, naming a failed listing in the reader's words, and
 * encoding the payload a pick hands back.
 *
 * A mention is built from the listing's own workspace-relative `path` plus the
 * entry name, so it stays plain path text the model reads and the Host resolves
 * against the same workspace root.
 */
import type {
  RemoteFailure, WorkspaceDirectoryEntry, WorkspaceDirectoryListing,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { InputTriggerCandidate } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { IconPaperclipOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'
import type { ReferenceKey } from './locales.ts'

/** Bound translate for this namespace's copy, read fresh on each call. */
export type Translate = (key: ReferenceKey, params?: Record<string, unknown>) => string

/** One `@` path query split into the directory to list and the name filter inside it. */
export interface BrowseTarget {
  /** Workspace-relative spelling of the directory to list; empty at the workspace root. */
  readonly directory: string
  /** Name fragment filtering that directory's direct children; empty for no filter. */
  readonly filter: string
}

/**
 * Split one `@` path query into the directory it descends into and the name
 * fragment typed after that directory's last separator.
 * @param query - path text after `@` or `@"`, live-filtered by the editor.
 * @returns the directory to list and the filter to apply inside it.
 */
export function splitBrowseQuery(query: string): BrowseTarget {
  const slash = query.lastIndexOf('/')
  return slash < 0
    ? { directory: '', filter: query }
    : { directory: query.slice(0, slash), filter: query.slice(slash + 1) }
}

/**
 * The path handed to `workspaceFiles.list` for one query directory: the
 * Session's workspace root itself for the root query, and the root-resolved
 * absolute path when the Session list carries one, so the request names the
 * same directory the workspace tree lists.
 * @param directory - workspace-relative directory from {@link splitBrowseQuery}.
 * @param cwd - Session workspace root, when the Session list carries it.
 * @returns the path to list.
 */
export function listingPath(directory: string, cwd: string | undefined): string {
  if (directory === '') return cwd === undefined || cwd === '' ? '.' : cwd
  return resolveWorkspacePath(cwd, directory)
}

/** Natural, case-insensitive name order, so `file2` precedes `file10`. */
const byName = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/* jscpd:ignore-start -- ui-sidebar-files orders one level the same way; a plugin
   bundle shares runtime code only through the platform modules, so the rule is
   duplicated here rather than imported across packages. */
/**
 * Order one listing for display: directories first, then everything else, each
 * group by natural name order. The endpoint's order is a listing fact; this is
 * the reader's.
 * @param entries - the listing as the endpoint returned it.
 * @returns a new array, directories first, then by name within each group.
 */
export function orderEntries(entries: readonly WorkspaceDirectoryEntry[]): WorkspaceDirectoryEntry[] {
  return [...entries].sort((left, right) => {
    const group = Number(right.type === 'directory') - Number(left.type === 'directory')
    return group === 0 ? byName.compare(left.name, right.name) : group
  })
}
/* jscpd:ignore-end */

/**
 * The workspace-relative path of one child entry.
 * @param directory - the listing's own workspace-relative path; empty at the root.
 * @param name - the entry's basename.
 * @returns the child's workspace-relative path.
 */
function childListingPath(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`
}

/**
 * Project one directory listing into menu rows: directories first, then files,
 * each with the glyph and mention its pick uses, and a trailing note when the
 * endpoint's entry cap dropped children.
 *
 * A child that is neither a regular file nor a directory has no mention the
 * model can read, so it contributes no row.
 * @param listing - the settled listing.
 * @param filter - name fragment from {@link splitBrowseQuery}.
 * @param preserveQuote - retain an explicitly opened quote in every mention.
 * @param t - the reference dictionary.
 * @returns the rows for this listing, in display order.
 */
export function browseCandidates(
  listing: WorkspaceDirectoryListing,
  filter: string,
  preserveQuote: boolean,
  t: Translate,
): InputTriggerCandidate[] {
  const needle = filter.toLowerCase()
  const rows: InputTriggerCandidate[] = []
  for (const entry of orderEntries(listing.entries)) {
    if (entry.type === 'other') continue
    if (needle !== '' && !entry.name.toLowerCase().includes(needle)) continue
    const path = childListingPath(listing.path, entry.name)
    if (entry.type === 'directory') {
      const mention = formatFileMention({ path, kind: 'directory' }, preserveQuote)
      if (mention === undefined) continue
      rows.push({
        name: `${entry.name}/`,
        icon: 'folder',
        section: t('section.files'),
        value: encodeCandidate({ kind: 'file', fileKind: 'directory', label: entry.name, mention }),
        drill: true,
      })
      continue
    }
    const mention = formatFileMention({ path, kind: 'file' }, preserveQuote)
    if (mention === undefined) continue
    rows.push({
      name: entry.name,
      icon: 'file',
      section: t('section.files'),
      value: encodeCandidate({ kind: 'file', fileKind: 'file', label: entry.name, mention }),
    })
    rows.push(attachCandidate(entry.name, path, t))
  }
  if (listing.truncated) rows.push({ name: t('listing.truncated'), section: t('section.files') })
  return rows
}

/**
 * The attach verb that sits beside one file's mention row: choosing it reads
 * the file's bytes through the Host and adds them to the composer rail, while
 * the mention row keeps inserting the plain path.
 * @param name - the file's basename, shown in the row label.
 * @param path - the file's workspace-relative path, carried as the pick payload.
 * @param t - the reference dictionary.
 * @returns the attach row.
 */
export function attachCandidate(name: string, path: string, t: Translate): InputTriggerCandidate {
  return {
    name: t('candidate.attach', { name }),
    icon: IconPaperclipOutline16,
    section: t('section.files'),
    value: encodeCandidate({ kind: 'attach', label: name, path }),
  }
}

/**
 * The single row a listing that failed produces: the reader's words for the
 * failure kind. It carries no pick value, so the row cannot insert anything.
 * @param failure - the settled Remote failure.
 * @param t - the reference dictionary.
 * @returns one note row for the file section.
 */
export function browseFailureCandidates(failure: RemoteFailure, t: Translate): InputTriggerCandidate[] {
  return [{ name: failureLine(failure, t), section: t('section.files') }]
}

/**
 * Name a failed listing in the reader's words, one line per Remote failure code.
 * Carrier and unclassified Host failures reach the reader as themselves.
 * @param failure - the settled Remote failure.
 * @param t - the reference dictionary.
 * @returns the line to show for that listing.
 */
function failureLine(failure: RemoteFailure, t: Translate): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('listing.error.notFound')
    case 'workspace-file/outside-workspace': return t('listing.error.outsideWorkspace')
    case 'workspace-file/not-directory': return t('listing.error.notDirectory')
    default: return t('listing.error.unavailable', { message: failure.message })
  }
}

/** One `@` row's pick payload, encoded into the candidate's opaque `value`. */
export type ReferenceCandidateValue =
  | { readonly kind: 'file'; readonly fileKind: 'file' | 'directory'; readonly label: string; readonly mention: string }
  | { readonly kind: 'session'; readonly label: string; readonly mention: string }
  | { readonly kind: 'attach'; readonly label: string; readonly path: string }

/**
 * Name a failed workspace-file read in the reader's words, one line per refusal
 * the Host declares. Carrier and unclassified failures reach the reader as
 * themselves, so an oversized or non-text file is never silently dropped.
 * @param failure - the settled Remote failure.
 * @param t - the reference dictionary.
 * @returns the line to show for that read.
 */
export function attachFailureLine(failure: RemoteFailure, t: Translate): string {
  switch (failure.code) {
    case 'workspace-file/not-found': return t('attach.error.notFound')
    case 'workspace-file/too-large': return t('attach.error.tooLarge')
    case 'workspace-file/not-regular-file': return t('attach.error.notRegularFile')
    default: return t('attach.error.unavailable', { message: failure.message })
  }
}

/**
 * Encode one row's pick payload for its candidate `value`.
 * @param value - the row's identity and mention.
 * @returns the opaque string the pipeline hands back on pick.
 */
export function encodeCandidate(value: ReferenceCandidateValue): string {
  return JSON.stringify(value)
}

/**
 * Decode a candidate's opaque pick payload.
 * @param encoded - the value the pipeline handed back.
 * @returns the payload, or undefined for a row this source did not encode.
 */
export function parseCandidate(encoded: string | undefined): ReferenceCandidateValue | undefined {
  if (encoded === undefined) return undefined
  return JSON.parse(encoded) as ReferenceCandidateValue
}

/**
 * The drill payload for one directory destination: the same value a folder row
 * carries, so a breadcrumb step and a drilled row are one outcome.
 * @param label - text the row or crumb shows.
 * @param mention - `@dir/` text the drill writes into the draft.
 * @returns the encoded candidate value.
 */
export function directoryValue(label: string, mention: string): string {
  return encodeCandidate({ kind: 'file', fileKind: 'directory', label, mention })
}
