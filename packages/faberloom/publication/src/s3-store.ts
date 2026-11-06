/**
 * The production object store: S3 or MinIO through `@aws-sdk/client-s3`.
 *
 * Objects are immutable by construction (`publications/<commit>/<path>`) and,
 * when a retention is configured, written under an object-lock COMPLIANCE
 * retention so the publisher's own identity cannot delete or overwrite them
 * before the agreed window ends. The adapter never logs or embeds a
 * credential: refusals carry a fixed sentence or the SDK error name only.
 * @module @deepseek-ai/dsh-faberloom-publication/src/s3-store
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type GetObjectCommandOutput,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3'
import { publicationError } from './errors.ts'
import type { PublicationObject, PublicationObjectStore } from './types.ts'

/** Milliseconds in one day, for the object-lock retention date. */
const DAY_MS = 86_400_000

/** Deployment values the S3/MinIO store needs. */
export interface S3PublicationStoreOptions {
  /** Endpoint origin, for example `http://minio.internal:9000`. */
  readonly endpoint: string
  /** Bucket that holds published objects; it must have object lock enabled for retention. */
  readonly bucket: string
  /** Signing region; MinIO accepts any value the deployment configured. */
  readonly region: string
  /** Access key, or undefined to use the SDK's default provider chain. */
  readonly accessKey?: string | undefined
  /** Secret key, or undefined to use the SDK's default provider chain. */
  readonly secretKey?: string | undefined
  /** Days of COMPLIANCE retention; zero stores without object lock. */
  readonly retentionDays: number
  /** Largest object the store accepts. */
  readonly maxBytes: number
}

/**
 * Build the S3 client for one deployment. Path-style addressing is on because
 * MinIO serves bucket paths rather than virtual hosts.
 * @param options - endpoint, region, and optional static credentials.
 * @returns the client; its credentials never enter a log or a refusal.
 */
export function createS3Client(options: S3PublicationStoreOptions): S3Client {
  const credentials = options.accessKey !== undefined && options.secretKey !== undefined
    ? { accessKeyId: options.accessKey, secretAccessKey: options.secretKey }
    : undefined
  return new S3Client({
    region: options.region,
    endpoint: options.endpoint,
    forcePathStyle: true,
    ...credentials === undefined ? {} : { credentials },
  })
}

/**
 * The PutObject input for one immutable publication object.
 * @param object - key, bytes, media type, and metadata.
 * @param options - bucket and retention.
 * @returns the command input.
 */
export function putObjectInput(
  object: PublicationObject,
  options: Pick<S3PublicationStoreOptions, 'bucket' | 'retentionDays'>,
): PutObjectCommandInput {
  const input: PutObjectCommandInput = {
    Bucket: options.bucket,
    Key: object.key,
    Body: object.bytes,
    ContentType: object.contentType,
    Metadata: { ...object.metadata },
  }
  if (options.retentionDays > 0) {
    input.ObjectLockMode = 'COMPLIANCE'
    input.ObjectLockRetainUntilDate = new Date(Date.now() + options.retentionDays * DAY_MS)
  }
  return input
}

/**
 * Whether a failed GetObject means the object is absent rather than unavailable.
 * @param error - the SDK error.
 * @returns true for `NoSuchKey` and HTTP 404.
 */
export function isMissingObject(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = (error as { name?: unknown }).name
  if (name === 'NoSuchKey' || name === 'NotFound') return true
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode
  return status === 404
}

/**
 * Read one object's bytes from a GetObject answer.
 * @param output - the SDK answer.
 * @returns the exact bytes.
 * @throws {Error} `PUBLICATION_NOT_FOUND` when the answer carries no body.
 */
async function bodyOf(output: GetObjectCommandOutput): Promise<Uint8Array> {
  const body = output.Body
  if (body === undefined) throw publicationError('PUBLICATION_NOT_FOUND', 'the stored object has no body')
  return await body.transformToByteArray()
}

/**
 * The S3/MinIO implementation of {@link PublicationObjectStore}.
 */
export class S3PublicationStore implements PublicationObjectStore {
  private readonly client: S3Client
  private readonly options: S3PublicationStoreOptions

  /**
   * @param options - endpoint, bucket, region, credentials, retention, and ceiling.
   * @param client - prebuilt client; production omits it and the store builds one.
   */
  constructor(options: S3PublicationStoreOptions, client: S3Client = createS3Client(options)) {
    this.options = options
    this.client = client
  }

  /**
   * Store one immutable object.
   * @param object - key, bytes, media type, and metadata.
   * @returns resolution once the store accepted the write.
   */
  async put(object: PublicationObject): Promise<void> {
    try {
      await this.client.send(new PutObjectCommand(putObjectInput(object, this.options)))
    } catch (_unavailable) {
      throw publicationError('PUBLICATION_STORE_UNAVAILABLE', 'the object store refused the write')
    }
  }

  /**
   * Read one object. The ceiling is enforced here; the service verifies the
   * digest against the durable record.
   * @param key - immutable key.
   * @returns the bytes, or undefined when the object does not exist.
   */
  async get(key: string): Promise<Uint8Array | undefined> {
    let output: GetObjectCommandOutput
    try {
      output = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }))
    } catch (error) {
      if (isMissingObject(error)) return undefined
      throw publicationError('PUBLICATION_STORE_UNAVAILABLE', 'the object store refused the read')
    }
    // The declared length refuses an oversized object before its body is read.
    if (output.ContentLength !== undefined && output.ContentLength > this.options.maxBytes) {
      throw publicationError('PUBLICATION_TOO_LARGE', `the stored object exceeds ${String(this.options.maxBytes)} bytes`)
    }
    const bytes = await bodyOf(output)
    if (bytes.length > this.options.maxBytes) {
      throw publicationError('PUBLICATION_TOO_LARGE', `the stored object exceeds ${String(this.options.maxBytes)} bytes`)
    }
    return bytes
  }
}
