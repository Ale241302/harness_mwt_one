import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyPath, classifyPaths, inspectUpstream, parseNumstat, toMarkdown, type GitRunner } from './compare-upstream.ts'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

const fakeRunner = (answers: Record<string, { ok: boolean; stdout?: string; stderr?: string }>): GitRunner => (args) => {
  const key = args.join(' ')
  const answer = answers[key]
  if (!answer) return { ok: false, stdout: '', stderr: `sin respuesta para ${key}` }
  return { ok: answer.ok, stdout: answer.stdout ?? '', stderr: answer.stderr ?? '' }
}

const baseAnswers = (): Record<string, { ok: boolean; stdout?: string; stderr?: string }> => ({
  'rev-parse HEAD': { ok: true, stdout: 'b'.repeat(40) },
  'rev-parse --abbrev-ref HEAD': { ok: true, stdout: 'fix/rama' },
  'status --porcelain': { ok: true, stdout: '' },
  'rev-parse --verify --quiet origin/master': { ok: true, stdout: 'a'.repeat(40) },
  'merge-base HEAD origin/master': { ok: true, stdout: 'c'.repeat(40) },
  'rev-list --left-right --count origin/master...HEAD': { ok: true, stdout: '10\t755' },
  'diff --numstat origin/master...HEAD': {
    ok: true,
    stdout: ['12\t3\tpackages/faberloom/inbound/src/index.ts', '1\t1\tREADME.md', '0\t0\tpackages/core/session/src/x.ts'].join('\n'),
  },
})

describe('clasificación de rutas', () => {
  it('agrupa por área del monorepo', () => {
    expect(classifyPath('packages/faberloom/board/src/index.ts')).toBe('faberloom')
    expect(classifyPath('packages/core/session/src/a.ts')).toBe('core')
    expect(classifyPath('packages/client/ui-faberloom/src/b.tsx')).toBe('client')
    expect(classifyPath('apps/web/tests/x.e2e.ts')).toBe('apps')
    expect(classifyPath('README.md')).toBe('raiz:README.md')
  })

  it('normaliza separadores de Windows', () => {
    expect(classifyPath('packages\\faberloom\\view\\src\\a.ts')).toBe('faberloom')
  })

  it('ordena de mayor a menor y desempata por nombre', () => {
    const counts = classifyPaths(['packages/core/a.ts', 'packages/faberloom/b.ts', 'packages/faberloom/c.ts'])
    expect(counts[0]).toEqual({ area: 'faberloom', files: 2 })
    expect(counts[1]).toEqual({ area: 'core', files: 1 })
  })
})

describe('parseo de numstat', () => {
  it('suma adiciones y borrados y conserva rutas con tabulaciones', () => {
    const parsed = parseNumstat('3\t0\ta.ts\n0\t5\tb.ts\n-\t-\tbinario.dat\n')
    expect(parsed.changedFiles).toBe(3)
    expect(parsed.insertions).toBe(3)
    expect(parsed.deletions).toBe(5)
    expect(parsed.paths).toContain('binario.dat')
  })

  it('ignora líneas vacías', () => {
    expect(parseNumstat('\n\n').changedFiles).toBe(0)
  })
})

describe('diagnóstico del upstream', () => {
  it('calcula base común, separación y áreas', () => {
    const report = inspectUpstream('/repo', { run: fakeRunner(baseAnswers()) })
    expect(report.mergeBase).toBe('c'.repeat(40))
    expect(report.ahead).toBe(755)
    expect(report.behind).toBe(10)
    expect(report.changedFiles).toBe(3)
    expect(report.insertions).toBe(13)
    expect(report.deletions).toBe(4)
    expect(report.dirty).toBe(false)
    expect(report.byArea.map(a => a.area)).toContain('faberloom')
  })

  it('declara la falta de referencia en vez de estimar', () => {
    const answers = baseAnswers()
    answers['rev-parse --verify --quiet origin/master'] = { ok: false }
    const report = inspectUpstream('/repo', { run: fakeRunner(answers) })
    expect(report.upstreamSha).toBeNull()
    expect(report.ahead).toBeNull()
    expect(report.limitations.join(' ')).toContain('no se hizo fetch')
    expect(toMarkdown(report)).toContain('desconocida')
  })

  it('reporta el objeto histórico ausente', () => {
    const answers = baseAnswers()
    answers['cat-file -e 39163dd30f703a79079e2d2446545cff3c453738^{commit}'] = { ok: false }
    const report = inspectUpstream('/repo', { run: fakeRunner(answers), historicalObject: '39163dd30f703a79079e2d2446545cff3c453738' })
    expect(report.missingObject).toBe('39163dd30f703a79079e2d2446545cff3c453738')
    expect(report.limitations.join(' ')).toContain('no está disponible localmente')
  })

  it('marca el árbol sucio', () => {
    const answers = baseAnswers()
    answers['status --porcelain'] = { ok: true, stdout: ' M MANIFEST.md' }
    expect(inspectUpstream('/repo', { run: fakeRunner(answers) }).dirty).toBe(true)
  })

  it('avisa cuando el fork está por detrás', () => {
    const report = inspectUpstream('/repo', { run: fakeRunner(baseAnswers()) })
    expect(report.limitations.join(' ')).toContain('por detrás')
  })
})

describe('repositorio real', () => {
  const isGit = (): boolean => {
    try {
      execFileSync('git', ['-C', repoRoot, 'rev-parse', '--git-dir'], { stdio: 'ignore' })
      return true
    } catch {
      return false
    }
  }

  it.skipIf(!isGit())('lee HEAD y devuelve una revisión de 40 caracteres', () => {
    const report = inspectUpstream(repoRoot)
    expect(report.head).toHaveLength(40)
    expect(report.branch.length).toBeGreaterThan(0)
    expect(toMarkdown(report)).toContain('Repositorio')
  })
})
