// @vitest-environment jsdom
/**
 * The MCP-servers Settings section: it lists the owner's servers with the
 * credentials present (never a value), validates the add form before enabling
 * its writes, tests a candidate connection, and confirms before removing one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ComponentProps } from 'react'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { FaberLoomMcpProbeResult, FaberLoomMcpServerRow } from '@deepseek-ai/dsh-faberloom-view/types'
import { en } from '../src/client/locales.ts'
import { McpServersSection } from '../src/client/mcp-servers-section.tsx'

afterEach(cleanup)

const t = makeTranslate(en, commonEn) as never

type Props = ComponentProps<typeof McpServersSection>

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

/** One saved server as the host projects it. */
function server(overrides: Partial<FaberLoomMcpServerRow> = {}): FaberLoomMcpServerRow {
  return {
    name: 'docs',
    transport: 'stdio',
    target: 'npx -y @acme/docs-mcp',
    command: 'npx',
    args: ['-y', '@acme/docs-mcp'],
    cwd: '',
    env: [{ name: 'DOCS_TOKEN', present: true }],
    headers: [{ name: 'HTTP_AUTH', present: false }],
    enabled: true,
    mounted: false,
    error: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

/** Framework hooks the section never reads, but its prop types require. */
const globals = {
  useSessions: () => undefined,
  useSessionPendingInteraction: () => undefined,
  useWorkspaces: () => undefined,
  usePanelInfo: () => undefined,
  useResource: () => undefined,
}

/** The section over the given Remote results. */
function props(overrides: Partial<Props> = {}): Props {
  return {
    ...globals,
    t,
    close: vi.fn(),
    load: vi.fn(async (): Promise<Result<readonly FaberLoomMcpServerRow[]>> => ok([])),
    save: vi.fn(async (): Promise<Result<readonly FaberLoomMcpServerRow[]>> => ok([])),
    remove: vi.fn(async (): Promise<Result<readonly FaberLoomMcpServerRow[]>> => ok([])),
    test: vi.fn(async (): Promise<Result<FaberLoomMcpProbeResult>> => ok({ ok: true, tools: [] })),
    ...overrides,
  } as unknown as Props
}

/** Fill the name of the add form. */
function typeName(value: string): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value } })
}

/** Choose the transport of the add form. */
function chooseTransport(value: 'stdio' | 'streamable-http'): void {
  fireEvent.change(screen.getByLabelText('Transport'), { target: { value } })
}

/** Type one secret value into the masked input of the first credential row. */
function typeSecretValue(value: string): void {
  const input = document.querySelector('input[type="password"]')
  if (input === null) throw new Error('no secret input is rendered')
  fireEvent.change(input, { target: { value } })
}

