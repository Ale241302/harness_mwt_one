import { describe, expect, it } from 'vitest'
import { resolveSpaceContributions } from '../src/resolve.ts'
import {
  ACTOR_A,
  COMPANY_A,
  OWNER_A2,
  bootBoard,
} from '../../board/tests/helpers/harness.ts'

const MEMBER = { id: OWNER_A2, role: 'client_b2b', companyId: COMPANY_A, readOnly: false }

describe('3B.1 contribution resolution and parent authorization', () => {
  it('does not leak a parent context or memory to a child-only member (CTX-01)', async () => {
    const harness = await bootBoard()
    const parent = await harness.spaces.create(ACTOR_A, { title: 'Padre' })
    const child = await harness.spaces.create(ACTOR_A, {
      title: 'Hijo',
      parentId: parent.id,
    })
    await harness.spaces.update(ACTOR_A, parent.id, { context: { 'regla-padre': 'valor privado del padre' } })
    await harness.spaces.update(ACTOR_A, child.id, {
      members: [OWNER_A2],
      context: { 'regla-hija': 'valor del hijo' },
    })
    await harness.spaces.remember(ACTOR_A, 'memoria privada del padre', [parent.id])

    const context = await harness.spaces.effectiveContext(MEMBER, child.id)
    expect(context.resolved['regla-hija']).toBe('valor del hijo')
    expect(context.resolved).not.toHaveProperty('regla-padre')
    expect(await harness.spaces.effectiveMemory(MEMBER, child.id)).toEqual([])
    const resolution = await harness.spaces.resolveContributions(MEMBER, child.id)
    expect(resolution.contributions.map(entry => entry.id)).not.toContain('rule:regla-padre')
    expect(JSON.stringify(resolution)).not.toContain('valor privado del padre')
    expect(JSON.stringify(resolution)).not.toContain('memoria privada del padre')
  })

  it('inherits only after the actor receives access by contribution to the parent', async () => {
    const harness = await bootBoard()
    const parent = await harness.spaces.create(ACTOR_A, { title: 'Padre' })
    const child = await harness.spaces.create(ACTOR_A, {
      title: 'Hijo',
      parentId: parent.id,
    })
    await harness.spaces.update(ACTOR_A, parent.id, {
      members: [OWNER_A2],
      context: { 'regla-padre': 'valor compartido' },
    })
    await harness.spaces.update(ACTOR_A, child.id, { members: [OWNER_A2] })
    await harness.spaces.remember(ACTOR_A, 'memoria compartida', [parent.id])

    const context = await harness.spaces.effectiveContext(MEMBER, child.id)
    expect(context.resolved['regla-padre']).toBe('valor compartido')
    expect((await harness.spaces.effectiveMemory(MEMBER, child.id)).map(entry => entry.text))
      .toContain('memoria compartida')
    const resolution = await harness.spaces.resolveContributions(MEMBER, child.id)
    expect(resolution.contributions.map(entry => entry.id)).toContain('rule:regla-padre')
  })

  it('resolves skill contributions with child precedence', () => {
    const resolution = resolveSpaceContributions('child', [
      { id: 'skill:saludo', kind: 'skill', title: 'saludo', body: 'child', spaceId: 'child', inheritable: false, granted: true },
      { id: 'skill:saludo', kind: 'skill', title: 'saludo', body: 'parent', spaceId: 'parent', inheritable: true, granted: true },
    ])
    expect(resolution.contributions).toEqual([
      { id: 'skill:saludo', kind: 'skill', title: 'saludo', body: 'child', spaceId: 'child' },
    ])
  })

  it('rejects duplicate names, dependency cycles, missing dependencies, and budget overflow without silent truncation', () => {
    const budget = resolveSpaceContributions('child', [
      { id: 'root', kind: 'rule', title: 'A', body: 'root', spaceId: 'child', inheritable: false, granted: true },
      { id: 'dup-a', kind: 'rule', title: 'Same', body: 'uno', spaceId: 'child', inheritable: false, granted: true },
      { id: 'dup-b', kind: 'rule', title: 'Same', body: 'dos', spaceId: 'child', inheritable: false, granted: true },
      { id: 'missing', kind: 'document', title: 'M', body: 'm', spaceId: 'child', inheritable: false, granted: true, dependsOn: ['absent'] },
      { id: 'cycle-a', kind: 'document', title: 'CA', body: 'a', spaceId: 'child', inheritable: false, granted: true, dependsOn: ['cycle-b'] },
      { id: 'cycle-b', kind: 'document', title: 'CB', body: 'b', spaceId: 'child', inheritable: false, granted: true, dependsOn: ['cycle-a'] },
    ])
    expect(budget.contributions.map(entry => entry.id)).toEqual(['root'])
    expect(budget.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dup-a', reason: 'name-conflict' }),
      expect.objectContaining({ id: 'dup-b', reason: 'name-conflict' }),
      expect.objectContaining({ id: 'missing', reason: 'dependency-missing' }),
    ]))
    expect(budget.cycles).toEqual(['cycle-a', 'cycle-b'])

    const overflow = resolveSpaceContributions('child', [
      { id: 'large', kind: 'document', title: 'L', body: 'x'.repeat(20), spaceId: 'child', inheritable: false, granted: true },
      { id: 'small', kind: 'document', title: 'S', body: 'ok', spaceId: 'child', inheritable: false, granted: true },
    ], { maxBytes: 10 })
    expect(overflow.contributions.map(entry => entry.id)).toEqual(['small'])
    expect(overflow.issues).toContainEqual(expect.objectContaining({ id: 'large', reason: 'context-budget' }))
  })

  it('never names a private parent in the issue report', () => {
    const resolution = resolveSpaceContributions('child', [
      { id: 'root', kind: 'rule', title: 'R', body: 'root', spaceId: 'child', inheritable: false, granted: true },
      { id: 'dep', kind: 'document', title: 'D', body: 'd', spaceId: 'child', inheritable: false, granted: true, dependsOn: ['private'] },
      { id: 'private', kind: 'document', title: 'Nombre privado', body: 'cuerpo privado', spaceId: 'parent', inheritable: true, granted: false },
    ])
    expect(JSON.stringify(resolution)).not.toContain('Nombre privado')
    expect(JSON.stringify(resolution)).not.toContain('cuerpo privado')
    expect(resolution.issues).toContainEqual({ id: 'dep', reason: 'dependency-missing' })
  })

  it('identifies affected children and reevaluates permission for each (PUB-06)', async () => {
    const harness = await bootBoard()
    const parent = await harness.spaces.create(ACTOR_A, { title: 'Padre' })
    const childOne = await harness.spaces.create(ACTOR_A, { title: 'Hijo uno', parentId: parent.id })
    const childTwo = await harness.spaces.create(ACTOR_A, { title: 'Hijo dos', parentId: parent.id })
    await harness.spaces.update(ACTOR_A, parent.id, { members: [OWNER_A2] })
    await harness.spaces.update(ACTOR_A, childOne.id, { members: [OWNER_A2] })

    const impact = await harness.spaces.parentChangeImpact(MEMBER, parent.id)
    expect(impact.parentId).toBe(parent.id)
    expect(impact.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: childOne.id, permitted: true }),
      expect.objectContaining({ id: childTwo.id, permitted: false }),
    ]))
    expect(impact.children.every(child => child.revision.length > 0)).toBe(true)
    expect(JSON.stringify(impact)).not.toContain('Hijo uno')
    expect(JSON.stringify(impact)).not.toContain('Hijo dos')
  })
})
