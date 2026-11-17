/**
 * F1 email surface state: selection, the local draft per message, the reading
 * pane disposition, and whether the approval panel is open.
 *
 * The reducer is pure so the behaviour can be tested without a DOM: the layout
 * only dispatches, and every transition that matters (selection, per-message
 * draft, dirty flag, panel) is decided here.
 */

/** One synthetic message the F1 surface renders. */
export interface EmailRow {
  /** Stable id used by selection and drafts. */
  readonly id: string
  /** Sender as displayed. */
  readonly from: string
  /** Recipients of the original message. */
  readonly to: readonly string[]
  /** Visible recipients the reply would copy. */
  readonly cc: readonly string[]
  /** Hidden recipients the reply would copy. */
  readonly bcc: readonly string[]
  /** Subject line. */
  readonly subject: string
  /** Body text, plain. */
  readonly body: string
  /** Attachment names, already resolved. */
  readonly attachments: readonly string[]
  /** When it arrived, already formatted for display. */
  readonly received: string
  /** Unread marker. */
  readonly unread: boolean
  /** Revision the user is looking at; `1` on a first version. */
  readonly revision: number
  /** Whether this row is fixture data. */
  readonly synthetic: boolean
  /** Body the agent proposes, when it proposes one. */
  readonly suggestion?: string
}

/** Editable state of one message. */
export interface EmailDraft {
  /** Subject being edited. */
  readonly subject: string
  /** Body being edited. */
  readonly body: string
  /** Whether the body differs from what is stored. */
  readonly dirty: boolean
  /** Whether a save is in flight. */
  readonly saving: boolean
  /** Revision the save would produce. */
  readonly revision: number
}

/** How the list and the reading pane share the screen. */
export type Disposition = 'split' | 'focus'

/** What the surface is showing. */
export type Pane = 'list' | 'reading' | 'compose'

/** Whole surface state. */
export interface EmailState {
  /** Messages, in display order. */
  readonly rows: readonly EmailRow[]
  /** Filter text applied to the subject. */
  readonly filter: string
  /** Selected row, always one of the visible ids or null. */
  readonly selectedId: string | null
  /** Message open in the reading pane. */
  readonly openId: string | null
  /** Current pane. */
  readonly pane: Pane
  /** List and reading side by side, or reading only. */
  readonly disposition: Disposition
  /** Draft per message id. */
  readonly drafts: Readonly<Record<string, EmailDraft>>
  /** Whether the approval panel is open. */
  readonly approvalOpen: boolean
  /** Decision taken on each proposal: pending, accepted or kept. */
  readonly proposals: Readonly<Record<string, 'pending' | 'accepted' | 'kept'>>
  /** Compose-from-zero fields, or null when closed. */
  readonly compose: { readonly to: string; readonly subject: string; readonly body: string } | null
}

/** Actions the layout dispatches. */
export type EmailAction =
  | { readonly type: 'select'; readonly id: string }
  | { readonly type: 'open'; readonly id: string }
  | { readonly type: 'close' }
  | { readonly type: 'disposition'; readonly value: Disposition }
  | { readonly type: 'filter'; readonly value: string }
  | { readonly type: 'edit'; readonly id: string; readonly body: string }
  | { readonly type: 'save'; readonly id: string }
  | { readonly type: 'saved'; readonly id: string }
  | { readonly type: 'approve' }
  | { readonly type: 'acceptProposal'; readonly id: string }
  | { readonly type: 'keepProposal'; readonly id: string }
  | { readonly type: 'cancelApproval' }
  | { readonly type: 'compose' }
  | { readonly type: 'composeField'; readonly field: 'to' | 'subject' | 'body'; readonly value: string }
  | { readonly type: 'cancelCompose' }
  | { readonly type: 'prepareCompose' }

/** Draft a message starts with, before anyone edits it. */
export function draftFrom(row: EmailRow): EmailDraft {
  return { subject: row.subject, body: row.body, dirty: false, saving: false, revision: row.revision }
}

/** Rows matching the current filter. */
export function visibleRows(state: EmailState): readonly EmailRow[] {
  const needle = state.filter.trim().toLocaleLowerCase()
  if (needle === '') return state.rows
  return state.rows.filter(row => row.subject.toLocaleLowerCase().includes(needle))
}

/** Draft for a message, falling back to its stored version. */
export function draftOf(state: EmailState, id: string): EmailDraft | undefined {
  const existing = state.drafts[id]
  if (existing !== undefined) return existing
  const row = state.rows.find(candidate => candidate.id === id)
  return row === undefined ? undefined : draftFrom(row)
}

