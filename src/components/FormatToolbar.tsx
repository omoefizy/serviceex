import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Baseline,
  Bold,
  Highlighter,
  Italic,
  RemoveFormatting,
  Strikethrough,
  Underline,
  X,
  type LucideIcon,
} from 'lucide-react'
import type { MouseEvent, ReactNode } from 'react'
import type { RichMarksPatch, RichParagraphPatch } from '../../shared/richText'
import type { RichAlign, TextCase } from '../../shared/types'
import { MOD } from '../lib/shortcuts'
import { FontPicker } from './FontPicker'

/** What the toolbar shows for the current selection: the formatting where set, else the theme's look. */
export interface FormatState {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  /** #rrggbb. */
  color: string
  highlight: string | null
  /** Empty: the theme's font. */
  font: string
  /** A multiple of the theme's size, or null for the theme's. */
  size: number | null
  /** Null: the theme's case. */
  textCase: TextCase | null
  align: RichAlign
  verticalAlign: 'top' | 'middle' | 'bottom'
  /** Null: the theme's line spacing. */
  lineHeight: number | null
}

export type FormatPatch = RichMarksPatch & RichParagraphPatch

/** Controls a place can switch off, such as alignment for a one-line field. */
export type FormatControl = 'strike' | 'highlight' | 'size' | 'case' | 'align' | 'justify' | 'verticalAlign' | 'lineHeight' | 'clear'

const SIZES = [0.5, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 2, 2.5, 3]
const LINE_HEIGHTS = [0.8, 0.9, 1, 1.1, 1.2, 1.35, 1.5, 1.75, 2]

const ALIGNS: { value: RichAlign; label: string; icon: LucideIcon; key: string }[] = [
  { value: 'left', label: 'Align left', icon: AlignLeft, key: 'L' },
  { value: 'center', label: 'Center', icon: AlignCenter, key: 'E' },
  { value: 'right', label: 'Align right', icon: AlignRight, key: 'R' },
  { value: 'justify', label: 'Justify', icon: AlignJustify, key: 'J' },
]

const VERTICAL: { value: FormatState['verticalAlign']; label: string; icon: LucideIcon }[] = [
  { value: 'top', label: 'Top', icon: AlignVerticalJustifyStart },
  { value: 'middle', label: 'Middle', icon: AlignVerticalJustifyCenter },
  { value: 'bottom', label: 'Bottom', icon: AlignVerticalJustifyEnd },
]

/** Clicking a button keeps the text's selection and focus where they are. */
const keepSelection = (e: MouseEvent) => e.preventDefault()

