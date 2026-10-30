import { Copy, Eye, EyeOff, Pencil, Play, Plus, RefreshCw, SkipForward, Star, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { DESIGN_FIELDS, EMPTY_DESIGN } from '../../shared/designs'
import type { Design, DesignElement, DesignTextField, Service, SermonPoint } from '../../shared/types'
import { reportError, type ErrorLike } from '../lib/errors'
import { pointKeyLabel, pointShortcut } from '../lib/sermonPoints'
import { CLEAR_LOWER_THIRD_KEY, isTyping } from '../lib/shortcuts'
import { selectSermonPoints, useOperatorStore, type LowerThirdLine } from '../store'
import { Designer, type DesignerDocument } from './Designer'
import { DesignView, type InlineEdit } from './DesignView'
import { QuickLowerThird } from './QuickLowerThird'
import { Button, ErrorNote, IconButton, Select } from './ui'

const FIELD_LABELS: Record<DesignTextField, string> = { headline: 'Headline', body: 'Body', number: 'Number' }

const newId = () => crypto.randomUUID().slice(0, 8)

/** The fields a design's text is bound to, in the order the fields are listed. */
function boundFields(design: Design | undefined): DesignTextField[] {
  const bound = new Set(design?.style.elements.flatMap((e) => (e.kind === 'text' && e.field && !e.hidden ? [e.field] : [])))
  return DESIGN_FIELDS.filter((f) => bound.has(f))
}

/** A name no design has yet, from `base`. */
function freeName(designs: Design[], base: string): string {
  const names = new Set(designs.map((d) => d.name))
  if (!names.has(base)) return base
  for (let n = 2; ; n++) if (!names.has(`${base} ${n}`)) return `${base} ${n}`
}

/** The left column: the lower third designs as thumbnails, with the star on the default. */
function Library({ designs, selectedId, onSelect, onEdit }: { designs: Design[]; selectedId: number | null; onSelect(id: number): void; onEdit(doc: DesignerDocument): void }) {
  const defaultId = useOperatorStore((s) => s.settings.lowerThirdDesignId)
  const updateSettings = useOperatorStore((s) => s.updateSettings)
  const loadDesigns = useOperatorStore((s) => s.loadDesigns)
  const [error, setError] = useState<ErrorLike | null>(null)
  const selected = designs.find((d) => d.id === selectedId)

  async function run(action: () => Promise<void>) {
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(reportError('Lower thirds', err))
    }
  }

  const duplicate = (design: Design) =>
    run(async () => {
      const created = await window.api.designs.create(freeName(designs, `${design.name} copy`), design.style)
      await loadDesigns()
      onSelect(created.id)
    })

  const remove = (design: Design) =>
    run(async () => {
      if (!window.confirm(`Delete the design "${design.name}"?`)) return
      await window.api.designs.delete(design.id)
      if (defaultId === design.id) await updateSettings({ lowerThirdDesignId: null })
      await loadDesigns()
    })

  return (
    <aside className="ltw-library" aria-label="Lower third designs">
      <div className="ltw-library-actions">
        <Button size="sm" variant="primary" icon={<Plus size={14} aria-hidden="true" />} onClick={() => onEdit({ id: null, name: 'New lower third', type: 'custom', style: EMPTY_DESIGN.lowerThird })}>
          New design
        </Button>
        <Button size="sm" icon={<Pencil size={13} aria-hidden="true" />} disabled={!selected} title="Open the selected design in the designer" onClick={() => selected && onEdit(selected)}>
          Edit
        </Button>
        <IconButton size="sm" label="Duplicate" tooltip="Duplicate the selected design" icon={<Copy size={14} />} disabled={!selected} onClick={() => selected && void duplicate(selected)} />
        <IconButton
          size="sm"
          label="Delete"
          tooltip={selected?.type === 'builtin' ? 'Built-in designs cannot be deleted' : 'Delete the selected design'}
          icon={<Trash2 size={14} />}
          disabled={!selected || selected.type !== 'custom'}
          onClick={() => selected && void remove(selected)}
        />
      </div>
      <ErrorNote error={error} />
      <ul className="ltw-designs">
        {designs.map((design) => {
          const isDefault = design.id === defaultId
          return (
            <li key={design.id} className={`ltw-design${design.id === selectedId ? ' selected' : ''}`}>
              <button
                type="button"
                className="ltw-design-thumb"
                title={`Select ${design.name}; double-click to edit it`}
                aria-pressed={design.id === selectedId}
                onClick={() => onSelect(design.id)}
                onDoubleClick={() => onEdit(design)}
              >
                <DesignView style={design.style} checker />
              </button>
              <div className="ltw-design-row">
                <span className="ltw-design-name">{design.name}</span>
                <IconButton
                  size="sm"
                  className={`ltw-star${isDefault ? ' on' : ''}`}
                  label={isDefault ? `${design.name} is the default` : `Make ${design.name} the default`}
                  tooltip={isDefault ? 'The default: quick lower thirds and quotes use it. Click to use the template instead' : 'Make it the default for quick lower thirds and quotes'}
                  pressed={isDefault}
                  icon={<Star size={14} fill={isDefault ? 'currentColor' : 'none'} />}
                  onClick={() => void run(() => updateSettings({ lowerThirdDesignId: isDefault ? null : design.id }))}
                />
              </div>
            </li>
          )
        })}
      </ul>
      {designs.length === 0 && <p className="hint">No lower third designs yet. New design starts one.</p>}
    </aside>
  )
}

