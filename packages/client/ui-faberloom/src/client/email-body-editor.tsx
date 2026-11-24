/**
 * Compose body editor: authored markup in a `contentEditable` region plus the
 * formatting toolbar. Once mounted the region owns its DOM, so the `html` prop
 * only replaces it when it differs from the value this component last acted on.
 */
import {
  useEffect,
  useRef,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type ReactElement,
} from 'react'
import styles from './email-body-editor.module.css'

/** Localized names of the editing region and its twelve controls. */
export interface EmailBodyEditorLabels {
  /** Accessible name of the editing region. */
  readonly body: string
  /** Hint shown while the region is empty. */
  readonly placeholder: string
  readonly bold: string
  readonly italic: string
  readonly underline: string
  /** Colour picker button label. */
  readonly colour: string
  readonly alignLeft: string
  readonly alignCentre: string
  readonly alignRight: string
  readonly bulletList: string
  readonly numberList: string
  readonly code: string
  readonly quote: string
  readonly clear: string
}

/** Inputs of {@link EmailBodyEditor}. */
export interface EmailBodyEditorProps {
  /** Authored markup; the editor replaces its DOM only when this differs from the last value it emitted. */
  readonly html: string
  /** Sanitized signature markup, or null when the sending account has none. */
  readonly signatureHtml: string | null
  /** Stable key of the sending account; a change replaces the signature block. */
  readonly signatureKey: string
  readonly labels: EmailBodyEditorLabels
  /** Emitted after every edit and every signature change. */
  readonly onChange: (value: { readonly html: string; readonly text: string }) => void
  /** Files pasted into the editor (images, documents). */
  readonly onPasteFiles: (files: readonly File[]) => void
}

/** Attribute marking the single signature block at the end of the body. */
const SIGNATURE_ATTRIBUTE = 'data-email-signature'
const SIGNATURE_SELECTOR = `[${SIGNATURE_ATTRIBUTE}]`
/** The colour the picker starts on. */
const COLOUR_DEFAULT = '#b4232a'

/**
 * Serialized markup of the region, or an empty string when only the placeholder
 * break of an emptied editor remains.
 * @param region - the editing region.
 * @returns the authored HTML.
 */
function htmlOf(region: HTMLElement): string {
  const html = region.innerHTML
  return html.replace(/<br\s*\/?>/gu, '').trim() === '' ? '' : html
}

/**
 * Plain text of the region; jsdom omits the generated `innerText`.
 * @param region - the editing region.
 * @returns the text the recipient reads.
 */
function textOf(region: HTMLElement): string {
  const rich = region as HTMLElement & { readonly innerText?: string }
  if (typeof rich.innerText === 'string') return rich.innerText
  // lib.dom types textContent nullable; the linter's checker reads it as non-nullish.
  /* oxlint-disable-next-line typescript/no-unnecessary-condition */ /* v8 ignore next -- textContent is never null on an element. */
  return region.textContent ?? ''
}

/**
 * Build the signature block appended after the authored content.
 * @param signatureHtml - sanitized signature markup.
 * @returns the block, marked so a new account replaces it instead of stacking.
 */
function signatureBlock(signatureHtml: string): HTMLElement {
  const block = document.createElement('div')
  block.setAttribute(SIGNATURE_ATTRIBUTE, '1')
  block.innerHTML = signatureHtml
  return block
}

/**
 * Decorative glyph of one toolbar control.
 * @param props - the SVG path of the command.
 * @returns the icon element.
 */
function ToolIcon({ path }: { readonly path: string }): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={path} />
    </svg>
  )
}

/**
 * One toolbar control: it keeps the caret in the region and runs its command.
 * @param props - label, command, glyph and dispatcher.
 * @returns the button element.
 */
function ToolButton(props: {
  readonly label: string
  readonly command: string
  readonly path: string
  readonly value?: string
  readonly onRun: (command: string, value?: string) => void
}): ReactElement {
  return (
    <button type="button" className={styles.tool} aria-label={props.label} title={props.label}
      onMouseDown={(event) => { event.preventDefault() }}
      onClick={() => { props.onRun(props.command, props.value) }}>
      <ToolIcon path={props.path} />
    </button>
  )
}

/**
 * Rich body editor for the mail composer.
 * @param props - authored markup, the sender's signature, labels and the emitting callbacks.
 * @returns the formatting toolbar above the editing region.
 */
