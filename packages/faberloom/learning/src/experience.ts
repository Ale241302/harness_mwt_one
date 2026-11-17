/**
 * The shared experience filter: what an answer may cite, when it must abstain,
 * and which contradictions it has to show instead of choosing a side.
 *
 * Every consumer (the Space scope, a board proposal, the panel explanation)
 * feeds the same shape, so "no base, no proposal" and "with base, cite it" are
 * one rule instead of three. The filter never reads a store and never calls a
 * model: it decides over the candidates it is given, which keeps the decision
 * testable and the answer auditable.
 * @module @deepseek-ai/dsh-faberloom-learning/experience
 */

/** Where one cited fact came from. */
export type ExperienceKind = 'memory' | 'teaching' | 'context' | 'case'

/** One fact the filter may cite. */
export interface ExperienceSource {
  /** Stable id, used as the citation. */
  readonly id: string
  /** Which family the fact belongs to. */
  readonly kind: ExperienceKind
  /** The fact itself, in the owner's words. */
  readonly text: string
  /** Topic the fact answers, when it states one; two facts with the same key must agree. */
  readonly key?: string
  /** Whether a person approved it; inherited data starts unapproved. */
  readonly approved: boolean
  /** Where it lives, for the human reading the answer. */
  readonly origin: string
}

/** One topic two approved facts disagree on. */
export interface ExperienceConflict {
  /** Contested topic. */
  readonly key: string
  /** Every distinct value with the fact that states it. */
  readonly values: readonly { readonly sourceId: string; readonly value: string }[]
}

/** What one answer may say. */
export interface ExperienceAnswer {
  /** `abstain` when nothing relevant supports a proposal. */
  readonly kind: 'abstain' | 'suggest'
  /** Facts the answer cites, most relevant first. */
  readonly sources: readonly ExperienceSource[]
  /** Topics the facts contradict; the answer must show them. */
  readonly conflicts: readonly ExperienceConflict[]
  /** Inputs the answer would need and no fact provides. */
  readonly missing: readonly string[]
}

/** Most facts one answer cites, so a long memory does not drown the answer. */
const MAX_CITED = 4

/** Words too common to make a fact relevant on their own. */
const STOPWORDS = new Set([
  'para', 'como', 'este', 'esta', 'esto', 'esos', 'esas', 'pero', 'porque', 'cuando', 'donde',
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'into', 'over', 'about', 'debe', 'deben',
  'tiene', 'tienen', 'hace', 'hacen', 'sobre', 'entre', 'desde', 'hasta', 'cada', 'todo', 'toda',
])

/** Fold one text into comparison tokens. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9áéíóúñü]+/u)
    .filter(token => token.length >= 4 && !STOPWORDS.has(token))
}

/** How many meaningful terms one query and one fact share. */
function relevance(query: readonly string[], source: readonly string[]): number {
  let score = 0
  for (const term of query) if (source.includes(term)) score += 1
  return score
}

/** Fold one fact for comparison of two statements of the same topic. */
function statement(value: string): string {
  return value.toLowerCase().replace(/[.!?;:]+$/u, '').replace(/\s+/gu, ' ').trim()
}

/**
 * Shape one answer from the facts a consumer already gathered.
 *
 * Only approved facts are cited; an unapproved (inherited) fact counts as no
 * base at all. A query that shares no meaningful term with any fact abstains,
 * and the answer lists what it would need. Approved facts that state the same
 * key with different values are reported as a conflict: the answer cites them
 * and shows the disagreement instead of pretending certainty.
 * @param query - what the person asked, or the case being prepared.
 * @param candidates - facts the consumer read from its stores.
 * @param needs - inputs the answer would require, for the abstention message.
 * @returns the answer, its citations, its conflicts, and its missing inputs.
 */
export function shapeExperience(
  query: string,
  candidates: readonly ExperienceSource[],
  needs: readonly string[] = [],
): ExperienceAnswer {
  const approved = candidates.filter(source => source.approved && source.text.trim().length > 0)
  const queryTerms = tokens(query)
  const scored = approved
    .map(source => ({ source, score: relevance(queryTerms, tokens(source.text)) }))
    .filter(entry => entry.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_CITED)
    .map(entry => entry.source)

  const byKey = new Map<string, { sourceId: string; value: string }[]>()
  for (const source of approved) {
    if (source.key === undefined) continue
    const list = byKey.get(source.key) ?? []
    if (!list.some(entry => entry.sourceId === source.id)) list.push({ sourceId: source.id, value: source.text.trim() })
    byKey.set(source.key, list)
  }
  const conflicts: ExperienceConflict[] = []
  for (const [key, values] of byKey.entries()) {
    const distinct = new Set(values.map(entry => statement(entry.value)))
    if (distinct.size > 1) conflicts.push({ key, values })
  }

  const covered = new Set(approved.flatMap(source => source.key === undefined ? [] : [source.key]))
  const missing = needs.filter(need => !covered.has(need))

  return {
    kind: scored.length === 0 ? 'abstain' : 'suggest',
    sources: scored,
    conflicts,
    missing,
  }
}
