import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { DEVICE_ID_FILENAME, resolveDeviceId } from '../src/device-id.ts'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u

it('creates one device id on first use and keeps it', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-device-'))
  const first = resolveDeviceId(home)
  expect(first).toMatch(uuid)
  expect(resolveDeviceId(home)).toBe(first)
  expect(readFileSync(join(home, DEVICE_ID_FILENAME), 'utf8').trim()).toBe(first)
})

it('replaces a stored id that is not a uuid', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-device-'))
  writeFileSync(join(home, DEVICE_ID_FILENAME), 'not-a-uuid\n')
  const id = resolveDeviceId(home)
  expect(id).toMatch(uuid)
  expect(readFileSync(join(home, DEVICE_ID_FILENAME), 'utf8').trim()).toBe(id)
})

it('creates the home directory when it is missing', () => {
  const home = join(mkdtempSync(join(tmpdir(), 'dsh-device-')), 'nested')
  expect(resolveDeviceId(home)).toMatch(uuid)
})
