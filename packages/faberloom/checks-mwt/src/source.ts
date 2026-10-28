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

/** Rounds a money value to cents, the precision the price control compares at. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

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
 * `price` reads the account band and the catalog price for that band: the
 * board's request carries the account and the SKU but no document reference, so
 * the expediente's own line prices cannot be reached from this port. The
 * overcharge is computed from the two catalog prices, never supplied as a
 * default.
 *
 * `separation` returns no record because no MWT.ONE read states the account's
 * split rule; the control's `confirmacion` class turns that into a required
 * confirmation.
 *
 * @param client - the five MWT.ONE reads.
 * @returns the source port the proforma controls read.
 */
export function mwtCheckSource(client: MwtCheckClient): BoardCheckSource {
  return {
    async sku(sku) {
      const exists = await client.skuExists(sku)
      return answer('mwt.catalog', { exists }, readInstant())
    },

    async price({ accountRef, sku }) {
      const band = await client.priceBand(accountRef)
      if (band === null) return noRecord('mwt.price', readInstant())
      const price = await client.catalogPrice(sku, band)
      if (price === null) return noRecord('mwt.price', readInstant())
      return answer('mwt.price', {
        listPrice: price.listPrice,
        overcharge: round2(price.clientPrice - price.listPrice),
      }, readInstant())
    },

    async stock(sku) {
      const available = await client.stockAvailable(sku)
      if (available === null) return noRecord('mwt.stock', readInstant())
      return answer('mwt.stock', { available }, readInstant())
    },

    async orderLines(orderRef) {
      const expediente = await client.expediente(orderRef)
      if (expediente === null) return noRecord('mwt.order', readInstant())
      const lines = expediente.lines.map(line => ({ sku: line.sku, quantity: line.quantity }))
      return answer('mwt.order', lines, readInstant())
    },

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
 * @param client - the five MWT.ONE reads.
 * @returns the disposer that removes every control it registered.
 */
export function registerProformaChecks(board: BoardCheckRegistrar, client: MwtCheckClient): () => void {
  return registerBoardProformaChecks(board, mwtCheckSource(client))
}
