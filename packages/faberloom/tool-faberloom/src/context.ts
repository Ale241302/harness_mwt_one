/**
 * Model-facing Context tools (`faberloom_context_*`): list, create, edit,
 * read the versions of, restore, approve, reject, and remove the versioned
 * Workspace/Space context. Registered only when the deployment opts in with
 * `Config.contextTools`, because they add request schema.
 * @module @deepseek-ai/dsh-tool-faberloom/src/context
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { SpaceActor } from '@deepseek-ai/dsh-faberloom-spaces'
import type { FaberLoomContext, FaberLoomContextEdit, FaberLoomContextEntry } from '@deepseek-ai/dsh-faberloom-context'

/** One argument value accepted by a context tool executor. */
type ContextArgs = Record<string, unknown>

/** Map one context entry to the tool-facing summary. */
function summarize(entry: FaberLoomContextEntry): Record<string, unknown> {
  return {
    entryId: entry.id,
    title: entry.title,
    spaceId: entry.spaceId ?? '',
    visibility: entry.visibility,
    version: entry.version,
    authorId: entry.authorId,
  }
}

/** Shared output: every context tool renders its entry or its list. */
const CONTEXT_OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      entryId: { type: 'string' },
      title: { type: 'string' },
      spaceId: { type: 'string' },
      visibility: { type: 'string' },
      version: { type: 'number' },
      authorId: { type: 'string' },
      count: { type: 'number' },
      entries: { type: 'array', items: { type: 'object', additionalProperties: true } },
      filename: { type: 'string' },
      content: { type: 'string' },
      created: { type: 'number' },
      skipped: { type: 'number' },
    },
  },
  render: (_args: unknown, value: Record<string, unknown>) => {
    if (typeof value['content'] === 'string') {
      return [{ type: 'text' as const, text: `Contexto exportado en ${asText(value['filename'])}:\n${value['content']}` }]
    }
    if (typeof value['created'] === 'number') {
      return [{ type: 'text' as const, text: `Contexto importado: ${String(value['created'])} creadas, ${asText(value['skipped'])} omitidas.` }]
    }
    if (Array.isArray(value['entries'])) {
      const entries = value['entries'] as readonly Record<string, unknown>[]
      if (entries.length === 0) return [{ type: 'text' as const, text: 'No context entries.' }]
      const lines = entries.map((entry) => {
        const space = asText(entry['spaceId'])
        return `- ${asText(entry['entryId'])} "${asText(entry['title'])}" v${asText(entry['version'])} (${asText(entry['visibility'])}${space.length === 0 ? '' : `, space ${space}`})`
      })
      return [{
        type: 'text' as const,
        text: `${String(entries.length)} context entr${entries.length === 1 ? 'y' : 'ies'}:\n${lines.join('\n')}`,
      }]
    }
    return [{
      type: 'text' as const,
      text: `Context entry ${asText(value['entryId'])} "${asText(value['title'])}" v${asText(value['version'])} · ${asText(value['visibility'])}.`,
    }]
  },
} as const

/** Render one unknown value as text, empty when it carries no string or number. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

/** One context tool declaration. */
interface ContextTool {
  readonly name: string
  readonly description: string
  readonly parameters: ParameterSchemaSpec
  readonly run: (service: FaberLoomContext, actor: SpaceActor, args: ContextArgs) => Promise<Record<string, unknown>>
}

