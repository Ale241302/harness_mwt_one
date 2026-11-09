/**
 * Field-level conversion report for one portable artifact and one host. It
 * decides what the host preserves, translates, omits, or rejects; an
 * unsupported component stays in the source artifact and is never silently
 * reinterpreted as an equivalent one. The adapter consumes the accepted files;
 * the report is the authority on everything left out.
 * @module @deepseek-ai/dsh-faberloom-portable/src/adapters/conversion
 */

import { sha256OfText } from '../canonical.ts'
import { portableError } from '../errors.ts'
import { isSessionOrTranscript } from '../policy.ts'
import type {
  ConversionReport,
  ConversionRow,
  ConvertedFile,
  PortableFileEntry,
  PortablePlan,
  PortableRejection,
} from '../types.ts'

/** Host this report covers. */
export const CONVERSION_HOST = 'claude-code' as const

/** Skill names the package reserves for its own instructions. */
const RESERVED_SKILLS = new Set(['faberloom-space', 'faberloom-proposals'])

/** One parsed Markdown component. */
interface MarkdownComponent {
  readonly fields: readonly (readonly [string, string])[]
  readonly body: string
}

/** One skill directory and the target name its valid skill would use. */
interface SkillInfo {
  readonly directory: string
  readonly slug: string
  readonly valid: boolean
  readonly reason?: string
}

/** Fold a display name into a host-safe slug. */
function slugOf(value: string): string {
  const folded = value
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64)
    .replace(/-+$/gu, '')
  return folded.length === 0 ? 'component' : folded
}

/** Parse one `---` frontmatter block without rewriting it. */
function parseMarkdown(content: string): MarkdownComponent | undefined {
  if (!content.startsWith('---')) return undefined
  const end = content.indexOf('\n---', 3)
  if (end < 0) return undefined
  const raw = content.slice(3, end).replace(/^\n/u, '')
  const body = content.slice(end + 4).replace(/^\n/u, '')
  const fields: (readonly [string, string])[] = []
  let current: [string, string] | undefined
  for (const line of raw.split('\n')) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line)
    if (match?.[1] !== undefined) {
      current = [match[1], match[2] ?? '']
      fields.push(current)
      continue
    }
    // A block-list item or folded value belongs to the previous key; keep the
    // original text in the content, only the key/value pair is inspected here.
    if (current !== undefined && /^\s+/u.test(line)) {
      current = undefined
    }
  }
  return { fields, body }
}

/** Read one field from a parsed component. */
function field(component: MarkdownComponent, name: string): string | undefined {
  return component.fields.find(([key]) => key === name)?.[1]
}

/** Whether a component declares a field. */
function hasField(component: MarkdownComponent, name: string): boolean {
  return component.fields.some(([key]) => key === name)
}

/** Keep the body and every frontmatter line, replacing only the name value. */
function withName(content: string, slug: string): string {
  return content.replace(/^name:\s*.*$/mu, `name: ${slug}`)
}

/** The inventory entry for one artifact path. */
function inventoryMap(plan: Pick<PortablePlan, 'manifest'>): Map<string, PortableFileEntry> {
  return new Map(plan.manifest.files.map(file => [file.path, file]))
}

/** Stable unique list. */
function unique(values: Iterable<string>): string[] {
  return [...new Set(values)]
}

/** Whether a path names a complete backup rather than a space resource. */
function looksLikeBackup(source: string): boolean {
  return source.startsWith('backup/')
    || source.startsWith('backups/')
    || /(?:^|\/)(?:backups?|dump|export)(?:[^/]*)\.(?:zip|tar|gz|tgz|dump|bak)$/iu.test(source)
}

/**
 * Convert one portable plan into host components and a field-level report.
 * @param plan - signed portable plan or its manifest/files/rejections.
 * @param host - host id; only `claude-code` is certified.
 * @returns accepted files and the conversion report.
 * @throws {Error} `PORTABLE_ADAPTER_INVALID` for an uncertified host.
 */
