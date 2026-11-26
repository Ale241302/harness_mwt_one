/**
 * Workspace store: the single cached overview the FaberLoom panels read. The
 * plugin's apply world owns every read and write through the generated Remote
 * API and publishes the result here, so a mutation refreshes every panel at
 * once instead of each panel refetching on its own.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { FaberLoomOverview } from '@deepseek-ai/dsh-faberloom-view/types'

/** A Work Flow the tablero asks the Workflows panel to open. */
export interface WorkflowTarget {
  /** Work flow to select. */
  readonly workflowId: string
  /** Space the flow belongs to, or null for the personal scope. */
  readonly spaceId: string | null
}

/** Reading state plus the last successful overview. */
export interface WorkspaceState {
  /** Read state; `ready` always carries an overview. */
  status: 'loading' | 'ready' | 'error'
  /** Last overview returned by the host, or null before the first success. */
  overview: FaberLoomOverview | null
  /** Message of the last failed read or write, cleared on the next success. */
  lastError: string | null
  /** Work flow another panel asked to open, consumed once by the Workflows screen. */
  workflowTarget: WorkflowTarget | null
}

/** Declared action shape giving the exported factory a stable return type. */
type WorkspaceActions = {
  /** Mark a read in flight without discarding the current rows. */
  setLoading: (draft: WorkspaceState) => void
  /** Publish a fresh overview from a read or write. */
  setOverview: (draft: WorkspaceState, overview: FaberLoomOverview) => void
  /** Mark the last operation as failed with the host's message. */
  setError: (draft: WorkspaceState, message: string) => void
  /** Ask the Workflows panel to open one flow. */
  openWorkflow: (draft: WorkspaceState, target: WorkflowTarget) => void
  /** Drop the pending target once the Workflows panel selected it. */
  clearWorkflowTarget: (draft: WorkspaceState) => void
}

/**
 * Declares the workspace state and write surface.
 * @returns the store handle declared by the panel registrations.
 */
export function createWorkspaceStore(): EngineStoreHandle<WorkspaceState, WorkspaceActions> {
  return defineStore({
    init: (): WorkspaceState => ({ status: 'loading', overview: null, lastError: null, workflowTarget: null }),
    actions: {
      setLoading: (d) => { d.status = 'loading' },
      setOverview: (d, overview) => { d.status = 'ready'; d.overview = overview; d.lastError = null },
      setError: (d, message) => { d.status = 'error'; d.lastError = message },
      openWorkflow: (d, target) => { d.workflowTarget = target },
      clearWorkflowTarget: (d) => { d.workflowTarget = null },
    },
  })
}
