/**
 * Native product publication (`ctx.faberloomPublication`): the real chain from
 * one approved diff to one activated revision.
 *
 * The chain has three effects and four durable facts. A row is written in
 * `pending` before the work tree is touched; the commit is recorded before the
 * object is written; the object key and digest are recorded before activation;
 * activation is a conditional update that only the first attempt can perform.
 * Every step resumes from the last recorded fact, so a retry after a crash
 * reuses the commit and the object instead of producing a second one.
 *
 * Durable state lives in the `faberloom_publication` domain: one row per
 * `(itemId, revision, artifactHash)` and one index row per commit. The service
 * owns no transport: the Git adapter is local, and the object store is the
 * configured S3/MinIO adapter unless a deployment mounts another one.
 * @module @deepseek-ai/dsh-faberloom-publication
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import { sha256Of, sha256OfText, verifyObject } from './bytes.ts'
import { publicationError } from './errors.ts'
import {
  assertCommitId,
  assertSafePath,
  commitPublication,
  committedBytes,
  openWorkTree,
} from './git.ts'
import { contentTypeOf, publicationObjectKey } from './object-store.ts'
import { S3PublicationStore } from './s3-store.ts'
import { publicationDomainSpec, type PublicationRecord, type RevisionIndexRecord } from './spec.ts'
import type {
  PublicationAvailability,
  PublicationObjectStore,
  PublicationRead,
  PublicationReceipt,
  PublicationRequest,
  PublicationState,
} from './types.ts'

export type * from './types.ts'
export * from './bytes.ts'
export * from './errors.ts'
export * from './git.ts'
export * from './object-store.ts'
export * from './s3-store.ts'
export * from './spec.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomPublication: FaberLoomPublication
  }
}

/** Approved bounds of one publication request. */
export const PUBLICATION_LIMITS = {
  /** Board item id. */
  itemId: 128,
  /** Unified diff text. */
  diff: 64_000,
  /** Why the change is published. */
  motivo: 2_000,
  /** One evidence reference. */
  evidenceItem: 512,
  /** Evidence references allowed per publication. */
  evidenceItems: 20,
  /** Version-bound artifact hash. */
  artifactHash: 128,
} as const

/** Largest object a publication stores when the deployment sets no ceiling. */
const DEFAULT_MAX_BYTES = 1024 * 1024

/**
 * Deployment-varying publication configuration. The repository, endpoint, and
 * bucket are required for the service to run; credentials stay in the
 * deployment and are never logged, returned, or written to durable state.
 */
export interface Config {
  /** Local Git work tree the approved diff is applied to. */
  readonly repo?: string
  /** S3/MinIO endpoint origin, for example `http://minio.internal:9000`. */
  readonly endpoint?: string
  /** Bucket that holds published objects. */
  readonly bucket?: string
  /** Access key; absent uses the SDK's default provider chain. */
  readonly accessKey?: string
  /** Secret key; must be supplied together with the access key. */
  readonly secretKey?: string
  /** Signing region. */
  readonly region?: string
  /** Days of object-lock COMPLIANCE retention; zero stores without object lock. */
  readonly retentionDays?: number
  /** Largest published object. */
  readonly maxBytes?: number
}

/** Validated publication configuration. */
export const Config = z.object({
  repo: z.string().default(''),
  endpoint: z.string().default(''),
  bucket: z.string().default(''),
  accessKey: z.string().default(''),
  secretKey: z.string().default(''),
  region: z.string().default('us-east-1'),
  retentionDays: z.number().int().min(0).default(0),
  maxBytes: z.number().int().positive().default(DEFAULT_MAX_BYTES),
})

/** Resolved configuration, with every field present. */
type ResolvedConfig = z.infer<typeof Config>

/** One request after normalization: identical inputs produce identical keys. */
interface NormalizedRequest {
  readonly itemId: string
  readonly revision: string
  readonly path: string
  readonly diff: string
  readonly motivo: string
  readonly evidence: readonly string[]
  readonly artifactHash: string
  /** SHA-256 of {@link diff}, hashed exactly as it will be applied. */
  readonly diffSha256: string
}

/** Item ids a caller may publish for. */
const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._:@-]*$/u

/** Artifact hashes a caller may publish for. */
const ARTIFACT_HASH = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u

/** Current instant, once per transition. */
function now(): string {
  return new Date().toISOString()
}

