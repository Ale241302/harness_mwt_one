/**
 * The product's palette catalog, shared by both faces of this package: the
 * browser face registers these palettes, and the Host face paints the active
 * one before any plugin runs.
 *
 * The brand system defines five complete palettes for one shell: three dark
 * (Faber Warm — the default —, Slate and Ink) and two light (Paper — the
 * default — and Bond). Each one is transcribed verbatim and mapped by role onto
 * the shared `--dsw-alias-*` tokens, so every surface that already consumes an
 * alias follows the chosen palette without its own branch.
 *
 * Only the built-in palettes are listed here. A theme registered at runtime by
 * another plugin lives in the registry alone: it is selectable and composed like
 * any other, but it has no durable id and no pre-plugin ground to paint.
 */

/** One palette as the brand book states it, before alias mapping. */
interface Palette {
  /** Page ground. */
  readonly canvas: string
  /** Panels and cards resting on the ground. */
  readonly surface: string
  /** Raised surfaces: menus, popovers, dialogs. */
  readonly raised: string
  /** Pointer-over row and control fill. */
  readonly hover: string
  /** Recessed wells: inputs, code blocks, table footers. */
  readonly sunken: string
  /** Modal scrim over the canvas. */
  readonly scrim: string
  /** Primary ink. */
  readonly textPrimary: string
  /** Secondary ink: labels and metadata. */
  readonly textSecondary: string
  /** Muted ink: captions and helper text. */
  readonly textMuted: string
  /** Faintest ink: placeholders and disabled text. */
  readonly textFaint: string
  /** Hairline at rest. */
  readonly borderSubtle: string
  /** Hairline of a framed control. */
  readonly borderDefault: string
  /** Hairline that must read as an edge. */
  readonly borderStrong: string
  /** Coral accent: the maker. */
  readonly coral: string
  /** Coral under the pointer. */
  readonly coralDeep: string
  /** Coral wash for a selected or active surface. */
  readonly coralSoft: string
  /** Sage: approved. */
  readonly sage: string
  readonly sageDeep: string
  readonly sageSoft: string
  /** Amber: waiting. */
  readonly amber: string
  readonly amberDeep: string
  readonly amberSoft: string
  /** Vino: blocked. */
  readonly vino: string
  readonly vinoDeep: string
  readonly vinoSoft: string
  /** Slate: delegated or neutral. */
  readonly slate: string
  readonly slateSoft: string
}

/**
 * Map one palette onto the shared aliases by role.
 * @param palette - the brand book's tokens for one theme.
 * @returns the flat alias-token map a theme definition carries.
 */
function paletteTokens(palette: Palette): Readonly<Record<string, string>> {
  return Object.freeze({
    // Surfaces, from the page down to the recessed well.
    '--dsw-alias-bg-base': palette.canvas,
    '--dsw-alias-bg-layer-1': palette.surface,
    '--dsw-alias-bg-layer-2': palette.raised,
    '--dsw-alias-bg-layer-3': palette.sunken,
    '--dsw-alias-bg-skeleton': palette.hover,
    '--dsw-alias-bg-overlay': palette.scrim,
    '--dsw-alias-interactive-bg-hover': palette.hover,
    '--dsw-alias-interactive-bg-active': palette.raised,
    // Ink.
    '--dsw-alias-label-primary': palette.textPrimary,
    '--dsw-alias-label-secondary': palette.textSecondary,
    '--dsw-alias-label-tertiary': palette.textMuted,
    '--dsw-alias-label-caption': palette.textMuted,
    '--dsw-alias-label-dimmed': palette.textFaint,
    '--dsw-alias-label-primary-dimmed': palette.textSecondary,
    '--dsw-alias-label-primary-inverted': palette.canvas,
    '--dsw-alias-label-primary-foreground': palette.canvas,
    // Hairlines.
    '--dsw-alias-border-l1': palette.borderSubtle,
    '--dsw-alias-border-l2': palette.borderDefault,
    '--dsw-alias-border-l2-darkmode-thin': palette.borderSubtle,
    '--dsw-alias-border-l3': palette.borderStrong,
    '--dsw-alias-border-l4': palette.borderStrong,
    // The accent: action and AI.
    '--dsw-alias-brand-primary': palette.coral,
    '--dsw-alias-brand-primary-new-colorprimary-new-color': palette.coral,
    '--dsw-alias-brand-text': palette.coral,
    '--dsw-alias-link': palette.coral,
    '--dsw-alias-button-primary-fill': palette.coral,
    '--dsw-alias-button-primary-hover': palette.coralDeep,
    '--dsw-alias-button-primary-dimmed': palette.coralSoft,
    '--dsw-alias-interactive-bg-hover-accent': palette.coralSoft,
    // Functional states; the glyph never changes shape, only colour.
    '--dsw-alias-state-success-primary': palette.sage,
    '--dsw-alias-state-success-secondary': palette.sageSoft,
    '--dsw-alias-state-success-tertiary': palette.sageDeep,
    '--dsw-alias-state-warn-primary': palette.amber,
    '--dsw-alias-state-warn-secondary': palette.amberSoft,
    '--dsw-alias-state-warn-tertiary': palette.amberDeep,
    '--dsw-alias-state-warn-label': palette.amber,
    '--dsw-alias-state-error-primary': palette.vino,
    '--dsw-alias-state-error-secondary': palette.vinoSoft,
    '--dsw-alias-interactive-bg-hover-danger': palette.vinoSoft,
    '--dsw-alias-state-business-primary': palette.slate,
    '--dsw-alias-state-business-tertiary': palette.slateSoft,
  })
}

