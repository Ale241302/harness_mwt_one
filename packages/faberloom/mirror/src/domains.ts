/**
 * The product domains the mirror carries, with their declared tables. It is the
 * backup domain list plus the domains a backup omits, so a row created on
 * either side of the mirror appears on the other: the Space memory, work flows,
 * context, the Space shares, and the session shares.
 *
 * It restates `FABERLOOM_BACKUP_DOMAINS` deliberately rather than importing it:
 * a snapshot scope and a mirror scope are separate product decisions, and the
 * mirror's list has to stay readable in one place when either changes.
 *
 * The `workspace` registry is deliberately absent. Its records name an absolute
 * folder and the Session identities of the machine that created them, and its
 * owning service builds its ordered view once when it opens and never adopts a
 * row written beside it (the Workspace feed drops an id it never knew), so a
 * carried row would name a folder that does not exist on the other side in a
 * registry that ignores it. The Space is the product's travelling work area and
 * it is carried whole, memory and context included.
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
}
