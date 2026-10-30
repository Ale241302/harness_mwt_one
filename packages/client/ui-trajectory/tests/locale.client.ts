import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { es as commonEs } from '@deepseek-ai/dsh-client-locale/src/locales/es.ts'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { en, es, zh, type TrajectoryTranslate } from '../src/client/locales.ts'

function translator(dictionary: Record<string, string>): TrajectoryTranslate {
  return (key, params = {}) => {
    const template = dictionary[key] ?? key
    return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value = params[name]
      return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : ''
    })
  }
}

/** English trajectory translator for component and pure-layout tests. */
export const t = translator({ ...commonEn, ...en })

/** Spanish trajectory translator for no-value locale coverage. */
export const tEs = translator({ ...commonEs, ...es })

/** Chinese trajectory translator for real-view fixtures that open in Chinese. */
export const tZh = translator({ ...commonZh, ...zh })