/** A color input takes only #rrggbb. */
const hex6 = (value: string) => (/^#[0-9a-f]{6}$/i.test(value) ? value : /^#[0-9a-f]{3}$/i.test(value) ? `#${[...value.slice(1)].map((c) => c + c).join('')}` : '#ffffff')

function ToolButton({ label, icon: Icon, pressed, disabled, onClick }: { label: string; icon: LucideIcon; pressed?: boolean; disabled?: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      className={`rt-button${pressed ? ' on' : ''}`}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onMouseDown={keepSelection}
      onClick={onClick}
    >
      <Icon size={14} aria-hidden="true" />
    </button>
  )
}

/**
 * The formatting toolbar, the same wherever slide text is edited: marks, colors, font, size and case, alignment, line
 * spacing and Clear formatting. `inherit` adds "Theme" choices that hand a setting back to the theme; without it
 * (the theme editor itself) every control sets a value.
 */
export function FormatToolbar({
  state,
  onChange,
  onClear,
  inherit = true,
  disabled = [],
  fontEmptyLabel,
  children,
}: {
  state: FormatState
  onChange(patch: FormatPatch, refocus?: boolean): void
  onClear?(): void
  inherit?: boolean
  disabled?: FormatControl[]
  fontEmptyLabel?: string
  /** Buttons for this place, such as Reset to theme, at the end of the bar. */
  children?: ReactNode
}) {
  const off = (control: FormatControl) => disabled.includes(control)
  const sizes = state.size !== null && !SIZES.includes(state.size) ? [...SIZES, state.size].sort((a, b) => a - b) : SIZES
  const lineHeights = state.lineHeight !== null && !LINE_HEIGHTS.includes(state.lineHeight) ? [...LINE_HEIGHTS, state.lineHeight].sort((a, b) => a - b) : LINE_HEIGHTS

  return (
    <div className="rt-toolbar" role="toolbar" aria-label="Formatting">
      <div className="rt-group">
        <ToolButton label={`Bold (${MOD}B)`} icon={Bold} pressed={state.bold} onClick={() => onChange({ bold: !state.bold })} />
        <ToolButton label={`Italic (${MOD}I)`} icon={Italic} pressed={state.italic} onClick={() => onChange({ italic: !state.italic })} />
        <ToolButton label={`Underline (${MOD}U)`} icon={Underline} pressed={state.underline} onClick={() => onChange({ underline: !state.underline })} />
        <ToolButton label="Strikethrough" icon={Strikethrough} pressed={state.strike} disabled={off('strike')} onClick={() => onChange({ strike: !state.strike })} />
      </div>

      <div className="rt-group">
        <label className="rt-color" title="Text color">
          <Baseline size={14} aria-hidden="true" />
          <span className="rt-swatch" style={{ background: state.color }} />
          <input type="color" aria-label="Text color" value={hex6(state.color)} onChange={(e) => onChange({ color: e.target.value }, false)} />
        </label>
        <label className={`rt-color${off('highlight') ? ' disabled' : ''}`} title="Highlight color">
          <Highlighter size={14} aria-hidden="true" />
          <span className={`rt-swatch${state.highlight ? '' : ' none'}`} style={{ background: state.highlight ?? undefined }} />
          <input
            type="color"
            aria-label="Highlight color"
            disabled={off('highlight')}
            value={state.highlight ?? '#ffff00'}
            onChange={(e) => onChange({ highlight: e.target.value }, false)}
          />
        </label>
        {state.highlight && !off('highlight') && (
          <button type="button" className="rt-button rt-small" aria-label="No highlight" title="No highlight" onMouseDown={keepSelection} onClick={() => onChange({ highlight: null })}>
            <X size={12} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="rt-group rt-font">
        <FontPicker value={state.font} emptyLabel={inherit ? 'Theme font' : fontEmptyLabel} onChange={(font) => onChange({ font: font || null })} />
        <select
          className="input rt-select"
          aria-label="Font size"
          title="Font size, compared with the theme's"
          disabled={off('size')}
          value={state.size ?? ''}
          onChange={(e) => onChange({ size: e.target.value ? Number(e.target.value) : null })}
        >
          {inherit && <option value="">Size</option>}
          {sizes.map((size) => (
            <option key={size} value={size}>
              {Math.round(size * 100)}%
            </option>
          ))}
        </select>
        <select
          className="input rt-select"
          aria-label="Text case"
          title="Text case"
          disabled={off('case')}
          value={state.textCase ?? ''}
          onChange={(e) => onChange({ textCase: (e.target.value || null) as TextCase | null })}
        >
          {inherit && <option value="">Case</option>}
          <option value="normal">As typed</option>
          <option value="upper">UPPERCASE</option>
          <option value="lower">lowercase</option>
        </select>
      </div>

      <div className="rt-group">
        {ALIGNS.map(({ value, label, icon, key }) => (
          <ToolButton
            key={value}
            label={value === 'justify' ? label : `${label} (${MOD}${key})`}
            icon={icon}
            pressed={state.align === value}
            disabled={off('align') || (value === 'justify' && off('justify'))}
            onClick={() => onChange({ align: value })}
          />
        ))}
      </div>

      <div className="rt-group">
        {VERTICAL.map(({ value, label, icon }) => (
          <ToolButton
            key={value}
            label={`Vertical: ${label}`}
            icon={icon}
            pressed={state.verticalAlign === value}
            disabled={off('verticalAlign')}
            onClick={() => onChange({ verticalAlign: value })}
          />
        ))}
        <select
          className="input rt-select"
          aria-label="Line spacing"
          title="Line spacing"
          disabled={off('lineHeight')}
          value={state.lineHeight ?? ''}
          onChange={(e) => onChange({ lineHeight: e.target.value ? Number(e.target.value) : null })}
        >
          {inherit && <option value="">Spacing</option>}
          {lineHeights.map((value) => (
            <option key={value} value={value}>
              {value.toFixed(2)}
            </option>
          ))}
        </select>
      </div>

      {(onClear || children) && (
        <div className="rt-group">
          {onClear && <ToolButton label="Clear formatting" icon={RemoveFormatting} disabled={off('clear')} onClick={onClear} />}
          {children}
        </div>
      )}
    </div>
  )
}
