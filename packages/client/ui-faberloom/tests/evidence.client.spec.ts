import { describe, expect, it } from 'vitest'
import { evidenceLabel, evidenceText } from '../src/client/evidence.ts'

/** Copy seat over the shipped English dictionary. */
const LABELS: Readonly<Record<string, string>> = {
  'mesa.evidence.mail': 'Mail thread',
  'mesa.evidence.mwPrice': 'MWT.ONE list price',
  'mesa.evidence.mw': 'MWT.ONE lookup',
  'mesa.evidence.order': 'Purchase order',
  'mesa.evidence.sap': 'SAP document',
  'mesa.evidence.fx': 'Exchange rate',
  'mesa.evidence.expediente': 'Expediente',
  'mesa.evidence.sicop': 'SICOP',
  'mesa.evidence.routine': 'Routine',
  'mesa.evidence.execution': 'Execution',
  'mesa.evidence.step': 'Step',
}
const t = (key: string): string => LABELS[key] ?? key

describe('evidence labels', () => {
  it('removes mail UIDs, opaque ids, and storage keys', () => {
    const raw = 'Correo uid 2980 de alvaro@muitowork.com (29-oct-2026 20:00 UTC), '
      + 'Adjunto BL 2488.pdf subido a MinIO (key documento/a9d80c16-3e3c-4e16-bb06-3da1c974b332/d33b29e3-bl-2488.pdf), '
      + 'Expediente 2488-2026 (PO 505244, SAP 282507, id a9d80c16-3e3c-4e16-bb06-3da1c974b332) en estado PREPARACION'
    const label = evidenceLabel(raw)
    expect(label).not.toContain('uid')
    expect(label).not.toContain('a9d80c16')
    expect(label).not.toContain('key documento')
    expect(label).toContain('Correo de alvaro@muitowork.com')
    expect(label).toContain('BL 2488.pdf')
    expect(label).toContain('Expediente 2488-2026')
    expect(label).toContain('PO 505244')
    expect(label).not.toMatch(/\(\s*$/u)
  })

  it('keeps an ordinary reference untouched and never returns empty', () => {
    expect(evidenceLabel('oc:505288')).toBe('oc:505288')
    expect(evidenceLabel('Correo uid 12')).toBe('Correo')
  })
})

describe('evidence sentences', () => {
  it('names the channel behind each producer token', () => {
    expect(evidenceText('mail:thread-1', t)).toBe('Mail thread 1')
    expect(evidenceText('mw:price:701414', t)).toBe('MWT.ONE list price 701414')
    expect(evidenceText('oc:505288', t)).toBe('Purchase order 505288')
    expect(evidenceText('sap:282507', t)).toBe('SAP document 282507')
    expect(evidenceText('fx:usd-crc', t)).toBe('Exchange rate usd-crc')
    expect(evidenceText('expediente:2487-2026', t)).toBe('Expediente 2487-2026')
    expect(evidenceText('sicop:2026LA-0001', t)).toBe('SICOP 2026LA-0001')
  })

  it('keeps the channel when the reference carries only an opaque id', () => {
    expect(evidenceText('routine:1d2c979f-d983-43b0-9b4c-8f2f5c0f7a11', t)).toBe('Routine')
    expect(evidenceText('execution:', t)).toBe('Execution')
  })

  it('treats an unknown prefix as text instead of inventing a channel', () => {
    expect(evidenceText('Correo recibido', t)).toBe('Correo recibido')
    expect(evidenceText('mw', t)).toBe('MWT.ONE lookup')
  })
})