/** Faber Warm — the default dark ground, coral and cream. */
const WARM: Palette = {
  canvas: '#1B1A17', surface: '#232120', raised: '#2A2824', hover: '#2F2C27', sunken: '#151311',
  scrim: 'rgba(0, 0, 0, 0.55)',
  textPrimary: '#F4F1ED', textSecondary: '#B8B0A4', textMuted: '#8A8278', textFaint: '#645E55',
  borderSubtle: '#302C26', borderDefault: '#3D3A34', borderStrong: '#514B42',
  coral: '#CD6B4A', coralDeep: '#A84F33', coralSoft: 'rgba(205, 107, 74, 0.14)',
  sage: '#6FBE92', sageDeep: '#2F6B49', sageSoft: 'rgba(111, 190, 146, 0.14)',
  amber: '#D9A24E', amberDeep: '#8A6420', amberSoft: 'rgba(217, 162, 78, 0.14)',
  vino: '#D9695A', vinoDeep: '#7E342B', vinoSoft: 'rgba(217, 105, 90, 0.13)',
  slate: '#9DAEBC', slateSoft: 'rgba(157, 174, 188, 0.12)',
}

/** Slate — the same ink on a cool graphite ground. */
const SLATE: Palette = {
  canvas: '#16181B', surface: '#1E2125', raised: '#272B30', hover: '#23272C', sunken: '#111316',
  scrim: 'rgba(0, 0, 0, 0.55)',
  textPrimary: '#EEF1F4', textSecondary: '#C2C8CF', textMuted: '#8B939C', textFaint: '#5C636B',
  borderSubtle: '#262A2F', borderDefault: '#383D44', borderStrong: '#4A5058',
  coral: '#CD6B4A', coralDeep: '#A84F33', coralSoft: 'rgba(205, 107, 74, 0.14)',
  sage: '#6FBE92', sageDeep: '#2F6B49', sageSoft: 'rgba(111, 190, 146, 0.14)',
  amber: '#D9A24E', amberDeep: '#8A6420', amberSoft: 'rgba(217, 162, 78, 0.14)',
  vino: '#D9695A', vinoDeep: '#7E342B', vinoSoft: 'rgba(217, 105, 90, 0.13)',
  slate: '#90A2B4', slateSoft: 'rgba(144, 162, 180, 0.13)',
}

/** Ink — high contrast: a near-black ground with the brightest ink. */
const MONO: Palette = {
  canvas: '#0E0D0C', surface: '#161513', raised: '#1E1C1A', hover: '#1B1917', sunken: '#070706',
  scrim: 'rgba(0, 0, 0, 0.7)',
  textPrimary: '#F7F5F2', textSecondary: '#CAC4BA', textMuted: '#857E73', textFaint: '#565047',
  borderSubtle: '#221F1B', borderDefault: '#37332D', borderStrong: '#4A453D',
  coral: '#D6724E', coralDeep: '#A84F33', coralSoft: 'rgba(214, 114, 78, 0.15)',
  sage: '#6FBE92', sageDeep: '#2F6B49', sageSoft: 'rgba(111, 190, 146, 0.14)',
  amber: '#D9A24E', amberDeep: '#8A6420', amberSoft: 'rgba(217, 162, 78, 0.14)',
  vino: '#DC6B5A', vinoDeep: '#7E342B', vinoSoft: 'rgba(220, 107, 90, 0.14)',
  slate: '#9DAEBC', slateSoft: 'rgba(157, 174, 188, 0.12)',
}

