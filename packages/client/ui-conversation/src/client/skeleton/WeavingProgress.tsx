/**
 * The brand's woven knot as an honest progress state.
 *
 * While a turn runs, the threads of the 3x3 knot draw on and pass over and
 * under one another; a reader who asked the operating system for less motion
 * gets the static mark instead. The shared {@link FaberLoomMark} stays the only
 * drawing of the knot: this component supplies the state and the motion, never
 * a second mark, and nothing here animates the idle hero or the sidebar.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import { FaberLoomMark } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WeavingProgress.module.css'

/** The mark edge that keeps the full 3x3 weave instead of the collapsed cross. */
const WEAVE_SIZE = 24

/** Whether the operating system asked for reduced motion (absent media API = motion allowed). */
function prefersReducedMotion(): boolean {
  const matchMedia = (window as unknown as { matchMedia?: Window['matchMedia'] }).matchMedia
  return matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
}

/** Progress props: the accessible status label, the mark edge, and placement. */
export interface WeavingProgressProps {
  /** Localized status label; the knot itself is decorative. */
  readonly label: string
  /** Square edge in px; defaults to the full-weave size. */
  readonly size?: number
  readonly className?: string | undefined
}

/**
 * Render the woven-knot progress state.
 * @param props - localized label, optional edge, and placement class.
 * @returns the drawing knot while motion is allowed, the static mark when it is reduced.
 */
export function WeavingProgress({ label, size = WEAVE_SIZE, className }: WeavingProgressProps): ReactNode {
  return (
    <span className={clsx(css.root, className)} role="status" aria-label={label} data-weaving-progress>
      {prefersReducedMotion()
        ? <FaberLoomMark size={size} className={css.static} />
        : <span className={css.weave} aria-hidden="true"><FaberLoomMark size={size} /></span>}
    </span>
  )
}
