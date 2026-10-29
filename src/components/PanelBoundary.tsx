import { Check, ClipboardCopy, RotateCcw, TriangleAlert } from 'lucide-react'
import { Component, Fragment, useState, type ErrorInfo, type ReactNode } from 'react'
import { copyDiagnostics, recordProblem } from '../lib/diagnostics'
import { Button, EmptyState } from './ui'

interface Props {
  /** Names the panel in the log and on screen. */
  name: string
  /** bar: one row, for the toolbar. */
  layout?: 'panel' | 'bar'
  children: ReactNode
}

interface State {
  error: Error | null
  /** Bumped by Reload panel, so the panel mounts again from scratch. */
  attempt: number
}

/** Copy diagnostics, which says Copied for a moment once the report is on the clipboard. */
export function CopyDiagnosticsButton({ variant = 'secondary' }: { variant?: 'secondary' | 'ghost' }) {
  const [copied, setCopied] = useState<boolean | null>(null)
  async function copy() {
    setCopied(await copyDiagnostics())
    setTimeout(() => setCopied(null), 2000)
  }
  return (
    <Button variant={variant} icon={copied ? <Check size={15} aria-hidden="true" /> : <ClipboardCopy size={15} aria-hidden="true" />} onClick={() => void copy()}>
      {copied === null ? 'Copy diagnostics' : copied ? 'Copied' : 'Could not copy'}
    </Button>
  )
}

/**
 * Keeps an error thrown while a panel renders inside that panel: it shows Reload panel and Copy diagnostics instead,
 * and the error is logged to the app data folder and to the diagnostics report. Without it, one failing panel
 * unmounts the whole window.
 */
export class PanelBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 }

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    const err = error instanceof Error ? error : new Error(String(error))
    console.error(`The ${this.props.name} panel had a problem`, err)
    recordProblem(
      `${this.props.name} panel`,
      'The panel stopped working.',
      [err.stack ?? err.message, info.componentStack && `Component stack:${info.componentStack}`].filter(Boolean).join('\n'),
    )
    window.api?.log
      ?.panelError({ panel: this.props.name, message: err.message, stack: err.stack ?? '', componentStack: info.componentStack ?? '' })
      .catch(console.error)
  }

  render() {
    if (this.state.error) {
      const reload = (
        <Button variant="primary" icon={<RotateCcw size={15} aria-hidden="true" />} onClick={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}>
          Reload {this.props.layout === 'bar' ? this.props.name.toLowerCase() : 'panel'}
        </Button>
      )
      if (this.props.layout === 'bar') {
        return (
          <div className="panel-crashed-bar" role="alert">
            <TriangleAlert size={16} aria-hidden="true" />
            <span>The {this.props.name.toLowerCase()} stopped working. Everything on the screen is safe.</span>
            {reload}
            <CopyDiagnosticsButton variant="ghost" />
          </div>
        )
      }
      return (
        <section className="panel panel-crashed">
          <EmptyState
            tone="error"
            icon={<TriangleAlert size={20} />}
            title={`The ${this.props.name} panel stopped working`}
            description="Your service, songs and what is on the screen are safe. Reload the panel to carry on."
            action={reload}
            secondaryAction={<CopyDiagnosticsButton />}
            details={this.state.error.message}
          />
        </section>
      )
    }
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
  }
}
