/**
 * The MCP-servers Settings section: the owner's installed servers, each shown
 * with its transport, whether it is enabled and mounted, and which credentials
 * are present (never a value), beside a form that tests a candidate connection
 * before it is saved and installs it with every value going to the credential
 * seam. The component holds no service of its own: every read and write arrives
 * as an already-bound callback.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { SecretInput } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  FaberLoomMcpProbeFailure, FaberLoomMcpProbeResult, FaberLoomMcpServerInput,
  FaberLoomMcpServerRow, FaberLoomMcpTransportKind,
} from '@deepseek-ai/dsh-faberloom-view/types'
import type { FaberloomKey } from './locales.ts'
import styles from './mcp-servers-section.module.css'

/** One Remote result, as the generated client returns it. */
type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** The localized wording for one candidate failure. */
const FAILURE_KEY: Record<FaberLoomMcpProbeFailure, FaberloomKey> = {
  unreachable: 'mcp.servers.failure.unreachable',
  'bad-credential': 'mcp.servers.failure.badCredential',
  protocol: 'mcp.servers.failure.protocol',
}

/** The localized transport label of one saved server. */
const TRANSPORT_KEY: Record<FaberLoomMcpTransportKind, FaberloomKey> = {
  stdio: 'mcp.servers.transportStdio',
  'streamable-http': 'mcp.servers.transportHttp',
}

/** The localized next action for one candidate failure. */
const NEXT_KEY: Record<FaberLoomMcpProbeFailure, FaberloomKey> = {
  unreachable: 'mcp.servers.next.unreachable',
  'bad-credential': 'mcp.servers.next.badCredential',
  protocol: 'mcp.servers.next.protocol',
}

/**
 * The localized state of one saved server, from what the host proved: a server
 * is working only when it is enabled and its client mounted; an enabled server
 * that did not mount is saved but unproven, and a disabled one is off.
 * @param row - the saved server as the host projects it.
 * @returns the state key.
 */
function stateKey(row: FaberLoomMcpServerRow): FaberloomKey {
  if (!row.enabled) return 'mcp.servers.stateDisabled'
  return row.mounted ? 'mcp.servers.stateWorking' : 'mcp.servers.stateUnproven'
}

/** Local namespace of the server name the MCP client's tool grammar accepts. */
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/

/** One credential being typed: a name and the value the form holds until it is saved. */
interface SecretDraft {
  /** Stable key of the row while its name is still being typed. */
  readonly key: number
  readonly name: string
  readonly value: string
}

/** Everything the add form holds before validation turns it into a candidate. */
interface Draft {
  readonly name: string
  readonly transport: FaberLoomMcpTransportKind
  readonly command: string
  readonly args: string
  readonly cwd: string
  readonly url: string
  readonly secrets: readonly SecretDraft[]
  readonly enabled: boolean
}

/** The empty add form: a local server, enabled, with no credentials. */
const EMPTY_DRAFT: Draft = { name: '', transport: 'stdio', command: '', args: '', cwd: '', url: '', secrets: [], enabled: true }

/**
 * Whether a value is an absolute HTTP(S) URL the Streamable HTTP transport accepts.
 * @param value - the trimmed URL text.
 * @returns true when the text is an absolute HTTP(S) URL.
 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Why the current draft cannot be tested or saved yet.
 * @param draft - the add form's current values.
 * @returns the localized reason key, or null when the draft is usable.
 */
function invalidReason(draft: Draft): FaberloomKey | null {
  if (!SERVER_NAME_PATTERN.test(draft.name.trim())) return 'mcp.servers.invalidName'
  // A named credential with no value, or a value with no name, is the one
  // missing input the harness must not drop: it refuses the write and says so.
  for (const row of draft.secrets) {
    const named = row.name.trim().length > 0
    const valued = row.value.trim().length > 0
    if (named && !valued) return 'mcp.servers.missingKey'
    if (!named && valued) return 'mcp.servers.missingKeyName'
  }
  if (draft.transport === 'stdio') {
    return draft.command.trim().length === 0 ? 'mcp.servers.invalidCommand' : null
  }
  return isHttpUrl(draft.url.trim()) ? null : 'mcp.servers.invalidUrl'
}