/** Row a message id refers to. */
export function rowOf(state: EmailState, id: string | null): EmailRow | undefined {
  return id === null ? undefined : state.rows.find(row => row.id === id)
}

/** Initial state for a list of messages. */
export function createEmailState(rows: readonly EmailRow[]): EmailState {
  const first = rows[0]?.id ?? null
  return {
    rows,
    filter: '',
    selectedId: first,
    openId: null,
    pane: 'list',
    disposition: 'split',
    drafts: {},
    approvalOpen: false,
    proposals: {},
    compose: null,
  }
}

/**
 * Next selection when moving by keyboard, clamped at both ends.
 * @param state - current surface state.
 * @param delta - `1` for down, `-1` for up.
 * @returns the id to select, or the current one when the list is empty.
 */
export function moveSelection(state: EmailState, delta: number): string | null {
  const rows = visibleRows(state)
  if (rows.length === 0) return null
  const index = rows.findIndex(row => row.id === state.selectedId)
  const next = index < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, index + delta))
  return rows[next]?.id ?? null
}

/** Apply one action. */
export function emailReducer(state: EmailState, action: EmailAction): EmailState {
  switch (action.type) {
    case 'select':
      return { ...state, selectedId: action.id }
    case 'open': {
      const row = rowOf(state, action.id)
      if (row === undefined) return state
      const drafts = state.drafts[action.id] === undefined
        ? { ...state.drafts, [action.id]: draftFrom(row) }
        : state.drafts
      return { ...state, selectedId: action.id, openId: action.id, pane: 'reading', drafts, compose: null }
    }
    case 'close':
      return { ...state, pane: 'list', openId: null, approvalOpen: false }
    case 'disposition':
      return { ...state, disposition: action.value }
    case 'filter': {
      const next = { ...state, filter: action.value }
      const rows = visibleRows(next)
      const stillVisible = rows.some(row => row.id === next.selectedId)
      return { ...next, selectedId: stillVisible ? next.selectedId : rows[0]?.id ?? null }
    }
    case 'edit': {
      const current = draftOf(state, action.id)
      if (current === undefined) return state
      return {
        ...state,
        drafts: {
          ...state.drafts,
          [action.id]: {
            ...current,
            body: action.body,
            dirty: action.body === current.body ? current.dirty : true,
          },
        },
      }
    }
    case 'save': {
      const current = draftOf(state, action.id)
      if (current === undefined) return state
      return { ...state, drafts: { ...state.drafts, [action.id]: { ...current, saving: true } } }
    }
    case 'saved': {
      const current = draftOf(state, action.id)
      if (current === undefined) return state
      return {
        ...state,
        drafts: { ...state.drafts, [action.id]: { ...current, dirty: false, saving: false, revision: current.revision + 1 } },
      }
    }
    case 'approve':
      return { ...state, approvalOpen: true }
    case 'cancelApproval':
      return { ...state, approvalOpen: false }
    case 'acceptProposal': {
      const current = draftOf(state, action.id)
      const row = rowOf(state, action.id)
      if (current === undefined || row?.suggestion === undefined) return state
      return {
        ...state,
        proposals: { ...state.proposals, [action.id]: 'accepted' },
        drafts: { ...state.drafts, [action.id]: { ...current, body: row.suggestion, dirty: true } },
      }
    }
    case 'keepProposal':
      return { ...state, proposals: { ...state.proposals, [action.id]: 'kept' } }
    case 'compose':
      return { ...state, pane: 'compose', openId: null, approvalOpen: false, compose: { to: '', subject: '', body: '' } }
    case 'composeField':
      if (state.compose === null) return state
      return { ...state, compose: { ...state.compose, [action.field]: action.value } }
    case 'cancelCompose':
      return { ...state, pane: 'list', compose: null }
    case 'prepareCompose': {
      if (state.compose === null) return state
      const id = `compose-${state.rows.length + 1}`
      const row: EmailRow = {
        id,
        from: 'Tú',
        to: [state.compose.to],
        cc: [],
        bcc: [],
        subject: state.compose.subject,
        body: state.compose.body,
        attachments: [],
        received: 'Ahora',
        unread: false,
        revision: 1,
        synthetic: true,
      }
      return {
        ...state,
        rows: [row, ...state.rows],
        drafts: { ...state.drafts, [id]: draftFrom(row) },
        selectedId: id,
        openId: id,
        pane: 'reading',
        compose: null,
      }
    }
    default:
      return state
  }
}
