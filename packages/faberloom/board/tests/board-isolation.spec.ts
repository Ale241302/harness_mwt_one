import { describe, expect, it } from 'vitest'
import { boardItemRecord } from '../src/spec.ts'
import {
  ACTOR_A,
  ACTOR_B,
  COMPANY_A,
  COMPANY_B,
  OWNER_A,
  bootBoard,
  proformaFixture,
  seedProforma,
  seedSpace,
} from './helpers/harness.ts'

describe('FaberLoomBoard isolation', () => {
  it('W-23 · refuses a read from another owner', async () => {
    const { board } = await bootBoard()
    const item = await seedProforma(board, OWNER_A, COMPANY_A)

    await expect(board.get(ACTOR_B, item.id)).rejects.toThrow('NO_ACCESS')
    await expect(board.get({ id: OWNER_A + '.other' }, item.id)).rejects.toThrow('NO_ACCESS')
    expect(await board.list(ACTOR_B)).toEqual([])
  })

  it('W-23 · refuses a read from another company even when the owner matches', async () => {
    const { board } = await bootBoard()
    const item = await seedProforma(board, OWNER_A, COMPANY_A)

    await expect(board.get({ id: OWNER_A, companyId: 'co-sonepar' }, item.id)).rejects.toThrow('NO_ACCESS')
    expect(await board.list({ id: OWNER_A, companyId: 'co-sonepar' })).toEqual([])
    expect((await board.get(ACTOR_A, item.id)).companyId).toBe(COMPANY_A)
  })

  it('denies a company-scoped item to an actor with no company, read and write', async () => {
    const { board } = await bootBoard()
    const item = await seedProforma(board, OWNER_A, COMPANY_A)
    const noCompany = { id: OWNER_A }

    await expect(board.get(noCompany, item.id)).rejects.toThrow('NO_ACCESS')
    expect(await board.list(noCompany)).toEqual([])
    await expect(board.review(noCompany, item.id, { decision: 'approve', version: 1 })).rejects.toThrow('NO_ACCESS')
    await expect(board.review({ id: OWNER_A, companyId: COMPANY_B }, item.id, { decision: 'approve', version: 1 })).rejects.toThrow('NO_ACCESS')
    await expect(board.recordEffect(noCompany, item.id, { ref: 'mail:1', authorization: 'x' })).rejects.toThrow('NO_ACCESS')
  })

  it('refuses to create an item for another company', async () => {
    const { board } = await bootBoard()
    await expect(board.create({ id: OWNER_A, companyId: COMPANY_A }, {
      title: 'x', summary: 's', evidence: ['e'], companyId: COMPANY_B,
    })).rejects.toThrow('NO_ACCESS')
    const own = await board.create({ id: OWNER_A, companyId: COMPANY_A }, {
      title: 'x', summary: 's', evidence: ['e'],
    })
    expect(own.companyId).toBe(COMPANY_A)
  })

  it('keeps a single-tenant item readable when the deployment has no company', async () => {
    const { board } = await bootBoard()
    const item = await board.create(OWNER_A, { title: 'x', summary: 's', evidence: ['e'] })

    expect(item.companyId).toBeNull()
    expect((await board.get({ id: OWNER_A }, item.id)).id).toBe(item.id)
    expect((await board.list({ id: OWNER_A })).map(row => row.id)).toEqual([item.id])
  })

  it('reads a record written before tenant scoping as company-less', () => {
    const legacy = {
      ownerId: OWNER_A,
      spaceId: null,
      routineId: null,
      title: 'Legacy',
      status: 'waiting_approval',
      version: 1,
      revisions: [{ version: 1, summary: 's', evidence: ['e'], documentRef: null, at: '2026-10-01T00:00:00.000Z' }],
      approvedRevision: null,
      stale: false,
      staleReason: null,
      effects: [],
      reviews: [],
      executionId: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    }
    // The stored record predates `companyId`; the schema default fills it.
    expect(boardItemRecord.parse(legacy).companyId).toBeNull()
  })

  it('filters the list by status and space inside the actor scope', async () => {
    const harness = await bootBoard()
    const { board } = harness
    const firstSpace = await seedSpace(harness, ACTOR_A, 'Proveedores')
    const secondSpace = await seedSpace(harness, ACTOR_A, 'Clientes')
    const first = await seedProforma(board, OWNER_A, COMPANY_A, firstSpace)
    await seedProforma(board, OWNER_A, COMPANY_A, secondSpace)

    expect((await board.list(ACTOR_A, { spaceId: firstSpace })).map(row => row.id)).toEqual([first.id])
    expect((await board.list(ACTOR_A, { status: 'approved' }))).toEqual([])
  })

  it('loads the golden proforma fixture with its expected checks', () => {
    const fixture = proformaFixture()
    const sum = fixture.lines.reduce((total, line) => total + line.quantity * line.unitPrice, 0)
    expect(fixture.artifactType).toBe('proforma')
    expect(fixture.lines.length).toBeGreaterThan(0)
    expect(fixture.lines.every(line => line.sku.length > 0 && line.quantity > 0)).toBe(true)
    expect(sum).toBe(286)
    expect(sum).toBe(fixture.total)
    expect(fixture.expected['linesSumToTotal']).toBe(true)
  })
})
