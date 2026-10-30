import { Copy, Eye, EyeOff, FileUp, Paintbrush, Pencil, Play, Plus, RefreshCw, SkipForward, Star, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { canvasFields, DESIGN_FIELDS, EMPTY_DESIGN } from '../../shared/designs'
import { can, canSaveLowerThirdDesign } from '../../shared/features'
import type { Design, DesignElement, DesignTextField, LowerThirdCanvasText, Service, SermonPoint } from '../../shared/types'
import { canImport, IMPORT_ACCEPT, importDesignFile } from '../lib/designImport'
import { reportError, type ErrorLike } from '../lib/errors'
import { pointKeyLabel, pointShortcut } from '../lib/sermonPoints'
import { CLEAR_LOWER_THIRD_KEY, isTyping, LOWER_THIRD_HEADLINE_ID } from '../lib/shortcuts'
import { useDesignLayout } from '../lib/textMeasure'
import { canvasLine, selectSermonPoints, useOperatorStore } from '../store'
import { askUpgrade } from '../lib/upgrade'
import { Designer, type DesignerDocument } from './Designer'
import { DesignView, type InlineEdit } from './DesignView'
import { HeaderPopover } from './LivePreview'
import { Locked } from './Locked'
import { LowerThirdPanel } from './LowerThirdPanel'
import { QuickLowerThird } from './QuickLowerThird'
import { Button, ErrorNote, IconButton, Select } from './ui'

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

  const fileRef = useRef<HTMLInputElement>(null)
  // The free plan keeps one saved lower third design of its own; built-in ones do not count.
  const atLimit = !canSaveLowerThirdDesign(designs.filter((d) => d.type === 'custom').length)

  /** Import design: the file as a new, unsaved lower third, open in the designer to check and save. */
  const importFiles = (files: File[]) =>
    run(async () => {
      const usable = files.filter(canImport)
      if (usable.length === 0) throw new Error('Import design takes SVG, PNG, JPEG and WebP files.')
      const results = await Promise.all(usable.map(importDesignFile))
      const name = usable[0].name.replace(/\.[^.]+$/, '') || 'Imported design'
      onEdit({ id: null, name, type: 'custom', style: { ...EMPTY_DESIGN.lowerThird, elements: results.flatMap((r) => r.elements) }, imported: results.flatMap((r) => r.warnings) })
    })

  const remove = (design: Design) =>
    run(async () => {
      if (!window.confirm(`Delete the design "${design.name}"?`)) return
      await window.api.designs.delete(design.id)
      if (defaultId === design.id) await updateSettings({ lowerThirdDesignId: null })
      await loadDesigns()
    })

  return (
    <aside
      className="ltw-library"
      aria-label="Lower third designs"
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        if (!can('designs.figmaImport')) return askUpgrade('designs.figmaImport', e.currentTarget)
        void importFiles([...e.dataTransfer.files])
      }}
    >
      <div className="ltw-library-actions">
        <Locked feature="lowerThirds.designs" locked={atLimit}>
          <Button size="sm" variant="primary" icon={<Plus size={14} aria-hidden="true" />} onClick={() => onEdit({ id: null, name: 'New lower third', type: 'custom', style: EMPTY_DESIGN.lowerThird })}>
            New design
          </Button>
        </Locked>
        <Button size="sm" icon={<Pencil size={13} aria-hidden="true" />} disabled={!selected} title="Open the selected design in the designer" onClick={() => selected && onEdit(selected)}>
          Edit
        </Button>
        <Locked feature="designs.figmaImport">
          <IconButton
            size="sm"
            label="Import design"
            tooltip="Import design: an SVG from Figma, Illustrator or Inkscape, or a PNG. You can also drop one on the list"
            icon={<FileUp size={14} />}
            onClick={() => fileRef.current?.click()}
          />
        </Locked>
        <input
          ref={fileRef}
          type="file"
          accept={IMPORT_ACCEPT}
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length > 0) void importFiles(files)
          }}
        />
        <Locked feature="lowerThirds.designs" locked={atLimit}>
          <IconButton size="sm" label="Duplicate" tooltip="Duplicate the selected design" icon={<Copy size={14} />} disabled={!selected} onClick={() => selected && void duplicate(selected)} />
        </Locked>
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

