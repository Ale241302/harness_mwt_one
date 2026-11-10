/**
 * Claude Code adapter for one portable artifact. The adapter turns the signed
 * portable inventory into a Claude plugin directory: a validated plugin
 * manifest, two FaberLoom skills, the artifact's own resources, and a
 * connection descriptor that names the host-managed work reference. It never
 * packages a bearer token, an executable, or a global token variable; the host
 * resolves the reference to a token at load time.
 * @module @deepseek-ai/dsh-faberloom-portable/src/adapters/claude
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { canonicalJson } from '../canonical.ts'
import { portableError } from '../errors.ts'
import { assertArtifactPath } from '../paths.ts'
import { convertPortable } from './conversion.ts'
import { CLAUDE_SURFACE_MATRIX, claudeSurfaceRow, type ClaudeAuthRoute, type ClaudeSurface, type ClaudeSurfaceStatus } from './surfaces.ts'
import type { ConversionReport, PortablePlan } from '../types.ts'

/** Plugin manifest path inside a Claude plugin directory. */
export const CLAUDE_MANIFEST_PATH = '.claude-plugin/plugin.json'

/** Host id this adapter certifies. */
export const CLAUDE_HOST = 'claude-code' as const

/** Hosts this adapter does not claim. */
export const CLAUDE_UNSUPPORTED = ['claude-chat', 'claude-cowork'] as const

/** One host-managed connection reference. It carries no secret. */
export interface ClaudeConnection {
  /** Opaque work reference id issued by the product host. */
  readonly referenceId: string
  /** Host that owns the reference; the matrix decides what is certified. */
  readonly host: ClaudeSurface
}

/** Everything one Claude package plan needs. */
export interface ClaudeAdapterRequest {
  /** Signed portable manifest, files it inventories, and planner rejections. */
  readonly artifact: Pick<PortablePlan, 'manifest' | 'files' | 'rejected'>
  /** Host-managed connection reference. */
  readonly connection: ClaudeConnection
  /** Exact Claude Code version that will load the package. */
  readonly hostVersion: string
  /** Whether the local product runtime is reachable. */
  readonly runtimeAvailable: boolean
  /** ISO-8601 instant, supplied by the caller for a reproducible package. */
  readonly generatedAt: string
  /** Package version; defaults to `1.0.0`. */
  readonly packageVersion?: string
  /** Surface to package for; defaults to the connection host. */
  readonly surface?: ClaudeSurface
}

/** One file the Claude package writes. */
export interface ClaudePackageFile {
  /** Package-relative path. */
  readonly path: string
  /** File text. */
  readonly content: string
}

/** One artifact file and the package path that carries it. */
export interface ClaudeComponent {
  /** Portable artifact path. */
  readonly source: string
  /** Package-relative path. */
  readonly target: string
  /** Kind the artifact declared. */
  readonly kind: string
  /** Whether Claude Code loads this file as a component or keeps it as a resource. */
  readonly loaded: boolean
}

/** Durable record of one package/load attempt. */
export interface ClaudeLoadRecord {
  /** Host the record belongs to. */
  readonly host: ClaudeSurface
  /** Exact host version. */
  readonly hostVersion: string
  /** Package version. */
  readonly packageVersion: string
  /** Portable content version the package carries. */
  readonly contentVersion: string
  /** Portable manifest digest. */
  readonly manifestDigest: string
  /** Host-managed work reference; never a token. */
  readonly referenceId: string
  /** Whether the runtime was reachable when the package was planned. */
  readonly runtimeAvailable: boolean
  /** `ready` loads components; `draft` is retained without sending anything. */
  readonly state: 'ready' | 'draft'
  /** Whether the host sent a task; a draft never sends. */
  readonly sent: boolean
  /** Whether any Mesa item was simulated; always false. */
  readonly mesa: false
  /** Components the host loads. */
  readonly components: readonly string[]
  /** ISO-8601 instant the record was written. */
  readonly installedAt: string
}

/** Capabilities the package declares before a task starts. */
export interface ClaudeCapabilities {
  /** Whether the surface is certified for Code. */
  readonly code: boolean
  /** Whether the surface is certified for chat. */
  readonly chat: boolean
  /** Whether the surface is certified for Cowork. */
  readonly cowork: boolean
  /** MCP is attached by the host, not by a packaged token. */
  readonly mcp: 'host-managed'
}

