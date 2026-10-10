import { useEffect, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { LivePreview } from './components/LivePreview'
import { ListenerPanel } from './components/ListenerPanel'
import { MediaPanel } from './components/MediaPanel'
import { SchedulePanel } from './components/SchedulePanel'
import { ScripturePanel } from './components/ScripturePanel'
import { SettingsPanel } from './components/SettingsPanel'
import { SlideGrid } from './components/SlideGrid'
import { SongEditor } from './components/SongEditor'
import { SongList } from './components/SongList'
import { Splitter } from './components/Splitter'
import { ThemeEditor } from './components/ThemeEditor'
import { Toolbar } from './components/Toolbar'
import { isTyping, MODE_KEYS } from './lib/shortcuts'
import { usePersistentState } from './lib/usePersistentState'
import { selectOutputState, selectStageState, useOperatorStore } from './store'

type PanelSizes = { library: number; preview: number; schedule: number }

const DEFAULT_SIZES: PanelSizes = { library: 300, preview: 360, schedule: 280 }
const LIMITS = { library: [200, 520], preview: [260, 720], schedule: [220, 480] } as const

const isPanelSizes = (value: unknown): value is PanelSizes =>
  typeof value === 'object' &&
  value !== null &&
  (Object.keys(LIMITS) as (keyof PanelSizes)[]).every((key) => typeof (value as PanelSizes)[key] === 'number')
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

const LIBRARY_TABS = [
  { id: 'songs', label: 'Songs' },
  { id: 'scripture', label: 'Scripture' },
  { id: 'media', label: 'Media' },
] as const

function App() {
  const [libraryTab, setLibraryTab] = useState<(typeof LIBRARY_TABS)[number]['id']>('songs')
  const [sizes, setSizes] = usePersistentState('worshipdeck.panelSizes', DEFAULT_SIZES, isPanelSizes)
  const [scheduleCollapsed, setScheduleCollapsed] = usePersistentState('worshipdeck.scheduleCollapsed', false, isBoolean)
  const editingSongId = useOperatorStore((s) => s.editingSongId)
  const themeEditorOpen = useOperatorStore((s) => s.themeEditorOpen)
  const settingsOpen = useOperatorStore((s) => s.settingsOpen)
  const paletteOpen = useOperatorStore((s) => s.paletteOpen)
  const appearance = useOperatorStore((s) => s.settings.appearance)

  const resize = (key: keyof PanelSizes) => (value: number) => setSizes((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    const st = useOperatorStore.getState()
    st.loadThemes().catch(console.error)
    st.loadSettings().catch(console.error)
    window.api.stage.isOpen().then(st.setStageOpen, console.error)
    return window.api.stage.onOpenChange(st.setStageOpen)
  }, [])

  // Dark or light; with "system" the stylesheet follows the operating system.
  useEffect(() => {
    const root = document.documentElement
    if (appearance === 'system') delete root.dataset.theme
    else root.dataset.theme = appearance
  }, [appearance])

  // Mirror the operator state to the output and stage windows, sending only what changed.
  useEffect(() => {
    let lastOutput = ''
    let lastStage = ''
    const send = () => {
      const s = useOperatorStore.getState()
      const output = selectOutputState(s)
      const outputJson = JSON.stringify(output)
      if (outputJson !== lastOutput) {
        lastOutput = outputJson
        window.api.output.send(output)
      }
      const stage = selectStageState(s)
      const stageJson = JSON.stringify(stage)
      if (stageJson !== lastStage) {
        lastStage = stageJson
        window.api.stage.send(stage)
      }
    }
    send()
    return useOperatorStore.subscribe(send)
  }, [])

  // A file dropped outside the import drop zone would otherwise replace the app with the file.
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', block)
    window.addEventListener('drop', block)
    return () => {
      window.removeEventListener('dragover', block)
      window.removeEventListener('drop', block)
    }
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const st = useOperatorStore.getState()
      const mod = e.metaKey || e.ctrlKey
      // Cmd+K (Ctrl+K) opens the command palette from anywhere.
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        st.setPaletteOpen(!st.paletteOpen)
        return
      }
      // Cmd+Down (Ctrl+Down) runs the schedule: next item, first slide live.
      if (e.key === 'ArrowDown' && mod && !e.altKey && !e.shiftKey && !isTyping(e.target)) {
        e.preventDefault()
        st.nextItem().catch(console.error)
        return
      }
      if (e.altKey || mod || isTyping(e.target)) return
      const modeKey = MODE_KEYS.find((m) => m.key.toLowerCase() === e.key.toLowerCase())
      if (modeKey) {
        e.preventDefault()
        st.setOutputMode(modeKey.mode)
      } else if (e.key === 'ArrowRight') {
        // Left and Right step through the live item, whatever the grid shows.
        e.preventDefault()
        st.nextSlide()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        st.previousSlide()
      } else if (e.key === 'ArrowDown') {
        // Up and Down move the preview highlight in the grid's item.
        e.preventDefault()
        st.moveHighlight(1)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        st.moveHighlight(-1)
      } else if (e.key === 'Enter') {
        // Enter on another button (a schedule item, a dialog) keeps its own meaning; on a slide card or the page
        // it sends the highlighted preview slide live.
        const target = e.target as HTMLElement | null
        if (target?.closest('button, a, [role="button"]') && !target.closest('.slide-card')) return
        e.preventDefault()
        st.goLiveHighlighted()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const columns = [
    `${sizes.library}px`,
    'auto',
    'minmax(360px, 1fr)',
    'auto',
    `${sizes.preview}px`,
    ...(scheduleCollapsed ? ['auto'] : ['auto', `${sizes.schedule}px`]),
  ].join(' ')

  return (
    <div className="app">
      <Toolbar />
      <main className="operator" style={{ gridTemplateColumns: columns }}>
        <div className="library">
          <div className="library-tabs" role="tablist">
            {LIBRARY_TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={libraryTab === tab.id}
                className={`library-tab${libraryTab === tab.id ? ' active' : ''}`}
                onClick={() => setLibraryTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {/* All stay mounted so each keeps its search text when switching tabs. */}
          <div className="library-page" hidden={libraryTab !== 'songs'}>
            <SongList />
          </div>
          <div className="library-page" hidden={libraryTab !== 'scripture'}>
            <ScripturePanel />
          </div>
          <div className="library-page" hidden={libraryTab !== 'media'}>
            <MediaPanel />
          </div>
        </div>
        <Splitter label="Resize library" value={sizes.library} min={LIMITS.library[0]} max={LIMITS.library[1]} direction={1} onChange={resize('library')} />
        {editingSongId !== null ? (
          <SongEditor key={editingSongId} songId={editingSongId} />
        ) : themeEditorOpen ? (
          <ThemeEditor />
        ) : settingsOpen ? (
          <SettingsPanel />
        ) : (
          <SlideGrid />
        )}
        <Splitter label="Resize live output" value={sizes.preview} min={LIMITS.preview[0]} max={LIMITS.preview[1]} direction={-1} onChange={resize('preview')} />
        <div className="preview-column">
          <LivePreview />
          <ListenerPanel />
        </div>
        {!scheduleCollapsed && (
          <Splitter label="Resize schedule" value={sizes.schedule} min={LIMITS.schedule[0]} max={LIMITS.schedule[1]} direction={-1} onChange={resize('schedule')} />
        )}
        <SchedulePanel collapsed={scheduleCollapsed} onCollapsedChange={setScheduleCollapsed} />
      </main>
      {paletteOpen && <CommandPalette />}
    </div>
  )
}

export default App