describe('McpServersSection', () => {
  it('lists the owner servers with their transport, state, and credential names, never a value', async () => {
    render(<McpServersSection {...props({ load: vi.fn(async () => ok([server()])) })} />)

    const row = (await screen.findByText('docs')).closest('li')
    expect(row).not.toBeNull()
    // The transport and the proven-or-not state belong to the row; the form's
    // own transport option carries the same label, so scope to the row.
    expect(within(row as HTMLElement).getByText('Local process (stdio)')).toBeTruthy()
    expect(within(row as HTMLElement).getByText('Saved but not verified')).toBeTruthy()
    // The credential is reported by presence, and its value never reaches the page.
    expect(within(row as HTMLElement).getByText('DOCS_TOKEN: stored')).toBeTruthy()
    expect(within(row as HTMLElement).getByText('HTTP_AUTH: absent')).toBeTruthy()
    // The scope is stated on the section, not per row.
    expect(screen.getByText(/Only for your user/)).toBeTruthy()
  })

  it('reports a mounted server as connected, a bare one, and the empty state', async () => {
    const working = server({ env: [], headers: [], mounted: true })
    const on = render(<McpServersSection {...props({ load: vi.fn(async () => ok([working])) })} />)
    const row = (await screen.findByText('docs')).closest('li')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText('Connected')).toBeTruthy()
    on.unmount()

    const bare = server({ env: [], headers: [], mounted: true, enabled: false })
    const none = render(<McpServersSection {...props({ load: vi.fn(async () => ok([bare])) })} />)
    const off = (await screen.findByText('docs')).closest('li')
    expect(off).not.toBeNull()
    expect(within(off as HTMLElement).getByText('no credentials')).toBeTruthy()
    expect(within(off as HTMLElement).getByText('Disabled')).toBeTruthy()
    none.unmount()

    render(<McpServersSection {...props()} />)
    expect(await screen.findByText('No MCP servers installed yet.')).toBeTruthy()
  })

  it('shows the failure a read reports, and a rejected read', async () => {
    const read = render(<McpServersSection {...props({ load: vi.fn(async () => failed('no se pudo leer')) })} />)
    expect(await screen.findByText('no se pudo leer')).toBeTruthy()
    read.unmount()

    render(<McpServersSection {...props({ load: vi.fn(async () => { throw new Error('boom') }) })} />)
    expect(await screen.findByText('Error: boom')).toBeTruthy()
  })

  it('validates the name before either write is enabled', async () => {
    render(<McpServersSection {...props()} />)
    await screen.findByText('No MCP servers installed yet.')

    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'Test connection' })).toHaveProperty('disabled', true)

    typeName('mala servidor')
    expect(await screen.findByText(/The name allows letters/)).toBeTruthy()

    typeName('docs')
    await waitFor(() => { expect(screen.queryByText(/The name allows letters/)).toBeNull() })
    // A stdio server still needs its command.
    expect(await screen.findByText('A local server needs a command.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
  })

  it('requires an absolute http url on the http branch', async () => {
    render(<McpServersSection {...props()} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('remote')
    chooseTransport('streamable-http')

    fireEvent.change(await screen.findByLabelText('URL'), { target: { value: 'ftp://mcp.example.com' } })
    expect(await screen.findByText('An HTTP server needs an absolute http(s) URL.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'no es una url' } })
    expect(await screen.findByText('An HTTP server needs an absolute http(s) URL.')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'http://mcp.example.com/sse' } })
    await waitFor(() => { expect(screen.queryByText('An HTTP server needs an absolute http(s) URL.')).toBeNull() })
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false)
  })

  it('saves a stdio candidate with its credentials as environment values', async () => {
    const save = vi.fn(async () => ok([server()]))
    render(<McpServersSection {...props({ save })} />)
    await screen.findByText('No MCP servers installed yet.')

    typeName('docs')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.change(screen.getByLabelText('Arguments'), { target: { value: '-y server-docs' } })
    fireEvent.change(screen.getByLabelText('Working directory'), { target: { value: '/tmp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add credential' }))
    fireEvent.change(screen.getByLabelText('Variable or header name'), { target: { value: 'DOCS_TOKEN' } })
    typeSecretValue('super-secret')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({
        name: 'docs',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'server-docs'],
        cwd: '/tmp',
        env: { DOCS_TOKEN: 'super-secret' },
        enabled: true,
      })
    })
    // The refreshed list replaces the empty state and the form resets.
    expect(await screen.findByText('docs')).toBeTruthy()
    expect(screen.getByLabelText('Name')).toHaveProperty('value', '')
  })

  it('saves a streamable-http candidate with its credentials as request headers', async () => {
    const save = vi.fn(async () => ok([]))
    render(<McpServersSection {...props({ save })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('remote')
    chooseTransport('streamable-http')
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://mcp.example.com/sse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add credential' }))
    fireEvent.change(screen.getByLabelText('Variable or header name'), { target: { value: 'Authorization' } })
    typeSecretValue('Bearer x')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({
        name: 'remote',
        transport: 'streamable-http',
        url: 'https://mcp.example.com/sse',
        headers: { Authorization: 'Bearer x' },
        enabled: true,
      })
    })
  })

  it('drops an empty credential row before building the candidate', async () => {
    const save = vi.fn(async () => ok([]))
    render(<McpServersSection {...props({ save })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('docs')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add credential' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(screen.queryByLabelText('Variable or header name')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({ name: 'docs', transport: 'stdio', command: 'npx', enabled: true })
    })
  })

  it('edits one of several credential rows and drops another', async () => {
    const save = vi.fn(async () => ok([]))
    render(<McpServersSection {...props({ save })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('docs')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add credential' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add credential' }))
    const names = screen.getAllByLabelText('Variable or header name')
    fireEvent.change(names[0] as HTMLInputElement, { target: { value: 'A' } })
    fireEvent.change(names[1] as HTMLInputElement, { target: { value: 'B' } })
    const values = screen.getAllByLabelText('Value')
    fireEvent.change(values[0] as HTMLInputElement, { target: { value: 'a-value' } })
    fireEvent.change(values[1] as HTMLInputElement, { target: { value: 'b-value' } })
    // Removing the second row leaves the first one edited in place.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[1] as HTMLButtonElement)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({ name: 'docs', transport: 'stdio', command: 'npx', env: { A: 'a-value' }, enabled: true })
    })
  })

  it('refuses a named credential with no value and a value with no name', async () => {
    const save = vi.fn(async () => ok([]))
    render(<McpServersSection {...props({ save })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('docs')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add credential' }))
    fireEvent.change(screen.getByLabelText('Variable or header name'), { target: { value: 'DOCS_TOKEN' } })

    expect(await screen.findByText('The value is missing: the credential has a name but no value.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
    expect(save).not.toHaveBeenCalled()

    // Clearing the name while a value remains is refused the other way.
    fireEvent.change(screen.getByLabelText('Variable or header name'), { target: { value: '' } })
    typeSecretValue('typed')
    expect(await screen.findByText('A credential with a value needs a name.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
  })

  it('switches back to the stdio branch before saving', async () => {
    const save = vi.fn(async () => ok([]))
    render(<McpServersSection {...props({ save })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('docs')
    chooseTransport('streamable-http')
    chooseTransport('stdio')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({ name: 'docs', transport: 'stdio', command: 'npx', enabled: true })
    })
  })

  it('saves an http candidate that names no credential', async () => {
    const save = vi.fn(async () => ok([]))
    render(<McpServersSection {...props({ save })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('remote')
    chooseTransport('streamable-http')
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://mcp.example.com/sse' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({ name: 'remote', transport: 'streamable-http', url: 'https://mcp.example.com/sse', enabled: true })
    })
  })

  it('ignores a read that settles after the section is gone', async () => {
    let settle: ((value: Result<readonly FaberLoomMcpServerRow[]>) => void) | undefined
    const load = vi.fn(() => new Promise<Result<readonly FaberLoomMcpServerRow[]>>((resolve) => { settle = resolve }))
    const view = render(<McpServersSection {...props({ load })} />)
    view.unmount()
    settle?.(ok([server()]))
    await waitFor(() => { expect(load).toHaveBeenCalledOnce() })
    expect(document.body.textContent).not.toContain('docs')

    let reject: ((cause: unknown) => void) | undefined
    const failing = vi.fn(() => new Promise<Result<readonly FaberLoomMcpServerRow[]>>((_resolve, refuse) => { reject = refuse }))
    const gone = render(<McpServersSection {...props({ load: failing })} />)
    gone.unmount()
    reject?.(new Error('late'))
    await waitFor(() => { expect(failing).toHaveBeenCalledOnce() })
    expect(document.body.textContent).not.toContain('late')
  })

  it('shows the failure a save reports and a rejected save', async () => {
    render(<McpServersSection {...props({ save: vi.fn(async () => failed('no se pudo guardar')) })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('docs')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('no se pudo guardar')).toBeTruthy()
    cleanup()

    render(<McpServersSection {...props({ save: vi.fn(async () => { throw new Error('boom') }) })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('docs')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Error: boom')).toBeTruthy()
  })

  it('tests a candidate: the tools it found, none, or the named failure with its redacted detail', async () => {
    const test = vi.fn(async () => ok<FaberLoomMcpProbeResult>({ ok: true, tools: ['mcp__docs__search', 'mcp__docs__read'] }))
    const view = render(<McpServersSection {...props({ test })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('docs')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Test passed: Tools found mcp__docs__search, mcp__docs__read')).toBeTruthy()
    view.unmount()

    const none = render(<McpServersSection {...props({ test: vi.fn(async () => ok<FaberLoomMcpProbeResult>({ ok: true, tools: [] })) })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('docs')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Test passed: No tool was published.')).toBeTruthy()
    none.unmount()

    const failures = [
      {
        failure: 'unreachable' as const,
        label: 'The server did not answer',
        detail: 'connect ECONNREFUSED',
        next: 'Check the URL, that the program is installed, or that the server is running.',
      },
      {
        failure: 'bad-credential' as const,
        label: 'The credential was rejected',
        detail: 'HTTP 401 with [redacted]',
        next: 'Replace the value with a valid one; the server rejected it.',
      },
      {
        failure: 'protocol' as const,
        label: 'The server answered something unexpected',
        detail: 'bad frames',
        next: 'The address does not answer as an MCP server; check that it is the right endpoint.',
      },
    ]
    for (const entry of failures) {
      const probeView = render(<McpServersSection {...props({
        test: vi.fn(async () => ok<FaberLoomMcpProbeResult>({ ok: false, failure: entry.failure, detail: entry.detail })),
      })} />)
      await screen.findByText('No MCP servers installed yet.')
      typeName('docs')
      fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
      fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
      expect(await screen.findByText(`${entry.label}: ${entry.detail} ${entry.next}`)).toBeTruthy()
      probeView.unmount()
    }
  })

  it('shows the failure a test call reports and a rejected test', async () => {
    const rejected = render(<McpServersSection {...props({ test: vi.fn(async () => { throw new Error('boom') }) })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('docs')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Error: boom')).toBeTruthy()
    rejected.unmount()

    render(<McpServersSection {...props({ test: vi.fn(async () => failed('no se pudo probar')) })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('docs')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('no se pudo probar')).toBeTruthy()
  })

  it('removes one server only after its own confirmation', async () => {
    const remove = vi.fn(async () => ok([]))
    render(<McpServersSection {...props({ load: vi.fn(async () => ok([server()])), remove })} />)
    await screen.findByText('docs')

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    expect(await screen.findByText('Remove this server? Its credentials are discarded.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByText('Remove this server? Its credentials are discarded.')).toBeNull()
    expect(remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove server' }))
    await waitFor(() => { expect(remove).toHaveBeenCalledWith('docs') })
    expect(await screen.findByText('No MCP servers installed yet.')).toBeTruthy()
  })

  it('shows the failure a removal reports and a rejected removal', async () => {
    const removal = render(<McpServersSection {...props({
      load: vi.fn(async () => ok([server()])),
      remove: vi.fn(async () => failed('no se pudo quitar')),
    })} />)
    await screen.findByText('docs')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove server' }))
    expect(await screen.findByText('no se pudo quitar')).toBeTruthy()
    removal.unmount()

    render(<McpServersSection {...props({
      load: vi.fn(async () => ok([server()])),
      remove: vi.fn(async () => { throw new Error('boom') }),
    })} />)
    await screen.findByText('docs')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove server' }))
    expect(await screen.findByText('Error: boom')).toBeTruthy()
  })

  it('installs without mounting a server left disabled', async () => {
    const save = vi.fn(async () => ok([]))
    render(<McpServersSection {...props({ save })} />)
    await screen.findByText('No MCP servers installed yet.')
    typeName('docs')
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'npx' } })
    fireEvent.click(screen.getByLabelText('Enable on save'))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({ name: 'docs', transport: 'stdio', command: 'npx', enabled: false })
    })
  })

  it('lists many servers, filters them by name or target, and reports no match', async () => {
    const many = [
      server({ name: 'docs' }),
      server({ name: 'weather', target: 'https://weather.example.com/mcp', transport: 'streamable-http', url: 'https://weather.example.com/mcp' }),
      server({ name: 'gitlab' }),
      server({ name: 'notes' }),
    ]
    render(<McpServersSection {...props({ load: vi.fn(async () => ok(many)) })} />)
    await screen.findByText('docs')
    expect(screen.getAllByRole('listitem')).toHaveLength(4)

    const search = screen.getByLabelText('Search servers')
    fireEvent.change(search, { target: { value: 'weather' } })
    await waitFor(() => { expect(screen.getAllByRole('listitem')).toHaveLength(1) })
    expect(screen.getByText('weather')).toBeTruthy()

    fireEvent.change(search, { target: { value: 'example.com' } })
    await waitFor(() => { expect(screen.getAllByRole('listitem')).toHaveLength(1) })

    fireEvent.change(search, { target: { value: 'zzz' } })
    expect(await screen.findByText('No server matches the search.')).toBeTruthy()
  })

  it('shows one server\'s error with its reason without hiding the others', async () => {
    render(<McpServersSection {...props({
      load: vi.fn(async () => ok([
        server({ name: 'broken', mounted: false, error: 'the credential is not configured' }),
        server({ name: 'fine', mounted: true }),
      ])),
    })} />)
    await screen.findByText('broken')
    expect(screen.getByText('This server failed: the credential is not configured')).toBeTruthy()
    expect(screen.getByText('fine')).toBeTruthy()
    expect(screen.getByText('Connected')).toBeTruthy()
  })

  it('enables and disables one server without touching its saved credentials', async () => {
    const save = vi.fn(async () => ok([server({ enabled: false })]))
    render(<McpServersSection {...props({ load: vi.fn(async () => ok([server()])), save })} />)
    await screen.findByText('docs')

    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({
        name: 'docs',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@acme/docs-mcp'],
        cwd: '',
        enabled: false,
      })
    })
    // The refreshed row flips the action to Enable.
    expect(await screen.findByRole('button', { name: 'Enable' })).toBeTruthy()
  })

  it('edits one server in place, prefilling its target and requiring the saved values again', async () => {
    const save = vi.fn(async () => ok([]))
    render(<McpServersSection {...props({
      load: vi.fn(async () => ok([server({ headers: [] })])),
      save,
    })} />)
    await screen.findByText('docs')

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByText('Editing docs')).toBeTruthy()
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'docs')
    expect(screen.getByLabelText('Command')).toHaveProperty('value', 'npx')
    // The saved value is never shown, so the prefilled row must be re-entered.
    expect(await screen.findByText('The value is missing: the credential has a name but no value.')).toBeTruthy()

    typeSecretValue('rotated-key')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith({
        name: 'docs',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', '@acme/docs-mcp'],
        env: { DOCS_TOKEN: 'rotated-key' },
        enabled: true,
      })
    })
  })

  it('leaves edit mode on cancel without writing', async () => {
    const save = vi.fn(async () => ok([]))
    render(<McpServersSection {...props({ load: vi.fn(async () => ok([server()])), save })} />)
    await screen.findByText('docs')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    await screen.findByText('Editing docs')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => { expect(screen.queryByText('Editing docs')).toBeNull() })
    expect(screen.getByLabelText('Name')).toHaveProperty('value', '')
    expect(save).not.toHaveBeenCalled()
  })
})