/** One complete Claude package plan. */
export interface ClaudePackagePlan {
  /** Ready packages load; draft packages stay local and unsent. */
  readonly state: 'ready' | 'draft'
  /** Files to write when the state is ready. */
  readonly files: readonly ClaudePackageFile[]
  /** The load record written beside the package. */
  readonly load: ClaudeLoadRecord
  /** Capability report shown before a task. */
  readonly capabilities: ClaudeCapabilities
  /** Hosts this package does not claim. */
  readonly unsupported: readonly string[]
  /** Artifact paths mapped to package paths. */
  readonly components: readonly ClaudeComponent[]
  /** Field-level conversion and compatibility report. */
  readonly conversion: ConversionReport
  /** Surface this package targets. */
  readonly surface: ClaudeSurface
  /** Certification state of that surface. */
  readonly surfaceStatus: ClaudeSurfaceStatus
  /** Authentication route the host owns. */
  readonly authRoute: ClaudeAuthRoute
  /** Matrix date this package was planned against. */
  readonly matrixAsOf: string
  /** Components the conversion omitted or rejected. */
  readonly ignored: readonly string[]
  /** Draft text when the runtime is absent, or null. */
  readonly draft: string | null
}

/** Result of the synthetic host load. */
export interface ClaudeLoadResult {
  /** Whether the manifest and skills are well formed. */
  readonly valid: boolean
  /** Whether a host actually loaded the package. */
  readonly loaded: boolean
  /** Host version recorded by the loader. */
  readonly hostVersion: string
  /** Components the loader found. */
  readonly components: readonly string[]
  /** Why the package is invalid, empty when valid. */
  readonly reasons: readonly string[]
}

/** Fold a display name into a plugin-safe slug. */
function slugOf(value: string): string {
  const folded = value
    .toLocaleLowerCase('es')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 64)
    .replace(/-+$/gu, '')
  return folded.length === 0 ? 'space' : folded
}

/**
 * Validate the host-managed reference. A reference is an opaque id, never a
 * bearer token; a token-shaped value fails before a package exists.
 * @param referenceId - reference id from the host.
 * @returns the id.
 * @throws {Error} `PORTABLE_ADAPTER_INVALID` when the id is missing or token-like.
 */
function assertReference(referenceId: string): string {
  const value = referenceId.trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw portableError('PORTABLE_ADAPTER_INVALID', 'the connection reference is not an opaque id')
  }
  if (/^(?:fbl_|sk-|Bearer\s)/iu.test(value)) {
    throw portableError('PORTABLE_ADAPTER_INVALID', 'a token must never be packaged as a connection reference')
  }
  return value
}

/** Capability report for one surface. */
function capabilities(surface: ClaudeSurface): ClaudeCapabilities {
  const certified = claudeSurfaceRow(surface).status === 'certified'
  return {
    code: surface === 'claude-code' && certified,
    chat: surface === 'claude-chat' && certified,
    cowork: surface === 'claude-cowork' && certified,
    mcp: 'host-managed',
  }
}

/** Render the skill that describes one space's portable material. */
function spaceSkill(manifest: PortablePlan['manifest']): string {
  return `---\nname: faberloom-space\ndescription: Usa el material autorizado del espacio FaberLoom y cita la revisión fijada.\n---\n\n# Espacio FaberLoom\n\nEste paquete pertenece al espacio **${manifest.space.title}** y a la revisión fijada \`${manifest.editorialRevision}\`.\n\n- El contenido autorizado está en \`resources/\`; no inventes archivos que no aparezcan allí.\n- Cita la revisión y el digest \`${manifest.digest}\` cuando resumas o propongas un cambio.\n- No leas ni publiques contenido fuera de este paquete.\n- Claude Code es la superficie certificada. Chat web y Cowork no están certificados por este adaptador.\n`
}

/** Render the skill that describes the proposal boundary. */
function proposalSkill(): string {
  return [
    '---',
    'name: faberloom-proposals',
    'description: Prepara propuestas de conocimiento para la Mesa sin aprobarlas.',
    '---',
    '',
    '# Propuestas FaberLoom',
    '',
    'Usa la herramienta MCP `faberloom_proposal_submit` con `archivo`, `versionBase`, `cambio`, `motivo`, `evidencia`, `claveCliente` y `title`.',
    '',
    '- La propuesta entra como pendiente; **nunca** la apruebes desde aquí.',
    '- Si falta el runtime local o la conexión, deja el borrador sin enviar y dilo.',
    '- No simules una Mesa ni inventes un id de propuesta.',
    '- La aprobación y la publicación pertenecen a una persona en Mesa.',
    '',
  ].join('\n')
}

