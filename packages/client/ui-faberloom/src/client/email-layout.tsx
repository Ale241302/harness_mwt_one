/**
 * F1 email surface: the list, the reading pane beside it, the agent proposal, the
 * complete approval panel, and the compose-from-zero entry.
 *
 * The component is presentational: every message, every label, and every effect
 * arrives as a prop, and all state transitions run through `emailReducer`. Two
 * dispositions share one structure, so a look changes paint and density only.
 *
 * Keyboard: the list is a `listbox` with one tab stop; arrows move the selection,
 * Enter opens, Escape returns from the reading pane and from the approval panel
 * to the control that opened it.
 */
import { useEffect, useId, useReducer, useRef, type KeyboardEvent, type ReactNode } from 'react'
import type { EmailCopy } from './locales/email.ts'
import { DEFAULT_LOOK, lookClassName, nextLook, type LookId } from './appearance.ts'
import {
  createEmailState,
  draftOf,
  emailReducer,
  moveSelection,
  rowOf,
  visibleRows,
  type EmailRow,
} from './email-store.ts'
import styles from './email-layout.module.css'

/** Props of the email surface. */
export interface EmailLayoutProps {
  /** Synthetic messages to render. */
  readonly rows: readonly EmailRow[]
  /** Localized copy. */
  readonly labels: EmailCopy
  /** Called with the message id and the exact snapshot the user approved. */
  readonly onApprove?: (approval: {
    readonly id: string
    readonly to: string
    readonly subject: string
    readonly body: string
    readonly revision: number
  }) => void
  /** Optional slot rendered after the proposal, for the iteration window. */
  readonly iterationSlot?: ReactNode
  /** Look to paint with; the surface defaults to the shipped default. */
  readonly look?: LookId
  /** Look switch handler; when omitted, no switch control is rendered. */
  readonly onLookChange?: (look: LookId) => void
  /** Data phase; fixtures default to `ready`. */
  readonly phase?: 'ready' | 'loading' | 'error'
  /** Retry handler for the error phase. */
  readonly onRetry?: () => void
}

/** One attachment or recipient line, with an explicit empty marker. */
function Line({ label, value, empty }: { label: string; value: string; empty: string }) {
  return (
    <div className={styles.line}>
      <span className={styles.lineLabel}>{label}</span>
      <span className={styles.lineValue}>{value === '' ? empty : value}</span>
    </div>
  )
}

