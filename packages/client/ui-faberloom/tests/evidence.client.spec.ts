import { describe, expect, it } from 'vitest'
import { evidenceLabel } from '../src/client/evidence.ts'

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
