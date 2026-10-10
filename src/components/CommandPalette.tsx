import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Eraser,
  Image,
  Monitor,
  MonitorPlay,
  MonitorUp,
  Moon,
  Music,
  Palette,
  Search,
  Settings,
  SkipForward,
  Square,
  Sun,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { formatReference, parseReference } from '../../shared/parseReference'
import {
  bookNeeded,
  isKeywordQuery,
  loadBookStructure,
  referenceVersion,
  savedVersionFilter,
  searchVersions,
  suggestReferences,
} from '../lib/referenceSuggestions'
import { loadScripture } from '../lib/scripture'
import { MOD } from '../lib/shortcuts'
import { useOperatorStore } from '../store'

interface Command {
  id: string
  group: 'Actions' | 'Songs' | 'Scripture'
  label: string
  detail?: string
  shortcut?: string
  icon: LucideIcon
  run(): void | Promise<unknown>
  /** Choosing it fills the box with this instead of running (a book or chapter while typing a reference). */
  complete?: string
}

const MAX_RESULTS = 8

/** The fixed actions; reads the store when run, so it never holds stale state. */
function actionCommands(): Command[] {
  const st = useOperatorStore.getState
  const mode = (m: 'show' | 'black' | 'clear' | 'logo') => () => st().setOutputMode(m)
  const appearance = st().settings.appearance
  return [
    { id: 'show', group: 'Actions', label: 'Show slide', shortcut: 'S', icon: Monitor, run: mode('show') },
    { id: 'black', group: 'Actions', label: 'Black screen', shortcut: 'B', icon: Square, run: mode('black') },
    { id: 'clear', group: 'Actions', label: 'Clear text (background only)', shortcut: 'C', icon: Eraser, run: mode('clear') },
    { id: 'logo', group: 'Actions', label: 'Show logo', shortcut: 'L', icon: Image, run: mode('logo') },
    { id: 'go-live', group: 'Actions', label: 'Go live with the preview slide', shortcut: '↵', icon: MonitorUp, run: () => st().goLiveHighlighted() },
    { id: 'next-slide', group: 'Actions', label: 'Next live slide', shortcut: '→', icon: ArrowRight, run: () => st().nextSlide() },
    { id: 'prev-slide', group: 'Actions', label: 'Previous live slide', shortcut: '←', icon: ArrowLeft, run: () => st().previousSlide() },
    { id: 'next-item', group: 'Actions', label: 'Stage the next schedule item', shortcut: `${MOD}↓`, icon: SkipForward, run: () => st().nextItem() },
    { id: 'themes', group: 'Actions', label: 'Open themes', icon: Palette, run: () => st().openThemeEditor(true) },
    { id: 'settings', group: 'Actions', label: 'Open settings', icon: Settings, run: () => st().openSettings(true) },
    {
      id: 'stage',
      group: 'Actions',
      label: st().stageOpen ? 'Close stage display' : 'Open stage display',
      icon: MonitorPlay,
      run: () => st().toggleStage(),
    },
    {
      id: 'appearance',
      group: 'Actions',
      label: appearance === 'light' ? 'Switch to dark mode' : 'Switch to light mode',
      icon: appearance === 'light' ? Moon : Sun,
      run: () => st().updateSettings({ appearance: appearance === 'light' ? 'dark' : 'light' }),
    },
  ]
}

