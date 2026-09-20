/**
 * FaberLoom identity tokens. The accent is the only shared token this surface
 * changes: every other color keeps the harness palette, so light and dark stay
 * contrast-checked. Tokens are supplied per mode and follow the active theme.
 */
import type { ThemeTokenOverrides } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Layer id recorded in the theme override stack. */
export const FABERLOOM_THEME_SOURCE = '@deepseek-ai/dsh-client-ui-faberloom'

/** Accent used by FaberLoom controls in both color schemes. */
export const faberloomTokens: ThemeTokenOverrides = {
  '--dsw-alias-brand-primary-new-colorprimary-new-color': {
    light: 'rgb(14, 158, 116)',
    dark: 'rgb(19, 185, 138)',
  },
}
