import { describe, expect, it } from 'vitest'
import FaberLoomShares from '../../shares/src/index.ts'
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

  it('stops inheriting after the parent view grant is revoked', async () => {
    const harness = await bootBoard()
    await harness.ctx.plugin(FaberLoomShares)
    const parent = await harness.spaces.create(ACTOR_A, { title: 'Padre' })
    await harness.spaces.update(ACTOR_A, parent.id, { context: { 'regla-padre': 'valor compartido' } })
    const child = await harness.spaces.create(ACTOR_A, { title: 'Hijo', parentId: parent.id })
    await harness.spaces.update(ACTOR_A, child.id, { members: [OWNER_A2] })

    const grant = await harness.ctx.faberloomShares.create(ACTOR_A.id, {
      resource: { kind: 'space', id: parent.id },
      resourceName: 'Padre',
      granteeEmail: OWNER_A2,
      permissions: ['view'],
    })
    await harness.ctx.faberloomShares.accept(OWNER_A2, grant.id)

    expect((await harness.spaces.effectiveContext(MEMBER, child.id)).resolved['regla-padre'])
      .toBe('valor compartido')
    await harness.ctx.faberloomShares.revoke(ACTOR_A.id, grant.id)
    expect(await harness.spaces.effectiveContext(MEMBER, child.id)).toMatchObject({ resolved: {} })
    const resolution = await harness.spaces.resolveContributions(MEMBER, child.id)
    expect(resolution.contributions.map(entry => entry.id)).not.toContain('rule:regla-padre')
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

    const dependent = resolveSpaceContributions('child', [
      { id: 'dep', kind: 'document', title: 'D', body: 'x'.repeat(20), spaceId: 'child', inheritable: false, granted: true },
      { id: 'user', kind: 'document', title: 'U', body: 'y', spaceId: 'child', inheritable: false, granted: true, dependsOn: ['dep'] },
    ], { maxBytes: 10 })
    expect(dependent.contributions).toEqual([])
    expect(dependent.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'dep', reason: 'context-budget' }),
      expect.objectContaining({ id: 'user', reason: 'dependency-blocked' }),
    ]))
  })

  it('keeps the child contribution when an ancestor reuses its name', () => {
    const resolution = resolveSpaceContributions('child', [
      { id: 'document:root', kind: 'document', title: 'Mismo', body: 'hijo', spaceId: 'child', inheritable: false, granted: true },
      { id: 'document:parent', kind: 'document', title: 'Mismo', body: 'padre', spaceId: 'parent', inheritable: true, granted: true },
    ])
    expect(resolution.contributions.map(entry => entry.body)).toEqual(['hijo'])
    expect(resolution.issues).toEqual([{ id: 'document:parent', reason: 'name-conflict' }])
  })

  it('excludes a whole Space and rejects an invalid byte budget', () => {
    const resolution = resolveSpaceContributions('child', [
      { id: 'rule:root', kind: 'rule', title: 'R', body: 'root', spaceId: 'child', inheritable: false, granted: true },
      { id: 'rule:parent', kind: 'rule', title: 'P', body: 'parent', spaceId: 'parent', inheritable: true, granted: true },
    ], { excluded: ['parent'] })
    expect(resolution.contributions.map(entry => entry.id)).toEqual(['rule:root'])
    expect(resolution.excluded).toEqual(['parent'])
    const withMemory = resolveSpaceContributions('child', [
      { id: 'memory:parent', kind: 'memory', title: 'm', body: 'nota', spaceId: 'parent', inheritable: true, granted: true },
    ], { excluded: ['parent'] })
    expect(withMemory.contributions.map(entry => entry.id)).toEqual(['memory:parent'])
    expect(() => resolveSpaceContributions('child', [], { maxBytes: Number.NaN }))
      .toThrow('context budget')
    expect(() => resolveSpaceContributions('child', [], { maxBytes: -1 }))
      .toThrow('context budget')
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

    const ownerImpact = await harness.spaces.parentChangeImpact(ACTOR_A, parent.id)
    expect(ownerImpact.children).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: childOne.id, permitted: true }),
      expect.objectContaining({ id: childTwo.id, permitted: true }),
    ]))
    expect(ownerImpact.children.every(child => child.revision.length > 0)).toBe(true)

    // A member may read the parent and one child but cannot publish into it.
    const memberImpact = await harness.spaces.parentChangeImpact(MEMBER, parent.id)
    expect(memberImpact.children).toHaveLength(1)
    expect(memberImpact.children[0]).toMatchObject({ id: childOne.id, permitted: false })
    expect(memberImpact.children[0]?.revision).toMatch(/\S/u)
    expect(JSON.stringify(memberImpact)).not.toContain(childTwo.id)
    expect(JSON.stringify(memberImpact)).not.toContain('Hijo uno')
    expect(JSON.stringify(memberImpact)).not.toContain('Hijo dos')
  })

  it('omits a readable descendant behind an unreadable intermediate', async () => {
    const harness = await bootBoard()
    const parent = await harness.spaces.create(ACTOR_A, { title: 'Padre' })
    await harness.spaces.update(ACTOR_A, parent.id, { members: [OWNER_A2] })
    const hidden = await harness.spaces.create(ACTOR_A, { title: 'Intermedio', parentId: parent.id })
    const deep = await harness.spaces.create(ACTOR_A, { title: 'Nieto', parentId: hidden.id })
    await harness.spaces.update(ACTOR_A, deep.id, { members: [OWNER_A2] })

    const impact = await harness.spaces.parentChangeImpact(MEMBER, parent.id)
    expect(impact.children.map(child => child.id)).not.toContain(deep.id)
    expect((await harness.spaces.effectiveContext(MEMBER, deep.id)).resolved).toEqual({})
  })

  it('omits descendants that opted out of inheritance or excluded the parent', async () => {
    const harness = await bootBoard()
    const parent = await harness.spaces.create(ACTOR_A, { title: 'Padre' })
    const child = await harness.spaces.create(ACTOR_A, { title: 'Hijo', parentId: parent.id })
    const grandchild = await harness.spaces.create(ACTOR_A, { title: 'Nieto', parentId: child.id })
    const optedOut = await harness.spaces.create(ACTOR_A, { title: 'Sin herencia', parentId: parent.id })
    const excluded = await harness.spaces.create(ACTOR_A, { title: 'Excluye', parentId: parent.id })
    await harness.spaces.update(ACTOR_A, optedOut.id, { inheritContext: false })
    await harness.spaces.update(ACTOR_A, excluded.id, { excluded: [parent.id] })

    const impact = await harness.spaces.parentChangeImpact(ACTOR_A, parent.id)
    const ids = impact.children.map(childImpact => childImpact.id)
    expect(ids).toEqual(expect.arrayContaining([child.id, grandchild.id]))
    expect(ids).not.toContain(optedOut.id)
    expect(ids).not.toContain(excluded.id)
  })
})
