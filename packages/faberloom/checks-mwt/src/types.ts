/**
 * The MWT.ONE reads the adapter performs, stated without a transport.
 *
 * A check adapter fills `BoardCheckSource` from these reads (ADR-003), so the
 * MCP tool names, their response fields, and the timeout live behind
 * {@link MwtCheckClient} instead of inside the board. Every method either
 * returns the fact the source holds or throws: a throw reaches the board as a
 * failed control, and a missing datum is returned as `null` so no caller can
 * substitute a default for a price, a stock figure, or a band (D-01, D-02).
 *
 * `expediente`, `skuExists`, and `stockAvailable` feed the proforma controls.
 * `priceBand` and `catalogPrice` expose the per-SKU price facts the catalog
 * states; no control consumes them until a read returns expediente lines.
 *
 * @module @deepseek-ai/dsh-faberloom-checks-mwt/types
 */

/**
 * MWT.ONE MCP tools this package calls, by the raw names the `mwt` server
 * exposes (the model-facing name is `mcp__mwt__<tool>`). `expediente_lineas`
 * is absent because it requires an expediente id that no read returns.
 */
export type MwtToolName =
  | 'expediente_buscar'
  | 'expediente_listar'
  | 'producto_buscar'
  | 'producto_precio_cliente'
  | 'stock_listar'

/**
 * The order totals MWT.ONE records for one expediente. The two sides are what
 * D-01's overcharge is made of: `total_client - total_mwt`.
 */
export interface MwtExpedienteFacts {
  /** Reference the caller asked for. */
  readonly reference: string
  /** Amount the client is billed (`total_client`), or null when unreadable. */
  readonly totalClient: number | null
  /** Amount MWT.ONE bills for the order (`total_mwt`), or null when unreadable. */
  readonly totalMwt: number | null
  /** Currency the totals are stated in (`moneda`), or null. */
  readonly currency: string | null
  /** Client the expediente records (`client_name`), or null. */
  readonly clientName: string | null
  /** Client credit term in days (`credit_days_cliente`), or null. */
  readonly creditDays: number | null
  /** Client credit band (`credit_band`), or null when the row states none. */
  readonly creditBand: string | number | null
}

/**
 * The price band MWT.ONE resolves for one SKU. The server answers the band it
 * prices under (`banda_vigente.id`) and the payment term (`plazo_dias`).
 */
export interface MwtPriceBand {
  /** Band identity the catalog prices against, or null when the read states none. */
  readonly bandId: string | number | null
  /** Payment term in days the read states, or null. */
  readonly paymentDays: number | null
}

/** The catalog's price for one SKU, as the product row states it. */
export interface MwtCatalogPrice {
  /** `precio_venta` of the exact catalog row; zero is a stated price. */
  readonly price: number
  /** Currency the product row states (`moneda`), or null. */
  readonly currency: string | null
}

/**
 * The MWT.ONE reads this adapter performs. Implementations own the tool calls,
 * the response fields, and the timeout; callers own nothing but the fact.
 * `null` means the source holds no record, never a zero or a default.
 */
export interface MwtCheckClient {
  /**
   * The expediente one proforma or purchase-order reference names, with both
   * sides of its order total.
   * @param reference - proforma code or purchase-order code the draft answers.
   * @returns the totals, or null when no expediente matches the reference.
   */
  expediente(reference: string): Promise<MwtExpedienteFacts | null>
  /**
   * Whether the catalog holds the SKU.
   * @param sku - billed SKU.
   * @returns true only for an exact catalog match.
   */
  skuExists(sku: string): Promise<boolean>
  /**
   * Units the inventory reports as available for one SKU.
   * @param sku - billed SKU.
   * @returns the available units, or null when the source cannot state them.
   */
  stockAvailable(sku: string): Promise<number | null>
  /**
   * The price band and payment term the catalog resolves for one SKU.
   * @param sku - billed SKU.
   * @returns the band facts, or null when the read states neither.
   */
  priceBand(sku: string): Promise<MwtPriceBand | null>
  /**
   * The catalog price of one SKU.
   * @param sku - billed SKU.
   * @returns the price, or null when the catalog row states none.
   */
  catalogPrice(sku: string): Promise<MwtCatalogPrice | null>
}

/**
 * One MWT.ONE tool call, already qualified with its server and bounded by the
 * caller's timeout. The implementation returns the canonical MCP tool value;
 * a failed call throws.
 */
export type MwtToolCall = (tool: MwtToolName, args: Record<string, unknown>) => Promise<unknown>
