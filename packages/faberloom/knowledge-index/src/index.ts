/**
 * The knowledge index (`ctx.spaceIndex`): ranks the actor's spaces for a query
 * through an optional embeddings endpoint, the Knowledge Hub markdown corpus
 * under `knowledgeRoot`, and a lexical fallback over each space's title,
 * context map, curated context entries, memory, and attached-file text. A
 * disabled or failing endpoint falls back to the lexical ranker so a search
 * never fails; the Knowledge Hub expands the query with the terms of the docs
 * that best match it.
 * @module @deepseek-ai/dsh-faberloom-knowledge-index
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SpaceIndex, SpaceIndexEntry, SpaceMatch } from '@deepseek-ai/dsh-faberloom-spaces'

/** Score added when a query token matches the space title. */
const TITLE_WEIGHT = 3

/** Score added when a query token matches any other scored text. */
const CONTEXT_WEIGHT = 2

/** Score added when an expansion term from the Knowledge Hub matches. */
const KNOWLEDGE_WEIGHT = 2

/** Deployment configuration for the knowledge index. */
export interface Config {
  /** Root of the Knowledge Hub markdown tree to read for query expansion; empty disables it. */
  knowledgeRoot?: string
  /** Embeddings endpoint (OpenAI-compatible `POST { model, input }`); empty disables embeddings. */
  embeddingUrl?: string
  /** Embeddings model id sent to the endpoint. */
  embeddingModel?: string
  /** Whether a failing embeddings endpoint falls back to lexical ranking. Defaults to `true`. */
  lexicalFallback?: boolean
  /** Most Knowledge Hub documents read for query expansion. */
  maxKnowledgeDocs?: number
}

/** Schemastery configuration for the knowledge index. */
export const Config: z<Config> = z.object({
  knowledgeRoot: z.string().default(''),
  embeddingUrl: z.string().default(''),
  embeddingModel: z.string().default(''),
  lexicalFallback: z.boolean().default(true),
  maxKnowledgeDocs: z.natural().min(1).default(200),
})

/**
 * Fold one text for language-tolerant comparison: lowercased in Spanish and
 * stripped of combining diacritics.
 * @param value - the text to fold.
 * @returns the folded text.
 */
function foldText(value: string): string {
  return value.toLocaleLowerCase('es').normalize('NFD').replace(/\p{Diacritic}/gu, '')
}

/**
 * Split a text into folded, non-empty terms.
 * @param text - the raw text.
 * @returns the folded terms.
 */
function normalizeTerms(text: string): string[] {
  return foldText(text).split(/[^\p{L}\p{N}]+/u).filter(token => token.length > 0)
}

/** Cosine similarity of two equal-length vectors, or `0` when either is empty. */
function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  const length = Math.min(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0
    const b = right[index] ?? 0
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  return leftNorm === 0 || rightNorm === 0 ? 0 : dot / Math.sqrt(leftNorm * rightNorm)
}

/**
 * The knowledge index service: ranks spaces through embeddings, the Knowledge
 * Hub, and a lexical fallback.
 */
export class FaberLoomKnowledgeIndex extends Service implements SpaceIndex {
  private knowledgeCache: readonly { readonly terms: ReadonlySet<string> }[] | undefined

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - the Knowledge Hub root and embeddings endpoint.
   */
  constructor(ctx: Context, private readonly config: Config = {}) {
    super(ctx, 'spaceIndex')
  }

  /**
   * Rank the readable spaces for a query.
   * @param entries - readable, non-archived candidate entries.
   * @param query - free-text query; an empty query lists recent spaces.
   * @param limit - most matches to return.
   * @returns matches, best score first, then most recent first.
   */
  async rank(entries: readonly SpaceIndexEntry[], query: string, limit: number): Promise<SpaceMatch[]> {
    const tokens = normalizeTerms(query)
    if (tokens.length === 0) return recent(entries, limit)
    const embedded = await this.embedRank(entries, query, limit).catch((error: unknown) => {
      if (this.config.lexicalFallback === false) throw error
      return undefined
    })
    if (embedded !== undefined) return embedded
    return rankLexically(entries, tokens, this.expansionTerms(tokens), limit)
  }

  /**
   * Read the Knowledge Hub markdown tree once and cache each document's folded
   * terms. An absent root, or a read failure, contributes no documents.
   * @returns one term set per read document.
   */
  private knowledgeDocs(): readonly { readonly terms: ReadonlySet<string> }[] {
    if (this.knowledgeCache !== undefined) return this.knowledgeCache
    const docs: { terms: ReadonlySet<string> }[] = []
    const root = this.config.knowledgeRoot
    if (root !== undefined && root.length > 0) {
      const max = this.config.maxKnowledgeDocs ?? 200
      const walk = (dir: string): void => {
        if (docs.length >= max) return
        let names: string[]
        try { names = readdirSync(dir) } catch { return }
        for (const name of names) {
          if (docs.length >= max) return
          const path = join(dir, name)
          let directory = false
          try { directory = statSync(path).isDirectory() } catch { continue }
          if (directory) { walk(path); continue }
          if (!name.endsWith('.md')) continue
          try { docs.push({ terms: new Set(normalizeTerms(readFileSync(path, 'utf8'))) }) } catch { continue }
        }
      }
      walk(root)
    }
    this.knowledgeCache = docs
    return docs
  }

