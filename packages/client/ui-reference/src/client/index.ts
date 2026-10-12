/**
 * Unified Web `@` reference source. File and session discovery run through
 * the cancellable generated Remote namespaces in parallel with deterministic
 * ordering and labels.
 *
 * The file half browses the Session's workspace folder tree: an empty query or
 * a typed path lists one real directory through the confined
 * `workspaceFiles.list`, a folder row drills into it, and the menu's breadcrumb
 * walks back. A typed name with no separator keeps the fuzzy file index, which
 * searches the whole workspace by name instead of one directory. Both modes
 * share the file section; sessions stay a second section the menu always lists.
 *
 * Rows carry only what distinguishes them: a fuzzy-search file names its parent
 * directory (nothing at the workspace root), a browsed listing names none
 * because its breadcrumb already does, and a session names its workspace only
 * when that workspace is not the current one. A session is dated from the Host
 * session list, so the `@` menu and the session list never disagree about its
 * age.
 *
 * @module @deepseek-ai/dsh-client-ui-reference/client
 */
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  ClientSessionContext, InputTriggerCandidate, InputTriggerCrumb, InputTriggerServiceContract,
  InputTriggerSource,
} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import type { FileReferenceCandidate } from '@deepseek-ai/dsh-file-reference/types'
import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-session-reference/types'
import { abbreviateHomePath, fileAddressFor } from '@deepseek-ai/dsh-util-workspace-path'
import {
  browseCandidates, browseFailureCandidates, directoryValue, encodeCandidate, listingPath,
  parseCandidate, splitBrowseQuery, type BrowseTarget, type ReferenceCandidateValue, type Translate,
} from './browse.ts'
import { en, es, NS, zh } from './locales.ts'

/** Required services: the trigger registry, the Remote namespaces, and the copy. */
export const inject = [
  'inputTriggers', 'locale', 'sessions', 'remote', 'remote.fileReferences',
  'remote.workspaceFiles', 'remote.sessionReferenceResolver', 'sidebarRight',
]

/**
 * Register the combined `@file` / `@session` source.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, es }), 'ui-reference: dictionaries')
  const t = ctx.locale.bind(NS)
  const sessions = ctx.get('sessions') as ISessions
  const source: InputTriggerSource = {
    trigger: '@',
    name: 'reference',
    showGroupTitle: false,
    async candidates(session: ClientSessionContext, { query, quoted, signal }) {
      const preserveQuote = quoted === true
      const target = splitBrowseQuery(query)
      // Two file modes share one section: an empty query or a typed path lists
      // one real workspace directory, so `@` reaches any file in the project;
      // a typed name with no separator keeps the fuzzy index that searches the
      // whole workspace by name.
      const fileLookup: Promise<readonly InputTriggerCandidate[]> = query === '' || query.includes('/')
        ? browseRows(ctx, sessions, session.sessionId, target, preserveQuote, signal, t)
        // A name search lists paths from anywhere in the workspace, so each row
        // names its parent directory; a browsed row needs no location because
        // its header or the typed path already says where it is.
        : ctx.remote.fileReferences.list(session.sessionId, query, signal)
          .then(result => result.ok
            ? result.value.flatMap(candidate => fileCandidate(candidate, preserveQuote, t))
            : [])
      const sessionLookup = quoted === true
        ? Promise.resolve([] as SessionReferenceMentionCandidate[])
        : ctx.remote.sessionReferenceResolver.candidates(session.sessionId, query, signal)
          .then(result => result.ok ? result.value : [])
      const [fileItems, sessionItems] = await Promise.all([fileLookup, sessionLookup])
      if (signal.aborted) return []
      const now = Date.now()
      const home = ctx.remote.$host.home
      const listed = sessions.list.getSnapshot().byId
      return [
        ...fileItems,
        ...sessionItems.map(candidate => sessionCandidate(
          candidate,
          listed[candidate.sessionId]?.updatedAt ?? candidate.createdAt,
          now,
          home,
          t,
        )),
      ]
    },
    header(_session: ClientSessionContext, req) {
      return crumbsFor(req.query, req.quoted === true, req.drilled, t)
    },
    onPick({ candidate, action }) {
      const value = parseCandidate(candidate.value)
      if (value?.kind === 'file') {
        // A directory row carries two verbs: the settling pick resolves the
        // folder itself as an atomic reference, while the drill action (Tab /
        // row chevron / a header crumb) keeps the literal descent text and
        // the open menu.
        if (value.fileKind === 'directory' && action === 'drill') {
          return { text: value.mention, continue: true }
        }
        return {
          insert: {
            source: 'reference',
            ref: value.mention,
            label: value.fileKind === 'directory' ? `${value.label}/` : value.label,
            appearance: value.fileKind === 'directory' ? 'folder' : 'file',
            clipboardText: value.mention,
          },
        }
      }
      if (value?.kind === 'session') {
        return {
          insert: {
            source: 'reference',
            ref: value.mention,
            label: value.label,
            appearance: 'session',
            clipboardText: value.mention,
          },
        }
      }
      return undefined
    },
    openReference(session, { ref, appearance }) {
      if (appearance !== 'file') return false
      const path = ref.startsWith('@"') ? ref.slice(2, -1) : ref.slice(1)
      const cwd = sessions.list.getSnapshot().byId[session.sessionId]?.cwd
      ctx.sidebarRight.openResource(fileAddressFor(session.sessionId, cwd, path))
      return true
    },
    codec: {
      clipboardText: ref => ref,
      serialize: ref => Promise.resolve(ref),
    },
  }
  const inputTriggers = ctx.get('inputTriggers') as InputTriggerServiceContract
  ctx.effect(() => inputTriggers.registerSource(source), 'ui-reference: @ source')
}

/**
 * Read the browsed directory through the confined workspace listing and project
 * it into rows; a listing that failed becomes one readable row naming the
 * failure.
 *
 * The Session's workspace root grounds the listing: it is the empty query's
 * directory and the base a typed path resolves against, so every row's mention
 * is workspace-relative text the Host resolves against that same root.
 * @param ctx - client root context carrying the Remote face.
 * @param sessions - the Session list supplying the workspace root.
 * @param sessionId - the Session whose workspace is browsed.
 * @param target - the directory to list and the filter inside it.
 * @param preserveQuote - retain an explicitly opened quote in every mention.
 * @param signal - the query's abort signal.
 * @param t - the reference dictionary.
 * @returns the rows for this listing, or one row naming why it could not be read.
 */
