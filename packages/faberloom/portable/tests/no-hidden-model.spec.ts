import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  installClaudePackage,
  loadClaudePackage,
  newClaudePackageDirectory,
  planClaudePackage,
  planPortable,
  type PortableContribution,
} from '../src/index.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function temporary(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

function document(overrides: Partial<PortableContribution> = {}): PortableContribution {
  return {
    id: 'document:knowledge/a.md',
    kind: 'document',
    path: 'knowledge/a.md',
    title: 'A',
    content: '# A\n\nContenido autorizado.\n',
    classification: 'N2',
    ...overrides,
  }
}

function packageFiles(root: string, current = root): string[] {
  const out: string[] = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const target = join(current, entry.name)
    if (entry.isDirectory()) out.push(...packageFiles(root, target))
    else out.push(readFileSync(target, 'utf8'))
  }
  return out
}

describe('4A.2 IA-01 no hidden model', () => {
  it('builds, validates, loads, and removes the package without any model or network call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const artifact = planPortable({
      identity: {
        spaceId: 'sp-1',
        spaceTitle: 'Espacio sin modelo',
        editorialRevision: 'a'.repeat(40),
        parentRevision: null,
      },
      generatedAt: '2026-11-09T00:00:00.000Z',
      softwareVersion: '1.0.0',
      contributions: [document()],
    })
    const plan = planClaudePackage({
      artifact,
      connection: { referenceId: 'fwr_no_model', host: 'claude-code' },
      hostVersion: '2.1.126',
      runtimeAvailable: true,
      generatedAt: '2026-11-09T00:00:00.000Z',
    })
    const target = newClaudePackageDirectory(temporary('faberloom-no-model-'))
    installClaudePackage(plan, target)
    loadClaudePackage(target, '2.1.126')

    const text = packageFiles(target).join('\n')
    for (const forbidden of [
      'api.anthropic.com',
      'api.openai.com',
      'generativelanguage.googleapis.com',
      'fetch(',
      'XMLHttpRequest',
      'child_process',
      'spawn(',
      'exec(',
    ]) {
      expect(text).not.toContain(forbidden)
    }
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
