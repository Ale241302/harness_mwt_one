/**
 * External-effect vocabulary and pure rules of the signed contract
 * (`CONTRATO_EFECTOS_MESA.md`): the `effect_key` formula, destination
 * normalisation, the reversal window a delegated item waits, and the state a
 * reservation and its outbox message may carry.
 *
 * Every rule here is pure over its arguments and an explicit clock, so the
 * service keeps authorization and the single `KvTable.update` commit while the
 * panel, the consumer, and the tests compute the same key and the same deadline.
 * @module @deepseek-ai/dsh-faberloom-board/src/effects
 */

import { createHash } from 'node:crypto'
import type {
  BoardEffectOutcome,
  BoardOutboxStatus,
  BoardReservationStatus,
  BoardState,
  BoardStatus,
} from './types.ts'

/**
 * Tenant segment of a deployment that knows no company. The contract reserves a
 * literal so the segment is never omitted; it is not a wildcard: two
 * company-less deployments share the one key space they can see.
 */
export const EFFECT_NO_TENANT = 'sin-empresa'

/** Deployment choices of the effect machine; the service resolves them from `Config`. */
export interface EffectPolicy {
  /** Reversal window per action type, in milliseconds. An unlisted type has none (D-12). */
  readonly reversalWindowMs: Readonly<Record<string, number>>
  /** Days a settled reservation and its message stay stored. */
  readonly retentionDays: number
  /** Milliseconds one dispatch attempt may take before the outcome is `DESCONOCIDO`. */
  readonly dispatchTimeoutMs: number
}

/** The five components the signed `effect_key` formula hashes. */
export interface EffectIdentity {
  /** `companyId` of the item; `null` is the single-tenant deployment. */
  readonly tenantId: string | null
  /** Action type, e.g. `mail.send`. */
  readonly actionType: string
  /** Destination, already normalised by {@link normaliseDestination}. */
  readonly destination: string
  /** Business identity of the item (§2.1). */
  readonly businessKey: string
  /** Hash of the exact approved artifact version. */
  readonly artifactHash: string
}

/**
 * Normalise the destination before it enters the key. A mail destination is one
 * address list: trimmed, lowercased, empties dropped, duplicates removed, and
 * sorted, so the same recipients in another order produce the same effect. Any
 * other destination is an external system id and is kept as written, trimmed.
 * @param actionType - action type of the effect.
 * @param destination - destination the caller supplied.
 * @returns the normalised destination.
 */
export function normaliseDestination(actionType: string, destination: string): string {
  const raw = destination.trim()
  if (raw.length === 0) {
    throw new Error('faberloom: EFFECT_IDENTITY_INCOMPLETE — the effect needs a destination')
  }
  if (!actionType.startsWith('mail.') && !raw.includes('@')) return raw
  const addresses = raw
    .split(/[,;]/)
    .map(part => part.trim().toLowerCase())
    .filter(part => part.length > 0)
  if (addresses.length === 0) {
    throw new Error('faberloom: EFFECT_IDENTITY_INCOMPLETE — the recipient list is empty')
  }
  return [...new Set(addresses)].sort().join(',')
}

/**
 * The signed identity of one effect:
 * `sha256(tenant_id + ":" + action_type + ":" + destination + ":" + business_key + ":" + artifact_hash)`.
 * @param identity - the five components.
 * @returns the hex digest.
 */
export function effectKeyOf(identity: EffectIdentity): string {
  const tenant = identity.tenantId ?? EFFECT_NO_TENANT
  const material = [
    tenant, identity.actionType, identity.destination, identity.businessKey, identity.artifactHash,
  ].join(':')
  return createHash('sha256').update(material).digest('hex')
}

/**
 * The reversal window of one action type. D-12 signs fifteen minutes for
 * `mail.send` and zero for money, inventory and shipments, which need a CEO
 * signature instead; a type the deployment did not configure has no window.
 * @param policy - resolved effect policy.
 * @param actionType - action type of the effect.
 * @returns the window in milliseconds, zero when the effect is not postponed.
 */
export function reversalWindowMs(policy: EffectPolicy, actionType: string): number {
  return policy.reversalWindowMs[actionType] ?? 0
}

/**
 * The instant a delegated item becomes dispatchable, or null when the action
 * type has no window and the effect may leave immediately.
 * @param policy - resolved effect policy.
 * @param actionType - action type of the effect.
 * @param now - the server clock.
 * @returns the ISO-8601 deadline, or null.
 */
export function reversalDeadlineOf(policy: EffectPolicy, actionType: string, now: Date): string | null {
  const windowMs = reversalWindowMs(policy, actionType)
  return windowMs === 0 ? null : new Date(now.getTime() + windowMs).toISOString()
}

