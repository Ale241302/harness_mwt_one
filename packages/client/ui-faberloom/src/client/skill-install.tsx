/**
 * The skill-install control: point the directory picker at a folder, choose
 * whether it installs for the current workspace or globally, and run it. The
 * control shows the resolved destination root before it writes and localizes
 * every reason an install changed nothing; a workspace install is refused when
 * the session has none. The folder choice and every Remote call arrive as
 * already-bound callbacks, so this component holds no service of its own.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  FaberLoomSkillCandidateReason, FaberLoomSkillInstallDestination, FaberLoomSkillInstallOutcome,
  FaberLoomSkillInstallRefusal, FaberLoomSkillInstallReport, FaberLoomSkillInstallRow, FaberLoomSkillInstallTargets,
} from '@deepseek-ai/dsh-faberloom-view/types'
import type { FaberloomKey } from './locales.ts'
import styles from './faberloom.module.css'

/** One Remote result, as the generated client returns it. */
type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The localized wording for one whole-call refusal. */
const REFUSAL_KEY: Record<FaberLoomSkillInstallRefusal, FaberloomKey> = {
  'read-only': 'skills.install.why.readOnly',
  'no-workspace': 'skills.install.why.noWorkspace',
  'source-missing': 'skills.install.why.sourceMissing',
  'outside-workspace': 'skills.install.why.outsideWorkspace',
  'not-a-skill': 'skills.install.why.notASkill',
  'name-missing': 'skills.install.why.nameMissing',
  'name-illegal': 'skills.install.why.nameIllegal',
}

/** The localized wording for one refused or skipped candidate. */
const REASON_KEY: Record<FaberLoomSkillCandidateReason, FaberloomKey> = {
  'name-missing': 'skills.install.why.nameMissing',
  'name-illegal': 'skills.install.why.nameIllegal',
  exists: 'skills.install.why.exists',
}

/** The localized wording for one candidate status. */
const STATUS_KEY: Record<FaberLoomSkillInstallOutcome['status'], FaberloomKey> = {
  installed: 'skills.installInstalled',
  replaced: 'skills.installReplaced',
  skipped: 'skills.installSkipped',
  refused: 'skills.installRefused',
}

/**
 * Render one install report as localized text: the refused reason for the whole
 * call, else one name and status per candidate.
 * @param report - the install report.
 * @param t - the faberloom dictionary seat.
 * @returns the localized report line.
 */
function reportText(report: FaberLoomSkillInstallReport, t: (key: FaberloomKey) => string): string {
  if (report.refused !== undefined) return t(REFUSAL_KEY[report.refused])
  return report.outcomes.map((outcome) => {
    const status = t(STATUS_KEY[outcome.status])
    const reason = outcome.reason === undefined ? '' : ` (${t(REASON_KEY[outcome.reason])})`
    return `${outcome.name}: ${status}${reason}`
  }).join(' | ')
}

/** Everything the install control reads and calls, all bound outside the component. */
export interface SkillInstallProps extends PropsLocale<'faberloom'> {
  /** Open the mounted directory picker; null when the user cancelled. */
  readonly pickFolder: () => Promise<string | null>
  /** Read the two resolved destination roots. */
  readonly loadTargets: () => Promise<Result<FaberLoomSkillInstallTargets>>
  /** Read this identity's recorded installs. */
  readonly loadInstalls: () => Promise<Result<readonly FaberLoomSkillInstallRow[]>>
  /** Install from one folder into one destination. */
  readonly install: (
    source: string,
    destination: FaberLoomSkillInstallDestination,
    replace: boolean,
  ) => Promise<Result<FaberLoomSkillInstallReport>>
  /** Remove one recorded install. */
  readonly uninstall: (
    name: string,
    destination: FaberLoomSkillInstallDestination,
  ) => Promise<Result<readonly FaberLoomSkillInstallRow[]>>
  /** Refresh the skill list after an install or removal changed it. */
  readonly onChanged: () => void
}

