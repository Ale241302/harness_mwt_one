/**
 * The MWT.ONE reads the proforma controls need, stated without a transport.
 *
 * A check adapter fills `BoardCheckSource` from these reads (ADR-003), so the
 * MCP tool names, their payload fields, and the timeout live behind
 * {@link MwtCheckClient} instead of inside the board. Every method either
 * returns the fact the source holds or throws: a throw reaches the board as a
 * failed control, and a missing datum is returned as `null` so no caller can
 * substitute a default for a price, a stock figure, or a band (D-01, D-02).
 *
 * @module @deepseek-ai/dsh-faberloom-checks-mwt/types
 */

/**
 * MWT.ONE MCP tools this package calls, by the raw names the `mwt` server
 * exposes (the model-facing name is `mcp__mwt__<tool>`). The list is the
 * catalogue surface recorded in `skills-catalog`: `expedientes`,
 * `productos`, `clientes`, and `inventario`.
 */
export type MwtToolName =
  | 'expediente_buscar'
  | 'expediente_lineas'
  | 'producto_buscar'
  | 'producto_precio_cliente'
  | 'cliente_listar'
  | 'cliente_obtener'
  | 'stock_listar'

/** One billed line of an MWT.ONE expediente. */
export interface MwtExpedienteLine {
  /** Catalog SKU the line bills. */
  readonly sku: string
  /** Quantity the order holds for that SKU. */
  readonly quantity: number
}

/** The lines of the expediente a purchase-order reference resolves to. */
export interface MwtExpedienteFacts {
  /** Expediente identity the lines were read from. */
  readonly reference: string
  /** Lines the expediente holds. */
  readonly lines: readonly MwtExpedienteLine[]
}

/**
 * The account's price condition. MWT.ONE resolves the band and the payment
 * term on the client record; the catalog price read needs one of them.
 */
export interface MwtPriceBand {
  /** Band identity the catalog matrix prices against, or null when the account has none. */
  readonly bandId: string | number | null
  /** Payment term in days the account trades on, or null when the record has none. */
  readonly paymentDays: number | null
}

/** The catalog's price for one SKU under one account band. */
export interface MwtCatalogPrice {
  /** List price before the overcharge, the MWT price of the catalog row. */
  readonly listPrice: number
  /** Price the account pays for that SKU under its band. */
  readonly clientPrice: number
}

/**
 * The five MWT.ONE reads the proforma controls need. Implementations own the
 * tool calls, the payload fields, and the timeout; callers own nothing but the
 * fact. `null` means the source holds no record, never a zero or a default.
 */
export interface MwtCheckClient {
  /**
   * Lines of the expediente one purchase-order reference names.
   * @param reference - expediente UUID or the order number the draft answers.
   * @returns the lines, or null when the source holds no such expediente.
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
   * The account's price band and payment term.
   * @param accountRef - board account reference (client name or code).
   * @returns the band facts, or null when the account or its condition is unstated.
   */
  priceBand(accountRef: string): Promise<MwtPriceBand | null>
  /**
   * The catalog price of one SKU for one account band.
   * @param sku - billed SKU.
   * @param band - band and term the account trades on.
   * @returns both prices, or null when either is absent.
   */
  catalogPrice(sku: string, band: MwtPriceBand): Promise<MwtCatalogPrice | null>
}

/**
 * One MWT.ONE tool call, already qualified with its server and bounded by the
 * caller's timeout. The implementation returns the canonical MCP tool value;
 * a failed call throws.
 */
export type MwtToolCall = (tool: MwtToolName, args: Record<string, unknown>) => Promise<unknown>
