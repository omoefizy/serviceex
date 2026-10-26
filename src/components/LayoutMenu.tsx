import { Check, ChevronDown, LayoutPanelLeft, Settings2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { hasFeature } from '../../shared/features'
import { layoutById } from '../../shared/layouts'
import { switchLayout } from '../lib/layouts'
import { MOD } from '../lib/shortcuts'
import { useOperatorStore } from '../store'

/** The toolbar's layout menu: which panels this computer shows. Any layout, any time. */
export function LayoutMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const layouts = useOperatorStore((s) => s.settings.layouts)
  const active = useOperatorStore((s) => layoutById(s.settings.layouts, s.settings.activeLayoutId))

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', close)
    }
  }, [open])

  if (!hasFeature('sharing.layouts')) return null
  return (
    <div className="live-menu layout-menu" ref={ref}>
      <button
        type="button"
        className="button layout-menu-button"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Layout: which panels this computer shows (${MOD}⌥1 to 9, ${MOD}⇧L for the next)`}
        onClick={() => setOpen(!open)}
      >
        <LayoutPanelLeft size={15} aria-hidden="true" />
        <span>{active.name}</span>
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {open && (
        <div className="live-menu-list" role="menu" aria-label="Layouts">
          {layouts.map((layout, index) => (
            <button
              key={layout.id}
              type="button"
              role="menuitemradio"
              aria-checked={layout.id === active.id}
              onClick={() => {
                setOpen(false)
                switchLayout(layout.id).catch(console.error)
              }}
            >
              <Check size={14} aria-hidden="true" style={{ visibility: layout.id === active.id ? 'visible' : 'hidden' }} />
              <span>{layout.name}</span>
              {index < 9 && (
                <kbd>
                  {MOD}⌥{index + 1}
                </kbd>
              )}
            </button>
          ))}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              useOperatorStore.getState().openSettings(true)
              // Settings scrolls to its Layouts section once it has rendered.
              requestAnimationFrame(() => document.getElementById('settings-layouts')?.scrollIntoView({ block: 'start' }))
            }}
          >
            <Settings2 size={14} aria-hidden="true" />
            <span>Edit layouts…</span>
          </button>
        </div>
      )}
    </div>
  )
}