/** The selected design large, its bound text editable on the canvas (double-click) or in the fields under it. */
function Stage({ design }: { design: Design | undefined }) {
  const draft = useOperatorStore((s) => s.lowerThirdDraft)
  const setDraft = useOperatorStore((s) => s.setLowerThirdDraft)
  const live = useOperatorStore((s) => s.live.lowerThird)
  const showLine = useOperatorStore((s) => s.showLowerThirdLine)
  const previewLine = useOperatorStore((s) => s.previewLowerThirdLine)
  const [editingId, setEditingId] = useState<string | null>(null)
  const fields = boundFields(design)
  const shownFields = fields.length > 0 ? fields : (['headline'] as DesignTextField[])
  const line: LowerThirdLine = { ...draft, ...(design ? { designId: design.id } : {}) }
  const empty = !draft.headline.trim() && !draft.body.trim()
  const onAirHere = live !== null && live.designId === line.designId
  const edited = onAirHere && !empty && (live.headline !== draft.headline.trim() || live.body !== draft.body.trim() || (live.number ?? '') !== (draft.number ?? '').trim())
  const valueOf = (field: DesignTextField) => (field === 'number' ? (draft.number ?? '') : draft[field])
  // Empty fields show the design's sample words, so the canvas always reads as the design.
  const canvasFields = Object.fromEntries(DESIGN_FIELDS.flatMap((f) => (valueOf(f) ? [[f, valueOf(f)]] : [])))

  const edit: InlineEdit | undefined =
    editingId === null
      ? undefined
      : {
          id: editingId,
          onCommit: (text) => {
            const element = design?.style.elements.find((e) => e.id === editingId)
            if (element?.kind === 'text' && element.field) setDraft({ [element.field]: text })
            setEditingId(null)
          },
          onCancel: () => setEditingId(null),
        }

  function onFieldKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      // Enter puts it on air (or updates it in place); Shift+Enter stages it on Preview.
      e.preventDefault()
      if (e.shiftKey) previewLine(line)
      else showLine(line)
    }
  }

  const editable = (e: DesignElement) => e.kind === 'text' && e.field !== null && !e.hidden

  return (
    <section className="ltw-stage-area" aria-label="Selected design">
      <div className="ltw-stage">
        {design ? (
          <>
            <DesignView style={design.style} fields={canvasFields} edit={edit} checker />
            <div className="ltw-frames">
              {design.style.elements.filter(editable).map((element) =>
                element.id === editingId ? null : (
                  <button
                    key={element.id}
                    type="button"
                    className="ltw-frame"
                    style={{ left: `${element.box.x}%`, top: `${element.box.y}%`, width: `${element.box.width}%`, height: `${element.box.height}%` }}
                    title={`Double-click to type the ${element.kind === 'text' && element.field ? FIELD_LABELS[element.field].toLowerCase() : 'words'}`}
                    aria-label={`Edit ${element.name}`}
                    onDoubleClick={() => setEditingId(element.id)}
                  />
                ),
              )}
            </div>
          </>
        ) : (
          <p className="screen-off">Choose or make a design on the left.</p>
        )}
      </div>
      <div className="ltw-fields">
        {shownFields.map((field) => (
          <label key={field} className={`ltw-field ltw-field-${field}`}>
            <span>{FIELD_LABELS[field]}</span>
            <input
              className="input"
              value={valueOf(field)}
              maxLength={300}
              placeholder={field === 'headline' ? 'Type while the pastor preaches' : ''}
              onChange={(e) => setDraft({ [field]: e.target.value })}
              onKeyDown={onFieldKey}
            />
          </label>
        ))}
        <div className="ltw-field-actions">
          <Button size="sm" icon={<Eye size={13} aria-hidden="true" />} disabled={empty} title="Stage it on Preview (Shift+Enter in a field)" onClick={() => previewLine(line)}>
            Preview
          </Button>
          {edited ? (
            <Button size="sm" variant="primary" icon={<RefreshCw size={13} aria-hidden="true" />} title="Change the words on air in place (Enter in a field)" onClick={() => showLine(line)}>
              Update live
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={<Play size={13} aria-hidden="true" />} disabled={empty} title="Put it on air (Enter in a field)" onClick={() => showLine(line)}>
              Show live
            </Button>
          )}
        </div>
      </div>
      {design && fields.length === 0 && <p className="hint">No text in this design is bound to Headline, Body or Number, so typed words do not show. Bind one in the designer.</p>}
    </section>
  )
}

