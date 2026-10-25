import { AlertTriangle, Star } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type FocusEvent } from 'react'
import { BUNDLED_FONTS, fallbackFor, familyName } from '../../shared/fonts'
import {
  cssFontFamily,
  favoriteFonts,
  importedFamilies,
  importFonts,
  loadSystemFonts,
  missingFonts,
  onFontsChanged,
  recentFonts,
  rememberRecentFont,
  toggleFavoriteFont,
} from '../lib/fonts'

const PREVIEW_TEXT = 'How great is our God · Aa Bb Cc 123'
const BUNDLED = BUNDLED_FONTS.map((font) => font.family).sort((a, b) => a.localeCompare(b))
/** Rows a long group shows before asking for a search, so a machine with thousands of fonts opens quickly. */
const MAX_ROWS = 300

/** Re-renders when fonts are imported, in this window or another. */
function useImportedFamilies(): string[] {
  const [families, setFamilies] = useState(importedFamilies)
  useEffect(() => onFontsChanged(() => setFamilies(importedFamilies())), [])
  return families
}

/**
 * A searchable font list: favorites and recently used at the top, then the fonts bundled with the app, imported ones
 * and the ones installed on this computer, each name in its own typeface, with a preview line and Import font.
 */
export function FontPicker({ value, onChange, emptyLabel, buttonLabel }: { value: string; onChange(value: string): void; emptyLabel?: string; buttonLabel?: string }) {
  const [open, setOpen] = useState(false)
  const [system, setSystem] = useState<string[] | null>(null)
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState(favoriteFonts)
  const [recent, setRecent] = useState(recentFonts)
  const [hovered, setHovered] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const importing = useRef(false)
  const imported = useImportedFamilies()

  const q = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const matches = (font: string) => font.toLowerCase().includes(q)
    const taken = new Set([...BUNDLED, ...imported].map((f) => f.toLowerCase()))
    const installed = (system ?? []).filter((f) => !taken.has(f.toLowerCase()))
    return [
      { title: 'Favorites', fonts: favorites.filter(matches) },
      { title: 'Recently used', fonts: recent.filter(matches) },
      { title: 'Bundled', fonts: BUNDLED.filter(matches) },
      { title: 'Imported', fonts: imported.filter(matches) },
      { title: 'System', fonts: installed.filter(matches) },
    ]
  }, [q, favorites, recent, imported, system])
  const first = groups.find((group) => group.fonts.length > 0)?.fonts[0]

  function openList() {
    setOpen(true)
    setQuery('')
    setNote(null)
    setFavorites(favoriteFonts())
    setRecent(recentFonts())
    loadSystemFonts().then(setSystem)
  }

  function choose(font: string) {
    if (font) rememberRecentFont(font)
    onChange(font)
    setOpen(false)
  }

  async function runImport() {
    importing.current = true
    try {
      const { families, skipped } = await importFonts()
      const parts = []
      if (families.length > 0) parts.push(`Added ${families.join(', ')}.`)
      if (skipped.length > 0) parts.push(`Could not read ${skipped.join(', ')}.`)
      setNote(parts.join(' ') || null)
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err))
    } finally {
      importing.current = false
    }
  }

  function handleBlur(e: FocusEvent<HTMLDivElement>) {
    // The file dialog takes focus while importing.
    if (!importing.current && !e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
  }

  const preview = hovered ?? (value || first || '')

  return (
    <div className="font-picker" onBlur={handleBlur}>
      <button
        type="button"
        className={buttonLabel ? 'button font-picker-replace' : 'input font-picker-value'}
        style={{ fontFamily: value && !buttonLabel ? cssFontFamily(value) : undefined }}
        onClick={() => (open ? setOpen(false) : openList())}
      >
        {buttonLabel ?? (value ? familyName(value) : emptyLabel)}
      </button>
      {open && (
        <div className="font-picker-menu">
          <input
            className="input"
            placeholder="Search fonts"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              // Allow a family the list does not show, such as a font another computer has.
              if (e.key === 'Enter' && q) choose(groups.flatMap((g) => g.fonts).find((f) => f.toLowerCase() === q) ?? first ?? query.trim())
            }}
          />
          <p className="font-picker-preview" style={{ fontFamily: preview ? cssFontFamily(preview) : undefined }} aria-live="polite">
            {PREVIEW_TEXT}
          </p>
          <ul onMouseLeave={() => setHovered(null)}>
            {emptyLabel !== undefined && !q && (
              <li>
                <button type="button" className="font-picker-font" onClick={() => choose('')}>
                  {emptyLabel}
                </button>
              </li>
            )}
            {groups.map(
              (group) =>
                (group.fonts.length > 0 || (group.title === 'System' && !q)) && (
                  <li key={group.title} className="font-picker-group">
                    <h3>{group.title}</h3>
                    {group.title === 'System' && system === null && <p className="hint">Loading fonts…</p>}
                    {group.title === 'System' && system?.length === 0 && <p className="hint">This computer did not list its fonts.</p>}
                    <ul>
                      {group.fonts.slice(0, MAX_ROWS).map((font) => (
                        <li key={font} className="font-picker-row">
                          <button
                            type="button"
                            className={`font-picker-font${font === value ? ' selected' : ''}`}
                            style={{ fontFamily: cssFontFamily(font) }}
                            onMouseEnter={() => setHovered(font)}
                            onFocus={() => setHovered(font)}
                            onClick={() => choose(font)}
                          >
                            {font}
                          </button>
                          <button
                            type="button"
                            className={`icon-button font-picker-star${favorites.includes(font) ? ' on' : ''}`}
                            aria-label={favorites.includes(font) ? `Remove ${font} from favorites` : `Add ${font} to favorites`}
                            aria-pressed={favorites.includes(font)}
                            onClick={() => setFavorites(toggleFavoriteFont(font))}
                          >
                            <Star size={13} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                    {group.fonts.length > MAX_ROWS && <p className="hint">Search to see {group.fonts.length - MAX_ROWS} more.</p>}
                  </li>
                ),
            )}
          </ul>
          <div className="font-picker-import">
            <button type="button" className="button" onClick={runImport}>
              Import font…
            </button>
            <p className="hint">Only import fonts your church is licensed to use. TTF, OTF and WOFF2.</p>
            {note && <p className="hint">{note}</p>}
          </div>
        </div>
      )}
    </div>
  )
}

/** A chip for each of these fonts this computer does not have, with what shows instead and a Replace button. */
export function MissingFontChips({ values, onReplace }: { values: (string | undefined)[]; onReplace(from: string, to: string): void }) {
  // Importing a font can make one available.
  useImportedFamilies()
  const missing = missingFonts(values)
  if (missing.length === 0) return null
  return (
    <div className="font-missing-list" role="status">
      {missing.map((font) => (
        <span key={font} className="font-missing-chip" title={`Not on this computer. Showing ${familyName(fallbackFor(font))} instead.`}>
          <AlertTriangle size={13} aria-hidden="true" />
          <span>
            <strong>{font}</strong> missing
          </span>
          <FontPicker value="" buttonLabel="Replace" onChange={(to) => to && onReplace(font, to)} />
        </span>
      ))}
    </div>
  )
}