/**
 * The non-empty credential values of the draft, or undefined when it names none.
 * @param draft - the add form's current values.
 * @returns the values keyed by name, or undefined.
 */
function secretValues(draft: Draft): Record<string, string> | undefined {
  const named = draft.secrets.filter(row => row.name.trim().length > 0)
  return named.length === 0 ? undefined : Object.fromEntries(named.map(row => [row.name.trim(), row.value]))
}

/**
 * Turn the draft into the candidate the Remote saves or tests, keeping each
 * credential value out of every read and inside this call only.
 * @param draft - the add form's current values.
 * @returns the candidate input.
 */
function draftInput(draft: Draft): FaberLoomMcpServerInput {
  const secrets = secretValues(draft)
  if (draft.transport === 'stdio') {
    const args = draft.args.trim()
    const cwd = draft.cwd.trim()
    return {
      name: draft.name.trim(),
      transport: 'stdio',
      command: draft.command.trim(),
      ...args.length === 0 ? {} : { args: args.split(/\s+/) },
      ...cwd.length === 0 ? {} : { cwd },
      ...secrets === undefined ? {} : { env: secrets },
      enabled: draft.enabled,
    }
  }
  return {
    name: draft.name.trim(),
    transport: 'streamable-http',
    url: draft.url.trim(),
    ...secrets === undefined ? {} : { headers: secrets },
    enabled: draft.enabled,
  }
}

/** The outcome of one candidate test, as the panel shows it. */
type TestState = {
  readonly state: 'testing' | 'ok' | 'fail'
  readonly text: string
  readonly tools: readonly string[]
  /** The localized next action a named failure carries, or null. */
  readonly next: FaberloomKey | null
}

/** Everything the settings section reads and calls, all bound outside the component. */
export interface McpServersSectionInjected {
  /** Read this identity's installed servers. */
  readonly load: () => Promise<Result<readonly FaberLoomMcpServerRow[]>>
  /** Install or replace one server and return the refreshed list. */
  readonly save: (input: FaberLoomMcpServerInput) => Promise<Result<readonly FaberLoomMcpServerRow[]>>
  /** Remove one server and return the refreshed list. */
  readonly remove: (name: string) => Promise<Result<readonly FaberLoomMcpServerRow[]>>
  /** Test one candidate connection before it is saved. */
  readonly test: (input: FaberLoomMcpServerInput) => Promise<Result<FaberLoomMcpProbeResult>>
}

/** Full component props: the runtime share, the locale seat, and the bound Remote calls. */
export type McpServersSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'faberloom'>
  & InjectFace<McpServersSectionInjected>

/**
 * Render the MCP-servers section.
 * @param props - the composed slot props (see {@link McpServersSectionProps}).
 * @returns the section element tree.
 */
