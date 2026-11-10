/**
 * The dated Claude surface matrix. Code and its desktop extension are certified
 * for the recorded version. Chat and Cowork remain open until their own
 * installation, authentication, and cycle are observed; neither inherits Code.
 * @module @deepseek-ai/dsh-faberloom-portable/src/adapters/surfaces
 */

import { portableError } from '../errors.ts'

/** One Claude surface the adapter can package for. */
export type ClaudeSurface = 'claude-code' | 'claude-desktop' | 'claude-chat' | 'claude-cowork'

/** Certification state of one surface. */
export type ClaudeSurfaceStatus = 'certified' | 'open'

/** Installation mechanism a surface consumes. */
export type ClaudeInstall = 'plugin-directory' | 'zip'

/** Authentication route the host owns. */
export type ClaudeAuthRoute = 'local-oauth-loopback' | 'remote-oauth' | 'host-session'

/** One dated row of the Claude matrix. */
export interface ClaudeSurfaceRow {
  /** Surface id. */
  readonly surface: ClaudeSurface
  /** Whether a reviewed installation and cycle exist. */
  readonly status: ClaudeSurfaceStatus
  /** Exact host version the row covers, or `unverified`. */
  readonly hostVersion: string
  /** Installation mechanism. */
  readonly install: ClaudeInstall
  /** Authentication route. */
  readonly auth: ClaudeAuthRoute
  /** Evidence ids that support the row. */
  readonly evidence: readonly string[]
  /** What the row does not claim. */
  readonly limitations: readonly string[]
}

/** The matrix date and its rows, one per surface. */
export const CLAUDE_SURFACE_MATRIX: {
  readonly asOf: string
  readonly rows: readonly ClaudeSurfaceRow[]
} = {
  asOf: '2026-11-10',
  rows: [
    {
      surface: 'claude-code',
      status: 'certified',
      hostVersion: '2.1.126',
      install: 'plugin-directory',
      auth: 'local-oauth-loopback',
      evidence: ['4A.1', '4A.2', '4A.3-code'],
      limitations: [],
    },
    {
      surface: 'claude-desktop',
      status: 'open',
      hostVersion: 'unverified',
      install: 'plugin-directory',
      auth: 'local-oauth-loopback',
      evidence: [],
      limitations: ['desktop-extension-shares-the-code-adapter', 'no-separate-desktop-cycle'],
    },
    {
      surface: 'claude-chat',
      status: 'open',
      hostVersion: 'unverified',
      install: 'zip',
      auth: 'remote-oauth',
      evidence: [],
      limitations: ['remote-endpoint-D02', 'no-certified-chat-install', '4A.3-open'],
    },
    {
      surface: 'claude-cowork',
      status: 'open',
      hostVersion: 'unverified',
      install: 'zip',
      auth: 'host-session',
      evidence: [],
      limitations: ['cowork-host-unverified', 'no-certified-cowork-install', '4A.3-open'],
    },
  ],
}

/**
 * Find one matrix row.
 * @param surface - surface id.
 * @returns the dated row.
 * @throws {Error} when the surface is unknown.
 */
export function claudeSurfaceRow(surface: ClaudeSurface): ClaudeSurfaceRow {
  const row = CLAUDE_SURFACE_MATRIX.rows.find(candidate => candidate.surface === surface)
  if (row === undefined) throw portableError('PORTABLE_ADAPTER_INVALID', `unknown Claude surface ${surface}`)
  return row
}