/**
 * Require one bounded, non-empty text field.
 * @param field - field name for the refusal.
 * @param value - normalized value.
 * @param maximum - approved bound.
 * @returns the value.
 * @throws {Error} `PUBLICATION_REQUEST_INVALID`.
 */
function bounded(field: string, value: string, maximum: number): string {
  if (value.length === 0) throw publicationError('PUBLICATION_REQUEST_INVALID', `${field} is required`)
  if (value.length > maximum) {
    throw publicationError('PUBLICATION_REQUEST_INVALID', `${field} exceeds ${String(maximum)} characters`)
  }
  return value
}

/**
 * Validate and normalize one request. The path and revision are security
 * inputs because the adapter resolves them; the diff is never trimmed because
 * its exact bytes are what `git apply` receives.
 * @param request - the caller's request.
 * @returns the normalized request.
 * @throws {Error} `PUBLICATION_REQUEST_INVALID`, `PUBLICATION_PATH_INVALID`, or
 * `PUBLICATION_REVISION_INVALID`.
 */
function normalizeRequest(request: PublicationRequest): NormalizedRequest {
  const itemId = bounded('itemId', request.itemId.trim(), PUBLICATION_LIMITS.itemId)
  if (!ITEM_ID.test(itemId)) throw publicationError('PUBLICATION_REQUEST_INVALID', 'itemId carries an unsupported character')
  const artifactHash = bounded('artifactHash', request.artifactHash.trim(), PUBLICATION_LIMITS.artifactHash)
  if (!ARTIFACT_HASH.test(artifactHash)) {
    throw publicationError('PUBLICATION_REQUEST_INVALID', 'artifactHash carries an unsupported character')
  }
  const diff = bounded('diff', request.diff, PUBLICATION_LIMITS.diff)
  if (request.evidence.length === 0) {
    throw publicationError('PUBLICATION_REQUEST_INVALID', 'evidencia needs at least one reference')
  }
  if (request.evidence.length > PUBLICATION_LIMITS.evidenceItems) {
    throw publicationError(
      'PUBLICATION_REQUEST_INVALID',
      `evidencia exceeds ${String(PUBLICATION_LIMITS.evidenceItems)} references`,
    )
  }
  return {
    itemId,
    revision: assertCommitId(request.revision),
    path: assertSafePath(request.path),
    diff,
    motivo: bounded('motivo', request.motivo.trim(), PUBLICATION_LIMITS.motivo),
    evidence: request.evidence.map((entry, index) => bounded(
      `evidencia[${String(index)}]`,
      entry.trim(),
      PUBLICATION_LIMITS.evidenceItem,
    )),
    artifactHash,
    diffSha256: sha256OfText(diff),
  }
}

/**
 * The durable key of one publication identity.
 * @param request - item, base revision, and artifact hash.
 * @returns `itemId\0revision\0artifactHash`.
 */
export function publicationKeyOf(request: Pick<PublicationRequest, 'itemId' | 'revision' | 'artifactHash'>): string {
  return [request.itemId, request.revision, request.artifactHash].join('\u0000')
}

/**
 * Project one durable row into the receipt a caller reads.
 * @param record - stored publication.
 * @returns the receipt.
 * @throws {Error} `PUBLICATION_INCOMPLETE` when no object was uploaded yet.
 */
function receiptOf(record: PublicationRecord): PublicationReceipt {
  const { commit, objectKey, sha256, bytes } = record
  if (commit === null || objectKey === null || sha256 === null || bytes === null) {
    throw publicationError('PUBLICATION_INCOMPLETE', `publication ${record.itemId} has no uploaded object`)
  }
  return {
    revision: record.revision,
    commit,
    objectKey,
    sha256,
    bytes,
    state: record.state,
    activatedAt: record.activatedAt,
  }
}

/**
 * The product publication service: apply, upload, activate, and read one
 * revision at a time.
 */
export class FaberLoomPublication extends Service {
  static inject = ['storageDomain']

