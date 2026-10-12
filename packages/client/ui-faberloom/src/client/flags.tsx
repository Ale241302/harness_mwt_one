/**
 * Locale flags for the language menu rows: one small inline SVG per shipped
 * language, kept beside the menu that uses them. The menu maps a locale id to
 * its flag and falls back to no icon for a locale it has no art for, so a
 * language pack another plugin adds still gets its row.
 *
 * Brand art: these SVGs carry the flags' own colours, the one place this
 * package writes literal colour values. Everything else consumes theme tokens.
 * The wrapper adds the hairline neutral border that keeps a light flag visible
 * on a light surface; each SVG is 16x11 and decorative (aria-hidden).
 */
import type { ComponentType, ReactNode } from 'react'
import css from './foot-controls.module.css'

/** Shared flag viewport: 16x11, the ratio the banners are drawn at. */
const FLAG_VIEW_BOX = '0 0 16 11'

/**
 * Wrap one flag drawing in the bordered, rounded frame the menu rows share.
 * @param props.id - the locale id, exposed as a data attribute for the menu.
 * @param props.children - the flag's SVG shapes.
 * @returns the framed, decorative flag.
 */
function FlagFrame({ id, children }: { id: string; children: ReactNode }) {
  return (
    <span className={css.flag} data-language-flag={id}>
      <svg width={16} height={11} viewBox={FLAG_VIEW_BOX} aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">
        {children}
      </svg>
    </span>
  )
}

/**
 * Points of a five-point star, used by the flag of China.
 * @param cx - star centre x.
 * @param cy - star centre y.
 * @param outer - outer radius.
 * @param inner - inner radius.
 * @returns the SVG polygon points string.
 */
function starPoints(cx: number, cy: number, outer: number, inner: number): string {
  const points: string[] = []
  for (let index = 0; index < 10; index++) {
    const radius = index % 2 === 0 ? outer : inner
    const angle = -Math.PI / 2 + (index * Math.PI) / 5
    points.push(`${(cx + radius * Math.cos(angle)).toFixed(2)},${(cy + radius * Math.sin(angle)).toFixed(2)}`)
  }
  return points.join(' ')
}

/** United States: thirteen stripes under the blue canton. */
function UnitedStatesFlag() {
  const stripe = 11 / 13
  return (
    <FlagFrame id="en">
      <rect width={16} height={11} fill="#FFFFFF" />
      {[0, 2, 4, 6, 8, 10, 12].map(index => (
        <rect key={index} y={(index * stripe).toFixed(3)} width={16} height={stripe.toFixed(3)} fill="#B22234" />
      ))}
      <rect width={6.4} height={(7 * stripe).toFixed(3)} fill="#3C3B6E" />
      {[[1, 0.9], [3.2, 0.9], [5.4, 0.9], [2.1, 2.4], [4.3, 2.4], [1, 3.9], [3.2, 3.9], [5.4, 3.9]].map(([x, y]) => (
        <circle key={`${String(x)}-${String(y)}`} cx={x} cy={y} r={0.3} fill="#FFFFFF" />
      ))}
    </FlagFrame>
  )
}

/** China: red field with the large star and four small ones. */
function ChinaFlag() {
  return (
    <FlagFrame id="zh">
      <rect width={16} height={11} fill="#DE2910" />
      <polygon points={starPoints(3.1, 3, 2.1, 0.85)} fill="#FFDE00" />
      <polygon points={starPoints(5.6, 1.1, 0.7, 0.3)} fill="#FFDE00" />
      <polygon points={starPoints(6.6, 2.5, 0.7, 0.3)} fill="#FFDE00" />
      <polygon points={starPoints(6.6, 4.2, 0.7, 0.3)} fill="#FFDE00" />
      <polygon points={starPoints(5.6, 5.6, 0.7, 0.3)} fill="#FFDE00" />
    </FlagFrame>
  )
}

/** Spain: the red, yellow, red bands with a simplified crest. */
function SpainFlag() {
  return (
    <FlagFrame id="es">
      <rect width={16} height={11} fill="#AA151B" />
      <rect y={2.75} width={16} height={5.5} fill="#F1BF00" />
      <rect x={3.4} y={4.1} width={1.5} height={2.4} fill="#AA151B" />
      <rect x={3.6} y={4.3} width={1.1} height={2} fill="#F1BF00" />
    </FlagFrame>
  )
}

/** Locale id to flag art; a locale absent here renders no row icon. */
const FLAGS: Readonly<Record<string, ComponentType>> = {
  en: UnitedStatesFlag,
  es: SpainFlag,
  zh: ChinaFlag,
}

/**
 * Resolve the flag art for one locale id.
 * @param id - the locale id the language service reports.
 * @returns the flag element, or undefined when this package has no art for it.
 */
export function languageFlag(id: string): ReactNode {
  const Flag = FLAGS[id]
  return Flag === undefined ? undefined : <Flag />
}
