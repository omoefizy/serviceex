import { AlertTriangle, Star, Trash2, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BUNDLED_FONTS, fallbackFor, familyName } from '../../shared/fonts'
import { reportError } from '../lib/errors'
import {
  cssFontFamily,
  favoriteFonts,
  importedFamilies,
  importFonts,
  importNote,
  loadSystemFonts,
  missingFonts,
  onFontsChanged,
  recentFonts,
  rememberRecentFont,
  removeImportedFamily,
  toggleFavoriteFont,
} from '../lib/fonts'
import { can } from '../../shared/features'
import { askUpgrade } from '../lib/upgrade'
import { Locked } from './Locked'

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

/** Where the menu goes: under the button, or over it when there is more room above; never past the window. */
interface MenuPlace {
  left: number
  top?: number
  bottom?: number
  maxHeight: number
}

const MENU_WIDTH = 300
const MENU_GAP = 4
const WINDOW_MARGIN = 8

function placeMenu(button: HTMLElement): MenuPlace {
  const rect = button.getBoundingClientRect()
  const left = Math.max(WINDOW_MARGIN, Math.min(rect.left, window.innerWidth - MENU_WIDTH - WINDOW_MARGIN))
  const below = window.innerHeight - rect.bottom - MENU_GAP - WINDOW_MARGIN
  const above = rect.top - MENU_GAP - WINDOW_MARGIN
  return below >= 360 || below >= above
    ? { left, top: rect.bottom + MENU_GAP, maxHeight: below }
    : { left, bottom: window.innerHeight - rect.top + MENU_GAP, maxHeight: above }
}

/**
 * A searchable font list: imported fonts at the top, then favorites, recently used, the fonts bundled with the app and
 * the ones installed on this computer, each name in its own typeface, with a preview line. Import font… and dropping
 * TTF, OTF, WOFF or WOFF2 files on the list add fonts, which show at once in every picker and window. The menu floats
 * over the page inside the window, so it is never cut off by the panel the picker sits in.
 */
