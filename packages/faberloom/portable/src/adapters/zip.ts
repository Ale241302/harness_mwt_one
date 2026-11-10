/**
 * Deterministic ZIP writer for the surfaces that consume a package archive.
 * Entries are stored uncompressed in path order with a fixed DOS timestamp, so
 * the same plan produces the same bytes. Code installs the directory directly;
 * chat and Cowork are documented as ZIP consumers and remain open until their
 * own cycle is observed.
 * @module @deepseek-ai/dsh-faberloom-portable/src/adapters/zip
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { portableError } from '../errors.ts'
import { assertArtifactPath } from '../paths.ts'
import type { ClaudePackagePlan } from './claude.ts'

/** CRC-32 table used by the ZIP local and central headers. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    table[index] = value >>> 0
  }
  return table
})()

/** CRC-32 of one byte sequence. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** One ZIP entry in path order. */
interface Entry {
  readonly name: Buffer
  readonly data: Buffer
  readonly crc: number
}

/**
 * Build one deterministic ZIP archive from a ready or draft plan.
 * @param plan - package plan.
 * @returns the archive bytes.
 */
export function archiveClaudePackage(plan: ClaudePackagePlan): Uint8Array {
  const entries: Entry[] = plan.files.map((file) => {
    const name = assertArtifactPath(file.path)
    const data = Buffer.from(file.content, 'utf8')
    return { name: Buffer.from(name, 'utf8'), data, crc: crc32(data) }
  }).sort((left, right) => Buffer.compare(left.name, right.name))
  let localSize = 0
  let centralSize = 0
  for (const entry of entries) {
    localSize += 30 + entry.name.length + entry.data.length
    centralSize += 46 + entry.name.length
  }
  const out = Buffer.alloc(localSize + centralSize + 22)
  let offset = 0
  const central: { entry: Entry; offset: number }[] = []
  for (const entry of entries) {
    const start = offset
    out.writeUInt32LE(0x04034b50, offset)
    out.writeUInt16LE(20, offset + 4)
    out.writeUInt16LE(0x0800, offset + 6)
    out.writeUInt16LE(0, offset + 8)
    out.writeUInt16LE(0, offset + 10)
    out.writeUInt16LE(0x0021, offset + 12)
    out.writeUInt32LE(entry.crc, offset + 14)
    out.writeUInt32LE(entry.data.length, offset + 18)
    out.writeUInt32LE(entry.data.length, offset + 22)
    out.writeUInt16LE(entry.name.length, offset + 26)
    out.writeUInt16LE(0, offset + 28)
    entry.name.copy(out, offset + 30)
    entry.data.copy(out, offset + 30 + entry.name.length)
    offset += 30 + entry.name.length + entry.data.length
    central.push({ entry, offset: start })
  }
  const centralStart = offset
  for (const { entry, offset: localOffset } of central) {
    out.writeUInt32LE(0x02014b50, offset)
    out.writeUInt16LE(20, offset + 4)
    out.writeUInt16LE(20, offset + 6)
    out.writeUInt16LE(0x0800, offset + 8)
    out.writeUInt16LE(0, offset + 10)
    out.writeUInt16LE(0, offset + 12)
    out.writeUInt16LE(0x0021, offset + 14)
    out.writeUInt32LE(entry.crc, offset + 16)
    out.writeUInt32LE(entry.data.length, offset + 20)
    out.writeUInt32LE(entry.data.length, offset + 24)
    out.writeUInt16LE(entry.name.length, offset + 28)
    out.writeUInt16LE(0, offset + 30)
    out.writeUInt16LE(0, offset + 32)
    out.writeUInt16LE(0, offset + 34)
    out.writeUInt16LE(0, offset + 36)
    out.writeUInt32LE(0, offset + 38)
    out.writeUInt32LE(localOffset, offset + 42)
    entry.name.copy(out, offset + 46)
    offset += 46 + entry.name.length
  }
  out.writeUInt32LE(0x06054b50, offset)
  out.writeUInt16LE(0, offset + 4)
  out.writeUInt16LE(0, offset + 6)
  out.writeUInt16LE(entries.length, offset + 8)
  out.writeUInt16LE(entries.length, offset + 10)
  out.writeUInt32LE(offset - centralStart, offset + 12)
  out.writeUInt32LE(centralStart, offset + 16)
  out.writeUInt16LE(0, offset + 20)
  return out
}

/**
 * Write one package ZIP to disk.
 * @param plan - package plan.
 * @param path - destination file.
 * @returns the byte count.
 */
export function writeClaudeZip(plan: ClaudePackagePlan, path: string): number {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const bytes = archiveClaudePackage(plan)
    writeFileSync(path, bytes)
    return bytes.length
  } catch (error) {
    throw portableError('PORTABLE_ADAPTER_INVALID', error instanceof Error ? error.message : String(error))
  }
}
