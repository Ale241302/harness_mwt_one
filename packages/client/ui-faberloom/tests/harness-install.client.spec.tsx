// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComponentProps } from 'react'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { FaberLoomHarnessReport } from '@deepseek-ai/dsh-faberloom-view/types'
import { en } from '../src/client/locales.ts'
import { HarnessInstallWizard } from '../src/client/harness-install.tsx'

afterEach(cleanup)

const t = makeTranslate(en, commonEn) as never

type Props = ComponentProps<typeof HarnessInstallWizard>

/** One Remote result, as the generated client returns it. */
type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/** A successful Remote result. */
function ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

/** A failed Remote result. */
function failed(message: string): Result<never> {
  return { ok: false, error: { code: 'test', message } }
}

/** A report naming two parts. */
const REPORT: FaberLoomHarnessReport = {
  status: 'installed',
  source: 'C:/fuentes/ECC',
  root: 'C:/fuentes/ECC',
  parts: [
    { kind: 'agents', status: 'installed', count: 2, target: 'C:/home/.agent-presets' },
    { kind: 'skills', status: 'installed', count: 5, target: 'C:/home/skills' },
  ],
  outcomes: [
    { name: 'saluda', status: 'installed' },
    { name: 'contable', status: 'installed' },
  ],
}

/** The wizard over stubbed pickers and Remote calls. */
function props(overrides: Partial<Props> = {}): Props {
  const base: Props = {
    t,
    pickSource: vi.fn(async () => 'C:/fuentes/ECC.zip'),
    install: vi.fn(async (): Promise<Result<FaberLoomHarnessReport>> => ok(REPORT)),
    onChanged: vi.fn(),
  }
  return { ...base, ...overrides }
}

describe('HarnessInstallWizard', () => {
  it('opens the chooser from the install button and installs the picked archive', async () => {
    const install = vi.fn(async (): Promise<Result<FaberLoomHarnessReport>> => ok(REPORT))
    const onChanged = vi.fn()
    render(<HarnessInstallWizard {...props({ install, onChanged })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Install Harness' }))
    expect(screen.getByText('Choose the .zip or any file inside the harness folder.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Choose folder or \.zip/ }))

    await waitFor(() => { expect(install).toHaveBeenCalledWith('C:/fuentes/ECC.zip', false) })
    expect(await screen.findByRole('dialog', { name: 'Installing Harness' })).toBeTruthy()
    expect(await screen.findByRole('dialog', { name: 'Harness installed' }, { timeout: 4000 })).toBeTruthy()
    expect(screen.getByText('C:/home/skills')).toBeTruthy()
    expect(onChanged).toHaveBeenCalledOnce()
  })

  it('treats any file inside a harness folder as that folder, and keeps the replace flag', async () => {
    const install = vi.fn(async (): Promise<Result<FaberLoomHarnessReport>> => ok(REPORT))
    render(<HarnessInstallWizard {...props({
      install,
      pickSource: vi.fn(async () => 'C:/fuentes/ECC/AGENTS.md'),
    })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Install Harness' }))
    fireEvent.click(screen.getByLabelText('Replace when it already exists'))
    fireEvent.click(screen.getByRole('button', { name: /Choose folder or \.zip/ }))

    await waitFor(() => { expect(install).toHaveBeenCalledWith('C:/fuentes/ECC', true) })
  })

  it('shows the refusal instead of a confirmation', async () => {
    render(<HarnessInstallWizard {...props({
      install: vi.fn(async (): Promise<Result<FaberLoomHarnessReport>> => failed('no se pudo leer el archivo')),
    })} />)

    fireEvent.click(screen.getByRole('button', { name: 'Install Harness' }))
    fireEvent.click(screen.getByRole('button', { name: /Choose folder or \.zip/ }))

    expect(await screen.findByRole('dialog', { name: 'Could not install' }, { timeout: 4000 })).toBeTruthy()
    expect(screen.getByText('no se pudo leer el archivo')).toBeTruthy()
  })
})
