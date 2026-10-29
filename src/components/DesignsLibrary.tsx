import { Copy, Plus, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { EMPTY_DESIGN } from '../../shared/designs'
import type { Design, DesignCategory } from '../../shared/types'
import { reportError, type ErrorLike } from '../lib/errors'
import { Designer, type DesignerDocument } from './Designer'
import { DesignView } from './DesignView'
import { ErrorNote } from './ui'

type Filter = 'all' | DesignCategory

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'lowerThird', label: 'Lower thirds' },
  { value: 'slide', label: 'Slides' },
]

/**
 * The Designs library: the built-in templates and the designs made in the designer. Open one to edit it (a built-in
 * one opens as a copy to save), or start a new lower third or slide. `open` starts with that document in the designer,
 * such as a lower third template opened from its editor.
 */
export function DesignsLibrary({ onClose, open = null }: { onClose(): void; open?: DesignerDocument | null }) {
  const [designs, setDesigns] = useState<Design[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [editing, setEditing] = useState<DesignerDocument | null>(open)
  const [error, setError] = useState<ErrorLike | null>(null)

  const run = useCallback(async (action: () => Promise<void>) => {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(reportError('Designs', err))
    }
  }, [])

  const load = useCallback(() => run(async () => setDesigns(await window.api.designs.list())), [run])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (editing) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onClose])

  const shown = designs.filter((d) => filter === 'all' || d.style.category === filter)

  const duplicate = (design: Design) =>
    run(async () => {
      const names = new Set(designs.map((d) => d.name))
      let name = `${design.name} copy`
      for (let n = 2; names.has(name); n++) name = `${design.name} copy ${n}`
      await window.api.designs.create(name, design.style)
      await load()
    })

  const remove = (design: Design) =>
    run(async () => {
      if (!window.confirm(`Delete the design "${design.name}"?`)) return
      await window.api.designs.delete(design.id)
      await load()
    })

  if (editing) {
    return (
      <Designer
        document={editing}
        onSaved={() => void load()}
        onClose={() => {
          setEditing(null)
          void load()
        }}
      />
    )
  }

  return createPortal(
    <div className="modal-backdrop designs-backdrop" onMouseDown={onClose}>
      <div className="modal designs-library" role="dialog" aria-label="Designs" onMouseDown={(e) => e.stopPropagation()}>
        <header className="lt-editor-header">
          <h2>Designs</h2>
          <span className="segmented" role="radiogroup" aria-label="Show">
            {FILTERS.map((f) => (
              <button key={f.value} type="button" role="radio" aria-checked={filter === f.value} className={filter === f.value ? 'active' : ''} onClick={() => setFilter(f.value)}>
                {f.label}
              </button>
            ))}
          </span>
          <button type="button" className="button" onClick={() => setEditing({ id: null, name: 'New lower third', type: 'custom', style: EMPTY_DESIGN.lowerThird })}>
            <Plus size={14} aria-hidden="true" /> Lower third
          </button>
          <button type="button" className="button" onClick={() => setEditing({ id: null, name: 'New slide', type: 'custom', style: EMPTY_DESIGN.slide })}>
            <Plus size={14} aria-hidden="true" /> Slide
          </button>
          <button type="button" className="icon-button" aria-label="Close" title="Close" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <ul className="designs-grid">
          {shown.map((design) => (
            <li key={design.id} className="designs-card">
              <button type="button" className="designs-thumb" title={`Open ${design.name}`} onClick={() => setEditing(design)}>
                <DesignView style={design.style} checker />
              </button>
              <div className="designs-card-row">
                <span className="designs-card-name">{design.name}</span>
                {design.type === 'builtin' && <span className="hint">Built in</span>}
                <button type="button" className="icon-button" aria-label={`Duplicate ${design.name}`} title="Duplicate" onClick={() => duplicate(design)}>
                  <Copy size={13} />
                </button>
                {design.type === 'custom' && (
                  <button type="button" className="icon-button" aria-label={`Delete ${design.name}`} title="Delete" onClick={() => remove(design)}>
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
        {shown.length === 0 && <p className="hint">No designs here yet.</p>}

        <ErrorNote error={error} />
      </div>
    </div>,
    document.body,
  )
}
