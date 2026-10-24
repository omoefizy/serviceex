import { Component, Fragment, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Names the panel in the log. */
  name: string
  children: ReactNode
}

interface State {
  error: Error | null
  /** Bumped by Reload panel, so the panel mounts again from scratch. */
  attempt: number
}

/**
 * Keeps an error thrown while a panel renders inside that panel: it shows a Reload panel button instead, and the
 * error is logged to the app data folder. Without it, one failing panel unmounts the whole window.
 */
export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const err = error instanceof Error ? error : new Error(String(error))
    console.error(`The ${this.props.name} panel had a problem`, err)
    window.api?.log
      ?.panelError({ panel: this.props.name, message: err.message, stack: err.stack ?? '', componentStack: info.componentStack ?? '' })
      .catch(console.error)
  }

  render() {
    if (this.state.error) {
      return (
        <section className="panel" role="alert">
          <p className="empty">This panel had a problem</p>
          <p className="error">{this.state.error.message}</p>
          <div>
            <button className="button" onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}>
              Reload panel
            </button>
          </div>
        </section>
      )
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}
