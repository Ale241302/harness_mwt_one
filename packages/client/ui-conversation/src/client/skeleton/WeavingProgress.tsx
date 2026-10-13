/**
 * The brand's woven knot as the product's "in use" state.
 *
 * The 3x3 plain weave has a still half and a moving half: the warp threads are
 * the prepared structure and stay drawn, while the weft is thrown across them
 * segment after segment from the top of the loom and the shuttle then draws
 * each pass back out — a weaving motion, not a spinner. The brand reserves
 * motion for this one state, so only the two surfaces that are genuinely in
 * flight mount it: the composer while a turn runs, and the conversation column
 * while a session opens. A reader who asked the operating system for less
 * motion gets the finished knot at rest, pinned by the stylesheet rather than
 * by a second render path.
 *
 * The drawing stays single-sourced: the geometry (and the collapsed cross) come
 * from the shared mark constants, and this component supplies only the state,
 * the warp/weft split, and the per-thread stagger.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'
import {
  FABERLOOM_MARK_CROSS_PATHS, FABERLOOM_MARK_CROSS_STROKE, FABERLOOM_MARK_SIMPLIFY_BELOW,
  FABERLOOM_MARK_WEAVE_PATHS, FABERLOOM_MARK_WEAVE_STROKE,
} from '@deepseek-ai/dsh-client-ui-primitives'
import css from './WeavingProgress.module.css'

/** Square edge the knot is drawn at when the caller names no size. */
const WEAVE_SIZE = 24

/** Offset between two threads of one pass: the loom is threaded one at a time. */
const THREAD_STEP_MS = 100

/**
 * Leading threads of each mark that are warp: the full weave draws its seven
 * vertical threads first, the collapsed cross its single one. The remaining
 * threads are weft and carry the motion.
 */
const WARP_THREADS = { weave: 7, cross: 1 } as const

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
 * @returns the knot with its weft in motion, or the same knot at rest when motion is reduced.
 */
export function WeavingProgress({ label, size = WEAVE_SIZE, className }: WeavingProgressProps): ReactNode {
  const simplified = size < FABERLOOM_MARK_SIMPLIFY_BELOW
  const threads = simplified ? FABERLOOM_MARK_CROSS_PATHS : FABERLOOM_MARK_WEAVE_PATHS
  const warp = simplified ? WARP_THREADS.cross : WARP_THREADS.weave
  return (
    <span className={clsx(css.root, className)} role="status" aria-label={label} data-weaving-progress>
      <svg
        className={css.knot}
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        aria-hidden="true"
      >
        <g
          stroke="currentColor"
          strokeWidth={simplified ? FABERLOOM_MARK_CROSS_STROKE : FABERLOOM_MARK_WEAVE_STROKE}
          strokeLinecap="round"
        >
          {threads.map((d, index) => {
            const weft = index >= warp
            return (
              <path
                key={d}
                d={d}
                className={weft ? css.weft : undefined}
                data-weave={weft ? 'weft' : 'warp'}
                style={weft ? { animationDelay: `${(index - warp) * THREAD_STEP_MS}ms` } : undefined}
              />
            )
          })}
        </g>
      </svg>
    </span>
  )
}