async function browseRows(
  ctx: ClientContext,
  sessions: ISessions,
  sessionId: SessionId,
  target: BrowseTarget,
  preserveQuote: boolean,
  signal: AbortSignal,
  t: Translate,
): Promise<readonly InputTriggerCandidate[]> {
  const cwd = sessions.list.getSnapshot().byId[sessionId]?.cwd
  const result = await ctx.remote.workspaceFiles.list(
    sessionId,
    listingPath(target.directory, cwd),
    signal,
  )
  if (signal.aborted) return []
  return result.ok
    ? browseCandidates(result.value, target.filter, preserveQuote, t)
    : browseFailureCandidates(result.error, t)
}

/**
 * The breadcrumb of a drilled directory listing, from the workspace root down
 * to the directory being listed.
 *
 * Only a drill produces one: a path the user typed carries its own context in
 * the draft, while a drill replaced the text they were reading with a deeper
 * one and owes them the way back.
 * @param query - the live query, path text following `@` or `@"`.
 * @param quoted - whether the active token is an open quoted path.
 * @param drilled - whether a drill pick, rather than typing, produced the query.
 * @param t - the reference dictionary.
 * @returns the crumbs, or undefined when this listing needs no header.
 */
function crumbsFor(
  query: string,
  quoted: boolean,
  drilled: boolean,
  t: Translate,
): readonly InputTriggerCrumb[] | undefined {
  if (!drilled) return undefined
  const slash = query.lastIndexOf('/')
  if (slash < 0) return undefined
  const segments = query.slice(0, slash).split('/').filter(segment => segment !== '')
  const crumbs: InputTriggerCrumb[] = [{
    label: t('crumb.root'),
    value: directoryValue(t('crumb.root'), quoted ? '@"' : '@'),
  }]
  for (const [index, segment] of segments.entries()) {
    const path = segments.slice(0, index + 1).join('/')
    const mention = formatFileMention({ path, kind: 'directory' }, quoted)
    // A trail whose steps cannot all be written back as mention text would
    // send the user somewhere they did not click; show no header instead.
    if (mention === undefined) return undefined
    crumbs.push({
      label: segment,
      value: directoryValue(segment, mention),
      ...(index === segments.length - 1 ? { current: true } : {}),
    })
  }
  return crumbs
}

/** Project one fuzzy-search candidate as a menu row, naming its parent directory. */
function fileCandidate(
  candidate: FileReferenceCandidate,
  preserveQuote: boolean,
  t: Translate,
) {
  const mention = formatFileMention(candidate, preserveQuote)
  if (mention === undefined) return []
  const slash = candidate.path.lastIndexOf('/')
  const name = candidate.path.slice(slash + 1)
  const parent = slash < 0 ? '' : candidate.path.slice(0, slash)
  const directory = candidate.kind === 'directory'
  const value: ReferenceCandidateValue = {
    kind: 'file',
    fileKind: candidate.kind,
    label: name,
    mention,
  }
  return [{
    name: `${name}${directory ? '/' : ''}`,
    // The location is the parent alone: repeating the name the row already
    // shows says nothing, and a workspace-root entry has no parent to name.
    ...(parent !== '' ? { description: parent } : {}),
    icon: directory ? 'folder' as const : 'file' as const,
    section: t('section.files'),
    value: encodeCandidate(value),
    ...(directory ? { drill: true } : {}),
  }]
}

/** Project one session discovery candidate as a menu row. */
function sessionCandidate(
  candidate: SessionReferenceMentionCandidate,
  updatedAt: number,
  now: number,
  home: string | undefined,
  t: Translate,
) {
  const { unit, n } = relativeTime(updatedAt, now)
  const age = unit === 'now' ? t('time.now') : t(`time.${unit}`, { n })
  // Candidates are ranked by workspace affinity, so the location only tells
  // the user something when it is not the workspace they are already in.
  const location = candidate.sameWorkspace
    ? undefined
    : candidate.cwd === undefined ? t('candidate.noCwd') : abbreviateHomePath(candidate.cwd, home)
  const value: ReferenceCandidateValue = {
    kind: 'session',
    label: candidate.label,
    mention: candidate.mention,
  }
  return {
    name: candidate.label,
    description: location === undefined ? age : `${location} · ${age}`,
    icon: 'session' as const,
    section: t('section.sessions'),
    value: encodeCandidate(value),
  }
}