/** Search for songs, verses and actions; Cmd+K (Ctrl+K) opens it. */
export function CommandPalette() {
  const setPaletteOpen = useOperatorStore((s) => s.setPaletteOpen)
  const [query, setQuery] = useState('')
  /** Songs and verses, with the query they answer, so results for older text are never shown or run. */
  const [found, setFound] = useState<{ query: string; commands: Command[] }>({ query: '', commands: [] })
  /** The input the user chose to search as words, as the Scripture tab's "Search verses for" does. */
  const [forceText, setForceText] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const close = () => setPaletteOpen(false)

  const actions = useMemo(() => {
    const q = query.trim().toLowerCase()
    return actionCommands().filter((c) => !q || c.label.toLowerCase().includes(q))
  }, [query])

  // Songs and verses come from the database, after a short pause in typing.
  useEffect(() => {
    const q = query.trim()
    if (!q) return
    let cancelled = false
    const timer = setTimeout(async () => {
      const st = useOperatorStore.getState
      const results: Command[] = []
      try {
        const songs = await window.api.songs.list(q)
        for (const song of songs.slice(0, MAX_RESULTS)) {
          results.push({
            id: `song-${song.id}`,
            group: 'Songs',
            label: song.title,
            detail: song.author ?? undefined,
            icon: Music,
            run: async () => {
              const full = await window.api.songs.get(song.id)
              st().selectSong(full ?? null)
              st().showGrid()
            },
          })
        }

        // The same search as the Scripture tab: reference suggestions, else the full-text index.
        const filter = savedVersionFilter()
        const asText = forceText === query
        // The box as typed: a trailing space after a book name moves on to its chapters.
        if (!asText && !isKeywordQuery(query)) {
          const book = bookNeeded(query)
          const structures = book ? { [book]: await loadBookStructure(book) } : {}
          const suggestions = suggestReferences(query, structures, MAX_RESULTS)
          // A complete reference such as "ps 23" opens straight away, as Enter does in the Scripture tab.
          const parsed = parseReference(query)
          if (parsed && suggestions[0]?.kind === 'chapter') {
            const version = referenceVersion(filter)
            results.push({
              id: 'ref-open',
              group: 'Scripture',
              label: `${formatReference(parsed)} ${version}`,
              detail: parsed.verseStart === null ? 'whole chapter' : undefined,
              icon: BookOpen,
              run: async () => {
                if (!(await loadScripture(parsed, version))) throw new Error(`${formatReference(parsed)} is not in the ${version}`)
                st().showGrid()
              },
            })
          }
          for (const suggestion of suggestions.slice(0, MAX_RESULTS - results.filter((r) => r.group === 'Scripture').length)) {
            const base = { id: `ref-${suggestion.kind}-${suggestion.label}`, group: 'Scripture' as const, icon: BookOpen }
            if (suggestion.kind === 'book') results.push({ ...base, label: suggestion.label, complete: `${suggestion.book} `, run: () => {} })
            else if (suggestion.kind === 'chapter') {
              results.push({ ...base, label: suggestion.label, complete: `${suggestion.book} ${suggestion.chapter}:`, run: () => {} })
            } else if (suggestion.kind === 'text') {
              results.push({ ...base, label: suggestion.label, complete: query, run: () => setForceText(query) })
            } else {
              const version = referenceVersion(filter)
              results.push({
                ...base,
                label: `${suggestion.label.replace(' (whole chapter)', '')} ${version}`,
                detail: suggestion.kind === 'wholeChapter' ? 'whole chapter' : undefined,
                run: async () => {
                  if (!(await loadScripture(suggestion.ref, version))) throw new Error(`${suggestion.label} is not in the ${version}`)
                  st().showGrid()
                },
              })
            }
          }
        } else if (q.length >= 2) {
          const { hits } = await window.api.bible.search({
            // As typed: a trailing space marks the last word finished, so it is not matched as a prefix.
            query,
            versions: searchVersions(filter),
            testament: 'all',
            book: null,
            offset: 0,
            limit: MAX_RESULTS,
          })
          for (const hit of hits) {
            const ref = { book: hit.book, chapter: hit.chapter, verseStart: hit.verse, verseEnd: hit.verse }
            results.push({
              id: `verse-${hit.id}`,
              group: 'Scripture',
              label: `${hit.book} ${hit.chapter}:${hit.verse} ${hit.version}`,
              detail: hit.text,
              icon: BookOpen,
              run: async () => {
                await loadScripture(ref, hit.version)
                st().showGrid()
              },
            })
          }
        }
      } catch (err) {
        console.error(err)
      }
      if (!cancelled) setFound({ query: q, commands: results })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, forceText])

  // Songs and verses first when searching; actions first when the box is empty.
  const current = found.query === query.trim() ? found.commands : []
  const commands = query.trim() ? [...current, ...actions] : actions
  const activeIndex = Math.min(active, Math.max(commands.length - 1, 0))

  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  async function run(command: Command | undefined) {
    if (!command) return
    // A book or chapter fills the box and keeps the palette open, like the Scripture tab's suggestions.
    if (command.complete !== undefined) {
      command.run()
      setQuery(command.complete)
      inputRef.current?.focus()
      return
    }
    close()
    try {
      await command.run()
    } catch (err) {
      console.error(err)
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, commands.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      run(commands[activeIndex])
    } else if (e.key === 'Tab' && commands[activeIndex]?.complete !== undefined) {
      e.preventDefault()
      run(commands[activeIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  let lastGroup: string | null = null

  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={close}>
      <div className="palette" role="dialog" aria-label="Command palette" onMouseDown={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={18} aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            placeholder="Search songs, verses (jn 3:16) or actions"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-results"
            aria-activedescendant={commands[activeIndex] ? `palette-${commands[activeIndex].id}` : undefined}
          />
          <kbd>esc</kbd>
        </div>
        <ul className="palette-results" id="palette-results" role="listbox" ref={listRef}>
          {commands.map((command, index) => {
            const heading = command.group !== lastGroup ? command.group : null
            lastGroup = command.group
            const Icon = command.icon
            return (
              <li key={command.id} role="presentation">
                {heading && <div className="palette-group">{heading}</div>}
                <button
                  id={`palette-${command.id}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  data-index={index}
                  className={`palette-item${index === activeIndex ? ' active' : ''}`}
                  onMouseMove={() => setActive(index)}
                  onClick={() => run(command)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span className="palette-label">{command.label}</span>
                  {command.detail && <span className="palette-detail">{command.detail}</span>}
                  {command.shortcut && <kbd>{command.shortcut}</kbd>}
                </button>
              </li>
            )
          })}
          {commands.length === 0 && <li className="empty">Nothing found.</li>}
        </ul>
      </div>
    </div>
  )
}