export function EmailBodyEditor(props: EmailBodyEditorProps): ReactElement {
  const { html, signatureHtml, signatureKey, labels, onChange, onPasteFiles } = props
  const regionRef = useRef<HTMLDivElement | null>(null)
  const colourRef = useRef<HTMLInputElement | null>(null)
  /** Markup this component last emitted, or null before the first placement. */
  const emittedRef = useRef<string | null>(null)
  /** Value of the `html` prop this component last acted on. */
  const propRef = useRef<string | null>(null)
  /** Signature the region currently carries. */
  const signatureKeyRef = useRef(signatureKey)
  const mountedRef = useRef(false)

  /** Publish the region's markup and text. */
  const emit = (region: HTMLElement): void => {
    const value = { html: htmlOf(region), text: textOf(region) }
    emittedRef.current = value.html
    onChange(value)
  }

  // Place authored markup (the first render, an opened draft or an AI draft) and
  // keep exactly one signature block after it.
  useEffect(() => {
    const region = regionRef.current
    /* v8 ignore next -- the region renders in the same commit as this effect. */
    if (region === null) return
    const mounted = mountedRef.current
    mountedRef.current = true
    if (mounted && propRef.current === html) return
    propRef.current = html
    if (emittedRef.current === html) return
    region.innerHTML = html
    if (signatureHtml !== null && region.querySelector(SIGNATURE_SELECTOR) === null) {
      region.append(signatureBlock(signatureHtml))
      emit(region)
      return
    }
    if (mounted) emit(region)
  }, [html, signatureHtml])

  // A new sending account swaps its signature in place; two blocks never coexist.
  useEffect(() => {
    const region = regionRef.current
    /* v8 ignore next -- the region renders in the same commit as this effect. */
    if (region === null) return
    if (signatureKeyRef.current === signatureKey) return
    signatureKeyRef.current = signatureKey
    const existing = region.querySelector(SIGNATURE_SELECTOR)
    if (signatureHtml === null) {
      if (existing !== null) existing.remove()
    } else if (existing === null) {
      region.append(signatureBlock(signatureHtml))
    } else {
      existing.replaceWith(signatureBlock(signatureHtml))
    }
    emit(region)
  }, [signatureKey, signatureHtml])

  /** Run one editing command over the current selection. */
  const run = (command: string, value?: string): void => {
    const region = regionRef.current
    /* v8 ignore next -- the toolbar renders beside the region it edits. */
    if (region === null) return
    // jsdom ships no editing commands; there the editor stays inert instead of throwing.
    /* oxlint-disable typescript/no-deprecated */
    if (typeof document.execCommand !== 'function') return
    document.execCommand(command, false, value)
    /* oxlint-enable typescript/no-deprecated */
    emit(region)
  }

  /** Open the native colour picker from the button that carries its name. */
  const openColour = (): void => {
    /* v8 ignore next -- the picker is a sibling of the button that opens it. */
    if (colourRef.current === null) return
    colourRef.current.click()
  }

  const handleInput = (event: FormEvent<HTMLDivElement>): void => {
    emit(event.currentTarget)
  }

  const handlePaste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const files = [...event.clipboardData.files]
    // Pasted files belong to the attachment flow, not to the markup.
    if (files.length > 0) {
      event.preventDefault()
      onPasteFiles(files)
      return
    }
    // jsdom ships no editing commands; without one the browser's own paste stays.
    /* oxlint-disable typescript/no-deprecated */
    if (typeof document.execCommand !== 'function') return
    event.preventDefault()
    document.execCommand('insertText', false, event.clipboardData.getData('text/plain'))
    /* oxlint-enable typescript/no-deprecated */
    emit(event.currentTarget)
  }

  const handleColour = (event: ChangeEvent<HTMLInputElement>): void => {
    run('foreColor', event.target.value)
  }

  return (
    <div className={styles.editor}>
      <div className={styles.toolbar}>
        <ToolButton label={labels.bold} command="bold" path="M8 5h5a3.5 3.5 0 0 1 0 7H8zM8 12h5.5a3.5 3.5 0 0 1 0 7H8z"
          onRun={run} />
        <ToolButton label={labels.italic} command="italic" path="M16 5h-5M13 19H8M14 5l-4 14" onRun={run} />
        <ToolButton label={labels.underline} command="underline" path="M7 5v6a5 5 0 0 0 10 0V5M5 20h14" onRun={run} />
        <span className={styles.colourControl}>
          <button type="button" className={styles.tool} aria-label={labels.colour} title={labels.colour}
            onMouseDown={(event) => { event.preventDefault() }} onClick={openColour}>
            <ToolIcon path="M4 20h16M7 16 12 5l5 11M9 13h6" />
          </button>
          <input ref={colourRef} className={styles.colourInput} type="color" defaultValue={COLOUR_DEFAULT}
            tabIndex={-1} aria-hidden="true" onChange={handleColour} />
        </span>
        <ToolButton label={labels.alignLeft} command="justifyLeft" path="M4 6h16M4 11h10M4 16h16M4 21h10"
          onRun={run} />
        <ToolButton label={labels.alignCentre} command="justifyCenter" path="M4 6h16M7 11h10M4 16h16M7 21h10"
          onRun={run} />
        <ToolButton label={labels.alignRight} command="justifyRight" path="M4 5h16M10 10h10M4 15h16M10 20h10"
          onRun={run} />
        <ToolButton label={labels.bulletList} command="insertUnorderedList" path="M5 6h.01M10 6h9M5 12h.01M10 12h9M5 18h.01M10 18h9"
          onRun={run} />
        <ToolButton label={labels.numberList} command="insertOrderedList" path="M4 5h1.5v4M3.5 9h3.5M4.5 13h2l-2 3.5h2M10 7h9M10 13h9M10 19h9"
          onRun={run} />
        <ToolButton label={labels.code} command="formatBlock" value="pre" path="m9 8-5 4 5 4M15 8l5 4-5 4"
          onRun={run} />
        <ToolButton label={labels.quote} command="formatBlock" value="blockquote" path="M8 6h4v5a4 4 0 0 1-4 4M16 6h4v5a4 4 0 0 1-4 4"
          onRun={run} />
        <ToolButton label={labels.clear} command="removeFormat" path="M8 20h11M6 15l6-9 5 3-6 9z" onRun={run} />
      </div>
      <div ref={regionRef} className={styles.body} role="textbox" aria-multiline="true"
        aria-label={labels.body} contentEditable data-placeholder={labels.placeholder}
        onInput={handleInput} onPaste={handlePaste} />
    </div>
  )
}