/** Render the instruction document shown to Claude Code. */
function instructions(manifest: PortablePlan['manifest'], load: ClaudeLoadRecord): string {
  return `# FaberLoom portable space\n\n- Space: **${manifest.space.title}** (\`${manifest.space.id}\`)\n- Editorial revision: \`${manifest.editorialRevision}\`\n- Content version: \`${manifest.contentVersion}\`\n- Manifest digest: \`${manifest.digest}\`\n- Host: \`${load.host}\` ${load.hostVersion}\n- Host-managed reference: \`${load.referenceId}\`\n\n## Capabilities before a task\n\n- Claude Code: supported.\n- Claude chat: not certified; do not load this package there.\n- Cowork: not certified; do not load this package there.\n- MCP: attached by the host from the reference above; no token is packaged.\n\n${load.runtimeAvailable ? 'The local runtime is reachable.' : 'The local runtime is absent. Keep any draft unsent; do not simulate Mesa.'}\n\n## Resources\n\nOnly files under \`resources/\` and the skills in \`skills/\` are authorized. A file that is not in the package is not part of the space.\n`
}

/**
 * Plan one Claude Code plugin from a signed portable artifact.
 * @param request - artifact, host-managed reference, host version, and runtime state.
 * @returns the package files, load record, capabilities, and component map.
 * @throws {Error} `PORTABLE_ADAPTER_INVALID` for a token-shaped reference or unsafe path.
 */
