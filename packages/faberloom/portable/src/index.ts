/**
 * FaberLoom portable artifact (`ctx.faberloomPortable`): one Space's allowed
 * documents and harness records become a versioned staging directory with a
 * complete inventory, a canonical digest, and a detached Ed25519 signature
 * verified against an out-of-band trust anchor.
 *
 * The planner is pure and never writes; the writer validates the staging root
 * before creating a fresh directory, writes the manifest last, and removes only
 * its own directory when a write fails. Sources are read from the authorized
 * Git commit, never from the moving work tree.
 * @module @deepseek-ai/dsh-faberloom-portable
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { planPortable, DEFAULT_PORTABLE_MAX_BYTES } from './plan.ts'
import { stagePortable } from './stage.ts'
import { verifyPortableArtifact } from './verify.ts'
import type { PortablePlan, PortableRequest, PortableSignature, PortableStageResult, PortableVerification } from './types.ts'

export type * from './types.ts'
export * from './adapters/claude.ts'
export * from './usability.ts'
export { canonicalJson, sha256OfBytes, sha256OfCanonical, sha256OfText } from './canonical.ts'
export { committedDocuments, readCommittedContent } from './git-source.ts'
export { assertArtifactPath, aliasKey, pathsOverlap, MAX_ARTIFACT_PATH } from './paths.ts'
export {
  DEFAULT_PORTABLE_MAX_BYTES,
  PORTABLE_FORMAT_VERSION,
  planPortable,
} from './plan.ts'
export { signPortableManifest, verifyPortableSignature } from './sign.ts'
export { stagePortable } from './stage.ts'
export { contributionsFromUsage } from './usage.ts'
export { verifyPortableArtifact } from './verify.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    faberloomPortable: FaberLoomPortable
  }
}

/** Deployment wiring of the portable service. */
export interface Config {
  /** Existing directory under which each stage creates a new artifact directory. */
  readonly stagingRoot?: string
  /** PKCS#8 Ed25519 private key in PEM form; the public key stays out of band. */
  readonly signingKeyPem?: string
  /** Trust-anchor key id written beside the signature. */
  readonly keyId?: string
  /** Optional per-file ceiling overriding the request's `maxBytes`. */
  readonly maxBytes?: number
}

/** Schemastery configuration for the portable service. */
export const Config = z.object({
  stagingRoot: z.string().default(''),
  signingKeyPem: z.string().default(''),
  keyId: z.string().default(''),
  maxBytes: z.number().int().positive().default(DEFAULT_PORTABLE_MAX_BYTES),
})

/**
 * The portable artifact service: plan without writing, stage atomically, and
 * verify offline.
 */
export class FaberLoomPortable extends Service {
  private readonly resolved: z.infer<typeof Config>

  /**
   * @param ctx - Cordis context owning the service fiber.
   * @param config - staging root, signing key, key id, and byte ceiling.
   */
  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'faberloomPortable')
    this.resolved = Config.parse(config)
  }

  /**
   * Build one plan without touching the filesystem.
   * @param request - identity, contributions, and fixed versions.
   * @returns files, manifest, digest, and per-file rejections.
   */
  plan(request: PortableRequest): PortablePlan {
    return planPortable(request)
  }

  /**
   * Sign and write one artifact into a new staging directory.
   * @param request - identity, contributions, and fixed versions.
   * @returns the staging directory, manifest, signature, and rejections.
   */
  stage(request: PortableRequest): PortableStageResult {
    return stagePortable(this.resolved, request)
  }

  /**
   * Verify one staged artifact offline.
   * @param directory - the staging directory.
   * @param signature - the detached signature.
   * @param publicKeyPem - the out-of-band trust anchor.
   * @param expectedKeyId - optional key id the signature must name.
   * @returns whether the artifact is intact, with named reasons.
   */
  verify(
    directory: string,
    signature: PortableSignature,
    publicKeyPem: string,
    expectedKeyId?: string,
  ): PortableVerification {
    return verifyPortableArtifact(directory, signature, publicKeyPem, expectedKeyId)
  }
}

export default FaberLoomPortable
