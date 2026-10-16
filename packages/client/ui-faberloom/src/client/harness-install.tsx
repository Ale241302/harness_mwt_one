/**
 * The harness-install control: point the host's own dialog at a folder or at a
 * `.zip`, install it once, and read back what landed where. The destination is
 * not a choice — a harness is the user's own setup, so every part is written
 * into the Harness home that user alone reads — and the report names each
 * part's root, because that listing is the evidence of what the run wrote.
 * The folder choice and every Remote call arrive as already-bound callbacks, so
 * this component holds no service of its own.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  FaberLoomHarnessPartKind, FaberLoomHarnessRefusal, FaberLoomHarnessReport,
  FaberLoomSkillCandidateReason, FaberLoomSkillInstallDestination, FaberLoomSkillInstallRow,
} from '@deepseek-ai/dsh-faberloom-view/types'
import type { FaberloomKey } from './locales.ts'
import styles from './faberloom.module.css'

/** One Remote result, as the generated client returns it. */
type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The localized name of each part a harness can carry. */
const PART_KEY: Record<FaberLoomHarnessPartKind, FaberloomKey> = {
  skills: 'harness.part.skills',
  agents: 'harness.part.agents',
  rules: 'harness.part.rules',
  commands: 'harness.part.commands',
  scripts: 'harness.part.scripts',
  hooks: 'harness.part.hooks',
  'mcp-configs': 'harness.part.mcpConfigs',
}

/** The localized wording for one part's status. */
const PART_STATUS_KEY: Record<FaberLoomHarnessReport['parts'][number]['status'], FaberloomKey> = {
  installed: 'skills.installInstalled',
  replaced: 'skills.installReplaced',
  skipped: 'skills.installSkipped',
}

/** The localized wording for one whole-call refusal. */
const REFUSAL_KEY: Record<FaberLoomHarnessRefusal, FaberloomKey> = {
  'read-only': 'skills.install.why.readOnly',
  'source-missing': 'skills.install.why.sourceMissing',
  'not-a-harness': 'harness.why.notAHarness',
  'archive-unreadable': 'harness.why.archiveUnreadable',
}

/** The localized wording for one refused candidate. */
const REASON_KEY: Record<FaberLoomSkillCandidateReason, FaberloomKey> = {
  'name-missing': 'skills.install.why.nameMissing',
  'name-illegal': 'skills.install.why.nameIllegal',
  exists: 'skills.install.why.exists',
  'agent-invalid': 'skills.install.why.agentInvalid',
}

/** Most install rows the control lists before it names the remainder. */
const LIST_CAP = 12

/** Everything the install control reads and calls, all bound outside the component. */
export interface HarnessInstallProps extends PropsLocale<'faberloom'> {
  /** Open the mounted directory picker; null when the user cancelled. */
  readonly pickFolder: () => Promise<string | null>
  /** Open the mounted file picker; null when the user cancelled. */
  readonly pickArchive: () => Promise<string | null>
  /** Install from one folder or archive into the user's own Harness home. */
  readonly install: (source: string, replace: boolean) => Promise<Result<FaberLoomHarnessReport>>
  /** Read this identity's recorded installs. */
  readonly loadInstalls: () => Promise<Result<readonly FaberLoomSkillInstallRow[]>>
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
 * @param props - the localized seat plus the bound pickers and Remote calls.
 * @returns the control markup.
 */
export function HarnessInstallBlock(props: HarnessInstallProps): ReactNode {
  const { t, pickFolder, pickArchive, install, loadInstalls, uninstall, onChanged } = props
  const [installs, setInstalls] = useState<readonly FaberLoomSkillInstallRow[]>([])
  const [source, setSource] = useState<string | null>(null)
  const [replace, setReplace] = useState(false)
  const [report, setReport] = useState<FaberLoomHarnessReport | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void loadInstalls().then((result) => { if (live && result.ok) setInstalls(result.value) })
    return () => { live = false }
  }, [loadInstalls])

  const pick = async (choose: () => Promise<string | null>): Promise<void> => {
    const picked = await choose()
    if (picked === null || picked.length === 0) return
    setSource(picked)
    setReport(null)
    setMessage(null)
  }

  const run = async (): Promise<void> => {
    if (source === null) return
    setBusy(true)
    setMessage(null)
    const result = await install(source, replace)
    setBusy(false)
    if (!result.ok) { setReport(null); setMessage(result.error.message); return }
    setReport(result.value)
    if (result.value.refused !== undefined) setMessage(t(REFUSAL_KEY[result.value.refused]))
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

  const refused = report === null ? [] : report.outcomes.filter(outcome => outcome.status === 'refused')
  const reason = (value: FaberLoomSkillCandidateReason | undefined): string =>
    value === undefined ? '' : ` (${t(REASON_KEY[value])})`

  return (
    <div className={styles.install}>
      <div className={styles.installRow}>
        <span className={styles.installLabel}>{t('harness.title')}</span>
        <button className={styles.secondary} type="button" disabled={busy} onClick={() => { void pick(pickFolder) }}>
          {t('harness.pickFolder')}
        </button>
        <button className={styles.secondary} type="button" disabled={busy} onClick={() => { void pick(pickArchive) }}>
          {t('harness.pickArchive')}
        </button>
        <span className={styles.installPath}>{source ?? t('harness.pickHint')}</span>
      </div>
      <div className={styles.installRow}>
        <label className={styles.installFlag}>
          <input type="checkbox" checked={replace} onChange={(event) => { setReplace(event.target.checked) }} />
          <span>{t('harness.replace')}</span>
        </label>
        <button className={styles.primary} type="button" disabled={busy || source === null} onClick={() => { void run() }}>
          {t('harness.run')}
        </button>
        {message === null ? null : <span className={styles.installNote}>{message}</span>}
      </div>
      {report === null || report.parts.length === 0 ? null : (
        <ul className={styles.installList}>
          {report.parts.map(part => (
            <li key={part.kind}>
              <span className={styles.installLabel}>{t(PART_KEY[part.kind])}</span>
              <span>{`${String(part.count)} · ${t(PART_STATUS_KEY[part.status])}`}</span>
              <code className={styles.installPath}>{part.target}</code>
            </li>
          ))}
        </ul>
      )}
      {refused.length === 0 ? null : (
        <span className={styles.installNote}>
          {`${t('harness.refused')}: ${refused.map(outcome => `${outcome.name}${reason(outcome.reason)}`).join(', ')}`}
        </span>
      )}
      {installs.length === 0 ? null : (
        <>
          <span className={styles.installLabel}>{t('skills.installList')}</span>
          <ul className={styles.installList}>
            {installs.slice(0, LIST_CAP).map(row => (
              <li key={`${row.destination}:${row.name}`}>
                <span>{row.name}</span>
                <code className={styles.installPath}>{row.destinationRoot}</code>
                <button className={styles.ghost} type="button" onClick={() => { void remove(row) }}>
                  {t('skills.installRemove')}
                </button>
              </li>
            ))}
            {installs.length <= LIST_CAP ? null : (
              <li className={styles.installNote}>{`${t('harness.andMore')}: ${String(installs.length - LIST_CAP)}`}</li>
            )}
          </ul>
        </>
      )}
    </div>
  )
}
