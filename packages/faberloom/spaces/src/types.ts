/**
 * Public type vocabulary of the native product spaces: the `FaberLoomSpaceId`
 * brand, the acting identity, and the service-facing records and results.
 * Types only — the id factory and the service live in `index.ts`.
 * @module @deepseek-ai/dsh-faberloom-spaces/src/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

/** Identifies one space record. A generated uuid, never a path. */
export type FaberLoomSpaceId = Branded<'FaberLoomSpaceId'>

/** Free-text context entries a space contributes, keyed by topic. */
export type SpaceContext = Record<string, string>

/**
 * A reference to a commercial source in MWT.ONE. It is a directive, not a
 * copy: the agent resolves the current value through the user's MWT MCP tools,
 * and the console stays the source of truth.
 */
export type SpaceSource =
  | { readonly kind: 'mwt-company'; readonly id: string }
  | { readonly kind: 'mwt-client'; readonly id: string }
  | { readonly kind: 'mwt-product'; readonly id: string }

/**
 * The acting identity for one operation, taken from the console login: the
 * owner id, the console role, the single company when the user has exactly one
 * (`undefined` otherwise), and whether the role is read-only.
 */
export interface SpaceActor {
  /** The authenticated identity (user email). */
  readonly id: string
  /** Console role (`admin`, `client_b2b`, `viewer`, …). */
  readonly role: string
  /** The user's single company id, or `undefined` when they have several. */
  readonly companyId: string | undefined
  /** True when the console marks the role read-only; the owner still manages its own spaces. */
  readonly readOnly: boolean
}

/** One stored space: ownership, company scope, hierarchy, inheritance, audience, and context. */
export interface FaberLoomSpace {
  /** Stable record id (generated uuid). */
  readonly id: FaberLoomSpaceId
  /** Owning identity (the account the space belongs to). */
  readonly ownerId: string
  /** Company this space is scoped to, or `undefined` for a global/admin space. */
  readonly companyId: string | undefined
  /** Display title. */
  readonly title: string
  /** Parent space id, or `undefined` for a root space. */
  readonly parentId: FaberLoomSpaceId | undefined
  /** Whether this space inherits its ancestors' context. */
  readonly inheritContext: boolean
  /** Ancestor space ids whose context this space explicitly excludes. */
  readonly excluded: readonly FaberLoomSpaceId[]
  /** Additional identities allowed to read this space. */
  readonly members: readonly string[]
  /** Context this space contributes. */
  readonly context: SpaceContext
  /** Commercial sources in MWT.ONE this space refers to (directives, not copies). */
  readonly sources: readonly SpaceSource[]
  /** The agent in charge of this space, or `undefined` when none is assigned. */
  readonly agentId: string | undefined
  /** Whether the space is archived (kept, out of the active list). */
  readonly archived: boolean
  /** ISO-8601 creation instant. */
  readonly createdAt: string
  /** ISO-8601 instant of the last durable mutation. */
  readonly updatedAt: string
  /** Monotonic revision; every accepted mutation increments it. */
  readonly version: number
}

/** Input accepted when creating one space; the actor supplies ownership. */
export interface CreateSpaceInput {
  /** Display title. */
  readonly title: string
  /** Parent space id, when the space is a sub-space. */
  readonly parentId?: FaberLoomSpaceId
  /** Agent in charge of the new space; the same agent may lead a parent and a sub-space. */
  readonly agentId?: string
  /** Whether the new space inherits its ancestors' context; defaults to true. */
  readonly inheritContext?: boolean
}

/** Mutable fields of a space. Absent fields stay unchanged. */
export interface UpdateSpaceInput {
  /** New display title. */
  readonly title?: string
  /** New inheritance switch. */
  readonly inheritContext?: boolean
  /** New exclusion list. */
  readonly excluded?: readonly FaberLoomSpaceId[]
  /** New member list. */
  readonly members?: readonly string[]
  /** New context, replaced wholesale. */
  readonly context?: SpaceContext
  /** New commercial-source list, replaced wholesale. */
  readonly sources?: readonly SpaceSource[]
  /** New responsible agent, or `null` to clear the assignment. */
  readonly agentId?: string | null
}

/** Input accepted when attaching one file to a space. */
export interface SpaceFileInput {
  /** Original file name. */
  readonly name: string
  /** Media type; `text/plain` when unknown. */
  readonly mediaType: string
  /** File bytes, base64-encoded. */
  readonly contentBase64: string
}

/** Metadata of one file attached to a space (no bytes). */
export interface SpaceFile {
  /** Stable file id (generated uuid). */
  readonly id: string
  /** The space the file belongs to. */
  readonly spaceId: FaberLoomSpaceId
  /** Original file name. */
  readonly name: string
  /** Media type. */
  readonly mediaType: string
  /** Byte length. */
  readonly size: number
  /** Lowercase hex SHA-256 of the bytes. */
  readonly sha256: string
  /** ISO-8601 attachment instant. */
  readonly createdAt: string
}

/** One attached file including its base64 bytes. */
export interface SpaceFileContent extends SpaceFile {
  /** The file bytes, base64-encoded. */
  readonly contentBase64: string
}

/**
 * One memory entry attached to one or more spaces. A sub-space whose
 * inheritance is on also sees its ancestors' entries.
 */
export interface FaberLoomSpaceMemory {
  /** Stable memory id (generated uuid). */
  readonly id: string
  /** Spaces this entry is attached to. */
  readonly spaceIds: readonly FaberLoomSpaceId[]
  /** The remembered text. */
  readonly text: string
  /** ISO-8601 creation instant. */
  readonly createdAt: string
}

/** One key for which two or more contributing spaces disagree. */
export interface EffectiveContextConflict {
  /** The contested context key. */
  readonly key: string
  /** Every distinct value offered for the key, with its source space. */
  readonly candidates: readonly { readonly spaceId: FaberLoomSpaceId; readonly value: string }[]
}

/** The resolved context of one space, with its contributing sources and unresolved conflicts. */
export interface EffectiveContext {
  /** Keys with a single distinct value. */
  readonly resolved: SpaceContext
  /** Keys with conflicting values, shown for the user to resolve. */
  readonly conflicts: readonly EffectiveContextConflict[]
  /** Spaces that contributed context, nearest first. */
  readonly sources: readonly FaberLoomSpaceId[]
  /** Excluded ancestor ids that were skipped. */
  readonly excluded: readonly FaberLoomSpaceId[]
  /** Commercial sources gathered from the contributing spaces (directives, not copies). */
  readonly dataSources: readonly SpaceSource[]
  /** Model-facing directives telling the agent to consult MWT.ONE for each source. */
  readonly directives: readonly string[]
}

/** The isolated personal scope of one identity, used when no space is assigned. */
export interface PersonalScope {
  /** Discriminant marking a personal scope. */
  readonly kind: 'personal'
  /** The identity that owns the scope. */
  readonly ownerId: string
}

/** An opaque working-directory reference; never a filesystem path. */
export interface WorkdirReference {
  /** Discriminant marking an opaque reference. */
  readonly kind: 'opaque'
  /** Stable opaque handle derived from owner and space. */
  readonly ref: string
}

/** Audience and material preview before linking private work to a space. */
export interface LinkPreview {
  /** Identities that would gain visibility of the linked material. */
  readonly newlyVisibleTo: readonly string[]
  /** Context keys the space would contribute to the linked material. */
  readonly sharedContextKeys: readonly string[]
}
