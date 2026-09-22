// SecretInput: password field with the reveal toggle every credential field
// needs. The wrapper owns the toggle's placement so consumers keep their own
// input styling; the revealed state is local to the control.

import { useState, type InputHTMLAttributes } from 'react'
import clsx from 'clsx'
import css from './SecretInput.module.css'

/**
 * Render a masked input whose value can be revealed and hidden again.
 * @param props.showLabel - accessible name of the toggle while the value is masked.
 * @param props.hideLabel - accessible name of the toggle while the value is visible.
 * @param props.inputClassName - the consumer's own input styling, when it has one.
 * @returns wrapper span holding the native input and the toggle button.
 */
export function SecretInput({ showLabel, hideLabel, className, inputClassName, ...rest }: {
  showLabel: string
  hideLabel: string
  className?: string | undefined
  inputClassName?: string | undefined
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  const label = visible ? hideLabel : showLabel
  return (
    <span className={clsx(css.wrap, className)}>
      <input className={inputClassName ?? css.input} type={visible ? 'text' : 'password'} {...rest} />
      <button
        type="button"
        className={css.toggle}
        aria-label={label}
        aria-pressed={visible}
        title={label}
        data-visible={visible}
        onClick={() => { setVisible(current => !current) }}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
          <path
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4-6.5-4-6.5-4Z"
          />
          <circle cx="8" cy="8" r="1.9" fill="none" stroke="currentColor" strokeWidth="1.3" />
          {visible
            ? <path fill="none" stroke="currentColor" strokeWidth="1.3" d="M3 13 13 3" />
            : null}
        </svg>
      </button>
    </span>
  )
}