/**
 * The instant after which a settled reservation and its message may be pruned.
 * @param policy - resolved effect policy.
 * @param now - the server clock.
 * @returns the ISO-8601 retention limit.
 */
export function retainUntilOf(policy: EffectPolicy, now: Date): string {
  return new Date(now.getTime() + policy.retentionDays * 86_400_000).toISOString()
}

/**
 * Storage key of one reservation: one row per tenant and effect key.
 * @param tenantId - tenant of the item.
 * @param effectKey - the effect identity.
 * @returns the storage key.
 */
export function reservationKeyOf(tenantId: string | null, effectKey: string): string {
  return `${tenantId ?? EFFECT_NO_TENANT}:${effectKey}`
}

/**
 * Storage key of one outbox message: one message per effect.
 * @param tenantId - tenant of the item.
 * @param effectKey - the effect identity.
 * @returns the storage key.
 */
export function outboxKeyOf(tenantId: string | null, effectKey: string): string {
  return `${tenantId ?? EFFECT_NO_TENANT}:${effectKey}`
}

/**
 * Storage key of one effect alert.
 * @param tenantId - tenant of the item.
 * @param effectKey - the effect identity.
 * @returns the storage key.
 */
export function alertKeyOf(tenantId: string | null, effectKey: string): string {
  return `${tenantId ?? EFFECT_NO_TENANT}:${effectKey}`
}

/**
 * Whether a reservation blocks a competing execution. Only a live reservation
 * does; a settled one frees the key (the contract's partial unique index).
 * @param status - reservation state.
 * @returns true while the key is held.
 */
export function reservationIsLive(status: BoardReservationStatus): boolean {
  return status === 'RESERVADA' || status === 'DESPACHADA'
}

/**
 * Whether a reservation reached a terminal state for its key.
 * @param status - reservation state.
 * @returns true when the key is free and the row may be pruned.
 */
export function reservationIsSettled(status: BoardReservationStatus): boolean {
  return status === 'CONCILIADA' || status === 'LIBERADA'
}

/**
 * Whether the consumer may emit one message. A cancelled, dispatched, or failed
 * message is not dispatchable; the consumer ignores it (§5 of the contract).
 * @param status - message state.
 * @param dispatchable - the stored flag.
 * @returns true when the message may be emitted now.
 */
export function messageIsDispatchable(status: BoardOutboxStatus, dispatchable: boolean): boolean {
  return status === 'PENDIENTE' && dispatchable
}

/**
 * The item state one outcome leads to. Only a confirmed effect is `EJECUTADO`;
 * an unknown result stays recoverable and verifiable (W-22).
 * @param outcome - what the destination reported.
 * @returns the target state.
 */
export function stateForOutcome(outcome: BoardEffectOutcome): BoardState {
  if (outcome === 'CONFIRMADO') return 'EJECUTADO'
  if (outcome === 'FALLIDO') return 'ERROR_RECUPERABLE'
  return 'DESCONOCIDO'
}

/**
 * The message state one outcome leads to.
 * @param outcome - what the destination reported.
 * @returns the message state; an unknown result keeps it dispatched.
 */
export function messageStatusFor(outcome: BoardEffectOutcome): BoardOutboxStatus {
  if (outcome === 'CONFIRMADO') return 'CONFIRMADO'
  if (outcome === 'FALLIDO') return 'FALLIDO'
  return 'DESPACHADO'
}

/**
 * The audit command one reported outcome writes.
 * @param outcome - what the destination reported.
 * @returns the stable command name.
 */
export function effectCommandFor(outcome: BoardEffectOutcome): string {
  if (outcome === 'CONFIRMADO') return 'effect.confirmed'
  if (outcome === 'FALLIDO') return 'effect.failed'
  return 'effect.unknown'
}

/**
 * The legacy `status` field one effect state carries, so old readers that only
 * know the eight original statuses keep a sensible value.
 * @param state - the WorkLoom state.
 * @returns the legacy status.
 */
export function legacyStatusOf(state: BoardState): BoardStatus {
  if (state === 'EJECUTADO' || state === 'DESCARTADO' || state === 'SUSTITUIDO') return 'completed'
  if (state === 'DESCONOCIDO' || state === 'ERROR_RECUPERABLE' || state === 'ERROR_SIN_SALIDA') return 'failed'
  if (state === 'APROBADO') return 'approved'
  if (state === 'PENDIENTE_CRITERIO') return 'waiting_approval'
  return 'in_progress'
}
