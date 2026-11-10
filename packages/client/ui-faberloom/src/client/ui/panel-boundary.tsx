/**
 * Panel error boundary.
 *
 * The slot renderer replaces a component that throws with an empty cell, so a
 * failing panel reads as a black main column with no clue anywhere. This
 * boundary keeps the failure on screen: the panel names itself and the error
 * message, and the same text goes to the console for the diagnostic report.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'

/** Props for {@link PanelBoundary}. */
export interface PanelBoundaryProps {
  /** Panel id shown in the failure card. */
  name: string
  children?: ReactNode
}

interface PanelBoundaryState {
  error: Error | undefined
}

/** Render a panel, or the error that kept it from rendering. */
export class PanelBoundary extends Component<PanelBoundaryProps, PanelBoundaryState> {
  override state: PanelBoundaryState = { error: undefined }

  /**
   * Record the thrown value and keep rendering.
   * @param error - what the panel threw.
   * @returns the state carrying the failure.
   */
  static getDerivedStateFromError(error: Error): PanelBoundaryState {
    return { error }
  }

  /**
   * Report the failure once, with its component stack.
   * @param error - what the panel threw.
   * @param info - React's component stack.
   */
  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ui-faberloom] panel ${this.props.name} failed: ${error.message}\n${error.stack ?? ''}\n${info.componentStack ?? ''}`)
  }

  override render(): ReactNode {
    const { error } = this.state
    if (error === undefined) return this.props.children
    return (
      <div
        style={{
          margin: '24px',
          padding: '16px 18px',
          border: '1px solid var(--dsw-alias-border-danger, #b42318)',
          borderRadius: '10px',
          background: 'var(--dsw-alias-bg-secondary, #1b1b1b)',
          color: 'var(--dsw-alias-label-primary, #f2f2f2)',
          fontFamily: 'var(--dsw-font-family-mono, ui-monospace, monospace)',
          fontSize: '12px',
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
        }}
      >
        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
          {`El panel "${this.props.name}" falló`}
        </div>
        <div>{error.message}</div>
        {error.stack !== undefined && (
          <div style={{ marginTop: '10px', opacity: 0.7 }}>{error.stack}</div>
        )}
      </div>
    )
  }
}
