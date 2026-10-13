/**
 * Model-facing workspace file tools (`faberloom_files_*`): create, rename, and
 * delete inside the calling session's workspace.
 *
 * Every call goes through the mounted `workspaceFiles` capability and the
 * session's own workspace root, never through a private copy of the rules, so
 * a path the model writes is the same root-confined path the Files panel
 * mutates and the same one the reads serve.
 * @module @deepseek-ai/dsh-tool-faberloom/src/workspace
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { WorkspaceFileMutation, WorkspaceFileScope, WorkspaceFiles } from '@deepseek-ai/dsh-api-workspace-files'

/** The workspace file capability the tools call, or a failure naming the missing mount. */
function workspaceFiles(ctx: Context): WorkspaceFiles {
  const mounted = ctx.get('workspaceFiles')
  if (mounted === undefined) throw new Error('faberloom: the workspace file service is not mounted')
  return mounted
}

/** The session a call serves, as the tools read it off the execution. */
interface CallerSession {
  readonly id: string
  readonly header: { readonly cwd?: string | undefined }
}

/**
 * The workspace scope one call acts in: the calling session's own root. A
 * session without a cwd falls back to the deployment's `workspace-write` root,
 * which is the same fallback the Host's wire lookup applies, so both name one
 * workspace.
 * @param ctx - context carrying the sandbox policy that owns the fallback root.
 * @param session - the session the call serves.
 * @returns the session-scoped workspace root.
 */
function scopeOf(ctx: Context, session: CallerSession): WorkspaceFileScope {
  const root = session.header.cwd ?? ctx.get('sandboxPolicy')?.workspaceRoot
  if (root === undefined) {
    throw new Error('faberloom: this session has no workspace root, so there is nothing to change')
  }
  return { sessionId: session.id as WorkspaceFileScope['sessionId'], workspaceRoot: root }
}

/**
 * The scope of the call's own session, or a failure when the call carries none.
 * @param ctx - context carrying the sandbox policy.
 * @param exec - the running execution.
 * @returns the session-scoped workspace root.
 */
function callScope(ctx: Context, exec: { agent?: { session: CallerSession } | undefined }): WorkspaceFileScope {
  const session = exec.agent?.session
  if (session === undefined) {
    throw new Error('faberloom: this call has no session, so it has no workspace to change')
  }
  return scopeOf(ctx, session)
}

/**
 * The full path a rename's new name produces, or the refusal for a name that is
 * not one path segment. A name is the entry's last segment: letting `..` or a
 * separator through would change a different entry than the one named.
 * @param path - the entry's current workspace path.
 * @param name - the requested new name.
 * @returns the entry's new workspace path.
 */
function renamedPath(path: string, name: string): string {
  if (name.length === 0 || name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    throw new Error(`faberloom: "${name}" is not a single file or folder name`)
  }
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut < 0 ? name : `${path.slice(0, cut + 1)}${name}`
}

/** The model-facing verb of each mutation. */
const MUTATION_VERB: Record<WorkspaceFileMutation['operation'], string> = {
  'created-file': 'Created file',
  'created-directory': 'Created folder',
  moved: 'Renamed',
  removed: 'Deleted',
}

/**
 * One tool argument as a string, or the empty string when the call omitted it
 * or carried a non-string value. Tool arguments are model input, so this is the
 * validation boundary the typed parameters cannot provide.
 * @param args - the validated argument record.
 * @param key - the parameter's name.
 * @returns the string argument, or an empty string.
 */
function text(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value : ''
}

/**
 * The model-facing line naming one mutation's result: what changed, and where.
 */
function mutationText(mutation: WorkspaceFileMutation): string {
  const what = mutation.operation === 'moved' && mutation.from !== undefined
    ? `${MUTATION_VERB.moved} ${mutation.from} to ${mutation.path}`
    : `${MUTATION_VERB[mutation.operation]} ${mutation.path}`
  return `${what} at ${mutation.absolutePath}.`
}

/** The output schema and render every workspace file tool shares. */
const MUTATION_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      operation: { type: 'string', required: true },
      path: { type: 'string', required: true },
      absolutePath: { type: 'string', required: true },
      from: { type: 'string' },
    },
  },
  render: (_args: unknown, value: WorkspaceFileMutation) => [{ type: 'text' as const, text: mutationText(value) }],
} as const

/** The mutation each registered tool performs, in the caller's scope. */
interface WorkspaceTool {
  readonly name: string
  readonly description: string
  readonly parameters: ParameterSchemaSpec
  readonly run: (
    files: WorkspaceFiles,
    scope: WorkspaceFileScope,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ) => Promise<WorkspaceFileMutation>
}

/** The workspace file tools this package registers. */
const WORKSPACE_TOOLS: readonly WorkspaceTool[] = [
  {
    name: 'faberloom_files_create',
    description: 'Create one file or one folder inside this session\'s workspace. The path is relative to the workspace root (or absolute inside it) and its missing parent folders are created. A name that is already taken is refused; nothing is overwritten.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative path of the new file or folder, such as "informes/2026.md".' },
      kind: { type: 'string', required: true, enum: ['file', 'directory'], description: 'Whether to create a file or a folder.' },
      content: { type: 'string', description: 'Complete text content of the new file; only for kind=file, empty when omitted.' },
    },
    run: async (files, scope, args, signal) => {
      const path = text(args, 'path')
      return text(args, 'kind') === 'directory'
        ? await files.createDirectory(scope, path, signal)
        : await files.createFile(scope, path, text(args, 'content'), signal)
    },
  },
  {
    name: 'faberloom_files_rename',
    description: 'Rename one file or folder inside this session\'s workspace, keeping it in the same folder. The new name replaces the last path segment; a name already taken in that folder is refused unless overwrite is set.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative path of the file or folder to rename.' },
      name: { type: 'string', required: true, description: 'The new name: one path segment, without a separator.' },
      overwrite: { type: 'boolean', description: 'Replace an entry that already has the new name; omitted refuses it.' },
    },
    run: async (files, scope, args, signal) => {
      const path = text(args, 'path')
      return await files.move(
        scope,
        path,
        renamedPath(path, text(args, 'name')),
        args['overwrite'] === true ? { overwrite: true } : {},
        signal,
      )
    },
  },
  {
    name: 'faberloom_files_delete',
    description: 'Delete one file or one folder inside this session\'s workspace. A folder that still has contents is refused; set recursive to delete it with everything inside it.',
    parameters: {
      path: { type: 'string', required: true, description: 'Workspace-relative path of the file or folder to delete.' },
      recursive: { type: 'boolean', description: 'Delete a non-empty folder with its contents; omitted refuses a non-empty folder.' },
    },
    run: async (files, scope, args, signal) => await files.removePath(
      scope,
      text(args, 'path'),
      args['recursive'] === true ? { recursive: true } : {},
      signal,
    ),
  },
]

/**
 * Register the workspace file tools on the calling agent's tool registry.
 * @param ctx - context carrying `tools` and, through `ctx.get`, the workspace file capability.
 */
export function registerWorkspaceTools(ctx: Context): void {
  for (const tool of WORKSPACE_TOOLS) {
    ctx.tools.register(defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      output: MUTATION_OUTPUT,
      execute: async (args: Record<string, unknown>, exec) => await tool.run(
        workspaceFiles(ctx),
        callScope(ctx, exec),
        args,
        exec.signal,
      ),
      presentCall: (callArgs: Record<string, unknown>) => ({ card: 'generic', title: tool.name, kind: 'other', rawInput: callArgs }),
    }))
  }
}