  /**
   * Expand the query with the terms of the Knowledge Hub documents that match
   * it, minus the query's own terms, so a Space sharing a matched document's
   * vocabulary is boosted.
   * @param tokens - the folded query terms.
   * @returns the expansion terms.
   */
  private expansionTerms(tokens: readonly string[]): ReadonlySet<string> {
    const query = new Set(tokens)
    const expansion = new Set<string>()
    for (const doc of this.knowledgeDocs()) {
      if (!tokens.some(token => doc.terms.has(token))) continue
      for (const term of doc.terms) if (!query.has(term)) expansion.add(term)
    }
    return expansion
  }

  /**
   * Rank through the configured embeddings endpoint. Returns `undefined` when
   * no endpoint is configured or the response is malformed, so the caller
   * falls back; a non-ok HTTP status throws so a misconfigured endpoint is
   * not silently ignored.
   * @param entries - readable candidate entries.
   * @param query - free-text query.
   * @param limit - most matches to return.
   * @returns matches, best cosine first, or `undefined` without an endpoint.
   */
  private async embedRank(entries: readonly SpaceIndexEntry[], query: string, limit: number): Promise<SpaceMatch[] | undefined> {
    const url = this.config.embeddingUrl
    if (url === undefined || url.length === 0) return undefined
    const docs = entries.map(entry => entryText(entry))
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.config.embeddingModel, input: [query, ...docs] }),
      signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) throw new Error(`knowledge-index: el endpoint de embeddings rechazó la petición (${String(response.status)})`)
    const data = await response.json() as { data?: readonly { embedding?: readonly number[] }[] }
    const vectors = (data.data ?? []).map(row => row.embedding)
    if (vectors.length !== docs.length + 1 || vectors.some(vector => vector === undefined)) return undefined
    const [queryVector, ...docVectors] = vectors
    if (queryVector === undefined) return undefined
    return entries
      .map((entry, index) => ({ entry, score: cosine(queryVector, docVectors[index] ?? []) }))
      .sort((left, right) => right.score - left.score || right.entry.createdAt.localeCompare(left.entry.createdAt))
      .slice(0, Math.max(0, limit))
      .map(({ entry, score }) => ({ id: entry.id, title: entry.title, score: Math.round(score * 100), reasons: ['embedding'] }))
  }
}

/** Every scored text of one space, joined. */
function entryText(entry: SpaceIndexEntry): string {
  return [entry.title, Object.values(entry.context).join(' '), entry.memory, entry.contextEntries, entry.filesText].join(' ')
}

/** Rank by recency alone, for an empty query. */
function recent(entries: readonly SpaceIndexEntry[], limit: number): SpaceMatch[] {
  return [...entries]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(0, limit))
    .map(entry => ({ id: entry.id, title: entry.title, score: 0, reasons: [] }))
}

/**
 * Rank one query lexically over every scored field, plus the Knowledge Hub
 * expansion terms.
 * @param entries - readable candidate entries.
 * @param tokens - the folded query terms.
 * @param expansion - extra terms from the Knowledge Hub.
 * @param limit - most matches to return.
 * @returns matches, best score first, then most recent first.
 */
function rankLexically(
  entries: readonly SpaceIndexEntry[],
  tokens: readonly string[],
  expansion: ReadonlySet<string>,
  limit: number,
): SpaceMatch[] {
  const scored = entries.map((entry) => {
    const title = foldText(entry.title)
    const context = foldText(Object.values(entry.context).join(' '))
    const memory = foldText(entry.memory)
    const entriesText = foldText(entry.contextEntries)
    const files = foldText(entry.filesText)
    let score = 0
    const reasons = new Set<string>()
    /* jscpd:ignore-start -- mirrors the built-in lexical ranker in
       dsh-faberloom-spaces: the same field weights, plus the files text and the
       Knowledge Hub expansion terms this provider adds. */
    for (const token of tokens) {
      if (title.includes(token)) { score += TITLE_WEIGHT; reasons.add('title') }
      if (context.includes(token)) { score += CONTEXT_WEIGHT; reasons.add('context') }
      if (memory.includes(token)) { score += CONTEXT_WEIGHT; reasons.add('memory') }
      if (entriesText.includes(token)) { score += CONTEXT_WEIGHT; reasons.add('context-entries') }
      if (files.includes(token)) { score += CONTEXT_WEIGHT; reasons.add('files') }
    }
    for (const term of expansion) {
      if (title.includes(term) || context.includes(term) || memory.includes(term) || entriesText.includes(term) || files.includes(term)) {
        score += KNOWLEDGE_WEIGHT
        reasons.add('knowledge')
      }
    }
    /* jscpd:ignore-end */
    return { match: { id: entry.id, title: entry.title, score, reasons: [...reasons] }, createdAt: entry.createdAt }
  })
  return scored
    .filter(entry => entry.match.score > 0)
    .sort((left, right) => right.match.score - left.match.score || right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(0, limit))
    .map(entry => entry.match)
}

export default FaberLoomKnowledgeIndex
