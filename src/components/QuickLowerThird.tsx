import { Eye, Play, Scissors, X } from 'lucide-react'
import { useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { hideSelection } from '../../shared/verseEdit'
import { MOD } from '../lib/shortcuts'
import { useOperatorStore } from '../store'
import { Button, IconButton } from './ui'

/**
 * Send as lower third: the words to show, editable, with Shorten to put "…" in place of the selected words, then
 * Preview or Show live in the default design (Settings, Lower thirds). Enter does what Settings says Send as lower
 * third goes straight to; Esc closes it. Used from the transcript, the heard cards and the Lower thirds workspace.
 */
export function QuickLowerThird({ text: initial, onClose, className = '', style, keepOpen = false, autoFocus = true }: {
  text: string
  autoFocus?: boolean
  style?: CSSProperties
  /** Closes it: after sending, unless `keepOpen`, and on Esc or the close button. Without it there is no close button. */
  onClose?(): void
  className?: string
  /** Stays open with its words after sending, as in the workspace. */
  keepOpen?: boolean
}) {
  const target = useOperatorStore((s) => s.settings.lowerThirdQuickTarget)
  const designName = useOperatorStore((s) => s.designs.find((d) => d.id === s.settings.lowerThirdDesignId)?.name ?? null)
  const send = useOperatorStore((s) => s.sendQuoteAsLowerThird)
  const [text, setText] = useState(initial.trim())
  const field = useRef<HTMLTextAreaElement>(null)
  const empty = !text.trim()

  function go(where: 'preview' | 'live') {
    if (empty) return
    send(text.trim(), where)
    if (!keepOpen) onClose?.()
  }

  function shorten() {
    const el = field.current
    if (!el || el.selectionStart === el.selectionEnd) return
    const result = hideSelection(text, el.selectionStart, el.selectionEnd)
    setText(result.text)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(result.cursor, result.cursor)
    })
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Inside the transcript or a card, the app's own keys stay out of the way.
    e.stopPropagation()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      go(e.metaKey || e.ctrlKey ? (target === 'live' ? 'preview' : 'live') : target)
    } else if (e.key === 'Escape' && onClose) {
      e.preventDefault()
      onClose()
    }
  }

  return (
    <div className={`quick-lower-third ${className}`} style={style} role="group" aria-label="Send as lower third" onMouseDown={(e) => e.stopPropagation()}>
      <div className="quick-lower-third-head">
        <strong>Send as lower third</strong>
        <span className="hint" title="Set the default design in Settings, Lower thirds, or with the star in the Lower thirds workspace">
          {designName ?? 'Default template'}
        </span>
        {onClose && <IconButton size="sm" label="Close" icon={<X size={14} />} onClick={onClose} />}
      </div>
      <textarea
        ref={field}
        className="input"
        rows={2}
        maxLength={300}
        aria-label="Lower third words"
        value={text}
        autoFocus={autoFocus}
        placeholder="A quote or line to show"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className="quick-lower-third-actions">
        <Button
          size="sm"
          variant="ghost"
          icon={<Scissors size={13} aria-hidden="true" />}
          title="Put “…” in place of the selected words"
          // Keep the selection while the button is pressed.
          onMouseDown={(e) => e.preventDefault()}
          onClick={shorten}
        >
          Shorten with …
        </Button>
        <span className="quick-lower-third-gap" />
        <Button
          size="sm"
          variant={target === 'preview' ? 'primary' : 'secondary'}
          icon={<Eye size={13} aria-hidden="true" />}
          disabled={empty}
          title={target === 'preview' ? 'Stage it on Preview (Enter)' : `Stage it on Preview (${MOD}Enter)`}
          onClick={() => go('preview')}
        >
          Preview
        </Button>
        <Button
          size="sm"
          variant={target === 'live' ? 'primary' : 'secondary'}
          icon={<Play size={13} aria-hidden="true" />}
          disabled={empty}
          title={target === 'live' ? 'Put it on air now (Enter)' : `Put it on air now (${MOD}Enter)`}
          onClick={() => go('live')}
        >
          Show live
        </Button>
      </div>
    </div>
  )
}