  private readonly resolved: ResolvedConfig
  private readonly unavailable: string | null
  private domainPromise: Promise<Domain<typeof publicationDomainSpec>> | undefined
  /** Object store a deployment mounted; production leaves it unset. */
  private mountedStore: PublicationObjectStore | undefined
  /** S3/MinIO adapter built on first use, so a disabled service builds nothing. */
  private defaultStore: S3PublicationStore | undefined
  /** Tail of the effect chain: one publication touches the work tree at a time. */
  private serial: Promise<void> = Promise.resolve()

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - repository, object store, retention, and byte ceiling.
   * @throws {Error} `PUBLICATION_CONFIG_INVALID` when only one credential is set.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'faberloomPublication')
    const resolved = Config.parse(config)
    if ((resolved.accessKey.length > 0) !== (resolved.secretKey.length > 0)) {
      throw publicationError('PUBLICATION_CONFIG_INVALID', 'accessKey and secretKey must be provided together')
    }
    this.resolved = resolved
    const missing = [
      ...(resolved.repo.length === 0 ? ['repo'] : []),
      ...(resolved.endpoint.length === 0 ? ['endpoint'] : []),
      ...(resolved.bucket.length === 0 ? ['bucket'] : []),
    ]
    this.unavailable = missing.length === 0
      ? null
      : `the publication service requires ${missing.join(', ')}`
    if (this.unavailable !== null) {
      this.ctx.logger.warn(`faberloom: PUBLICATION_UNAVAILABLE — ${this.unavailable}`)
    }
  }

  /**
   * Whether this deployment can publish, and what it is missing.
   * @returns the availability and its reason.
   */
  readiness(): PublicationAvailability {
    return { available: this.unavailable === null, reason: this.unavailable }
  }

  /**
   * Mount the object store a deployment or a test uses. The mounted store
   * replaces the configured S3/MinIO adapter; configuration still has to be
   * complete, so a mount cannot turn a disabled service on.
   * @param store - the store to use.
   * @returns the disposer that detaches it.
   */
  useObjectStore(store: PublicationObjectStore): () => void {
    this.mountedStore = store
    return () => {
      if (this.mountedStore === store) this.mountedStore = undefined
    }
  }

  /**
   * Publish one approved diff: apply and commit it, upload the committed
   * bytes, and activate the revision. A replay of the same request returns the
   * same receipt without a second commit, object, or activation.
   * @param request - approval identity, base commit, path, diff, and evidence.
   * @returns the receipt of the activated publication.
   * @throws {Error} a `faberloom:` refusal from validation, Git, the store, or storage.
   */
  async publish(request: PublicationRequest): Promise<PublicationReceipt> {
    this.requireAvailable()
    const input = normalizeRequest(request)
    return await this.serialize(async () => {
      const table = await this.publications()
      const key = publicationKeyOf(input)
      const existing = table.get(key)
      if (existing !== undefined) {
        if (existing.path !== input.path || existing.diffSha256 !== input.diffSha256) {
          throw publicationError(
            'PUBLICATION_REQUEST_CONFLICT',
            `approval ${input.itemId} already published another change for this revision and artifact`,
          )
        }
        return await this.advance(existing, input)
      }
      const at = now()
      const record: PublicationRecord = {
        key,
        itemId: input.itemId,
        revision: input.revision,
        path: input.path,
        motivo: input.motivo,
        evidence: [...input.evidence],
        artifactHash: input.artifactHash,
        diffSha256: input.diffSha256,
        state: 'pending',
        commit: null,
        objectKey: null,
        sha256: null,
        bytes: null,
        activatedAt: null,
        failure: null,
        createdAt: at,
        updatedAt: at,
      }
      // The pending row is durable before the work tree is touched, so the
      // caller can always ask what happened to this identity.
      await table.put(key, record)
      return await this.advance(record, input)
    })
  }

  /**
   * Read one file from one published revision, verifying its length and
   * SHA-256 against the durable record.
   * @param revision - publication commit.
   * @param path - repository-relative path the publication serves.
   * @returns the verified bytes and their text.
   * @throws {Error} `PUBLICATION_NOT_FOUND`, `PUBLICATION_NOT_ACTIVE`,
   * `PUBLICATION_PATH_INVALID`, `PUBLICATION_TOO_LARGE`, or
   * `PUBLICATION_DIGEST_MISMATCH`.
   */
  async read(revision: string, path: string): Promise<PublicationRead> {
    this.requireAvailable()
    const commit = assertCommitId(revision)
    const requested = assertSafePath(path)
    const record = await this.recordByCommit(commit)
    if (record.path !== requested) {
      throw publicationError('PUBLICATION_PATH_INVALID', `revision ${commit} publishes ${record.path}`)
    }
    if (record.state !== 'uploaded' && record.state !== 'activated') {
      throw publicationError('PUBLICATION_NOT_ACTIVE', `revision ${commit} is ${record.state}`)
    }
    const { objectKey, sha256, bytes } = record
    if (objectKey === null || sha256 === null || bytes === null) {
      throw publicationError('PUBLICATION_INCOMPLETE', `revision ${commit} has no uploaded object`)
    }
    const stored = await this.store().get(objectKey)
    if (stored === undefined) {
      throw publicationError('PUBLICATION_NOT_FOUND', `no object at ${objectKey}`)
    }
    verifyObject(stored, { sha256, bytes, maxBytes: this.resolved.maxBytes })
    return {
      revision: commit,
      path: requested,
      bytes: stored.length,
      sha256,
      text: Buffer.from(stored).toString('utf8'),
    }
  }

  /**
   * The durable stage of one publication revision.
   * @param revision - publication commit.
   * @returns its state.
   * @throws {Error} `PUBLICATION_NOT_FOUND` when no publication fixed that commit.
   */
  async status(revision: string): Promise<PublicationState> {
    this.requireAvailable()
    return (await this.recordByCommit(assertCommitId(revision))).state
  }

  /**
   * The receipt of one published revision.
   * @param revision - publication commit.
   * @returns its receipt.
   * @throws {Error} `PUBLICATION_NOT_FOUND` or `PUBLICATION_INCOMPLETE`.
   */
  async receipt(revision: string): Promise<PublicationReceipt> {
    this.requireAvailable()
    return receiptOf(await this.recordByCommit(assertCommitId(revision)))
  }

  /** Refuse every operation while the deployment is incomplete. */
  private requireAvailable(): void {
    if (this.unavailable !== null) throw publicationError('PUBLICATION_UNAVAILABLE', this.unavailable)
  }

  /**
   * Run one effect chain after the previous one settled. Git has no
   * compare-and-set, so two publications may not interleave in one process.
   * @param job - the chain to run.
   * @returns the chain's answer.
   */
  private async serialize<T>(job: () => Promise<T>): Promise<T> {
    const run = this.serial.then(job, job)
    this.serial = run.then(() => undefined, () => undefined)
    return run
  }

  /** The object store this deployment uses. */
  private store(): PublicationObjectStore {
    if (this.mountedStore !== undefined) return this.mountedStore
    const resolved = this.resolved
    this.defaultStore ??= new S3PublicationStore({
      endpoint: resolved.endpoint,
      bucket: resolved.bucket,
      region: resolved.region,
      retentionDays: resolved.retentionDays,
      maxBytes: resolved.maxBytes,
      ...resolved.accessKey.length === 0
        ? {}
        : { accessKey: resolved.accessKey, secretKey: resolved.secretKey },
    })
    return this.defaultStore
  }

  private domain(): Promise<Domain<typeof publicationDomainSpec>> {
    this.domainPromise ??= (async () => {
      const domain = await this.ctx.storageDomain.open(publicationDomainSpec)
      this.ctx.effect(() => () => domain.close(), 'faberloom.publicationDomainClose')
      return domain
    })()
    return this.domainPromise
  }

  /** The publication rows, keyed by identity. */
  private async publications(): Promise<KvTable<string, PublicationRecord>> {
    return (await this.domain()).table('publications')
  }

  /** The commit index. */
  private async revisions(): Promise<KvTable<string, RevisionIndexRecord>> {
    return (await this.domain()).table('revisions')
  }

  /**
   * Resolve one commit to its durable row.
   * @param commit - publication commit.
   * @returns the row.
   * @throws {Error} `PUBLICATION_NOT_FOUND`.
   */
  private async recordByCommit(commit: string): Promise<PublicationRecord> {
    const index = (await this.revisions()).get(commit)
    const record = index === undefined ? undefined : (await this.publications()).get(index.publication)
    if (record === undefined) throw publicationError('PUBLICATION_NOT_FOUND', `no publication for ${commit}`)
    return record
  }

  /**
   * Persist one transition before the next effect. The commit index is written
   * after the row, so a crash between them leaves a retryable row rather than
   * an addressable revision without state.
   * @param record - the transition to store.
   * @returns resolution after both writes.
   */
  private async persist(record: PublicationRecord): Promise<void> {
    await (await this.publications()).put(record.key, record)
    if (record.commit !== null) await (await this.revisions()).put(record.commit, { publication: record.key })
  }

  /**
   * Continue one publication from the last durable fact. The next effect is
   * derived from the recorded artifacts, not from the state word, so a failure
   * after a partial chain resumes instead of repeating work.
   * @param record - the durable row.
   * @param input - the normalized request, used only to re-apply before a commit.
   * @returns the receipt.
   */
  private async advance(record: PublicationRecord, input: NormalizedRequest): Promise<PublicationReceipt> {
    let current = record
    try {
      if (current.commit === null) current = await this.commitOnce(current, input)
      if (current.sha256 === null) current = await this.uploadOnce(current)
      if (current.state !== 'activated') current = await this.activateOnce(current)
      return receiptOf(current)
    } catch (error) {
      await this.markFailed(current, error)
      throw error
    }
  }

  /**
   * Apply and commit the diff, then record the commit before any upload.
   * @param record - the pending row.
   * @param input - the normalized request.
   * @returns the row in `committed`.
   */
  private async commitOnce(record: PublicationRecord, input: NormalizedRequest): Promise<PublicationRecord> {
    const committed = commitPublication({
      root: this.resolved.repo,
      revision: record.revision,
      path: record.path,
      diff: input.diff,
      itemId: record.itemId,
      artifactHash: record.artifactHash,
      maxBytes: this.resolved.maxBytes,
    })
    const next: PublicationRecord = {
      ...record,
      state: 'committed',
      commit: committed.commit,
      failure: null,
      updatedAt: now(),
    }
    await this.persist(next)
    return next
  }

  /**
   * Upload the committed bytes under the immutable key, reusing an object a
   * crash already wrote, then record the key and digest before activation.
   * @param record - the committed row.
   * @returns the row in `uploaded`.
   */
  private async uploadOnce(record: PublicationRecord): Promise<PublicationRecord> {
    const commit = record.commit
    if (commit === null) throw publicationError('PUBLICATION_INCOMPLETE', 'the commit is missing')
    const bytes = committedBytes(openWorkTree(this.resolved.repo), commit, record.path, this.resolved.maxBytes)
    const sha256 = sha256Of(bytes)
    const key = publicationObjectKey(commit, record.path)
    const existing = await this.store().get(key)
    if (existing === undefined) {
      await this.store().put({
        key,
        bytes,
        contentType: contentTypeOf(record.path),
        metadata: { sha256, itemId: record.itemId },
      })
    } else if (sha256Of(existing) !== sha256) {
      throw publicationError('PUBLICATION_OBJECT_CONFLICT', `${key} already holds different bytes`)
    }
    const next: PublicationRecord = {
      ...record,
      state: 'uploaded',
      objectKey: key,
      sha256,
      bytes: bytes.length,
      failure: null,
      updatedAt: now(),
    }
    await this.persist(next)
    return next
  }

  /**
   * Verify the stored object and activate the revision once. The durable update
   * compares the current state, so a concurrent or repeated activation keeps
   * the first `activatedAt` instead of writing a second one.
   * @param record - the uploaded row.
   * @returns the row in `activated`.
   */
  private async activateOnce(record: PublicationRecord): Promise<PublicationRecord> {
    const { objectKey, sha256, bytes } = record
    if (objectKey === null || sha256 === null || bytes === null) {
      throw publicationError('PUBLICATION_INCOMPLETE', 'the object is missing')
    }
    const stored = await this.store().get(objectKey)
    if (stored === undefined) throw publicationError('PUBLICATION_NOT_FOUND', `no object at ${objectKey}`)
    verifyObject(stored, { sha256, bytes, maxBytes: this.resolved.maxBytes })
    const table = await this.publications()
    const activatedAt = now()
    return await table.update(record.key, current => current.state === 'activated'
      ? current
      : { ...current, state: 'activated', activatedAt, failure: null, updatedAt: activatedAt })
  }

  /**
   * Record the refusal that stopped the chain, keeping the artifacts a retry
   * resumes from. A refusal after activation never downgrades the row.
   * @param record - the row the chain was working on.
   * @param error - the thrown value.
   * @returns resolution after the row is updated, or when the durable layer is gone.
   */
  private async markFailed(record: PublicationRecord, error: unknown): Promise<void> {
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 500)
    try {
      await this.failRow(record.key, detail)
    } catch (_unavailable) {
      // The durable layer failed too; the caller still receives the original refusal.
    }
  }

  /**
   * Write the failed state for one row.
   * @param key - publication key.
   * @param detail - bounded refusal text.
   * @returns resolution after the write.
   */
  private async failRow(key: string, detail: string): Promise<void> {
    const table = await this.publications()
    const current = table.get(key)
    if (current === undefined || current.state === 'activated') return
    await table.put(key, { ...current, state: 'failed', failure: detail, updatedAt: now() })
  }
}

export default FaberLoomPublication
