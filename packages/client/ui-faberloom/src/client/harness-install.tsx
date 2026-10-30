/**
 * The harness-install wizard: one button before the Agents/Skills tabs, one
 * chooser, a staged progress dialog, and a confirmation that names what landed.
 *
 * The chooser is a single button because the harness is either a folder or a
 * `.zip`. The native file dialog cannot select both kinds on Windows, so the
 * button opens the file dialog and the chosen path decides: a `.zip` installs
 * as an archive, any other file stands for the folder that contains it. The
 * hint says so instead of hiding a second button.
 */
import { useState, type ReactNode } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  FaberLoomHarnessPartKind, FaberLoomHarnessRefusal, FaberLoomHarnessReport, FaberLoomSkillCandidateReason,
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
const REFUSED_KEY: Record<FaberLoomSkillCandidateReason, FaberloomKey> = {
  'name-missing': 'skills.install.why.nameMissing',
  'name-illegal': 'skills.install.why.nameIllegal',
  exists: 'skills.install.why.exists',
  'agent-invalid': 'skills.install.why.agentInvalid',
}

/** The stages the progress dialog walks, in the order the reader asked for. */
const STAGES = ['agents', 'skills', 'commands', 'scripts'] as const

/** Everything the wizard reads and calls, all bound outside the component. */
export interface HarnessInstallWizardProps {
  /** Namespace-bound translate. */
  readonly t: (key: FaberloomKey) => string
  /** Open the native chooser and return the chosen file path. */
  readonly pickSource: () => Promise<string | null>
  /** Install one folder or archive into the signed-in user's Harness home. */
  readonly install: (source: string, replace: boolean) => Promise<Result<FaberLoomHarnessReport>>
  /** Refresh the catalog after a successful run. */
  readonly onChanged: () => void
}

/** One phase of the wizard. */
type Phase = 'pick' | 'run' | 'done' | 'error'

/**
 * Render the install button and its three dialogs.
 * @param props - translate, chooser, install, and refresh callbacks.
 * @returns the trigger button and the dialogs it owns.
 */
export function HarnessInstallWizard({ t, pickSource, install, onChanged }: HarnessInstallWizardProps): ReactNode {
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('pick')
  const [source, setSource] = useState<{ readonly path: string; readonly folder: boolean } | null>(null)
  const [replace, setReplace] = useState(false)
  const [percent, setPercent] = useState(0)
  const [report, setReport] = useState<FaberLoomHarnessReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const begin = (): void => {
    setPhase('pick')
    setSource(null)
    setPercent(0)
    setReport(null)
    setError(null)
    setOpen(true)
  }

  const close = (): void => {
    setOpen(false)
    setPhase('pick')
    setSource(null)
    setPercent(0)
    setReport(null)
    setError(null)
  }

  const start = (chosen: string): void => {
    const archive = /\.zip$/iu.test(chosen)
    const path = archive ? chosen : chosen.replace(/[\\/][^\\/]+$/u, '')
    setSource({ path, folder: !archive })
    setPhase('run')
    setPercent(2)
    setError(null)
    const started = Date.now()
    const timer = setInterval(() => {
      setPercent(current => Math.min(96, current + Math.max(1, Math.round((96 - current) / 10))))
    }, 110)
    void install(path, replace)
      .then((result) => {
        clearInterval(timer)
        // The run is short; the wait only lets the reader see each stage.
        const wait = Math.max(0, 1500 - (Date.now() - started))
        setTimeout(() => {
          if (!result.ok) {
            setError(result.error.message)
            setPhase('error')
            return
          }
          if (result.value.refused !== undefined) {
            setError(t(REFUSAL_KEY[result.value.refused]))
            setPhase('error')
            return
          }
          setReport(result.value)
          setPercent(100)
          setPhase('done')
          onChanged()
        }, wait)
      })
      .catch((cause: unknown) => {
        clearInterval(timer)
        setError(String(cause))
        setPhase('error')
      })
  }

  const pick = async (): Promise<void> => {
    const chosen = await pickSource()
    if (chosen === null || chosen.length === 0) return
    start(chosen)
  }

  const stage = Math.min(STAGES.length - 1, Math.floor(percent / (100 / STAGES.length)))
  const refused = report === null ? [] : report.outcomes.filter(outcome => outcome.status === 'refused')

  return (
    <>
      <button className={styles.secondary} type="button" onClick={begin}>{t('harness.installButton')}</button>
      <Modal open={open && phase === 'pick'} onClose={close} title={t('harness.wizard.title')} closeLabel={t('action.close')}
        footer={<button className={styles.ghost} type="button" onClick={close}>{t('action.cancel')}</button>}>
        <p className={styles.installHint}>{t('harness.wizard.hint')}</p>
        <button className={styles.installPick} type="button" onClick={() => { void pick() }}>
          {t('harness.wizard.pick')}
        </button>
        <label className={styles.installFlag}>
          <input type="checkbox" checked={replace} onChange={(event) => { setReplace(event.target.checked) }} />
          <span>{t('harness.replace')}</span>
        </label>
      </Modal>
      <Modal open={open && phase === 'run'} onClose={() => {}} title={t('harness.progress.title')} closeLabel={t('action.close')}>
        <div className={styles.installStages}>
          {STAGES.map((name, index) => (
            <div
              key={name}
              className={styles.installStage}
              data-state={index < stage ? 'done' : index === stage ? 'active' : 'pending'}
            >
              <span className={styles.installStageDot} aria-hidden="true" />
              <span className={styles.installStageName}>{t(`harness.part.${name}` as FaberloomKey)}</span>
              <span className={styles.installStageState}>
                {index < stage ? '✓' : index === stage ? `${String(percent)}%` : ''}
              </span>
            </div>
          ))}
        </div>
        <div className={styles.installBar} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className={styles.installBarFill} style={{ width: `${String(percent)}%` }} />
        </div>
        {source === null ? null : <code className={styles.installPath}>{source.path}</code>}
      </Modal>
      <Modal open={open && phase === 'done'} onClose={close} title={t('harness.done.title')} closeLabel={t('action.close')}
        footer={<button className={styles.primary} type="button" onClick={close}>{t('action.close')}</button>}>
        <p className={styles.installHint}>{t('harness.done.summary')}</p>
        <ul className={styles.installList}>
          {report?.parts.map(part => (
            <li key={part.kind}>
              <span className={styles.installLabel}>{t(PART_KEY[part.kind])}</span>
              <span>{`${String(part.count)} · ${t(PART_STATUS_KEY[part.status])}`}</span>
              <code className={styles.installPath}>{part.target}</code>
            </li>
          ))}
          {refused.map((outcome, index) => (
            <li key={`${outcome.name}-${String(index)}`}>
              <span className={styles.installLabel}>{outcome.name}</span>
              <span>{t('skills.installRefused')}{outcome.reason === undefined ? '' : ` · ${t(REFUSED_KEY[outcome.reason])}`}</span>
            </li>
          ))}
        </ul>
      </Modal>
      <Modal open={open && phase === 'error'} onClose={close} title={t('harness.error.title')} closeLabel={t('action.close')}
        footer={<button className={styles.primary} type="button" onClick={close}>{t('action.close')}</button>}>
        <p className={styles.installNote} role="alert">{error}</p>
      </Modal>
    </>
  )
}