export function planClaudePackage(request: ClaudeAdapterRequest): ClaudePackagePlan {
  const referenceId = assertReference(request.connection.referenceId)
  const surface = request.surface ?? request.connection.host
  const row = claudeSurfaceRow(surface)
  if (row.status === 'certified' && request.hostVersion.trim() !== row.hostVersion) {
    throw portableError('PORTABLE_ADAPTER_INVALID', `${surface} is certified only for version ${row.hostVersion}`)
  }
  if (request.connection.host !== surface) {
    throw portableError('PORTABLE_ADAPTER_INVALID', 'the connection host and the requested surface differ')
  }
  if (request.hostVersion.trim().length === 0) {
    throw portableError('PORTABLE_ADAPTER_INVALID', 'the host version is required')
  }
  if (Number.isNaN(Date.parse(request.generatedAt))) {
    throw portableError('PORTABLE_ADAPTER_INVALID', 'generatedAt is not a date')
  }
  const packageVersion = request.packageVersion ?? '1.0.0'
  const { manifest } = request.artifact
  const converted = convertPortable(request.artifact)
  const ignored = converted.report.rows
    .filter(entry => entry.decision === 'omitted' || entry.decision === 'rejected')
    .map(entry => entry.source)
  const components: ClaudeComponent[] = []
  const packageFiles: ClaudePackageFile[] = []
  const targets = new Set<string>([
    'skills/faberloom-space/SKILL.md',
    'skills/faberloom-proposals/SKILL.md',
    CLAUDE_MANIFEST_PATH,
    'CLAUDE.md',
    'faberloom/connection.json',
    'faberloom/load.json',
    'faberloom/portable-manifest.json',
    'faberloom/conversion.json',
  ])
  for (const file of converted.files) {
    const source = assertArtifactPath(file.source)
    const target = assertArtifactPath(file.target)
    if (targets.has(target)) {
      throw portableError('PORTABLE_ADAPTER_INVALID', `${target} is claimed by more than one component`)
    }
    targets.add(target)
    packageFiles.push({ path: target, content: file.content })
    components.push({ source, target, kind: file.kind, loaded: file.loaded })
  }
  const load: ClaudeLoadRecord = {
    host: surface,
    hostVersion: request.hostVersion.trim(),
    packageVersion,
    contentVersion: manifest.contentVersion,
    manifestDigest: manifest.digest,
    referenceId,
    runtimeAvailable: request.runtimeAvailable,
    state: request.runtimeAvailable ? 'ready' : 'draft',
    sent: false,
    mesa: false,
    components: components.filter(component => component.loaded).map(component => component.target),
    installedAt: request.generatedAt,
  }
  if (row.status !== 'certified') {
    const draft = `# Borrador FaberLoom\n\nLa superficie ${surface} sigue abierta: ${row.limitations.join(', ')}. No se envió ninguna tarea ni se simuló Mesa.\n\nEspacio: ${manifest.space.title}\nRevisión: ${manifest.editorialRevision}\nAutenticación: ${row.auth}\n`
    return {
      state: 'draft',
      files: [{ path: 'faberloom/draft.md', content: draft }],
      load: { ...load, state: 'draft', components: [] },
      capabilities: capabilities(surface),
      unsupported: [...row.limitations, ...CLAUDE_UNSUPPORTED],
      components: [],
      conversion: converted.report,
      surface,
      surfaceStatus: row.status,
      authRoute: row.auth,
      matrixAsOf: CLAUDE_SURFACE_MATRIX.asOf,
      ignored,
      draft,
    }
  }
  if (!request.runtimeAvailable) {
    const draft = `# Borrador FaberLoom\n\nRuntime local ausente. No se envió ninguna tarea ni se simuló Mesa.\n\nEspacio: ${manifest.space.title}\nRevisión: ${manifest.editorialRevision}\n`
    return {
      state: 'draft',
      files: [{ path: 'faberloom/draft.md', content: draft }],
      load: { ...load, components: [] },
      capabilities: capabilities(surface),
      unsupported: [...CLAUDE_UNSUPPORTED],
      components: [],
      conversion: converted.report,
      surface,
      surfaceStatus: row.status,
      authRoute: row.auth,
      matrixAsOf: CLAUDE_SURFACE_MATRIX.asOf,
      ignored,
      draft,
    }
  }
  const pluginManifest = {
    name: `faberloom-${slugOf(manifest.space.title)}`,
    version: packageVersion,
    description: `FaberLoom space ${manifest.space.title} at revision ${manifest.editorialRevision}`,
    author: { name: 'FaberLoom' },
    skills: './skills',
  }
  packageFiles.push(
    { path: CLAUDE_MANIFEST_PATH, content: canonicalJson(pluginManifest) },
    { path: 'CLAUDE.md', content: instructions(manifest, load) },
    { path: 'skills/faberloom-space/SKILL.md', content: spaceSkill(manifest) },
    { path: 'skills/faberloom-proposals/SKILL.md', content: proposalSkill() },
    { path: 'faberloom/connection.json', content: canonicalJson({ schemaVersion: 1, host: surface, referenceId, mcpServer: 'faberloom', managedBy: 'host' }) },
    { path: 'faberloom/load.json', content: canonicalJson(load) },
    { path: 'faberloom/portable-manifest.json', content: canonicalJson(manifest) },
    { path: 'faberloom/conversion.json', content: canonicalJson(converted.report) },
  )
  return {
    state: 'ready',
    files: packageFiles,
    load,
    capabilities: capabilities(surface),
    unsupported: [...CLAUDE_UNSUPPORTED],
    components,
    conversion: converted.report,
    surface,
    surfaceStatus: row.status,
    authRoute: row.auth,
    matrixAsOf: CLAUDE_SURFACE_MATRIX.asOf,
    ignored,
    draft: null,
  }
}

/**
 * Write one ready package into a directory. A draft writes only its draft file
 * and never a plugin manifest.
 * @param plan - package plan.
 * @param target - directory to create or reuse.
 * @returns the directory and files written.
 * @throws {Error} `PORTABLE_ADAPTER_INVALID` when a path escapes the target.
 */
export function installClaudePackage(plan: ClaudePackagePlan, target: string): {
  readonly target: string
  readonly written: readonly string[]
} {
  const root = resolve(target)
  if (plan.state === 'draft' && existsSync(root) && readdirSync(root).length > 0) {
    throw portableError('PORTABLE_ADAPTER_INVALID', 'a draft cannot be installed over an existing package')
  }
  mkdirSync(root, { recursive: true })
  const written: string[] = []
  for (const file of plan.files) {
    const path = assertArtifactPath(file.path)
    const absolute = resolve(root, path)
    const rel = relative(root, absolute)
    if (rel.startsWith('..') || rel.startsWith('/') || rel.length === 0) {
      throw portableError('PORTABLE_ADAPTER_INVALID', `${file.path} escapes the package directory`)
    }
    mkdirSync(dirname(absolute), { recursive: true })
    writeFileSync(absolute, file.content, 'utf8')
    written.push(path)
  }
  return { target: root, written }
}