/** Text in a design that typed words fill: bound to a field and shown. */
const editable = (e: DesignElement): e is Extract<DesignElement, { kind: 'text' }> => e.kind === 'text' && e.field !== null && !e.hidden

const NO_TEXT: LowerThirdCanvasText = {}

/**
 * The selected design large, to type into on the canvas: click a text to select it, then type (or double-click) to
 * change its words in place; Enter keeps them, Esc cancels, Tab goes on to the next text. The design stretches with
 * the words as they are typed. The canvas is the only place the words are typed: they are kept for each design, and
 * Send to Preview and Show live send exactly what it shows.
 */
function Stage({ design }: { design: Design | undefined }) {
  const typed = useOperatorStore((s) => (design ? s.settings.lowerThirdCanvasText[String(design.id)] : undefined) ?? NO_TEXT)
  const setCanvasText = useOperatorStore((s) => s.setCanvasText)
  const live = useOperatorStore((s) => s.live.lowerThird)
  const send = useOperatorStore((s) => s.sendCanvasLowerThird)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; initial?: string } | null>(null)
  /** The words as they are typed, so the design stretches with them live. */
  const [liveText, setLiveText] = useState<string | null>(null)
  const [error, setError] = useState<ErrorLike | null>(null)
  const frames = useRef(new Map<string, HTMLButtonElement>())
  const fields = boundFields(design)
  const line = design ? canvasLine(design, typed) : null
  const empty = !line || (!line.headline.trim() && !line.body.trim() && !line.number?.trim())
  const onAirHere = live !== null && line !== null && live.designId === line.designId
  const edited = onAirHere && !empty && (live.headline !== line.headline.trim() || live.body !== line.body.trim() || (live.number ?? '') !== (line.number ?? '').trim())
  const texts = (design?.style.elements ?? []).filter(editable)
  const editingElement = texts.find((e) => e.id === editing?.id)
  // Exactly what is sent: the typed words, else the design's own; what is being typed shows as it is.
  const kept = design ? canvasFields(design.style, typed) : {}
  const shown = editingElement?.field && liveText !== null ? { ...kept, [editingElement.field]: liveText } : kept
  const layout = useDesignLayout(design?.style ?? EMPTY_DESIGN.lowerThird, shown)
  // Cmd+L (Ctrl+L) selects the headline's text, else the first one.
  const firstId = (texts.find((e) => e.field === 'headline') ?? texts[0])?.id

  // A design change leaves nothing selected.
  useEffect(() => {
    setSelectedId(null)
    setEditing(null)
  }, [design?.id])

  const focusFrame = (id: string) => requestAnimationFrame(() => frames.current.get(id)?.focus())
  const commit = (id: string, text: string) => {
    const element = texts.find((e) => e.id === id)
    if (!design || !element?.field || text === kept[element.field]) return
    setError(null)
    setCanvasText(design.id, { [element.field]: text }).catch((err) => setError(reportError('Lower thirds', err)))
  }
  const stop = (id: string) => {
    setEditing(null)
    setLiveText(null)
    focusFrame(id)
  }
  const edit: InlineEdit | undefined =
    editing === null
      ? undefined
      : {
          id: editing.id,
          initial: editing.initial,
          onInput: setLiveText,
          onCommit: (text) => {
            commit(editing.id, text)
            stop(editing.id)
          },
          onCancel: () => stop(editing.id),
          onTab: (text, back) => {
            commit(editing.id, text)
            const at = texts.findIndex((e) => e.id === editing.id)
            const next = texts[(at + (back ? -1 : 1) + texts.length) % texts.length]
            setLiveText(null)
            setSelectedId(next.id)
            setEditing({ id: next.id })
          },
        }

  function onFrameKey(e: ReactKeyboardEvent<HTMLButtonElement>, id: string) {
    const mod = e.metaKey || e.ctrlKey
    if (e.key === 'Enter' || (e.key.length === 1 && !mod && !e.altKey)) {
      // Enter, or the first letter typed, starts editing in place.
      e.preventDefault()
      e.stopPropagation()
      setSelectedId(id)
      setEditing(e.key === 'Enter' ? { id } : { id, initial: e.key })
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setSelectedId(null)
      e.currentTarget.blur()
    }
  }

  return (
    <section className="ltw-stage-area" aria-label="Selected design">
      <div className="ltw-stage">
        {design ? (
          <>
            <DesignView style={design.style} fields={shown} edit={edit} checker warnings />
            <div className="ltw-frames">
              {texts.map((element) => {
                if (element.id === editing?.id) return null
                const box = layout.boxes.get(element.id) ?? element.box
                return (
                  <button
                    key={element.id}
                    ref={(el) => {
                      if (el) frames.current.set(element.id, el)
                      else frames.current.delete(element.id)
                    }}
                    id={element.id === firstId ? LOWER_THIRD_HEADLINE_ID : undefined}
                    type="button"
                    className={`ltw-frame${selectedId === element.id ? ' selected' : ''}`}
                    style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.width}%`, height: `${box.height}%` }}
                    title="Click, then type to change the words (or double-click). Enter keeps them, Esc cancels, Tab goes to the next text"
                    aria-label={`${element.name}: type to change its words`}
                    aria-pressed={selectedId === element.id}
                    onClick={() => setSelectedId(element.id)}
                    onFocus={() => setSelectedId(element.id)}
                    onDoubleClick={() => setEditing({ id: element.id })}
                    onKeyDown={(e) => onFrameKey(e, element.id)}
                  />
                )
              })}
            </div>
          </>
        ) : (
          <p className="screen-off">Choose or make a design on the left.</p>
        )}
      </div>
      <div className="ltw-fields">
        <div className="ltw-field-actions">
          <Button size="sm" icon={<Eye size={13} aria-hidden="true" />} disabled={empty} title="Stage the words on the design on Preview" onClick={() => send('preview')}>
            Send to Preview
          </Button>
          {edited ? (
            <Button size="sm" variant="primary" icon={<RefreshCw size={13} aria-hidden="true" />} title="Change the words on air in place" onClick={() => send('live')}>
              Update live
            </Button>
          ) : (
            <Button size="sm" variant="primary" icon={<Play size={13} aria-hidden="true" />} disabled={empty} title="Put the design on air with the words on it" onClick={() => send('live')}>
              Show live
            </Button>
          )}
        </div>
      </div>
      <ErrorNote error={error} />
      {design && fields.length === 0 && <p className="hint">No text in this design is bound to Headline, Body or Number, so there are no words to change here. Bind one in the designer.</p>}
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
 * The Lower thirds workspace, in place of the schedule and the middle column, with Live and Preview still on
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
  const [styleOpen, setStyleOpen] = useState(false)
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
      // A selected text on the canvas takes the keys: typing changes its words.
      const onCanvas = !!(e.target as Element | null)?.closest?.('.ltw-frame')
      const action = pointShortcut(e, selectSermonPoints(st).length, isTyping(e.target) || onCanvas)
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
        <HeaderPopover
          label="Lower third style"
          text="Style and saved lines"
          tooltip="Template, saved lines, animation and timing"
          icon={<Paintbrush size={14} aria-hidden="true" />}
          open={styleOpen}
          onOpenChange={setStyleOpen}
          className="lower-third-popover"
        >
          <LowerThirdPanel />
        </HeaderPopover>
        <IconButton label="Close Lower thirds" tooltip="Back to the schedule and slides" icon={<X size={18} />} onClick={() => close(false)} />
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