export function FontPicker({ value, onChange, emptyLabel, buttonLabel }: { value: string; onChange(value: string): void; emptyLabel?: string; buttonLabel?: string }) {
  const [place, setPlace] = useState<MenuPlace | null>(null)
  const open = place !== null
  const [system, setSystem] = useState<string[] | null>(null)
  const [query, setQuery] = useState('')
  const [favorites, setFavorites] = useState(favoriteFonts)
  const [recent, setRecent] = useState(recentFonts)
  const [hovered, setHovered] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [dropping, setDropping] = useState(false)
  const importing = useRef(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const imported = useImportedFamilies()

  const q = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const matches = (font: string) => font.toLowerCase().includes(q)
    const taken = new Set([...BUNDLED, ...imported].map((f) => f.toLowerCase()))
    const installed = (system ?? []).filter((f) => !taken.has(f.toLowerCase()))
    return [
      { title: 'Imported', fonts: imported.filter(matches) },
      { title: 'Favorites', fonts: favorites.filter(matches) },
      { title: 'Recently used', fonts: recent.filter(matches) },
      { title: 'Bundled', fonts: BUNDLED.filter(matches) },
      { title: 'System', fonts: installed.filter(matches) },
    ]
  }, [q, favorites, recent, imported, system])
  const first = groups.find((group) => group.fonts.length > 0)?.fonts[0]

  // The menu follows its button when the page scrolls or the window changes size.
  useEffect(() => {
    if (!open) return
    const follow = () => buttonRef.current && setPlace(placeMenu(buttonRef.current))
    window.addEventListener('resize', follow)
    window.addEventListener('scroll', follow, true)
    return () => {
      window.removeEventListener('resize', follow)
      window.removeEventListener('scroll', follow, true)
    }
  }, [open])

  function openList() {
    if (!buttonRef.current) return
    setPlace(placeMenu(buttonRef.current))
    setQuery('')
    setNote(null)
    setFavorites(favoriteFonts())
    setRecent(recentFonts())
    loadSystemFonts().then(setSystem)
  }

  const close = () => setPlace(null)

  function choose(font: string) {
    if (font) rememberRecentFont(font)
    onChange(font)
    close()
  }

  async function runImport(files?: File[]) {
    if (!can('fonts.import')) return askUpgrade('fonts.import')
    importing.current = true
    try {
      setNote(importNote(await importFonts(files)))
    } catch (err) {
      setNote(reportError('Fonts', err).message)
    } finally {
      importing.current = false
    }
  }

  async function remove(font: string) {
    if (!window.confirm(`Remove the imported font "${font}"? Text using it shows ${familyName(fallbackFor(font))} instead until it is imported again.`)) return
    try {
      await removeImportedFamily(font)
      setNote(`Removed ${font}.`)
    } catch (err) {
      setNote(reportError('Fonts', err).message)
    }
  }

  function handleBlur() {
    // Once focus has landed (the menu takes it as it opens): closed when it went elsewhere, or the window lost it.
    // The file dialog takes focus while importing.
    requestAnimationFrame(() => {
      const at = document.activeElement
      if (importing.current || !document.hasFocus()) return
      if (!buttonRef.current?.parentElement?.contains(at) && !menuRef.current?.contains(at)) close()
    })
  }

  const preview = hovered ?? (value || first || '')

  return (
    <div className="font-picker" onBlur={handleBlur}>
      <button
        ref={buttonRef}
        type="button"
        className={buttonLabel ? 'button font-picker-replace' : 'input font-picker-value'}
        style={{ fontFamily: value && !buttonLabel ? cssFontFamily(value) : undefined }}
        aria-expanded={open}
        onClick={() => (open ? close() : openList())}
      >
        {buttonLabel ?? (value ? familyName(value) : emptyLabel)}
      </button>
      {place &&
        createPortal(
          <div
            ref={menuRef}
            className={`font-picker-menu${dropping ? ' dropping' : ''}`}
            role="dialog"
            aria-label="Fonts"
            style={{ left: place.left, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
            onBlur={handleBlur}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return
              e.preventDefault()
              e.dataTransfer.dropEffect = 'copy'
              setDropping(true)
            }}
            onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setDropping(false)}
            onDrop={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return
              e.preventDefault()
              setDropping(false)
              void runImport([...e.dataTransfer.files])
            }}
          >
            <input
              className="input"
              placeholder="Search fonts"
              aria-label="Search fonts"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') close()
                // Allow a family the list does not show, such as a font another computer has.
                if (e.key === 'Enter' && q) choose(groups.flatMap((g) => g.fonts).find((f) => f.toLowerCase() === q) ?? first ?? query.trim())
              }}
            />
            <div className="font-picker-import">
              <Locked feature="fonts.import">
                <button type="button" className="button" onClick={() => void runImport()}>
                  <Upload size={14} aria-hidden="true" /> Import font…
                </button>
              </Locked>
              <span className="hint">or drop TTF, OTF, WOFF or WOFF2 files here. Only fonts your church is licensed to use.</span>
            </div>
            {note && (
              <p className="hint font-picker-note" role="status">
                {note}
              </p>
            )}
            <p className="font-picker-preview" style={{ fontFamily: preview ? cssFontFamily(preview) : undefined }} aria-live="polite">
              {PREVIEW_TEXT}
            </p>
            <ul className="font-picker-list" onMouseLeave={() => setHovered(null)}>
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
                            {group.title === 'Imported' && (
                              <button type="button" className="icon-button font-picker-star" aria-label={`Remove ${font}`} title="Remove this imported font" onClick={() => void remove(font)}>
                                <Trash2 size={13} aria-hidden="true" />
                              </button>
                            )}
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
          </div>,
          document.body,
        )}
    </div>
  )
}

/**
 * A warning for each of these fonts this computer does not have, with what shows instead, Import font (one click to
 * the file picker) and Replace.
 */
export function MissingFontChips({ values, onReplace }: { values: (string | undefined)[]; onReplace(from: string, to: string): void }) {
  // Importing a font can make one available.
  useImportedFamilies()
  const [note, setNote] = useState<string | null>(null)
  const missing = missingFonts(values)
  if (missing.length === 0) return null

  async function runImport() {
    try {
      setNote(importNote(await importFonts()))
    } catch (err) {
      setNote(reportError('Fonts', err).message)
    }
  }

  return (
    <div className="font-missing-list" role="status">
      {missing.map((font) => (
        <span key={font} className="font-missing-chip" title={`Not on this computer. Showing ${familyName(fallbackFor(font))} instead.`}>
          <AlertTriangle size={13} aria-hidden="true" />
          <span>
            Missing font: <strong>{font}</strong>
          </span>
          <Locked feature="fonts.import">
            <button type="button" className="button font-picker-replace" onClick={() => void runImport()}>
              Import font
            </button>
          </Locked>
          <FontPicker value="" buttonLabel="Replace" onChange={(to) => to && onReplace(font, to)} />
        </span>
      ))}
      {note && <p className="hint">{note}</p>}
    </div>
  )
}