/** The email surface. */
export function EmailLayout({ rows, labels, onApprove, iterationSlot, look: lookProp, onLookChange, phase = 'ready', onRetry }: EmailLayoutProps) {
  const look = lookProp ?? DEFAULT_LOOK
  const [state, dispatch] = useReducer(emailReducer, rows, createEmailState)
  const listRef = useRef<HTMLDivElement>(null)
  const optionRefs = useRef(new Map<string, HTMLDivElement>())
  const approveRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const dialogTitleId = useId()
  const visible = visibleRows(state)
  const row = rowOf(state, state.openId)
  const draft = state.openId === null ? undefined : draftOf(state, state.openId)

  useEffect(() => {
    if (state.approvalOpen) {
      const first = dialogRef.current?.querySelector<HTMLElement>('[data-autofocus]')
      first?.focus()
    }
  }, [state.approvalOpen])

  const focusSelected = (): (void) => {
    if (state.selectedId === null) return
    optionRefs.current.get(state.selectedId)?.focus()
  }

  const onListKeyDown = (event: KeyboardEvent<HTMLDivElement>): (void) => {
    const delta = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
    if (delta !== 0) {
      event.preventDefault()
      const next = moveSelection(state, delta)
      if (next !== null) {
        dispatch({ type: 'select', id: next })
        optionRefs.current.get(next)?.focus()
      }
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      if (state.selectedId === null) return
      event.preventDefault()
      dispatch({ type: 'open', id: state.selectedId })
    }
  }

  const onReadingKeyDown = (event: KeyboardEvent<HTMLElement>): (void) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    dispatch({ type: 'close' })
    focusSelected()
  }

  const onDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>): (void) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      dispatch({ type: 'cancelApproval' })
      approveRef.current?.focus()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button, [href], input, textarea, [tabindex]:not([tabindex="-1"])')
    if (focusable === undefined || focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }

  const approve = (): (void) => {
    if (row === undefined || draft === undefined) return
    onApprove?.({
      id: row.id,
      to: row.to.join(', '),
      subject: draft.subject,
      body: draft.body,
      revision: draft.revision,
    })
    dispatch({ type: 'cancelApproval' })
  }

  const canApprove = row !== undefined && row.to.filter(address => address.trim() !== '').length > 0

  if (phase !== 'ready') {
    return (
      <section className={`${styles.surface} ${lookClassName(look)}`} aria-label={labels.title} aria-busy={phase === 'loading'}>
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{phase === 'loading' ? labels.loading : labels.errorTitle}</p>
          <p className={styles.emptyHint}>{phase === 'loading' ? labels.loadingHint : labels.errorHint}</p>
          {phase === 'error' && onRetry !== undefined ? (
            <div className={styles.actions}>
              <button type="button" className={styles.ghost} onClick={onRetry}>{labels.retry}</button>
            </div>
          ) : null}
        </div>
      </section>
    )
  }

  return (
    <section className={`${styles.surface} ${lookClassName(look)}`} aria-label={labels.title}>
      <header className={styles.toolbar}>
        <h1 className={styles.title}>{labels.title}</h1>
        <div className={styles.toolbarActions}>
          {onLookChange === undefined ? null : (
            <button
              type="button"
              className={styles.ghost}
              onClick={() => { onLookChange(nextLook(look)) }}
            >
              {`${labels.lookSwitch}: ${labels.lookNames[look]}`}
            </button>
          )}
          <label className={styles.filter}>
            <span className={styles.filterLabel}>{labels.listFilter}</span>
            <input
              className={styles.filterInput}
              value={state.filter}
              onChange={(event) => { dispatch({ type: 'filter', value: event.target.value }) }}
            />
          </label>
          <button
            type="button"
            className={styles.primary}
            onClick={() => { dispatch({ type: 'compose' }) }}
          >
            {labels.toolbarNew}
          </button>
          <button
            type="button"
            className={styles.ghost}
            aria-pressed={state.disposition === 'split'}
            onClick={() => { dispatch({ type: 'disposition', value: state.disposition === 'split' ? 'focus' : 'split' }) }}
          >
            {state.disposition === 'split' ? labels.toolbarSplit : labels.toolbarFocus}
          </button>
        </div>
      </header>

      <p className={styles.synthetic}>{labels.listSynthetic}</p>

      <div className={state.disposition === 'split' ? styles.split : styles.focus}>
        <div className={styles.listColumn}>
          {visible.length === 0 ? (
            <div className={styles.empty}>
              <p className={styles.emptyTitle}>{labels.listEmpty}</p>
              <p className={styles.emptyHint}>{labels.listEmptyHint}</p>
            </div>
          ) : (
            <div
              ref={listRef}
              role="listbox"
              aria-label={labels.a11yMessages}
              aria-activedescendant={state.selectedId === null ? undefined : `email-row-${state.selectedId}`}
              className={styles.list}
              onKeyDown={onListKeyDown}
            >
              {visible.map((item) => {
                const selected = item.id === state.selectedId
                return (
                  <div
                    key={item.id}
                    id={`email-row-${item.id}`}
                    ref={(element) => {
                      if (element === null) optionRefs.current.delete(item.id)
                      else optionRefs.current.set(item.id, element)
                    }}
                    role="option"
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    className={selected ? styles.rowSelected : styles.row}
                    onClick={() => {
                      dispatch({ type: 'select', id: item.id })
                      dispatch({ type: 'open', id: item.id })
                    }}
                  >
                    <div className={styles.rowTop}>
                      <span className={styles.rowFrom}>{item.from}</span>
                      <span className={styles.rowDate}>{item.received}</span>
                    </div>
                    <div className={styles.rowSubject}>
                      {item.unread ? (
                        <>
                          <span className={styles.unread} aria-hidden="true" />
                          <span className={styles.srOnly}>{labels.unread}</span>
                        </>
                      ) : null}
                      {item.subject}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className={styles.readingColumn}>
          {state.pane === 'compose' && state.compose !== null ? (
            <section className={styles.reading} aria-label={labels.composeTitle}>
              <h2 className={styles.readingTitle}>{labels.composeTitle}</h2>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{labels.composeTo}</span>
                <input
                  className={styles.fieldInput}
                  value={state.compose.to}
                  onChange={(event) => { dispatch({ type: 'composeField', field: 'to', value: event.target.value }) }}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{labels.composeSubject}</span>
                <input
                  className={styles.fieldInput}
                  value={state.compose.subject}
                  onChange={(event) => { dispatch({ type: 'composeField', field: 'subject', value: event.target.value }) }}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>{labels.composeBody}</span>
                <textarea
                  className={styles.fieldArea}
                  rows={8}
                  value={state.compose.body}
                  onChange={(event) => { dispatch({ type: 'composeField', field: 'body', value: event.target.value }) }}
                />
              </label>
              <div className={styles.actions}>
                <button type="button" className={styles.ghost} onClick={() => { dispatch({ type: 'cancelCompose' }) }}>
                  {labels.composeCancel}
                </button>
                <button type="button" className={styles.primary} onClick={() => { dispatch({ type: 'prepareCompose' }) }}>
                  {labels.composePrepare}
                </button>
              </div>
            </section>
          ) : row === undefined || draft === undefined ? (
            <p className={styles.placeholder}>{labels.readingPlaceholder}</p>
          ) : (
            <section className={styles.reading} aria-labelledby={`email-open-${row.id}`} onKeyDown={onReadingKeyDown}>
              <h2 id={`email-open-${row.id}`} className={styles.readingTitle}>{draft.subject}</h2>
              <Line label={labels.readingFrom} value={row.from} empty={labels.approvalNone} />
              <Line label={labels.readingTo} value={row.to.join(', ')} empty={labels.approvalNone} />

              {row.suggestion !== undefined && (state.proposals[row.id] ?? 'pending') === 'pending' ? (
                <section className={styles.proposal} aria-label={labels.proposalTitle}>
                  <h3 className={styles.proposalTitle}>{labels.proposalTitle}</h3>
                  <p className={styles.proposalWhy}>{labels.proposalWhy}: {row.from}</p>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.ghost}
                      onClick={() => { dispatch({ type: 'acceptProposal', id: row.id }) }}
                    >
                      {labels.proposalUse}
                    </button>
                    <button
                      type="button"
                      className={styles.ghost}
                      onClick={() => { dispatch({ type: 'keepProposal', id: row.id }) }}
                    >
                      {labels.proposalKeep}
                    </button>
                  </div>
                </section>
              ) : null}

              <label className={styles.field}>
                <span className={styles.fieldLabel}>{labels.readingDraft}</span>
                <textarea
                  className={styles.fieldArea}
                  rows={10}
                  value={draft.body}
                  onChange={(event) => { dispatch({ type: 'edit', id: row.id, body: event.target.value }) }}
                />
              </label>

              <p className={styles.status} aria-live="polite">
                {draft.saving ? labels.readingSaving : draft.dirty ? labels.readingDirty : labels.readingSaved}
              </p>

              {iterationSlot}

              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.ghost}
                  onClick={() => {
                    dispatch({ type: 'save', id: row.id })
                    dispatch({ type: 'saved', id: row.id })
                  }}
                >
                  {labels.readingSave}
                </button>
                <button
                  ref={approveRef}
                  type="button"
                  className={styles.primary}
                  disabled={!canApprove}
                  onClick={() => { dispatch({ type: 'approve' }) }}
                >
                  {labels.readingApprove}
                </button>
              </div>
              {!canApprove ? <p className={styles.warning}>{labels.approvalNoRecipients}</p> : null}
            </section>
          )}
        </div>
      </div>

      {state.approvalOpen && row !== undefined && draft !== undefined ? (
        <div className={styles.overlay}>
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={dialogTitleId}
            className={styles.dialog}
            onKeyDown={onDialogKeyDown}
          >
            <h2 id={dialogTitleId} className={styles.dialogTitle}>{labels.approvalTitle}</h2>
            <p className={styles.dialogHint}>{labels.approvalHint}</p>
            <Line label={labels.approvalTo} value={row.to.join(', ')} empty={labels.approvalNone} />
            <Line label={labels.approvalCc} value={row.cc.join(', ')} empty={labels.approvalNone} />
            <Line label={labels.approvalBcc} value={row.bcc.join(', ')} empty={labels.approvalNone} />
            <Line label={labels.approvalSubject} value={draft.subject} empty={labels.approvalNone} />
            <Line label={labels.approvalAttachments} value={row.attachments.join(', ')} empty={labels.approvalNone} />
            <Line label={labels.approvalVersion} value={`v${String(draft.revision)}`} empty={labels.approvalNone} />
            <div className={styles.dialogBody}>
              <span className={styles.lineLabel}>{labels.approvalBody}</span>
              <p className={styles.dialogText}>{draft.body}</p>
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                data-autofocus
                className={styles.ghost}
                onClick={() => {
                  dispatch({ type: 'cancelApproval' })
                  approveRef.current?.focus()
                }}
              >
                {labels.approvalCancel}
              </button>
              <button type="button" className={styles.primary} onClick={approve}>
                {labels.approvalConfirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