export function McpServersSection(props: McpServersSectionProps): ReactNode {
  const { t, load, save, remove, test } = props
  const [rows, setRows] = useState<readonly FaberLoomMcpServerRow[] | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [probe, setProbe] = useState<TestState | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [nextKey, setNextKey] = useState(1)
  /** The server being edited, or null while the form installs a new one. */
  const [editing, setEditing] = useState<string | null>(null)
  /** The list search text, so a user with many servers finds one by name or target. */
  const [search, setSearch] = useState('')

  useEffect(() => {
    let live = true
    const apply = (result: Result<readonly FaberLoomMcpServerRow[]>): void => {
      if (!live) return
      if (result.ok) setRows(result.value)
      else setMessage(result.error.message)
    }
    void load().then(apply).catch((cause: unknown) => { if (live) setMessage(String(cause)) })
    return () => { live = false }
  }, [load])

  /** Patch one field of the add form. */
  const patch = (fields: Partial<Draft>): void => { setDraft(current => ({ ...current, ...fields })) }

  /** Append one empty credential row and return its stable key. */
  const addSecret = (): void => {
    setDraft(current => ({ ...current, secrets: [...current.secrets, { key: nextKey, name: '', value: '' }] }))
    setNextKey(key => key + 1)
  }

  /** Patch or drop one credential row. */
  const editSecret = (key: number, fields: Partial<SecretDraft>): void => {
    setDraft(current => ({ ...current, secrets: current.secrets.map(row => (row.key === key ? { ...row, ...fields } : row)) }))
  }

  /** Run one candidate test and keep its verdict in the form. */
  const runTest = (): void => {
    setProbe({ state: 'testing', text: t('mcp.servers.testing'), tools: [], next: null })
    void test(draftInput(draft)).then((result) => {
      // `result.ok` is the Remote call; `result.value.ok` is the test itself.
      if (!result.ok) { setProbe({ state: 'fail', text: result.error.message, tools: [], next: null }); return }
      setProbe(result.value.ok
        ? { state: 'ok', text: t('mcp.servers.testOk'), tools: result.value.tools, next: null }
        : {
          state: 'fail',
          text: `${t(FAILURE_KEY[result.value.failure])}: ${result.value.detail}`,
          tools: [],
          next: NEXT_KEY[result.value.failure],
        })
    }).catch((cause: unknown) => { setProbe({ state: 'fail', text: String(cause), tools: [], next: null }) })
  }

  /** Install or update the candidate, resetting the form when the write succeeds. */
  const runSave = (): void => {
    setBusy(true)
    setMessage(null)
    void save(draftInput(draft)).then((result) => {
      setBusy(false)
      if (!result.ok) { setMessage(result.error.message); return }
      setRows(result.value)
      setDraft(EMPTY_DRAFT)
      setEditing(null)
      setProbe(null)
    }).catch((cause: unknown) => { setBusy(false); setMessage(String(cause)) })
  }

  /** Remove one server, refusing until the row's own confirmation is answered. */
  const runRemove = (name: string): void => {
    setPending(null)
    setMessage(null)
    void remove(name).then((result) => {
      if (result.ok) setRows(result.value)
      else setMessage(result.error.message)
    }).catch((cause: unknown) => { setMessage(String(cause)) })
  }

  /**
   * Load one saved server into the form so it can be edited in place. The saved
   * credential values are never shown, so each existing entry becomes a row the
   * user re-enters; saving replaces exactly this server's entries and leaves
   * every other server untouched.
   */
  const startEdit = (row: FaberLoomMcpServerRow): void => {
    const secrets: SecretDraft[] = [...row.env, ...row.headers].map((entry, index) => ({
      key: nextKey + index,
      name: entry.name,
      value: '',
    }))
    setNextKey(nextKey + secrets.length)
    setEditing(row.name)
    setProbe(null)
    setMessage(null)
    setDraft({
      name: row.name,
      transport: row.transport,
      command: row.command ?? '',
      args: (row.args ?? []).join(' '),
      cwd: row.cwd ?? '',
      url: row.url ?? '',
      secrets,
      enabled: row.enabled,
    })
  }

  /** Leave edit mode and clear the form. */
  const cancelEdit = (): void => {
    setEditing(null)
    setDraft(EMPTY_DRAFT)
    setProbe(null)
  }

  /**
   * Flip one server's enabled flag without touching its saved credentials or
   * any other server, by resending the row's own transport and no secret map.
   */
  const toggle = (row: FaberLoomMcpServerRow): void => {
    setMessage(null)
    setProbe(null)
    const input: FaberLoomMcpServerInput = {
      name: row.name,
      transport: row.transport,
      ...row.transport === 'stdio'
        ? { command: row.command ?? '', args: [...row.args ?? []], cwd: row.cwd ?? '' }
        : { url: row.url ?? '' },
      enabled: !row.enabled,
    }
    void save(input).then((result) => {
      if (result.ok) setRows(result.value)
      else setMessage(result.error.message)
    }).catch((cause: unknown) => { setMessage(String(cause)) })
  }

  const invalid = invalidReason(draft)
  const visible = search.trim().length === 0
    ? rows ?? []
    : (rows ?? []).filter(row =>
      row.name.toLowerCase().includes(search.trim().toLowerCase())
      || row.target.toLowerCase().includes(search.trim().toLowerCase()))

  return (
    <div className={styles.section}>
      <p className={styles.intro}>{t('mcp.servers.intro')}</p>
      <p className={styles.scope}>{t('mcp.servers.scope')}</p>
      {message === null ? null : <p className={styles.error} role="alert">{message}</p>}

      {rows === null
        ? <p className={styles.status} role="status">{t('state.loading')}</p>
        : rows.length === 0
          ? <p className={styles.status}>{t('mcp.servers.empty')}</p>
          : (
            <>
              {rows.length > 3
                ? (
                  <>
                    <p className={styles.status}>{t('mcp.servers.count')}</p>
                    <label className={styles.field}>
                      <span className={styles.label}>{t('mcp.servers.search')}</span>
                      <input
                        type="search"
                        value={search}
                        placeholder={t('mcp.servers.search')}
                        aria-label={t('mcp.servers.search')}
                        onChange={(event) => { setSearch(event.target.value) }}
                      />
                    </label>
                  </>
                )
                : null}
              {visible.length === 0
                ? <p className={styles.status}>{t('mcp.servers.noMatch')}</p>
                : (
                  <ul className={styles.list}>
                    {visible.map(row => (
                      <li key={row.name} className={styles.row}>
                        <div className={styles.rowHead}>
                          <span className={styles.name}>{row.name}</span>
                          <span className={styles.tag}>{t(TRANSPORT_KEY[row.transport])}</span>
                          <span className={styles.tag}>{t(stateKey(row))}</span>
                        </div>
                        <p className={styles.target}>{row.target}</p>
                        {row.error === null
                          ? null
                          : <p className={styles.rowError} role="alert">{`${t('mcp.servers.error')}: ${row.error}`}</p>}
                        <div className={styles.credentials}>
                          {row.env.length === 0 && row.headers.length === 0
                            ? <span className={styles.meta}>{t('mcp.servers.noSecrets')}</span>
                            : [...row.env, ...row.headers].map(entry => (
                              <span key={entry.name} className={styles.credential}>
                                {`${entry.name}: `}{t(entry.present ? 'mcp.servers.present' : 'mcp.servers.absent')}
                              </span>
                            ))}
                        </div>
                        {pending === row.name
                          ? (
                            <div className={styles.confirm}>
                              <span className={styles.meta}>{t('mcp.servers.removeConfirm')}</span>
                              <button type="button" className={styles.danger} onClick={() => { runRemove(row.name) }}>
                                {t('mcp.servers.removeAction')}
                              </button>
                              <button type="button" className={styles.secondary} onClick={() => { setPending(null) }}>
                                {t('action.cancel')}
                              </button>
                            </div>
                          )
                          : (
                            <div className={styles.actions}>
                              <button type="button" className={styles.ghost} onClick={() => { startEdit(row) }}>
                                {t('mcp.servers.edit')}
                              </button>
                              <button type="button" className={styles.ghost} onClick={() => { toggle(row) }}>
                                {t(row.enabled ? 'mcp.servers.disable' : 'mcp.servers.enable')}
                              </button>
                              <button type="button" className={styles.ghost} onClick={() => { setPending(row.name) }}>
                                {t('action.remove')}
                              </button>
                            </div>
                          )}
                      </li>
                    ))}
                  </ul>
                )}
            </>
          )}

      <div className={styles.form}>
        <div className={styles.formHead}>
          <h3 className={styles.formTitle}>{editing === null ? t('mcp.servers.add') : `${t('mcp.servers.editing')} ${editing}`}</h3>
          {editing === null ? null : (
            <button type="button" className={styles.secondary} onClick={() => { cancelEdit() }}>
              {t('action.cancel')}
            </button>
          )}
        </div>
        <label className={styles.field}>
          <span className={styles.label}>{t('field.name')}</span>
          <input
            type="text"
            value={draft.name}
            aria-label={t('field.name')}
            onChange={(event) => { patch({ name: event.target.value }) }}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>{t('mcp.servers.transport')}</span>
          <select
            value={draft.transport}
            aria-label={t('mcp.servers.transport')}
            onChange={(event) => { patch({ transport: event.target.value === 'streamable-http' ? 'streamable-http' : 'stdio' }) }}
          >
            <option value="stdio">{t('mcp.servers.transportStdio')}</option>
            <option value="streamable-http">{t('mcp.servers.transportHttp')}</option>
          </select>
        </label>
        {draft.transport === 'stdio'
          ? (
            <>
              <label className={styles.field}>
                <span className={styles.label}>{t('mcp.servers.command')}</span>
                <input
                  type="text"
                  value={draft.command}
                  placeholder={t('mcp.servers.command')}
                  aria-label={t('mcp.servers.command')}
                  onChange={(event) => { patch({ command: event.target.value }) }}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>{t('mcp.servers.args')}</span>
                <input
                  type="text"
                  value={draft.args}
                  placeholder={t('mcp.servers.args')}
                  aria-label={t('mcp.servers.args')}
                  onChange={(event) => { patch({ args: event.target.value }) }}
                />
                <span className={styles.hint}>{t('mcp.servers.argsHint')}</span>
              </label>
              <label className={styles.field}>
                <span className={styles.label}>{t('mcp.servers.cwd')}</span>
                <input
                  type="text"
                  value={draft.cwd}
                  aria-label={t('mcp.servers.cwd')}
                  onChange={(event) => { patch({ cwd: event.target.value }) }}
                />
              </label>
            </>
          )
          : (
            <label className={styles.field}>
              <span className={styles.label}>{t('mcp.servers.url')}</span>
              <input
                type="text"
                value={draft.url}
                placeholder={t('mcp.servers.url')}
                aria-label={t('mcp.servers.url')}
                onChange={(event) => { patch({ url: event.target.value }) }}
              />
            </label>
          )}

        <div className={styles.secrets}>
          <span className={styles.label}>{t('mcp.servers.secrets')}</span>
          <span className={styles.hint}>{editing === null ? t('mcp.servers.secretsHint') : t('mcp.servers.editSecretsHint')}</span>
          {draft.secrets.map(row => (
            <div key={row.key} className={styles.secretRow}>
              <input
                type="text"
                value={row.name}
                placeholder={t('mcp.servers.secretName')}
                aria-label={t('mcp.servers.secretName')}
                onChange={(event) => { editSecret(row.key, { name: event.target.value }) }}
              />
              <SecretInput
                value={row.value}
                aria-label={t('mcp.servers.secretValue')}
                showLabel={t('mcp.servers.secretValue')}
                hideLabel={t('mcp.servers.secretValue')}
                onChange={(event) => { editSecret(row.key, { value: event.target.value }) }}
              />
              <button type="button" className={styles.ghost} onClick={() => {
                setDraft(current => ({ ...current, secrets: current.secrets.filter(entry => entry.key !== row.key) }))
              }}>{t('action.remove')}</button>
            </div>
          ))}
          <button type="button" className={styles.secondary} onClick={() => { addSecret() }}>
            {t('mcp.servers.secretAdd')}
          </button>
        </div>

        <label className={styles.flag}>
          <input type="checkbox" checked={draft.enabled} onChange={(event) => { patch({ enabled: event.target.checked }) }} />
          <span>{t('mcp.servers.enabledFlag')}</span>
        </label>

        {invalid === null ? null : <p className={styles.error} role="alert">{t(invalid)}</p>}
        {probe === null ? null : (
          <p className={styles.test} data-state={probe.state} role="status">
            {probe.state === 'ok'
              ? `${probe.text}: ${probe.tools.length === 0 ? t('mcp.servers.testNoTools') : `${t('mcp.servers.testTools')} ${probe.tools.join(', ')}`}`
              : probe.text}
            {probe.next === null ? null : ` ${t(probe.next)}`}
          </p>
        )}

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} disabled={busy || invalid !== null} onClick={() => { runTest() }}>
            {t('mcp.servers.test')}
          </button>
          <button type="button" className={styles.primary} disabled={busy || invalid !== null} onClick={() => { runSave() }}>
            {t('action.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
