// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { FaberloomSignOut } from '../src/client/sign-out.tsx'

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(globalThis, 'dshDesktop')
})

const t = ((key: string) => key) as never

function props(): ComponentProps<typeof FaberloomSignOut> {
  return { wide: true, t } as unknown as ComponentProps<typeof FaberloomSignOut>
}

describe('FaberloomSignOut', () => {
  it('renders the web action and redirects to the gateway logout route', () => {
    const assign = vi.fn()
    Object.defineProperty(window, 'location', { configurable: true, value: { assign } })
    render(<FaberloomSignOut {...props()} />)
    const button = screen.getByRole('button', { name: 'session.signOut' })
    fireEvent.click(button)
    expect(assign).toHaveBeenCalledWith('/logout')
  })

  it('leaves the desktop footer to the native sign-out menu', () => {
    Object.defineProperty(globalThis, 'dshDesktop', { configurable: true, value: { protocolVersion: 1 } })
    const { container } = render(<FaberloomSignOut {...props()} />)
    expect(container.firstChild).toBeNull()
  })
})
