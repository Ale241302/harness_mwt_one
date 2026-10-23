/**
 * Shared provider-key vault plugin for the local desktop harness and the cloud
 * web harness.
 *
 * Both installations sign in to the same MWT.ONE console account. This plugin
 * keeps their model-provider API keys identical: a key saved on either side is
 * pushed to the console's encrypted vault and pulled by the other on boot and
 * on a fixed interval. A composition without a console base/token stays fully
 * local.
 *
 * @module @deepseek-ai/dsh-credentials-console
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { CredentialVault } from './vault.ts'

export type { VaultConfig } from './vault.ts'

/** Deployment-supplied console configuration. */
export interface Config {
  /** Console API base URL; empty falls back to `CONSOLA_API_BASE`. */
  readonly consoleBase?: string
  /** Console bearer token; empty falls back to `CONSOLA_TOKEN` per request. */
  readonly consoleToken?: string
  /** Re-read interval in milliseconds. */
  readonly intervalMs?: number
  /** Reference suffix the vault owns. */
  readonly refSuffix?: string
}

/** Schemastery configuration for the vault plugin. */
export const Config: Schema<Config> = Schema.object({
  consoleBase: Schema.string().default(''),
  consoleToken: Schema.string().default(''),
  intervalMs: Schema.number().step(1).min(5_000).default(60_000),
  refSuffix: Schema.string().default('_API_KEY'),
})

/** Plugin name in the Loader tree. */
export const name = 'credentials-console'

/** The local credential store must exist before a sync can read or write it. */
export const inject = ['credentials']

/**
 * Install the vault synchronization on the host's credentials service.
 * @param ctx - host context.
 * @param config - validated console and interval configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const vault = new CredentialVault(ctx, {
    consoleBase: config.consoleBase ?? '',
    consoleToken: config.consoleToken ?? '',
    intervalMs: config.intervalMs ?? 60_000,
    refSuffix: config.refSuffix ?? '_API_KEY',
  })
  ctx.effect(() => vault.start(), 'credentials-console: vault synchronization')
}
