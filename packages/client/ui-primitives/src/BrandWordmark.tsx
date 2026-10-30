import { FaberLoomMark } from './FaberLoomMark.tsx'
import type { IconProps } from './icons/props.ts'

/** Mark-box edge per unit of wordmark height; the brand lockup pairs a 52px mark with 38px type. */
const MARK_OPTICAL_SCALE = 52 / 38

/**
 * The two proper-noun halves of the wordmark: "Faber" holds the coral, "Loom"
 * takes the ink of its ground. A brand name is fixed identity rather than
 * translatable product copy, so it stays out of the locale dictionaries.
 */
const WORDMARK_HALVES = { faber: 'Faber', loom: 'Loom' } as const

/** Display options for the FaberLoom wordmark. */
export interface BrandWordmarkProps extends IconProps {
  /** Whether to include the leading woven mark; defaults to true. */
  includeMark?: boolean | undefined
}

/**
 * Render the FaberLoom two-tone wordmark: "Faber" in coral, "Loom" in the
 * ink of its ground, with the woven mark beside it.
 * @param props.size - the wordmark's visual height in px (default 24); the type and mark are sized from it.
 * @param props.className - extra class for layout placement.
 * @param props.includeMark - whether to include the leading woven mark.
 * @returns the wordmark element (aria-hidden decorative brand art).
 */
export function BrandWordmark({ size = 24, className, includeMark = true }: BrandWordmarkProps) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: size * 0.32,
        fontFamily: "var(--dsw-font-family-serif, 'EB Garamond', Georgia, 'Times New Roman', serif)",
        fontStyle: 'italic',
        fontWeight: 500,
        fontSize: size,
        letterSpacing: '-0.005em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      {includeMark ? <FaberLoomMark size={Math.round(size * MARK_OPTICAL_SCALE)} /> : null}
      <span>
        <span style={{ color: 'var(--dsw-alias-brand-primary-new-colorprimary-new-color)' }}>{WORDMARK_HALVES.faber}</span>
        <span style={{ color: 'var(--dsw-alias-label-primary)' }}>{WORDMARK_HALVES.loom}</span>
      </span>
    </span>
  )
}