/** One sermon point: click to stage it on Preview, double-click (or Show live) for air, its own design, edit, remove. */
function PointRow({ point, index, current, designs, onChange, onRemove }: {
  point: SermonPoint
  index: number
  current: boolean
  designs: Design[]
  onChange(point: SermonPoint): void
  onRemove(): void
}) {
  const triggerPoint = useOperatorStore((s) => s.triggerPoint)
  const [editing, setEditing] = useState<string | null>(null)
  const key = pointKeyLabel(index)

  return (
    <li className={`ltw-point${current ? ' current' : ''}`}>
      <span className="ltw-point-key" title={key ? `Press ${key} to show it live` : undefined} aria-hidden={!key}>
        {key ?? '·'}
      </span>
      {editing !== null ? (
        <input
          className="input ltw-point-edit"
          aria-label="Point"
          value={editing}
          autoFocus
          maxLength={300}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={() => {
            if (editing.trim()) onChange({ ...point, text: editing })
            setEditing(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            else if (e.key === 'Escape') setEditing(null)
          }}
        />
      ) : (
        <button
          type="button"
          className="ltw-point-text"
          title="Click: stage it on Preview in its design. Double-click: show it live"
          onClick={() => triggerPoint(index, 'preview')}
          onDoubleClick={() => triggerPoint(index, 'live')}
        >
          {point.text}
        </button>
      )}
      <Select
        size="sm"
        className="ltw-point-design"
        aria-label="Design for this point"
        title="The design this point shows in"
        value={point.designId === null ? '' : String(point.designId)}
        onChange={(e) => onChange({ ...point, designId: e.target.value ? Number(e.target.value) : null })}
      >
        <option value="">Selected design</option>
        {designs.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>
      <Button size="sm" variant={current ? 'primary' : 'secondary'} icon={<Play size={13} aria-hidden="true" />} title="Show it live" onClick={() => triggerPoint(index, 'live')}>
        Show live
      </Button>
      <IconButton size="sm" label="Edit point" icon={<Pencil size={13} />} onClick={() => setEditing(point.text)} />
      <IconButton size="sm" label="Remove point" icon={<Trash2 size={13} />} onClick={onRemove} />
    </li>
  )
}

/** Sermon points: typed in with Enter, saved with the open service, reusable from another service. */
function Points({ designs }: { designs: Design[] }) {
  const points = useOperatorStore(selectSermonPoints)
  const allPoints = useOperatorStore((s) => s.settings.lowerThirdServicePoints)
  const serviceId = useOperatorStore((s) => s.service?.id ?? 0)
  const serviceName = useOperatorStore((s) => s.service?.name ?? null)
  const pointIndex = useOperatorStore((s) => s.lowerThirdPointIndex)
  const live = useOperatorStore((s) => s.live.lowerThird !== null)
  const setPoints = useOperatorStore((s) => s.setSermonPoints)
  const nextPoint = useOperatorStore((s) => s.nextPoint)
  const hide = useOperatorStore((s) => s.hideLowerThird)
  const [typed, setTyped] = useState('')
  const [services, setServices] = useState<Service[]>([])
  const [error, setError] = useState<ErrorLike | null>(null)
  const next = points[pointIndex + 1]

  useEffect(() => {
    window.api.services.list().then(setServices, console.error)
  }, [])

  const save = (list: SermonPoint[]) => {
    setError(null)
    setPoints(list).catch((err) => setError(reportError('Sermon points', err)))
  }

  // Other services' points, to use again here.
  const reusable = Object.entries(allPoints).filter(([id, list]) => id !== String(serviceId) && list.length > 0)
  const nameOf = (id: string) => (id === '0' ? 'No service' : (services.find((s) => String(s.id) === id)?.name ?? `Service ${id}`))

  return (
    <section className="ltw-points" aria-label="Sermon points">
      <header className="ltw-points-head">
        <h3>Sermon points</h3>
        <span className="hint">{serviceName ? `Saved with ${serviceName}` : 'Saved until a service is opened'}</span>
        {reusable.length > 0 && (
          <Select
            size="sm"
            aria-label="Reuse points from another service"
            value=""
            onChange={(e) => {
              const from = allPoints[e.target.value]
              if (from) save([...points, ...from.map((p) => ({ ...p, id: newId() }))])
            }}
          >
            <option value="" disabled>
              Reuse points from…
            </option>
            {reusable.map(([id, list]) => (
              <option key={id} value={id}>
                {nameOf(id)} ({list.length})
              </option>
            ))}
          </Select>
        )}
      </header>
      <input
        className="input"
        aria-label="New point"
        placeholder="Type a point and press Enter"
        maxLength={300}
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || !typed.trim()) return
          e.preventDefault()
          save([...points, { id: newId(), text: typed.trim(), designId: null }])
          setTyped('')
        }}
      />
      <ErrorNote error={error} />
      {points.length > 0 ? (
        <ol className="ltw-point-list">
          {points.map((point, index) => (
            <PointRow
              key={point.id}
              point={point}
              index={index}
              current={index === pointIndex}
              designs={designs}
              onChange={(changed) => save(points.map((p) => (p.id === point.id ? changed : p)))}
              onRemove={() => save(points.filter((p) => p.id !== point.id))}
            />
          ))}
        </ol>
      ) : (
        <p className="hint">No points yet. 1 to 9 show the first nine live, Space the next one.</p>
      )}
      <div className="ltw-points-actions">
        <Button variant="primary" icon={<SkipForward size={14} aria-hidden="true" />} disabled={!next} title="Show the next point live (Space)" onClick={nextPoint}>
          Next point{next && <span className="ltw-next">{next.text}</span>}
        </Button>
        <Button icon={<EyeOff size={14} aria-hidden="true" />} disabled={!live} title={`Take the lower third off (Esc here, ${CLEAR_LOWER_THIRD_KEY} anywhere)`} onClick={hide}>
          Clear lower third
        </Button>
      </div>
    </section>
  )
}