/** Paper — the default light ground: warm cream, ink on paper. */
const PAPER: Palette = {
  canvas: '#EDE8DF', surface: '#F7F3EC', raised: '#FFFFFF', hover: '#EFE9DF', sunken: '#E7E0D2',
  scrim: 'rgba(40, 34, 28, 0.35)',
  textPrimary: '#1F1E1C', textSecondary: '#5A544C', textMuted: '#8A8278', textFaint: '#A99F8E',
  borderSubtle: '#E4DCCD', borderDefault: '#D8D0C0', borderStrong: '#BEB29B',
  coral: '#C96442', coralDeep: '#A84F33', coralSoft: 'rgba(201, 100, 66, 0.12)',
  sage: '#2F8F5E', sageDeep: '#245F40', sageSoft: 'rgba(47, 143, 94, 0.13)',
  amber: '#B07A1E', amberDeep: '#8A6015', amberSoft: 'rgba(176, 122, 30, 0.15)',
  vino: '#B4452E', vinoDeep: '#8E3424', vinoSoft: 'rgba(180, 69, 46, 0.1)',
  slate: '#5A6B7C', slateSoft: 'rgba(90, 107, 124, 0.12)',
}

/** Bond — a cooler light ground: cream canvas under white surfaces. */
const CLOUD: Palette = {
  canvas: '#F4F1ED', surface: '#FBFAF7', raised: '#FFFFFF', hover: '#F1EEE8', sunken: '#EDE8DF',
  scrim: 'rgba(40, 34, 28, 0.3)',
  textPrimary: '#1F1E1C', textSecondary: '#5A544C', textMuted: '#8A8278', textFaint: '#ABA191',
  borderSubtle: '#EDE7DC', borderDefault: '#D8D0C0', borderStrong: '#C2B8A6',
  coral: '#C96442', coralDeep: '#A84F33', coralSoft: 'rgba(201, 100, 66, 0.12)',
  sage: '#2F8F5E', sageDeep: '#245F40', sageSoft: 'rgba(47, 143, 94, 0.13)',
  amber: '#B07A1E', amberDeep: '#8A6015', amberSoft: 'rgba(176, 122, 30, 0.15)',
  vino: '#B4452E', vinoDeep: '#8E3424', vinoSoft: 'rgba(180, 69, 46, 0.1)',
  slate: '#5A6B7C', slateSoft: 'rgba(90, 107, 124, 0.11)',
}

/**
 * Built-in palette ids in registry order. The first two are the pair a
 * `system` preference resolves between, so the dark default must stay at the
 * position the resolver reads and `light`/`dark` must keep their ids.
 */
export const THEME_PALETTE_IDS = ['light', 'dark', 'slate', 'mono', 'cloud'] as const

/** Id of one built-in palette. */
export type ThemePaletteId = typeof THEME_PALETTE_IDS[number]

/** A built-in palette, ready to register and to paint before first paint. */
export interface ThemePalette {
  /** Registry id and durable preference value. */
  readonly id: ThemePaletteId
  /** Which base sheet the palette builds on; the presenter switches `body[data-ds-dark-theme]` from this, never from the id. */
  readonly colorScheme: 'light' | 'dark'
  /** Brand-book name; a proper noun kept verbatim in every locale. */
  readonly name: string
  /** Page ground colour, also what the boot style paints behind the shell. */
  readonly ground: string
  /** Alias-token map applied over the base sheet. */
  readonly tokens: Readonly<Record<string, string>>
}

/** Attach the shared data of one palette to its tokens. */
function palette(id: ThemePaletteId, colorScheme: 'light' | 'dark', name: string, tokens: Palette): ThemePalette {
  return Object.freeze({ id, colorScheme, name, ground: tokens.canvas, tokens: paletteTokens(tokens) })
}

/** Every built-in palette, in the order the theme menu lists them. */
export const THEME_PALETTES: readonly ThemePalette[] = Object.freeze([
  palette('light', 'light', 'Paper', PAPER),
  palette('dark', 'dark', 'Faber Warm', WARM),
  palette('slate', 'dark', 'Slate', SLATE),
  palette('mono', 'dark', 'Ink', MONO),
  palette('cloud', 'light', 'Bond', CLOUD),
])

/**
 * Look a built-in palette up by id.
 * @param id - a registry id or a durable preference value.
 * @returns the palette, or undefined when this build does not know the id.
 */
export function paletteById(id: string): ThemePalette | undefined {
  return THEME_PALETTES.find(entry => entry.id === id)
}
