import {
  IconSkillOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SkillKey } from './locales.ts'
import css from './InstallSkillRow.module.css'

type InstallSkillRowProps = ToolCallViewProps & PropsLocale<'skill'>

/** Replay-stable view model for one install call. */
interface InstallSkillModel {
  readonly source: string
  readonly scope: 'workspace' | 'global' | undefined
  readonly status: string | undefined
  readonly state: 'running' | 'ok' | 'error'
  readonly error: string | null
}

/** Install statuses that have dedicated copy, keyed by the wire status value. */
const STATUS_KEYS = {
  installed: 'install.status.installed',
  replaced: 'install.status.replaced',
  'already-installed': 'install.status.alreadyInstalled',
  skipped: 'install.status.skipped',
  refused: 'install.status.refused',
  invalid: 'install.notASkill',
  cancelled: 'install.status.cancelled',
} as const satisfies Record<string, SkillKey>

/** First physical line of a value, for a compact summary. */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** Parse one JSON object, tolerating a streaming prefix or an unrelated value. */
function parseObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(text) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    return parsed as Record<string, unknown>
  } catch {
    return undefined
  }
}

/** One non-empty string field of a parsed object. */
function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const field = value?.[key]
  return typeof field === 'string' && field !== '' ? field : undefined
}

/** The destination scope named by a parsed value, when it is one of the two. */
function scopeField(value: Record<string, unknown> | undefined): 'workspace' | 'global' | undefined {
  const scope = stringField(value, 'destination')
  return scope === 'workspace' || scope === 'global' ? scope : undefined
}

/** The copy key for a wire status, when the status is one this row explains. */
function statusKey(status: string | undefined): SkillKey | undefined {
  if (status === undefined || !Object.hasOwn(STATUS_KEYS, status)) return undefined
  return (STATUS_KEYS as Record<string, SkillKey>)[status]
}

/** Derive the row model from the durable call slice alone. */
function installSkillModel(block: ToolCallViewProps['block']): InstallSkillModel {
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const args = parseObject(argsRaw)
  let text: string | null = null
  if (settled) {
    let joined = ''
    for (const item of block.content) {
      if (item.type === 'text') joined += item.text
    }
    text = joined === '' ? null : joined
  }
  const result = text === null ? undefined : parseObject(text)
  const state: InstallSkillModel['state'] = !settled ? 'running' : block.isError ? 'error' : 'ok'
  return {
    source: stringField(args, 'source') ?? firstLine(argsRaw),
    scope: scopeField(args) ?? scopeField(result),
    status: stringField(result, 'status'),
    state,
    error: state === 'error' && text !== null ? firstLine(text) : null,
  }
}

/**
 * Render one `install_skill` call as a compact summary: the folder, the scope
 * it targeted, and the outcome, with the localised scope and status copy.
 * @param props - keyed toolview payload plus the skill locale seat.
 * @returns the dedicated install row.
 */
export function InstallSkillRow({ block, t }: InstallSkillRowProps) {
  const model = installSkillModel(block)
  const scopeText = model.scope === 'workspace'
    ? t('install.scope.workspace')
    : model.scope === 'global' ? t('install.scope.global') : null
  const key = model.state === 'running' ? 'install.running' : statusKey(model.status)
  const summary = model.error ?? model.source
  return (
    <div className={css.card} data-tool="install_skill" data-state={model.state}>
      <div className={css.row}>
        <span className={css.leading}>
          {model.state === 'error' ? <StateDot state="error" /> : <IconSkillOutline16 size={14} />}
        </span>
        <span className={css.title}>{t('install.title')}</span>
        <span className={css.separator} aria-hidden />
        <span className={model.error === null ? css.summary : `${css.summary} ${css.errorSummary}`}>
          {summary}
        </span>
        {scopeText === null ? null : <span className={css.scope}>{scopeText}</span>}
        {key === undefined ? null : <span className={css.status}>{t(key)}</span>}
      </div>
    </div>
  )
}