/**
 * The install control.
 * @param props - the localized seat plus the bound picker and Remote calls.
 * @returns the control markup.
 */
export function SkillInstallBlock(props: SkillInstallProps): ReactNode {
  const { t, pickFolder, loadTargets, loadInstalls, install, uninstall, onChanged } = props
  const [targets, setTargets] = useState<FaberLoomSkillInstallTargets | null>(null)
  const [installs, setInstalls] = useState<readonly FaberLoomSkillInstallRow[]>([])
  const [source, setSource] = useState<string | null>(null)
  const [destination, setDestination] = useState<FaberLoomSkillInstallDestination>('global')
  const [replace, setReplace] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void loadTargets().then((result) => { if (live && result.ok) setTargets(result.value) })
    void loadInstalls().then((result) => { if (live && result.ok) setInstalls(result.value) })
    return () => { live = false }
  }, [loadTargets, loadInstalls])

  const pick = async (): Promise<void> => {
    const picked = await pickFolder()
    if (picked === null || picked.length === 0) return
    setSource(picked)
    setMessage(null)
  }

  const run = async (): Promise<void> => {
    if (source === null) return
    setBusy(true)
    setMessage(null)
    const result = await install(source, destination, replace)
    setBusy(false)
    if (!result.ok) { setMessage(result.error.message); return }
    setMessage(reportText(result.value, t))
    const refreshed = await loadInstalls()
    if (refreshed.ok) setInstalls(refreshed.value)
    onChanged()
  }

  const remove = async (row: FaberLoomSkillInstallRow): Promise<void> => {
    const result = await uninstall(row.name, row.destination)
    if (!result.ok) { setMessage(result.error.message); return }
    setInstalls(result.value)
    onChanged()
  }

  const root = targets === null
    ? ''
    : destination === 'workspace' ? targets.workspace ?? '' : targets.global
  const noWorkspace = targets !== null && targets.workspace === null

  return (
    <div className={styles.install}>
      <div className={styles.installRow}>
        <span className={styles.installLabel}>{t('skills.install')}</span>
        <button className={styles.secondary} type="button" disabled={busy} onClick={() => { void pick() }}>
          {t('skills.installPick')}
        </button>
        <span className={styles.installPath}>{source ?? t('skills.installPickHint')}</span>
      </div>
      <div className={styles.installRow}>
        <span className={styles.installLabel}>{t('skills.installDest')}</span>
        <button
          className={destination === 'workspace' ? styles.primary : styles.secondary}
          type="button"
          disabled={noWorkspace}
          onClick={() => { setDestination('workspace') }}
        >{t('skills.installWorkspace')}</button>
        <button
          className={destination === 'global' ? styles.primary : styles.secondary}
          type="button"
          onClick={() => { setDestination('global') }}
        >{t('skills.installGlobal')}</button>
      </div>
      <div className={styles.installRow}>
        <span className={styles.installLabel}>{t('skills.installRoot')}</span>
        <code className={styles.installPath}>{root}</code>
      </div>
      {!noWorkspace ? null : <span className={styles.installNote}>{t('skills.installNoWorkspace')}</span>}
      <div className={styles.installRow}>
        <label className={styles.installFlag}>
          <input type="checkbox" checked={replace} onChange={(event) => { setReplace(event.target.checked) }} />
          <span>{t('skills.installReplace')}</span>
        </label>
        <button className={styles.primary} type="button" disabled={busy || source === null} onClick={() => { void run() }}>
          {t('skills.installRun')}
        </button>
        {message === null ? null : <span className={styles.installNote}>{message}</span>}
      </div>
      {installs.length === 0 ? null : (
        <ul className={styles.installList}>
          {installs.map(row => (
            <li key={`${row.destination}:${row.name}`}>
              <span className={styles.installLabel}>{t('skills.installList')}</span>
              <span>{row.name}</span>
              <code className={styles.installPath}>{row.destinationRoot}</code>
              <button className={styles.ghost} type="button" onClick={() => { void remove(row) }}>
                {t('skills.installRemove')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
