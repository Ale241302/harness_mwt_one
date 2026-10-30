/**
 * The stable identifier one installation uses as its MCP device.
 *
 * The console binds a DeviceToken to the machine that first uses it. Binding to
 * the public address made a network change invalidate the credential, so the
 * machine identifies itself instead: this id is generated once, stored in the
 * Harness home, and sent with every MCP request. A copied token stays unusable
 * on another machine because that machine presents a different id, while the
 * same machine keeps working from any network.
 */
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** File under the Harness home that holds this installation's device id. */
export const DEVICE_ID_FILENAME = 'device-id'

/** Shape a stored id must match before it is trusted. */
const DEVICE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

/**
 * Read this installation's device id, creating it on first use.
 * @param dshHome - the resolved Harness home.
 * @returns the stable device id.
 */
export function resolveDeviceId(dshHome: string): string {
  const file = join(dshHome, DEVICE_ID_FILENAME)
  if (existsSync(file)) {
    const stored = readFileSync(file, 'utf8').trim()
    if (DEVICE_ID_PATTERN.test(stored)) return stored
  }
  const created = randomUUID()
  mkdirSync(dshHome, { recursive: true })
  writeFileSync(file, `${created}\n`)
  return created
}
