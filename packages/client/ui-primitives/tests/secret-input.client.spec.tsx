// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { SecretInput } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

describe('SecretInput', () => {
  it('starts masked and reveals the value from a named toggle', () => {
    render(<SecretInput value="ds-secret" showLabel="Show the key" hideLabel="Hide the key" onChange={() => {}} />)
    const input = screen.getByDisplayValue('ds-secret')

    expect(input).toHaveProperty('type', 'password')
    const show = screen.getByRole('button', { name: 'Show the key' })
    expect(show.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(show)

    expect(input).toHaveProperty('type', 'text')
    const hide = screen.getByRole('button', { name: 'Hide the key' })
    expect(hide.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(hide)
    expect(input).toHaveProperty('type', 'password')
  })

  it('passes the consumer input class through and keeps the placeholder', () => {
    render(
      <SecretInput
        value=""
        placeholder="API key"
        inputClassName="field-input"
        showLabel="Show the key"
        hideLabel="Hide the key"
        onChange={() => {}}
      />,
    )
    const input = screen.getByPlaceholderText('API key')
    expect(input.className).toContain('field-input')
  })
})