/**
 * The Lower thirds workspace, in place of the order of service and the middle column, with Live and Preview still on
 * the right: the designs on the left, the selected one large in the centre to type into live, the sermon points
 * under it, and a quick quote. 1 to 9 show the first nine points live, Space the next, Enter the lower third staged
 * on Preview, and Esc clears it. Edit design opens the designer here, as a page.
 */
export function LowerThirdsWorkspace() {
  const allDesigns = useOperatorStore((s) => s.designs)
  const designs = useMemo(() => allDesigns.filter((d) => d.style.category === 'lowerThird'), [allDesigns])
  const workspaceId = useOperatorStore((s) => s.lowerThirdWorkspaceDesignId)
  const defaultId = useOperatorStore((s) => s.settings.lowerThirdDesignId)
  const setWorkspaceDesign = useOperatorStore((s) => s.setWorkspaceDesign)
  const loadDesigns = useOperatorStore((s) => s.loadDesigns)
  const close = useOperatorStore((s) => s.openLowerThirds)
  const [designing, setDesigning] = useState<DesignerDocument | null>(null)
  // The workspace's choice, else the default, else the first; a deleted one falls through.
  const selected = [workspaceId, defaultId].map((id) => designs.find((d) => d.id === id)).find(Boolean) ?? designs[0]

  // Points without their own design show in the one selected here, so the store keeps the choice shown.
  useEffect(() => {
    if (selected && selected.id !== workspaceId) setWorkspaceDesign(selected.id)
  }, [selected, workspaceId, setWorkspaceDesign])

  // The point keys, ahead of the app's own (1 to 5 pick a highlight colour there), and never while typing.
  useEffect(() => {
    if (designing) return
    const onKey = (e: KeyboardEvent) => {
      const st = useOperatorStore.getState()
      const action = pointShortcut(e, selectSermonPoints(st).length, isTyping(e.target))
      if (!action) return
      const onButton = (e.target as Element | null)?.closest?.('button, select, a')
      if (action.kind === 'takePreview' && (onButton || !st.lowerThirdPreview)) return
      if (action.kind === 'clear' && !st.live.lowerThird) return
      e.preventDefault()
      e.stopPropagation()
      if (action.kind === 'point') st.triggerPoint(action.index, 'live')
      else if (action.kind === 'next') st.nextPoint()
      else if (action.kind === 'takePreview') st.takeLowerThirdPreviewLive()
      else st.hideLowerThird()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [designing])

  if (designing) {
    return (
      <div className="ltw ltw-designing">
        <Designer
          page
          document={designing}
          onSaved={(design) => {
            void loadDesigns()
            setWorkspaceDesign(design.id)
          }}
          onClose={() => {
            setDesigning(null)
            void loadDesigns()
          }}
        />
      </div>
    )
  }

  return (
    <section className="ltw" aria-label="Lower thirds">
      <header className="ltw-head">
        <h2>Lower thirds</h2>
        <span className="hint">1–9 show a point live · Space the next · Enter takes Preview live · Esc clears</span>
        <IconButton label="Close Lower thirds" tooltip="Back to the order of service and slides" icon={<X size={18} />} onClick={() => close(false)} />
      </header>
      <div className="ltw-body">
        <Library designs={designs} selectedId={selected?.id ?? null} onSelect={setWorkspaceDesign} onEdit={setDesigning} />
        <div className="ltw-centre">
          <Stage design={selected} />
          <Points designs={designs} />
          <QuickLowerThird className="ltw-quick" text="" keepOpen autoFocus={false} />
        </div>
      </div>
    </section>
  )
}
