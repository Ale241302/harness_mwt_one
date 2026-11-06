// @vitest-environment node
/**
 * The S3/MinIO adapter without a network: it observes the commands the store
 * builds, the retention and metadata it writes, and how a read enforces the
 * byte ceiling and reports a missing or unavailable object.
 */

import { describe, expect, it } from 'vitest'
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import {
  S3PublicationStore,
  contentTypeOf,
  isMissingObject,
  publicationObjectKey,
  putObjectInput,
  sha256Of,
  type S3PublicationStoreOptions,
} from '../src/index.ts'

const BYTES = new TextEncoder().encode('# Nota\n')
const OPTIONS: S3PublicationStoreOptions = {
  endpoint: 'http://127.0.0.1:9000',
  bucket: 'faberloom-test',
  region: 'us-east-1',
  accessKey: 'test-access',
  secretKey: 'test-secret',
  retentionDays: 0,
  maxBytes: 1024,
}

/**
 * Build a real client whose send is replaced by the spec's handler, so the
 * store exercises its own command construction without a socket.
 * @param handler - the replacement send implementation.
 * @returns the client.
 */
function stubClient(handler: (command: unknown) => Promise<unknown>): S3Client {
  const client = new S3Client({
    region: OPTIONS.region,
    endpoint: OPTIONS.endpoint,
    credentials: { accessKeyId: 'test-access', secretAccessKey: 'test-secret' },
  })
  Object.assign(client, { send: handler })
  return client
}

describe('S3 publication store', () => {
  it('keys objects immutably by commit and derives the media type from the path', () => {
    expect(publicationObjectKey('a'.repeat(40), 'knowledge/note.md')).toBe(`publications/${'a'.repeat(40)}/knowledge/note.md`)
    expect(contentTypeOf('knowledge/note.md')).toBe('text/markdown')
    expect(contentTypeOf('knowledge/note.markdown')).toBe('text/markdown')
    expect(contentTypeOf('knowledge/note.txt')).toBe('text/plain')
  })

  it('writes the bucket, key, bytes, metadata, and a COMPLIANCE retention when configured', () => {
    const input = putObjectInput(
      {
        key: 'publications/abc/knowledge/note.md',
        bytes: BYTES,
        contentType: 'text/markdown',
        metadata: { sha256: sha256Of(BYTES), itemId: 'item-1' },
      },
      { bucket: 'faberloom-test', retentionDays: 30 },
    )

    expect(input.Bucket).toBe('faberloom-test')
    expect(input.Key).toBe('publications/abc/knowledge/note.md')
    expect(input.ContentType).toBe('text/markdown')
    expect(input.Metadata).toEqual({ sha256: sha256Of(BYTES), itemId: 'item-1' })
    expect(input.ObjectLockMode).toBe('COMPLIANCE')
    expect(input.ObjectLockRetainUntilDate?.getTime()).toBeGreaterThan(Date.now())
  })

  it('omits the object lock when no retention is configured', () => {
    const input = putObjectInput(
      { key: 'k', bytes: BYTES, contentType: 'text/plain', metadata: {} },
      { bucket: 'b', retentionDays: 0 },
    )

    expect(input.ObjectLockMode).toBeUndefined()
    expect(input.ObjectLockRetainUntilDate).toBeUndefined()
  })

  it('sends one PutObjectCommand for one object', async () => {
    const sent: unknown[] = []
    const store = new S3PublicationStore(OPTIONS, stubClient(async (command) => {
      sent.push(command)
      return {}
    }))

    await store.put({
      key: 'publications/abc/knowledge/note.md',
      bytes: BYTES,
      contentType: 'text/markdown',
      metadata: { sha256: sha256Of(BYTES), itemId: 'item-1' },
    })

    expect(sent).toHaveLength(1)
    const command = sent[0] as PutObjectCommand
    expect(command).toBeInstanceOf(PutObjectCommand)
    expect(command.input.Bucket).toBe('faberloom-test')
    expect(command.input.Key).toBe('publications/abc/knowledge/note.md')
  })

  it('reads the object bytes back', async () => {
    const store = new S3PublicationStore(OPTIONS, stubClient(async (command) => {
      expect(command).toBeInstanceOf(GetObjectCommand)
      return { Body: { transformToByteArray: async () => BYTES } }
    }))

    expect(await store.get('publications/abc/knowledge/note.md')).toEqual(BYTES)
  })

  it('reports a missing object as undefined and any other failure as unavailable without its credential', async () => {
    const missing = new S3PublicationStore(OPTIONS, stubClient(async () => {
      throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' })
    }))
    expect(await missing.get('absent')).toBeUndefined()

    const failing = new S3PublicationStore(OPTIONS, stubClient(async () => {
      throw Object.assign(new Error('AccessDenied'), { name: 'AccessDenied' })
    }))
    await expect(failing.get('denied')).rejects.toThrow('PUBLICATION_STORE_UNAVAILABLE')
    await expect(failing.put({
      key: 'k',
      bytes: BYTES,
      contentType: 'text/plain',
      metadata: {},
    })).rejects.toThrow('PUBLICATION_STORE_UNAVAILABLE')
    const refusal = await failing.get('denied').catch((error: unknown) => error)
    expect(refusal).toBeInstanceOf(Error)
    expect((refusal as Error).message).not.toContain('test-secret')
    expect((refusal as Error).message).not.toContain('test-access')
  })

  it('refuses a body-less answer and an object above the ceiling', async () => {
    const empty = new S3PublicationStore(OPTIONS, stubClient(async () => ({})))
    await expect(empty.get('k')).rejects.toThrow('PUBLICATION_NOT_FOUND')

    const oversized = new S3PublicationStore({ ...OPTIONS, maxBytes: 4 }, stubClient(async () => ({
      Body: { transformToByteArray: async () => BYTES },
    })))
    await expect(oversized.get('k')).rejects.toThrow('PUBLICATION_TOO_LARGE')

    const declared = new S3PublicationStore({ ...OPTIONS, maxBytes: 4 }, stubClient(async () => ({
      ContentLength: 1024,
      Body: { transformToByteArray: async () => BYTES },
    })))
    await expect(declared.get('k')).rejects.toThrow('PUBLICATION_TOO_LARGE')
  })

  it('recognizes the SDK shapes that mean an absent object', () => {
    expect(isMissingObject(Object.assign(new Error('x'), { name: 'NoSuchKey' }))).toBe(true)
    expect(isMissingObject(Object.assign(new Error('x'), { name: 'NotFound' }))).toBe(true)
    expect(isMissingObject({ $metadata: { httpStatusCode: 404 } })).toBe(true)
    expect(isMissingObject({ $metadata: { httpStatusCode: 500 } })).toBe(false)
    expect(isMissingObject(null)).toBe(false)
  })
})
