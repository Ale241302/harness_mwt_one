/**
 * The teaching activation rule (PREC-04): a proposal never influences, an
 * exact version a person approved does, and a text change invalidates that
 * approval until the new version is approved again.
 *
 * The rule is pure so every route can apply it at the operation that writes the
 * status, instead of trusting a caller's `active` flag.
 * @module @deepseek-ai/dsh-faberloom-learning/activation
 */

import type {
  TeachingActivationInput,
  TeachingActivationRefusal,
} from './types.ts'

/** A teaching record has the fields the activation rule reads. */
export interface ActivatableTeaching {
  /** Lifecycle status. */
  readonly status: 'candidate' | 'active' | 'superseded' | 'revoked'
  /** Monotonic version. */
  readonly version: number
}

/** Identities that belong to an automated route, never to a person. */
const MACHINE_APPROVER = /^(agent|assistant|workflow|routine|mcp|tool|capture|system):/iu

/**
 * Decide whether one activation request may proceed.
 *
 * Only a proposal (`candidate`) can be activated. The approval must name a
 * person and the human act that approved it, and it must name the version the
 * person actually read. A revoked teaching is never revived by this path: the
 * owner records a new proposal instead, so the revocation stays in history.
 * @param teaching - the durable record about to change.
 * @param input - approver, approval reference, and proposal version.
 * @returns the refusal code, or `null` when the activation may proceed.
 */
export function planTeachingActivation(
  teaching: ActivatableTeaching,
  input: TeachingActivationInput,
): TeachingActivationRefusal | null {
  if (teaching.status !== 'candidate') return 'NOT_CANDIDATE'
  if (input.proposalVersion !== teaching.version) return 'VERSION_STALE'
  if (input.approvedBy.trim().length === 0) return 'NO_APPROVER'
  if (MACHINE_APPROVER.test(input.approvedBy.trim())) return 'APPROVER_IS_MACHINE'
  if (input.approvalRef.trim().length === 0) return 'NO_APPROVAL_REF'
  return null
}

/**
 * The single message one refusal produces, so a caller never invents one.
 * @param refusal - code returned by {@link planTeachingActivation}.
 * @returns the error text.
 */
export function activationRefusalMessage(refusal: TeachingActivationRefusal): string {
  switch (refusal) {
    case 'NOT_CANDIDATE':
      return 'faberloom: ACTIVATION_NOT_CANDIDATE — only a proposal can be activated'
    case 'VERSION_STALE':
      return 'faberloom: ACTIVATION_VERSION_STALE — the approved version is not the current one'
    case 'NO_APPROVER':
      return 'faberloom: ACTIVATION_NO_APPROVER — an activation names the person who approved it'
    case 'APPROVER_IS_MACHINE':
      return 'faberloom: ACTIVATION_APPROVER_IS_MACHINE — an automated route cannot approve a teaching'
    case 'NO_APPROVAL_REF':
      return 'faberloom: ACTIVATION_NO_APPROVAL_REF — an activation names the human act that approved it'
  }
}
