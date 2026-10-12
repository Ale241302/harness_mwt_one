import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { FaberLoomViewService } from '../src/index.ts'

const homes: string[] = []

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

/** The minimal service graph `sendSpaceFileByEmail` touches. */
function harness(options: { connections?: boolean } = {}) {
  const space = { id: 'sp1', title: 'ACME', workspaceId: undefined }
  const spaces = {
    get: vi.fn(async () => space),
    resolveWorkdir: vi.fn(async () => ({ kind: 'opaque' as const, ref: 'fw_oc' })),
  }
  const sendMail = vi.fn(async () => ({ messageId: '<m@faberloom.local>', accepted: ['cliente@example.com'] }))
  const ctx = {
    faberloomSpaces: spaces,
    provide: () => {},
    reflect: { provide: () => {} },
    effect: (run: () => unknown) => { run(); return () => {} },
    on: vi.fn(() => () => {}),
    logger: { warn: vi.fn(), info: vi.fn() },
    get: (name: string) => name === 'faberloomConnections' && options.connections !== false ? { sendMail } : undefined,
  } as unknown as Context
  const view = new FaberLoomViewService(ctx, { ownerId: 'owner@muitowork.com', role: 'admin', readOnly: false })
  return { view, sendMail }
}

/** Create the space folder and one file inside it. */
function seed(home: string, name: string, content: string): void {
  const dir = join(home, 'spaces', 'fw_oc')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), content)
}

describe('sendSpaceFileByEmail', () => {
  it('mails a file from the space folder as an attachment', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-send-file-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    seed(home, 'proforma.pdf', '%PDF-1.4')
    const { view, sendMail } = harness()

    const sent = await view.sendSpaceFileByEmail('sp1', 'proforma.pdf', 'cliente@example.com, otro@example.com', 'Proforma', 'Adjunto la proforma.')

    expect(sent).toEqual({ messageId: '<m@faberloom.local>', accepted: ['cliente@example.com'] })
    expect(sendMail).toHaveBeenCalledWith('owner@muitowork.com', {
      to: ['cliente@example.com', 'otro@example.com'],
      subject: 'Proforma',
      text: 'Adjunto la proforma.',
      attachments: [{
        name: 'proforma.pdf',
        mediaType: 'application/octet-stream',
        contentBase64: Buffer.from('%PDF-1.4').toString('base64'),
      }],
    })
  })

  it('refuses a path outside the space folder', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-send-file-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    const { view, sendMail } = harness()

    await expect(view.sendSpaceFileByEmail('sp1', '../../secreto.txt', 'a@example.com', 'S', 'T'))
      .rejects.toThrow(/dentro de la carpeta del Space/u)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('refuses to send without recipients', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-send-file-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    seed(home, 'proforma.pdf', '%PDF-1.4')
    const { view, sendMail } = harness()

    await expect(view.sendSpaceFileByEmail('sp1', 'proforma.pdf', '  ,  ', 'S', 'T'))
      .rejects.toThrow(/no tiene destinatarios/u)
    expect(sendMail).not.toHaveBeenCalled()
  })

  it('refuses when no mail connection is mounted', async () => {
    const home = mkdtempSync(join(tmpdir(), 'view-send-file-'))
    homes.push(home)
    vi.stubEnv('DSH_HOME', home)
    seed(home, 'proforma.pdf', '%PDF-1.4')
    const { view } = harness({ connections: false })

    await expect(view.sendSpaceFileByEmail('sp1', 'proforma.pdf', 'a@example.com', 'S', 'T'))
      .rejects.toThrow(/conexión de correo/u)
  })
})
