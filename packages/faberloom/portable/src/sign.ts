/**
 * Detached Ed25519 signatures for the portable manifest. The signing key lives
 * in deployment configuration; the verifying key is a trust anchor supplied
 * out of band and never stored inside the artifact.
 * @module @deepseek-ai/dsh-faberloom-portable/src/sign
 */

import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto'
import { canonicalJson } from './canonical.ts'
import { portableError } from './errors.ts'
import type { PortableManifest, PortableSignature } from './types.ts'

/**
 * Sign one canonical manifest.
 * @param manifest - the manifest, including its digest.
 * @param privateKeyPem - PKCS#8 Ed25519 private key in PEM form.
 * @param keyId - trust-anchor key id selected by the deployment.
 * @returns the detached signature.
 * @throws {Error} `PORTABLE_SIGNING` when the key cannot sign.
 */
export function signPortableManifest(
  manifest: PortableManifest,
  privateKeyPem: string,
  keyId: string,
): PortableSignature {
  if (privateKeyPem.trim().length === 0) throw portableError('PORTABLE_SIGNING', 'no signing key is configured')
  if (keyId.trim().length === 0) throw portableError('PORTABLE_SIGNING', 'no key id is configured')
  try {
    const value = cryptoSign(null, Buffer.from(canonicalJson(manifest), 'utf8'), privateKeyPem).toString('base64')
    return { algorithm: 'ed25519', keyId, value }
  } catch (error) {
    throw portableError('PORTABLE_SIGNING', error instanceof Error ? error.message : String(error))
  }
}

/**
 * Verify one detached signature against the canonical manifest.
 * @param manifest - the manifest, including its digest.
 * @param signature - the detached signature.
 * @param publicKeyPem - SPKI Ed25519 public key in PEM form.
 * @returns true when the signature is valid.
 */
export function verifyPortableSignature(
  manifest: PortableManifest,
  signature: PortableSignature,
  publicKeyPem: string,
  expectedKeyId?: string,
): boolean {
  const runtime = signature as { readonly algorithm?: string; readonly keyId?: string }
  if (runtime.algorithm !== 'ed25519') return false
  if (expectedKeyId !== undefined && runtime.keyId !== expectedKeyId) return false
  try {
    return cryptoVerify(
      null,
      Buffer.from(canonicalJson(manifest), 'utf8'),
      publicKeyPem,
      Buffer.from(signature.value, 'base64'),
    )
  } catch {
    return false
  }
}
