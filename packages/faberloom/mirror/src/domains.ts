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
 *
 * The MCP token table is deliberately absent too. A token names the installation
 * that minted it: copying it to the other home would make the deployment's
 * token index claim the desktop's token, and a public call would act on the
 * web home instead of the PC. Tokens are minted and revoked where they are used.
 * @module @deepseek-ai/dsh-faberloom-mirror/src/domains
 */

/** Every product domain the mirror carries, in the order it traverses them. */
export const FABERLOOM_MIRROR_DOMAINS: Readonly<Record<string, readonly string[]>> = {
  faberloom_spaces: ['spaces', 'files', 'memory'],
  // The deployment baseline and the copies materialized from console shares stay
  // in the home that holds them: every installation seeds or imports its own, so
  // carrying them left the peer with two rows of the same name.
  faberloom_agents: ['models', 'agents', 'selections', 'outcomes'],
  faberloom_board: ['items'],
  // Definitions travel; executions do not. An execution is a run of one host:
  // mirroring the `executions` row made the desktop and the VPS resume the same
  // wait and both send the same mail. Each host starts its own runs, keyed by
  // its own triggers, and only `routines`/`routine_versions` are shared.
  faberloom_routines: ['routines', 'routine_versions'],
  faberloom_memory: ['teachings', 'teaching_versions', 'performance', 'late_errors'],
  faberloom_grants: ['grants'],
  faberloom_connections: ['connections'],
  faberloom_inbound: ['cursors'],
  faberloom_workflows: ['workflows', 'versions', 'pending'],
  faberloom_context: ['entries', 'versions'],
  faberloom_shares: ['grants', 'content'],
  // Session shares are deliberately absent. A tenant's `sessions` rows are
  // around a megabyte each (the transcripts), and carrying them made every
  // two-minute cycle fetch and rewrite tens of megabytes even when only a
  // routine had changed. Sessions already travel through the console's own
  // sharing path; the mirror's job is the product rows that decide what runs
  // where: routines, Work Flows, grants, connections, contexts, and Spaces.
}
