/**
 * The board's source port filled from the MWT.ONE client.
 *
 * `registerProformaChecks(board, client)` registers the six controls D-8 signed
 * through the board's own declarations, so the ids and classes cannot drift: a
 * different class is impossible here because the registration passes the class
 * the board declares. The adapter only fills `BoardCheckSource` (ADR-003).
 *
 * A client that throws reaches the board as a failed control; a client that
 * answers null reaches it as "no record", which D-01 makes a blocking failure
 * and D-02 a required confirmation.
 *
 * @module @deepseek-ai/dsh-faberloom-checks-mwt/source
 */

import { registerProformaChecks as registerBoardProformaChecks } from '@deepseek-ai/dsh-faberloom-board'
import type { BoardCheckRegistrar, BoardCheckSource, BoardSourceAnswer } from '@deepseek-ai/dsh-faberloom-board'
import type { MwtCheckClient } from './types.ts'

/** The instant one read answered. */
function readInstant(): string {
  return new Date().toISOString()
}

/**
 * An answer the source holds.
 * @param source - source identifier the board records.
 * @param value - the fact.
 * @param readAt - ISO-8601 instant of the read.
 * @returns the answer.
 */
function answer<T>(source: string, value: T, readAt: string): BoardSourceAnswer<T> {
  return { value, source, version: null, readAt }
}

/**
 * An answer the source holds no record for.
 * @param source - source identifier the board records.
 * @param readAt - ISO-8601 instant of the read.
 * @returns the answer with a null value.
 */
function noRecord<T>(source: string, readAt: string): BoardSourceAnswer<T> {
  return { value: null, source, version: null, readAt }
}

/**
 * Fill the board's source port from the MWT.ONE client.
 *
 * `orderTotals` reads both sides of the expediente total the reference names:
 * that is the comparison the live source supports, because no read returns an
 * expediente id and therefore none returns its lines. A reference that does not
 * resolve, or an expediente that states only one side, answers no record, which
 * D-01 turns into a blocking failure.
 *
 * `orderLines` answers no record for the same reason: without an expediente id
 * there is no line read, and the quantity control must fail rather than compare
 * against invented quantities.
 *
 * `separation` returns no record because no MWT.ONE read states the account's
 * split rule; the control's `confirmacion` class turns that into a required
 * confirmation.
 *
 * @param client - the MWT.ONE reads.
 * @returns the source port the proforma controls read.
 */
export function mwtCheckSource(client: MwtCheckClient): BoardCheckSource {
  return {
    async sku(sku) {
      const exists = await client.skuExists(sku)
      return answer('mwt.catalog', { exists }, readInstant())
    },

    async orderTotals(orderRef) {
      const expediente = await client.expediente(orderRef)
      if (expediente === null) return noRecord('mwt.price', readInstant())
      if (expediente.totalClient === null || expediente.totalMwt === null) {
        return noRecord('mwt.price', readInstant())
      }
      return answer('mwt.price', {
        totalClient: expediente.totalClient,
        totalMwt: expediente.totalMwt,
      }, readInstant())
    },

    async stock(sku) {
      const available = await client.stockAvailable(sku)
      if (available === null) return noRecord('mwt.stock', readInstant())
      return answer('mwt.stock', { available }, readInstant())
    },

    // No MWT.ONE 1.30.0 read returns the lines of an expediente: every line read
    // requires an expediente id, and no read returns one.
    orderLines: () => Promise.resolve(noRecord('mwt.order', readInstant())),

    // No MWT.ONE read states the account's split rule, so this answer is a
    // constant: the control's confirmation class turns it into a required
    // confirmation instead of a silent pass.
    separation: () => Promise.resolve(noRecord('mwt.separation', readInstant())),
  }
}

/**
 * Register the six proforma controls of D-8 against the board, reading MWT.ONE
 * through the given client.
 * @param board - the board service the controls register on.
 * @param client - the MWT.ONE reads.
 * @returns the disposer that removes every control it registered.
 */
export function registerProformaChecks(board: BoardCheckRegistrar, client: MwtCheckClient): () => void {
  return registerBoardProformaChecks(board, mwtCheckSource(client))
}