/** The context tools this package registers. */
const CONTEXT_TOOLS: readonly ContextTool[] = [
  {
    name: 'faberloom_context_list',
    description: 'List the context entries the user can see, newest first: id, title, version, visibility, and space.',
    parameters: {},
    run: async (service, actor) => ({ entries: (await service.list({ id: actor.id })).map(summarize), count: 0 }),
  },
  {
    name: 'faberloom_context_create',
    description: 'Create one context entry from the conversation: a fact, rule, or document the Space should remember. In a Space the owner indexes it directly; another member\'s entry starts pending for the owner to approve.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short display title.' },
      body: { type: 'string', required: true, description: 'The context text.' },
      spaceId: { type: 'string', description: 'Space id to attach it to; omit for the personal scope.' },
    },
    run: async (service, actor, args) => summarize(await service.create({ id: actor.id }, {
      title: asText(args.title),
      body: asText(args.body),
      spaceId: typeof args.spaceId === 'string' && args.spaceId.length > 0 ? args.spaceId : null,
    })),
  },
  {
    name: 'faberloom_context_update',
    description: 'Edit one context entry (a new version is appended); a member\'s edit returns the entry to pending.',
    parameters: {
      entryId: { type: 'string', required: true, description: 'Entry id from faberloom_context_list.' },
      title: { type: 'string', description: 'New title.' },
      body: { type: 'string', description: 'New context text.' },
    },
    run: async (service, actor, args) => {
      const edit: FaberLoomContextEdit = {
        ...args.title === undefined ? {} : { title: asText(args.title) },
        ...args.body === undefined ? {} : { body: asText(args.body) },
      }
      return summarize(await service.update({ id: actor.id }, String(args.entryId), edit))
    },
  },
  {
    name: 'faberloom_context_versions',
    description: 'List one context entry\'s version history, newest first.',
    parameters: { entryId: { type: 'string', required: true, description: 'Entry id.' } },
    run: async (service, actor, args) => ({
      entries: (await service.versions({ id: actor.id }, String(args.entryId))).map(version => ({
        entryId: args.entryId,
        title: version.title,
        version: version.version,
        visibility: `by ${version.authorId} at ${version.createdAt}`,
        authorId: version.authorId,
      })),
      count: 0,
    }),
  },
  {
    name: 'faberloom_context_restore',
    description: 'Restore one context entry to an earlier version (a fresh version is appended).',
    parameters: {
      entryId: { type: 'string', required: true, description: 'Entry id.' },
      version: { type: 'number', required: true, description: 'Version number to restore from faberloom_context_versions.' },
    },
    run: async (service, actor, args) => summarize(await service.restore({ id: actor.id }, String(args.entryId), Number(args.version))),
  },
  {
    name: 'faberloom_context_approve',
    description: 'Index one pending context entry into the Space\'s shared context (owner only).',
    parameters: { entryId: { type: 'string', required: true, description: 'Pending entry id.' } },
    run: async (service, actor, args) => summarize(await service.approve({ id: actor.id }, String(args.entryId))),
  },
  {
    name: 'faberloom_context_reject',
    description: 'Keep one pending context entry private to its author (owner only).',
    parameters: { entryId: { type: 'string', required: true, description: 'Pending entry id.' } },
    run: async (service, actor, args) => summarize(await service.reject({ id: actor.id }, String(args.entryId))),
  },
  {
    name: 'faberloom_context_remove',
    description: 'Remove one context entry and its history.',
    parameters: { entryId: { type: 'string', required: true, description: 'Entry id.' } },
    run: async (service, actor, args) => {
      await service.remove({ id: actor.id }, String(args.entryId))
      return { entryId: String(args.entryId), title: '', version: 0, visibility: 'removed' }
    },
  },
  {
    name: 'faberloom_context_export',
    description: 'Export the workspace/space context record as JSON or Markdown, with every version. Restrict it to one Space, or omit the Space for the personal scope plus every Space.',
    parameters: {
      spaceId: { type: 'string', description: 'Space to export; omit for the personal scope plus every Space.' },
      format: { type: 'string', enum: ['json', 'markdown'], description: 'Output format; defaults to json.' },
    },
    run: async (service, actor, args) => {
      const exported = await service.export({ id: actor.id }, {
        ...typeof args.spaceId === 'string' && args.spaceId.length > 0 ? { spaceId: args.spaceId } : {},
        ...args.format === 'markdown' ? { format: 'markdown' as const } : {},
      })
      return { filename: exported.filename, content: exported.content, count: exported.entries }
    },
  },
  {
    name: 'faberloom_context_import',
    description: 'Import a context record produced by faberloom_context_export. An entry whose title already exists in its Space is skipped, so importing twice is idempotent.',
    parameters: {
      payload: { type: 'string', required: true, description: 'The exported JSON body.' },
    },
    run: async (service, actor, args) => {
      const result = await service.import({ id: actor.id }, asText(args.payload))
      return { created: result.created, skipped: result.skipped }
    },
  },
]

/**
 * Register the Context tools on the calling agent's tool registry.
 * @param ctx - context carrying `tools` and the `faberloomContext` service.
 * @param actor - the acting identity, from the deployment config.
 */
export function registerContextTools(ctx: Context, actor: SpaceActor): void {
  const service = (): FaberLoomContext => {
    const mounted = ctx.get('faberloomContext')
    if (mounted === undefined) throw new Error('faberloom: the context service is not mounted')
    return mounted
  }
  for (const tool of CONTEXT_TOOLS) {
    ctx.tools.register(defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      output: CONTEXT_OUTPUT,
      execute: async (args: ContextArgs) => await tool.run(service(), actor, args),
      presentCall: (callArgs: ContextArgs) => ({ card: 'generic', title: tool.name, kind: 'other', rawInput: callArgs }),
    }))
  }
}
