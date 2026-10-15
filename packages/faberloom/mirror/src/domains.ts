/**
 * The product domains the mirror carries, with their declared tables. It is the
 * backup domain list plus the domains a backup omits, so a row created on
 * either side of the mirror appears on the other: the Space memory, work flows,
 * context, the Space shares, and the workspace entity.
 *
 * It restates `FABERLOOM_BACKUP_DOMAINS` deliberately rather than importing it:
 * a snapshot scope and a mirror scope are separate product decisions, and the
 * mirror's list has to stay readable in one place when either changes.
 * @module @deepseek-ai/dsh-faberloom-mirror/src/domains
 */

/** Every product domain the mirror carries, in the order it traverses them. */
export const FABERLOOM_MIRROR_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  faberloom_spaces: ['spaces', 'files', 'memory'],
  faberloom_agents: ['models', 'agents', 'selections', 'outcomes'],
  faberloom_board: ['items'],
  faberloom_routines: ['routines', 'routine_versions', 'executions', 'effects', 'sources', 'event_keys'],
  faberloom_memory: ['teachings', 'teaching_versions', 'performance', 'late_errors'],
  faberloom_grants: ['grants'],
  faberloom_connections: ['connections'],
  faberloom_mcp: ['tokens'],
  faberloom_inbound: ['cursors'],
  faberloom_workflows: ['workflows', 'versions', 'pending'],
  faberloom_context: ['entries', 'versions'],
  faberloom_shares: ['grants', 'content'],
  faberloom_session_shares: ['sessions'],
  workspace: ['workspaces'],
}
