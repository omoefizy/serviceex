// Scripture display: the Settings form that edits the default scripture theme's verse and reference, and the Aa
// popover on the Live and Preview boxes for quick adjustments to one verse. Every translation shares the same look.

import { AlertTriangle, ArrowDown, ArrowUp, Bold, Minus, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { applyScriptureLook, contrastWarnings, isEmptyAdjust, OFFSET_LIMIT, readScriptureLook, SIZE_LIMITS, type ScriptureLook } from '../../shared/scriptureLook'
import { THEME_CONTENT_TYPES } from '../../shared/themes'
import type { ThemeContentType } from '../../shared/types'
import { nudgeVerse, stepVerseSize } from '../lib/scriptureAdjust'
import { MOD } from '../lib/shortcuts'
import { dualTheme } from '../lib/translations'
import { selectAdjustTarget, selectDeckTheme, selectServiceLook, slideTheme, useOperatorStore, type TranslationTarget } from '../store'
import { FontPicker } from './FontPicker'
import { Color, Range, Row, Segmented } from './ThemeEditor'
import { ThemedSlide } from './ThemedSlide'
import { Button, Toggle } from './ui'

const SAMPLE = {
  text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.',
  second: 'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.',
}

const percent = (value: number) => `${Number(value.toFixed(2))}%`
const signed = (value: number) => `${value > 0 ? '+' : ''}${Number(value.toFixed(2))}%`

function Warnings({ warnings }: { warnings: string[] }) {
  return warnings.map((warning) => (
    <p key={warning} className="contrast-warning" role="status">
      <AlertTriangle size={13} aria-hidden="true" />
      <span>{warning}</span>
    </p>
  ))
}

const SWATCHES = [
  { color: '#ffffff', label: 'White' },
  { color: '#fff4d6', label: 'Cream' },
  { color: '#ffd400', label: 'Yellow' },
  { color: '#9cc9ff', label: 'Light blue' },
  { color: '#9be7b0', label: 'Light green' },
  { color: '#111111', label: 'Black' },
]

/**
 * The Aa button over the Live or Preview box while it shows scripture: size, color, position, font and bold for this
 * verse alone, which the projector shows at once when it is live. Save keeps them in the default scripture theme or
 * for this service; Reset to theme takes them off. "Custom size" shows while the verse differs from its theme.
 */
export function ScriptureQuickAdjust({ where }: { where: TranslationTarget }) {
  const slide = useOperatorStore((s) => selectAdjustTarget(s, where)?.slide ?? null)
  const base = useOperatorStore((s) => (where === 'live' ? s.live.theme : selectDeckTheme(s)))
  const serviceLook = useOperatorStore(selectServiceLook)
  const hasService = useOperatorStore((s) => s.service !== null)
  const lumaKey = useOperatorStore((s) => s.settings.streamKeyMode === 'luma')
  const adjust = useOperatorStore((s) => s.adjustScripture)
  const save = useOperatorStore((s) => s.saveScriptureAdjust)
  const reset = useOperatorStore((s) => s.resetScriptureAdjust)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const theme = useMemo(() => (slide ? slideTheme(base, slide) : null), [base, slide])
  const look = useMemo(() => theme && readScriptureLook(theme), [theme])
  const warnings = useMemo(() => (theme ? contrastWarnings(theme, theme.keyTransparent || lumaKey) : []), [theme, lumaKey])

  // The popover closes on a click outside it.
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!slide || !look) return null
  const own = !isEmptyAdjust(slide.adjust)
  const custom = own || serviceLook !== undefined

  async function keep(scope: 'theme' | 'service') {
    setBusy(true)
    try {
      await save(where, scope)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="scripture-adjust" ref={menuRef}>
      {custom && (
        <span className="custom-chip" title={own ? 'This verse has its own adjustments' : 'This service has its own scripture look'}>
          Custom size
        </span>
      )}
      <button
        type="button"
        className={`rt-button scripture-adjust-button${open ? ' on' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Adjust this verse"
        title="Adjust this verse: size, color, position, font"
        onClick={() => setOpen((value) => !value)}
      >
        Aa
      </button>
      {open && (
        <div className="scripture-adjust-menu" role="dialog" aria-label={`Adjust the ${where} verse`}>
          <div className="scripture-adjust-row" role="group" aria-label="Size">
            <span>Size</span>
            <button type="button" className="rt-button" aria-label={`Smaller (${MOD}−)`} title={`Smaller (${MOD}−)`} onClick={() => stepVerseSize(where, -1)}>
              <Minus size={14} aria-hidden="true" />
            </button>
            <span className="scripture-adjust-value">{look.sizeMode === 'fixed' ? percent(look.fontSize) : 'Auto'}</span>
            <button type="button" className="rt-button" aria-label={`Larger (${MOD}+)`} title={`Larger (${MOD}+)`} onClick={() => stepVerseSize(where, 1)}>
              <Plus size={14} aria-hidden="true" />
            </button>
          </div>
          <div className="scripture-adjust-row" role="radiogroup" aria-label="Color">
            <span>Color</span>
            {SWATCHES.map((swatch) => (
              <button
                key={swatch.color}
                type="button"
                role="radio"
                aria-checked={look.color === swatch.color}
                className={`highlight-swatch${look.color === swatch.color ? ' on' : ''}`}
                style={{ background: swatch.color }}
                aria-label={swatch.label}
                title={swatch.label}
                onClick={() => adjust(where, { color: swatch.color })}
              />
            ))}
            <Color value={look.color} onChange={(color) => adjust(where, { color })} />
          </div>
          <div className="scripture-adjust-row" role="group" aria-label="Position">
            <span>Position</span>
            <button type="button" className="rt-button" aria-label="Up (Alt+↑)" title="Up (Alt+↑)" onClick={() => nudgeVerse(where, -1)}>
              <ArrowUp size={14} aria-hidden="true" />
            </button>
            <button type="button" className="rt-button" aria-label="Down (Alt+↓)" title="Down (Alt+↓)" onClick={() => nudgeVerse(where, 1)}>
              <ArrowDown size={14} aria-hidden="true" />
            </button>
            <span className="scripture-adjust-value">{signed(look.offset)}</span>
          </div>
          <div className="scripture-adjust-row">
            <span>Font</span>
            <FontPicker value={look.fontFamily} emptyLabel="Default Font" onChange={(fontFamily) => adjust(where, { fontFamily })} />
            <button
              type="button"
              className={`rt-button${look.bold ? ' on' : ''}`}
              aria-pressed={look.bold}
              aria-label="Bold"
              title="Bold"
              onClick={() => adjust(where, { bold: !look.bold })}
            >
              <Bold size={14} aria-hidden="true" />
            </button>
          </div>
          <Warnings warnings={warnings} />
          <div className="scripture-adjust-actions">
            <button type="button" className="button" disabled={busy || !own} onClick={() => keep('theme')}>
              Save to default scripture theme
            </button>
            <button
              type="button"
              className="button"
              disabled={busy || !own || !hasService}
              title={hasService ? 'Every verse of this service shows these adjustments' : 'Open a service first'}
              onClick={() => keep('service')}
            >
              Apply to this service only
            </button>
            <button type="button" className="button" disabled={busy || !custom} onClick={() => reset(where)}>
              Reset to theme
            </button>
          </div>
          <p className="hint">Changes apply to this verse only until you save them.</p>
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </div>
  )
}

const SIZE_MODES: { value: ScriptureLook['sizeMode']; label: string }[] = [
  { value: 'auto', label: 'Auto fit' },
  { value: 'fixed', label: 'Fixed size' },
]
const ALIGNS: { value: ScriptureLook['align']; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
]
const REFERENCE_POSITIONS: { value: ScriptureLook['reference']['position']; label: string }[] = [
  { value: 'above', label: 'Above the verse' },
  { value: 'below', label: 'Below the verse' },
]
const POSITIONS: { value: ScriptureLook['position']; label: string }[] = [
  { value: 'top', label: 'Top' },
  { value: 'middle', label: 'Middle' },
  { value: 'bottom', label: 'Bottom' },
]
const OTHER_USES: Record<ThemeContentType, string> = {
  song: 'songs',
  scripture: 'scripture',
  announcement: 'announcements',
  quote: 'quotes',
  lowerThird: 'lower thirds',
  logo: 'the logo',
}
const SAMPLES: { value: 'one' | 'two'; label: string }[] = [
  { value: 'one', label: 'One translation' },
  { value: 'two', label: 'Two translations' },
]

/** Settings, Scripture display: the default scripture theme's verse and reference, with a live preview. */
export function ScriptureDisplayForm() {
  const themes = useOperatorStore((s) => s.themes)
  const defaults = useOperatorStore((s) => s.themeDefaults)
  const lumaKey = useOperatorStore((s) => s.settings.streamKeyMode === 'luma')
  const dualLayout = useOperatorStore((s) => s.settings.scriptureDual.layout)
  const saveTheme = useOperatorStore((s) => s.saveScriptureTheme)
  const theme = themes.find((t) => t.id === defaults?.scripture) ?? null
  const saved = useMemo(() => (theme ? readScriptureLook(theme.style) : null), [theme])
  const [draft, setDraft] = useState<ScriptureLook | null>(null)
  const [sample, setSample] = useState<'one' | 'two'>('one')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null)

  // Another default theme, or this one saved, starts again from what is stored.
  useEffect(() => setDraft(null), [theme])

  const look = draft ?? saved
  const style = useMemo(() => (theme && look ? applyScriptureLook(theme.style, look) : null), [theme, look])
  const preview = useMemo(() => (style && sample === 'two' ? dualTheme(style, { text: SAMPLE.second, layout: dualLayout }) : style), [style, sample, dualLayout])
  const warnings = useMemo(() => (style ? contrastWarnings(style, style.keyTransparent || lumaKey) : []), [style, lumaKey])

  if (!theme || !look || !style || !preview) {
    return <p className="hint">{theme ? `${theme.name} has no text box for the verse. Add one in the theme editor.` : 'Loading themes…'}</p>
  }
  const builtin = theme.type === 'builtin'
  const shared = THEME_CONTENT_TYPES.filter((type) => type !== 'scripture' && defaults?.[type] === theme.id).map((type) => OTHER_USES[type])
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(saved)
  const set = (patch: Partial<ScriptureLook>) => setDraft({ ...look, ...patch })
  const setReference = (patch: Partial<ScriptureLook['reference']>) => set({ reference: { ...look.reference, ...patch } })

  async function save() {
    if (!style) return
    setBusy(true)
    try {
      await saveTheme(style)
      setStatus({ text: builtin ? `Saved as a copy of ${theme?.name}, now the default scripture theme.` : 'Saved.', error: false })
    } catch (err) {
      setStatus({ text: err instanceof Error ? err.message : String(err), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="theme-form scripture-display">
      <p className="hint">
        Editing <strong>{theme.name}</strong>, the default scripture theme. Every translation, and both lines of two translations, use this look.
        {builtin
          ? ' It is built in, so saving makes a copy and uses that for scripture.'
          : shared.length > 0
            ? ` It is also the default for ${shared.join(', ')}, which change too.`
            : ''}
      </p>
      <div className="theme-preview">
        <ThemedSlide theme={preview} text={SAMPLE.text} caption={sample === 'two' ? 'John 3:16 KJV · NIV' : 'John 3:16 KJV'} />
      </div>
      <Segmented<'one' | 'two'> value={sample} options={SAMPLES} onChange={setSample} />
      <Warnings warnings={warnings} />

      <fieldset>
        <legend>Verse text</legend>
        <Row label="Size">
          <Segmented value={look.sizeMode} options={SIZE_MODES} onChange={(sizeMode) => set({ sizeMode })} />
        </Row>
        {look.sizeMode === 'auto' ? (
          <Row label="Maximum size">
            <Range value={look.maxSize} min={2} max={SIZE_LIMITS.max} step={0.5} format={percent} onChange={(maxSize) => set({ maxSize })} />
          </Row>
        ) : (
          <Row label="Size">
            <Range value={look.fontSize} min={SIZE_LIMITS.min} max={SIZE_LIMITS.max} step={0.25} format={percent} onChange={(fontSize) => set({ fontSize })} />
          </Row>
        )}
        <Row label="Color">
          <Color value={look.color} onChange={(color) => set({ color })} />
        </Row>
        <Row label="Font">
          <FontPicker value={look.fontFamily} emptyLabel="Default Font" onChange={(fontFamily) => set({ fontFamily })} />
        </Row>
        <Row label="Style">
          <Toggle checked={look.bold} onChange={(e) => set({ bold: e.target.checked })}>
            Bold
          </Toggle>
          <Toggle checked={look.italic} onChange={(e) => set({ italic: e.target.checked })}>
            Italic
          </Toggle>
        </Row>
        <Row label="Alignment">
          <Segmented value={look.align} options={ALIGNS} onChange={(align) => set({ align })} />
        </Row>
        <Row label="Line spacing">
          <Range value={look.lineHeight} min={0.8} max={2.5} step={0.05} format={(v) => v.toFixed(2)} onChange={(lineHeight) => set({ lineHeight })} />
        </Row>
        <Row label="Shadow">
          <Toggle aria-label="Text shadow" checked={look.shadow.enabled} onChange={(e) => set({ shadow: { ...look.shadow, enabled: e.target.checked } })} />
          <Color value={look.shadow.color} onChange={(color) => set({ shadow: { ...look.shadow, color } })} />
          <Range value={look.shadow.blur} min={0} max={1} step={0.01} format={(v) => `blur ${v.toFixed(2)}`} onChange={(blur) => set({ shadow: { ...look.shadow, blur } })} />
        </Row>
        <Row label="Outline">
          <Toggle aria-label="Text outline" checked={look.outline.enabled} onChange={(e) => set({ outline: { ...look.outline, enabled: e.target.checked } })} />
          <Color value={look.outline.color} onChange={(color) => set({ outline: { ...look.outline, color } })} />
          <Range
            value={look.outline.width}
            min={0}
            max={0.2}
            step={0.005}
            format={(v) => `width ${v.toFixed(3)}`}
            onChange={(width) => set({ outline: { ...look.outline, width } })}
          />
        </Row>
        <Row label="Padding">
          <Range value={look.padding} min={0} max={20} step={0.5} format={percent} onChange={(padding) => set({ padding })} />
        </Row>
      </fieldset>

      <fieldset>
        <legend>Reference line</legend>
        <Row label="Show">
          <Toggle checked={look.reference.show} onChange={(e) => setReference({ show: e.target.checked })}>
            Show the reference, such as “John 3:16 KJV”
          </Toggle>
        </Row>
        {look.reference.show && (
          <>
            <Row label="Size">
              <Range value={look.reference.fontSize} min={1} max={15} step={0.1} format={percent} onChange={(fontSize) => setReference({ fontSize })} />
            </Row>
            <Row label="Color">
              <Color value={look.reference.color} onChange={(color) => setReference({ color })} />
            </Row>
            <Row label="Font">
              <FontPicker value={look.reference.fontFamily} emptyLabel="Default Font" onChange={(fontFamily) => setReference({ fontFamily })} />
            </Row>
            <Row label="Position">
              <Segmented value={look.reference.position} options={REFERENCE_POSITIONS} onChange={(position) => setReference({ position })} />
            </Row>
          </>
        )}
      </fieldset>

      <fieldset>
        <legend>Vertical position</legend>
        <Row label="Position">
          <Segmented value={look.position} options={POSITIONS} onChange={(position) => set({ position })} />
        </Row>
        <Row label="Fine offset">
          <Range value={look.offset} min={-OFFSET_LIMIT} max={OFFSET_LIMIT} step={0.5} format={signed} onChange={(offset) => set({ offset })} />
        </Row>
      </fieldset>

      <div className="theme-actions">
        <Button variant="primary" disabled={busy || !dirty} onClick={save}>
          Save
        </Button>
        <Button disabled={busy || !dirty} onClick={() => setDraft(null)}>
          Revert
        </Button>
      </div>
      {status && <p className={status.error ? 'error' : 'hint'}>{status.text}</p>}
    </div>
  )
}
