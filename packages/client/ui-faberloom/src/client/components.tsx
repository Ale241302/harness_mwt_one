/**
 * Shared FaberLoom UI primitives for the module screens: a toolbar, a dense
 * data table with selection, a right-hand inspector, form fields, chips, status
 * dots, the skill transfer list, and the loading/error/empty states. They are
 * pure components: every fact and callback arrives as a prop, and all copy
 * arrives through the locale seat.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { FaberloomKey } from './locales.ts'
import styles from './faberloom.module.css'

/** One column of a data table. */
export interface Column<T> {
  /** Stable column key. */
  key: string
  /** Header copy. */
  header: string
  /** Cell renderer. */
  cell: (row: T) => ReactNode
  /** Fixed width in pixels, when the column should not flex. */
  width?: number
}

/** Screen-level toolbar: title, counters, search, filters, and the primary action. */
export function Toolbar({ title, subtitle, trailing }: {
  title: string
  subtitle?: string | undefined
  trailing?: ReactNode | undefined
}) {
  return (
    <div className={styles.toolbar}>
      <div>
        <h1 className={styles.h1}>{title}</h1>
        {subtitle === undefined ? null : <p className={styles.sub}>{subtitle}</p>}
      </div>
      <div className={styles.tools}>{trailing}</div>
    </div>
  )
}

/** Search box with an accessible label. */
export function SearchBox({ value, onChange, placeholder, label }: {
  value: string
  onChange: (next: string) => void
  placeholder: string
  label: string
}) {
  return (
    <label className={styles.search}>
      <span className={styles.visuallyHidden}>{label}</span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        onChange={(event) => { onChange(event.target.value) }}
      />
    </label>
  )
}

/** Dense selectable table with the empty state.
 * @param props - columns, rows, the selected id, the row handler, and the empty copy.
 * @returns the table or the empty state.
 */
export function DataTable<T extends { id: string }>({ columns, rows, selectedId, onSelect, emptyTitle, emptyText }: {
  columns: readonly Column<T>[]
  rows: readonly T[]
  selectedId: string | null
  onSelect: (id: string) => void
  emptyTitle: string
  emptyText: string
}) {
  if (rows.length === 0) return <StateBlock kind="empty" title={emptyTitle} text={emptyText} />
  return (
    <div className={styles.tableCard}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.key} style={column.width === undefined ? undefined : { width: column.width }}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr
              key={row.id}
              className={row.id === selectedId ? styles.rowSelected : undefined}
              onClick={() => { onSelect(row.id) }}
            >
              {columns.map(column => <td key={column.key}>{column.cell(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Right-hand inspector: a titled panel with a footer. */
export function Inspector({ title, status, children, footer }: {
  title?: string
  status?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <aside className={styles.inspector}>
      {title === undefined ? null : (
        <div className={styles.inspectorTop}>
          <h2 className={styles.h2}>{title}</h2>
          {status}
        </div>
      )}
      <div className={styles.inspectorBody}>{children}</div>
      {footer === undefined ? null : <div className={styles.inspectorFoot}>{footer}</div>}
    </aside>
  )
}

/** Labelled form field. */
export function Field({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }) {
  return (
    // The wrapper is the label so the control gets its accessible name, which
    // keeps the editors usable by screen readers and by automation.
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint === undefined ? null : <span className={styles.hint}>{hint}</span>}
    </label>
  )
}

/** Small mono chip, used for skills and identifiers. */
export function Chip({ children, tone }: { children: ReactNode; tone?: 'muted' | 'accent' }) {
  return <span className={tone === 'accent' ? `${styles.chip} ${styles.chipAccent}` : styles.chip}>{children}</span>
}

/** Active/inactive dot with its label. */
export function StatusDot({ on, label }: { on: boolean; label: string }) {
  return <span className={styles.status}><span className={on ? styles.pulse : `${styles.pulse} ${styles.pulseOff}`} />{label}</span>
}

/** Loading, error, or empty block. */
export function StateBlock({ kind, title, text, action }: {
  kind: 'loading' | 'error' | 'empty'
  title: string
  text?: string
  action?: ReactNode
}) {
  return (
    <div className={kind === 'empty' ? styles.stateEmpty : styles.stateNote}>
      <p className={styles.stateTitle}>{title}</p>
      {text === undefined ? null : <p className={styles.stateText}>{text}</p>}
      {action}
    </div>
  )
}

/** Two-pane skill assignment: available on the left, assigned on the right. */
export function SkillTransfer({ available, assigned, onChange, labels, t }: {
  available: readonly { name: string; meta: string }[]
  assigned: readonly string[]
  onChange: (next: readonly string[]) => void
  labels: { available: string; assigned: string; search: string; add: string; remove: string }
  t: PropsLocale<'faberloom'>['t']
}) {
  const [query, setQuery] = useState('')
  const assignedSet = useMemo(() => new Set(assigned), [assigned])
  const needle = query.trim().toLowerCase()
  const pool = available.filter(item => !assignedSet.has(item.name)
    && (needle.length === 0 || item.name.toLowerCase().includes(needle) || item.meta.toLowerCase().includes(needle)))
  return (
    <div className={styles.transfer}>
      <div className={styles.pane}>
        <div className={styles.paneHead}>
          <span className={styles.hint}>{labels.available} ({pool.length})</span>
          <input
            className={styles.paneSearch}
            type="search"
            value={query}
            aria-label={labels.search}
            placeholder={labels.search}
            onChange={(event) => { setQuery(event.target.value) }}
          />
        </div>
        <div className={styles.paneRows}>
          {pool.length === 0 ? <p className={styles.hint}>{t('skills.noMatch')}</p> : pool.map(item => (
            <button
              key={item.name}
              type="button"
              className={styles.paneRow}
              title={item.meta}
              onClick={() => { onChange([...assigned, item.name]) }}
            >
              <code>{item.name}</code><span className={styles.paneAdd}>+</span>
            </button>
          ))}
        </div>
      </div>
      <div className={styles.paneMid} aria-hidden="true">›</div>
      <div className={styles.pane}>
        <div className={styles.paneHead}><span className={styles.hint}>{labels.assigned} ({assigned.length})</span></div>
        <div className={styles.paneRows}>
          {assigned.length === 0 ? <p className={styles.hint}>{t('skills.noneAssigned')}</p> : assigned.map(name => (
            <button
              key={name}
              type="button"
              className={styles.paneRow}
              onClick={() => { onChange(assigned.filter(entry => entry !== name)) }}
            >
              <code>{name}</code><span className={styles.paneAdd}>−</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Formatting helper for the skill keys the screens need. */
export type { FaberloomKey }
