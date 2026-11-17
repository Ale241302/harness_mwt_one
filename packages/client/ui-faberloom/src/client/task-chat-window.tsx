/**
 * F1 iteration window: a floating tool window over the email surface.
 *
 * It can be moved and resized with the pointer and with the keyboard, taken
 * fullscreen, and closed and reopened without losing the instruction being
 * written. Escape closes it and returns focus to the control that opened it,
 * which is what T12-F1 asks a prototype to prove about focus and a local draft.
 */
import { useEffect, useId, useReducer, useRef, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { TaskChatCopy } from './locales/email.ts'
import { KEYBOARD_STEP, createTaskChatState, taskChatReducer } from './task-chat-store.ts'
import styles from './task-chat-window.module.css'

/** Props of the iteration window. */
export interface TaskChatWindowProps {
  /** Localized copy. */
  readonly labels: TaskChatCopy
  /** What is being iterated: the message title and an optional detail line. */
  readonly context: { readonly title: string; readonly detail?: string | undefined }
  /** Called with the instruction when the user iterates. */
  readonly onIterate?: (instruction: string) => void
}

/** The iteration window and its launcher. */
export function TaskChatWindow({ labels, context, onIterate }: TaskChatWindowProps) {
  const [state, dispatch] = useReducer(taskChatReducer, undefined, createTaskChatState)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const moveOrigin = useRef<{ x: number; y: number } | null>(null)
  const sizeOrigin = useRef<{ x: number; y: number } | null>(null)
  const wasOpen = useRef(state.open)
  const titleId = useId()

  useEffect(() => {
    if (state.open) areaRef.current?.focus()
  }, [state.open])

  useEffect(() => {
    if (wasOpen.current && !state.open) launcherRef.current?.focus()
    wasOpen.current = state.open
  }, [state.open])

  useEffect(() => {
    const onMove = (event: PointerEvent): void => {
      if (moveOrigin.current !== null) {
        const dx = event.clientX - moveOrigin.current.x
        const dy = event.clientY - moveOrigin.current.y
        moveOrigin.current = { x: event.clientX, y: event.clientY }
        dispatch({ type: 'move', dx, dy })
        return
      }
      if (sizeOrigin.current !== null) {
        const dw = event.clientX - sizeOrigin.current.x
        const dh = event.clientY - sizeOrigin.current.y
        sizeOrigin.current = { x: event.clientX, y: event.clientY }
        dispatch({ type: 'resize', dw, dh })
      }
    }
    const onUp = (): void => {
      moveOrigin.current = null
      sizeOrigin.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const startMove = (event: ReactPointerEvent<HTMLElement>): void => {
    if (state.mode === 'fullscreen') return
    moveOrigin.current = { x: event.clientX, y: event.clientY }
  }

  const startResize = (event: ReactPointerEvent<HTMLElement>): void => {
    if (state.mode === 'fullscreen') return
    sizeOrigin.current = { x: event.clientX, y: event.clientY }
  }

  const onMoveKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (state.mode === 'fullscreen') return
    const step = KEYBOARD_STEP
    if (event.key === 'ArrowLeft') dispatch({ type: 'move', dx: -step, dy: 0 })
    else if (event.key === 'ArrowRight') dispatch({ type: 'move', dx: step, dy: 0 })
    else if (event.key === 'ArrowUp') dispatch({ type: 'move', dx: 0, dy: -step })
    else if (event.key === 'ArrowDown') dispatch({ type: 'move', dx: 0, dy: step })
    else return
    event.preventDefault()
  }

  const onResizeKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (state.mode === 'fullscreen') return
    const step = event.shiftKey ? KEYBOARD_STEP * 2 : KEYBOARD_STEP
    if (event.key === 'ArrowLeft') dispatch({ type: 'resize', dw: -step, dh: 0 })
    else if (event.key === 'ArrowRight') dispatch({ type: 'resize', dw: step, dh: 0 })
    else if (event.key === 'ArrowUp') dispatch({ type: 'resize', dw: 0, dh: -step })
    else if (event.key === 'ArrowDown') dispatch({ type: 'resize', dw: 0, dh: step })
    else return
    event.preventDefault()
  }

  const close = (): void => {
    dispatch({ type: 'close' })
  }

  if (!state.open) {
    return (
      <button ref={launcherRef} type="button" className={styles.launcher} onClick={() => { dispatch({ type: 'open' }) }}>
        {labels.launcher}
      </button>
    )
  }

  const floating = state.mode === 'floating'
  const geometry = floating
    ? { left: state.geometry.x, top: state.geometry.y, width: state.geometry.width, height: state.geometry.height }
    : undefined

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      className={floating ? styles.window : `${styles.window} ${styles.fullscreen}`}
      style={geometry}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        close()
      }}
    >
      <header
        className={styles.header}
        tabIndex={floating ? 0 : -1}
        aria-label={labels.move}
        onPointerDown={startMove}
        onKeyDown={onMoveKeyDown}
      >
        <div className={styles.titles}>
          <h2 id={titleId} className={styles.title}>{labels.title}</h2>
          <span className={styles.context}>{context.detail === undefined ? context.title : `${context.title} · ${context.detail}`}</span>
        </div>
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={() => { dispatch({ type: 'mode', value: floating ? 'fullscreen' : 'floating' }) }}
          >
            {floating ? labels.fullscreen : labels.restore}
          </button>
          <button type="button" className={styles.iconButton} onClick={close}>
            {labels.close}
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <label className={styles.label} htmlFor={`${titleId}-area`}>{labels.draftLabel}</label>
        <textarea
          id={`${titleId}-area`}
          ref={areaRef}
          className={styles.area}
          value={state.text}
          placeholder={labels.draftHint}
          onChange={(event) => { dispatch({ type: 'edit', text: event.target.value }) }}
        />
        <p className={styles.status} aria-live="polite">
          {state.saving ? labels.saving : state.dirty ? labels.dirty : labels.saved}
        </p>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconButton}
            disabled={!state.dirty}
            onClick={() => {
              dispatch({ type: 'save' })
              dispatch({ type: 'saved' })
            }}
          >
            {labels.save}
          </button>
          <button
            type="button"
            className={styles.primary}
            disabled={state.text.trim() === ''}
            onClick={() => { onIterate?.(state.text) }}
          >
            {labels.iterate}
          </button>
        </div>
      </div>

      {floating ? (
        <button
          type="button"
          className={styles.resize}
          aria-label={labels.resize}
          onPointerDown={startResize}
          onKeyDown={onResizeKeyDown}
        />
      ) : null}
    </div>
  )
}
