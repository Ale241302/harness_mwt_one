import type { IconProps } from './icons/props.ts'

/** The 3x3 woven knot on the brand's 48-unit field: three warp and three weft strokes interlaced in a plain weave. */
export const FABERLOOM_MARK_WEAVE_PATHS = [
  'M14 7 V19', 'M14 29 V41',
  'M24 7 V9', 'M24 19 V29', 'M24 39 V41',
  'M34 7 V19', 'M34 29 V41',
  'M7 14 H9', 'M19 14 H29', 'M39 14 H41',
  'M7 24 H19', 'M29 24 H41',
  'M7 34 H9', 'M19 34 H29', 'M39 34 H41',
] as const

/** The 16px collapsed knot: one vertical thread crossed by two edge stubs, the simplified form the brand drops to below 24px. */
export const FABERLOOM_MARK_CROSS_PATHS = ['M24 9 V39', 'M9 24 H17', 'M31 24 H39'] as const

/** Thread width in 48-unit field units for the full weave (the brand's 3.5u stroke). */
export const FABERLOOM_MARK_WEAVE_STROKE = 3.5

/** Thread width for the collapsed cross; thicker so the 16px form stays legible. */
export const FABERLOOM_MARK_CROSS_STROKE = 6

/** Below this rendered size the weave is illegible and the mark collapses to the single woven cross. */
export const FABERLOOM_MARK_SIMPLIFY_BELOW = 24

/**
 * Render the FaberLoom 3x3 woven knot.
 * @param props.size - square edge in px (default 24); below 24 it collapses to the single woven cross.
 * @param props.className - extra class for layout placement.
 * @returns the mark svg (aria-hidden decorative brand art).
 */
export function FaberLoomMark({ size = 24, className }: IconProps) {
  const simplified = size < FABERLOOM_MARK_SIMPLIFY_BELOW
  const paths = simplified ? FABERLOOM_MARK_CROSS_PATHS : FABERLOOM_MARK_WEAVE_PATHS
  const strokeWidth = simplified ? FABERLOOM_MARK_CROSS_STROKE : FABERLOOM_MARK_WEAVE_STROKE
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
    >
      <g stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round">
        {paths.map(d => <path key={d} d={d} />)}
      </g>
    </svg>
  )
}