export function convertPortable(
  plan: Pick<PortablePlan, 'manifest' | 'files'> & { readonly rejected?: readonly PortableRejection[] },
  host: string = CONVERSION_HOST,
): {
  readonly files: readonly ConvertedFile[]
  readonly report: ConversionReport
} {
  if (host !== CONVERSION_HOST) {
    throw portableError('PORTABLE_ADAPTER_INVALID', `only ${CONVERSION_HOST} is certified for conversion`)
  }
  const rows: ConversionRow[] = []
  const files: ConvertedFile[] = []
  const limitations: string[] = ['legacy-generator-retained:D13-open']
  const inventory = inventoryMap(plan)
  let omitted = 0
  let rejected = 0
  const add = (row: ConversionRow): void => {
    rows.push(row)
    if (row.reason !== undefined) limitations.push(row.reason)
  }
  const acceptCommon = (source: string, kind: string): void => {
    rows.push(
      { source, kind, field: 'path', decision: 'preserved' },
      { source, kind, field: 'mediaType', decision: 'preserved' },
      { source, kind, field: 'classification', decision: 'preserved' },
    )
    if (inventory.has(source)) {
      rows.push(
        { source, kind, field: 'origin', decision: 'preserved' },
        { source, kind, field: 'metadata', decision: 'preserved' },
      )
    }
  }
  const skillInfos = new Map<string, SkillInfo>()
  const usedSkills = new Set<string>(RESERVED_SKILLS)
  for (const file of plan.files) {
    if (file.kind !== 'skill' || !file.path.startsWith('skills/')) continue
    const directory = file.path.split('/').slice(0, 2).join('/')
    const parsed = parseMarkdown(file.content)
    const name = parsed === undefined ? undefined : field(parsed, 'name')
    const description = parsed === undefined ? undefined : field(parsed, 'description')
    if (parsed === undefined || (name ?? '').trim().length === 0 || (description ?? '').trim().length === 0) {
      skillInfos.set(directory, { directory, slug: '', valid: false, reason: 'skill-invalid' })
      continue
    }
    const slug = slugOf(name ?? directory)
    if (RESERVED_SKILLS.has(slug)) {
      skillInfos.set(directory, { directory, slug, valid: false, reason: 'skill-reserved-name' })
      continue
    }
    if (usedSkills.has(slug)) {
      skillInfos.set(directory, { directory, slug, valid: false, reason: 'skill-name-conflict' })
      continue
    }
    usedSkills.add(slug)
    skillInfos.set(directory, { directory, slug, valid: true })
  }
  const targets = new Set<string>()
  for (const file of plan.files) {
    const source = file.path
    const kind = file.kind as string
    const entry = inventory.get(source)
    if (entry !== undefined && (entry.kind !== file.kind || sha256OfText(file.content) !== entry.sha256)) {
      rejected += 1
      add({ source, kind, field: 'component', decision: 'rejected', reason: 'inventory-mismatch' })
      continue
    }
    if (isSessionOrTranscript({
      id: source, kind: file.kind, path: source, title: '', content: file.content, classification: 'N2',
    })) {
      rejected += 1
      add({ source, kind, field: 'component', decision: 'rejected', reason: 'session-transcript' })
      continue
    }
    if (looksLikeBackup(source) || kind === 'backup') {
      rejected += 1
      add({ source, kind, field: 'component', decision: 'rejected', reason: 'backup-not-space-package' })
      continue
    }
    if (kind === 'workflow') {
      rejected += 1
      add({ source, kind, field: 'component', decision: 'rejected', reason: 'workflow-not-representable' })
      continue
    }
    if (kind === 'tool') {
      rejected += 1
      add({ source, kind, field: 'component', decision: 'rejected', reason: 'tool-not-representable' })
      continue
    }
    if (kind === 'routine' || kind === 'memory' || kind === 'metadata') {
      omitted += 1
      add({ source, kind, field: 'component', decision: 'omitted', reason: 'not-a-host-component' })
      continue
    }
    if (kind === 'skill') {
      const directory = source.split('/').slice(0, 2).join('/')
      const info = skillInfos.get(directory)
      if (info === undefined || !info.valid) {
        rejected += 1
        add({ source, kind, field: 'component', decision: 'rejected', reason: info?.reason ?? 'skill-invalid' })
        continue
      }
      const target = `skills/${info.slug}/SKILL.md`
      if (targets.has(target)) {
        rejected += 1
        add({ source, kind, field: 'component', decision: 'rejected', reason: 'skill-name-conflict' })
        continue
      }
      targets.add(target)
      acceptCommon(source, kind)
      add({ source, kind, field: 'name', decision: 'translated', reason: 'slug-normalized' })
      add({ source, kind, field: 'frontmatter', decision: 'preserved' })
      add({ source, kind, field: 'body', decision: 'preserved' })
      files.push({ source, target, kind, content: withName(file.content, info.slug), loaded: true })
      continue
    }
    if (kind === 'agent') {
      const parsed = parseMarkdown(file.content)
      const name = parsed === undefined ? undefined : field(parsed, 'name')
      const description = parsed === undefined ? undefined : field(parsed, 'description')
      if (parsed === undefined || (name ?? '').trim().length === 0 || (description ?? '').trim().length === 0) {
        rejected += 1
        add({ source, kind, field: 'component', decision: 'rejected', reason: 'agent-invalid' })
        continue
      }
      const slug = slugOf(name ?? source)
      const target = `agents/${slug}.md`
      if (targets.has(target)) {
        rejected += 1
        add({ source, kind, field: 'component', decision: 'rejected', reason: 'agent-name-conflict' })
        continue
      }
      targets.add(target)
      acceptCommon(source, kind)
      add({ source, kind, field: 'name', decision: 'translated', reason: 'slug-normalized' })
      add({ source, kind, field: 'frontmatter', decision: 'preserved' })
      add({ source, kind, field: 'body', decision: 'preserved' })
      // The host inherits every tool when the field is absent; keeping the
      // source field preserves the restriction instead of widening it.
      if (hasField(parsed, 'tools')) add({ source, kind, field: 'tools', decision: 'preserved' })
      files.push({ source, target, kind, content: withName(file.content, slug), loaded: true })
      continue
    }
    if (kind === 'resource' && source.startsWith('skills/')) {
      const directory = source.split('/').slice(0, 2).join('/')
      const info = skillInfos.get(directory)
      if (info === undefined || !info.valid) {
        rejected += 1
        add({ source, kind, field: 'component', decision: 'rejected', reason: 'skill-resource-orphan' })
        continue
      }
      const rest = source.split('/').slice(2).join('/')
      const target = `skills/${info.slug}/${rest}`
      if (targets.has(target)) {
        rejected += 1
        add({ source, kind, field: 'component', decision: 'rejected', reason: 'skill-resource-conflict' })
        continue
      }
      targets.add(target)
      acceptCommon(source, kind)
      add({ source, kind, field: 'content', decision: 'preserved' })
      files.push({ source, target, kind, content: file.content, loaded: false })
      continue
    }
    if (kind === 'document' || kind === 'context' || kind === 'resource') {
      const target = `resources/${source}`
      if (targets.has(target)) {
        rejected += 1
        add({ source, kind, field: 'component', decision: 'rejected', reason: 'target-conflict' })
        continue
      }
      targets.add(target)
      acceptCommon(source, kind)
      add({ source, kind, field: 'content', decision: 'preserved' })
      files.push({ source, target, kind, content: file.content, loaded: false })
      continue
    }
    rejected += 1
    add({ source, kind, field: 'component', decision: 'rejected', reason: 'unsupported-kind' })
  }
  const withheld = plan.rejected ?? []
  return {
    files,
    report: {
      host,
      rows,
      accepted: files.length,
      omitted,
      rejected,
      withheld: {
        count: withheld.length,
        reasons: unique(withheld.map(entry => entry.reason)),
      },
      limitations: unique(limitations),
      legacyGenerator: 'retained',
      legacyReason: 'D13-open',
    },
  }
}