/**
 * Synthetic host loader used by the installation test. It validates the package
 * shape and reports components without claiming the package was installed; a
 * manifest check is not an installation.
 * @param target - package directory.
 * @returns validation and the components the loader would register.
 */
export function validateClaudePackage(target: string, expectedSurface?: ClaudeSurface): ClaudeLoadResult {
  const root = resolve(target)
  const reasons: string[] = []
  const components: string[] = []
  let manifest: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, CLAUDE_MANIFEST_PATH), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object')
    manifest = parsed as Record<string, unknown>
  } catch {
    return { valid: false, loaded: false, hostVersion: '', components: [], reasons: ['manifest-missing'] }
  }
  if (typeof manifest['name'] !== 'string' || manifest['name'].length === 0) reasons.push('name')
  if (typeof manifest['version'] !== 'string' || manifest['version'].length === 0) reasons.push('version')
  if (manifest['skills'] !== './skills') reasons.push('skills')
  for (const skill of ['faberloom-space', 'faberloom-proposals']) {
    try {
      if (readFileSync(join(root, 'skills', skill, 'SKILL.md'), 'utf8').trim().length === 0) reasons.push(`skill:${skill}`)
      else components.push(`skills/${skill}/SKILL.md`)
    } catch {
      reasons.push(`skill:${skill}`)
    }
  }
  try {
    for (const entry of readdirSync(join(root, 'skills'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const path = `skills/${entry.name}/SKILL.md`
      if (components.includes(path)) continue
      try {
        if (readFileSync(join(root, path), 'utf8').trim().length > 0) components.push(path)
      } catch {
        // A directory without SKILL.md is not a loadable skill.
      }
    }
  } catch {
    // The required two skills above already report the missing directory.
  }
  try {
    for (const entry of readdirSync(join(root, 'agents'), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const path = `agents/${entry.name}`
      if (readFileSync(join(root, path), 'utf8').trim().length > 0) components.push(path)
    }
  } catch {
    // A package without agents is valid.
  }
  let hostVersion = ''
  let host = ''
  try {
    const load: unknown = JSON.parse(readFileSync(join(root, 'faberloom/load.json'), 'utf8'))
    if (typeof load === 'object' && load !== null && !Array.isArray(load)) {
      const value = (load as Record<string, unknown>)['hostVersion']
      hostVersion = typeof value === 'string' ? value : ''
      const recorded = (load as Record<string, unknown>)['host']
      host = typeof recorded === 'string' ? recorded : ''
    }
  } catch {
    reasons.push('load-record')
  }
  if (hostVersion.length === 0) reasons.push('host-version')
  if (expectedSurface !== undefined && host !== expectedSurface) reasons.push('host-mismatch')
  return { valid: reasons.length === 0, loaded: false, hostVersion, components, reasons }
}

/**
 * Synthetic host load. It proves a validated manifest is not an installation:
 * the caller must write the package first, and the loader registers components
 * only when the exact host version matches.
 * @param target - installed package directory.
 * @param expectedHostVersion - host version that must match the load record.
 * @returns the load result.
 */
export function loadClaudePackage(target: string, expectedHostVersion: string): ClaudeLoadResult {
  const validation = validateClaudePackage(target)
  if (!validation.valid) return validation
  if (validation.hostVersion !== expectedHostVersion) {
    return { ...validation, loaded: false, reasons: ['host-version-mismatch'] }
  }
  return { ...validation, loaded: true }
}

/**
 * Create one empty installation directory outside the checkout.
 * @param parent - temporary parent directory.
 * @returns the new package directory.
 */
export function newClaudePackageDirectory(parent: string): string {
  return mkdtempSync(join(parent, 'faberloom-claude-'))
}

/**
 * Remove one installed package. The source artifact and any product records are
 * outside this directory; this function removes only the package.
 * @param target - package directory.
 * @throws {Error} `PORTABLE_ADAPTER_INVALID` when the directory carries no package marker.
 */
export function removeClaudePackage(target: string): void {
  const root = resolve(target)
  const packageMarker = join(root, 'faberloom/load.json')
  const draftMarker = join(root, 'faberloom/draft.md')
  if (!existsSync(packageMarker) && !existsSync(draftMarker)) {
    throw portableError('PORTABLE_ADAPTER_INVALID', `${root} is not a Claude package`)
  }
  rmSync(root, { recursive: true, force: true })
}
