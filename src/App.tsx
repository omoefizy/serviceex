import { useEffect, useState } from 'react'
import { CommandPalette } from './components/CommandPalette'
import { LivePreview } from './components/LivePreview'
import { LowerThirdPanel } from './components/LowerThirdPanel'
import { ListenerPanel } from './components/ListenerPanel'
import { MediaPanel } from './components/MediaPanel'
import { PanelBoundary } from './components/PanelBoundary'
import { PresentationsPanel } from './components/PresentationsPanel'
import { SchedulePanel } from './components/SchedulePanel'
import { ScripturePanel } from './components/ScripturePanel'
import { SettingsPanel } from './components/SettingsPanel'
import { SlideGrid } from './components/SlideGrid'
import { SongEditor } from './components/SongEditor'
import { SongList } from './components/SongList'
import { StreamPanel } from './components/StreamPanel'
import { Splitter } from './components/Splitter'
import { ThemeEditor } from './components/ThemeEditor'
import { Toolbar } from './components/Toolbar'
import { highlightKey, toggleHighlightMode } from './lib/highlights'
import { focusLowerThirdHeadline, isTyping, MODE_KEYS } from './lib/shortcuts'
import { slideTranslation } from './lib/translations'
import { usePersistentState } from './lib/usePersistentState'
import {
  selectBrowsingLive,
  selectLiveSlide,
  selectOutputState,
  selectPowerPointTarget,
  selectPreviewSlide,
  selectStageState,
  selectStreamState,
  selectTranslationTarget,
  useOperatorStore,
} from './store'

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
  { id: 'presentations', label: 'Presentations' },
  { id: 'media', label: 'Media' },
] as const

function App() {
  const [libraryTab, setLibraryTab] = useState<(typeof LIBRARY_TABS)[number]['id']>('songs')
  const [sizes, setSizes] = usePersistentState('worshipdeck.panelSizes', DEFAULT_SIZES, isPanelSizes)
  const [scheduleCollapsed, setScheduleCollapsed] = usePersistentState('worshipdeck.scheduleCollapsed', false, isBoolean)
  const editingSongId = useOperatorStore((s) => s.editingSongId)
  const themeEditorOpen = useOperatorStore((s) => s.themeEditorOpen)
  const settingsOpen = useOperatorStore((s) => s.settingsOpen)
  const streamPanelOpen = useOperatorStore((s) => s.streamPanelOpen)
  const paletteOpen = useOperatorStore((s) => s.paletteOpen)
  const appearance = useOperatorStore((s) => s.settings.appearance)

  const resize = (key: keyof PanelSizes) => (value: number) => setSizes((current) => ({ ...current, [key]: value }))

  useEffect(() => {
    const st = useOperatorStore.getState()
    st.loadThemes().catch(console.error)
    st.loadSettings().catch(console.error)
    st.loadLowerThirdTemplates().catch(console.error)
    st.loadPresentations().catch(console.error)
    st.loadBibleVersions().catch(console.error)
    window.api.stage.isOpen().then(st.setStageOpen, console.error)
    window.api.output.isOpen().then(st.setOutputOpen, console.error)
    window.api.stream.isOpen().then(st.setStreamOpen, console.error)
    const offStage = window.api.stage.onOpenChange(st.setStageOpen)
    const offOutput = window.api.output.onOpenChange(st.setOutputOpen)
    const offStream = window.api.stream.onOpenChange(st.setStreamOpen)
    const offProgress = window.api.presentations.onProgress(st.presentationProgress)
    const offUpdated = window.api.presentations.onUpdated(st.presentationUpdated)
    const offChanged = window.api.presentations.onChanged(st.presentationChanged)
    const offPowerPoint = window.api.livePowerPoint.onStatus(st.livePowerPointStatus)
    return () => {
      offStage()
      offOutput()
      offStream()
      offProgress()
      offUpdated()
      offChanged()
      offPowerPoint()
    }
  }, [])

  // Dark or light; with "system" the stylesheet follows the operating system.
  useEffect(() => {
    const root = document.documentElement
    if (appearance === 'system') delete root.dataset.theme
    else root.dataset.theme = appearance
  }, [appearance])

  // Mirror the operator state to the output, stage and Stream windows, and to Live PowerPoint, sending only what changed.
  useEffect(() => {
    let lastOutput = ''
    let lastStage = ''
    let lastStream = ''
    let lastPowerPoint = ''
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
      const stream = selectStreamState(s)
      const streamJson = JSON.stringify(stream)
      if (streamJson !== lastStream) {
        lastStream = streamJson
        window.api.stream.send(stream)
      }
      const powerPoint = selectPowerPointTarget(s)
      const powerPointJson = JSON.stringify(powerPoint)
      if (powerPointJson !== lastPowerPoint) {
        lastPowerPoint = powerPointJson
        window.api.livePowerPoint.sync(powerPoint)
      }
    }
    send()
    return useOperatorStore.subscribe(send)
  }, [])

  // On macOS the main process catches Cmd+H before the app menu's Hide and passes it on here.
  useEffect(() => window.api.onToggleHighlight(toggleHighlightMode), [])

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
      // Cmd+Shift+K (Ctrl+Shift+K) ends a PowerPoint slide show and brings the output back; the main process also
      // catches it while PowerPoint has the keyboard.
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        st.panicPowerPoint()
        return
      }
      // Cmd+K (Ctrl+K) opens the command palette from anywhere.
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        st.setPaletteOpen(!st.paletteOpen)
        return
      }
      // Cmd+L (Ctrl+L) jumps to the lower third headline from anywhere.
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        focusLowerThirdHeadline()
        return
      }
      // Live highlighting: Esc clears the live slide's marks, Cmd+H (Ctrl+H) toggles highlight mode, 1 to 5 pick a color.
      if (!isTyping(e.target) && highlightKey(e)) {
        e.preventDefault()
        return
      }
      // Cmd+1 to 9 (Ctrl+1 to 9) pick a translation, in the order of the version chips; Alt+Up and Down cycle them.
      // They change the live scripture or the preview's, as Up and Down would step (see selectTranslationTarget).
      const digit = /^Digit([1-9])$/.exec(e.code)
      const cycle = e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')
      if (((digit && mod && !e.altKey && !e.shiftKey) || cycle) && !isTyping(e.target)) {
        const where = selectTranslationTarget(st)
        const codes = st.bibleVersions.map((v) => v.code)
        if (!where || codes.length === 0) return
        e.preventDefault()
        const current = slideTranslation(where === 'live' ? selectLiveSlide(st) : selectPreviewSlide(st))?.version
        const at = current ? codes.indexOf(current) : -1
        const next = digit ? codes[Number(digit[1]) - 1] : codes[(at + (e.key === 'ArrowDown' ? 1 : -1) + codes.length) % codes.length]
        if (next && next !== current) st.switchTranslation(where, next).catch(console.error)
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
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        // Up and Down move the preview highlight in the grid's item. With live scripture in the grid they step the
        // live verse instead, as Right and Left do.
        e.preventDefault()
        const delta = e.key === 'ArrowDown' ? 1 : -1
        if (st.live.itemType === 'scripture' && st.live.slideIndex !== null && selectBrowsingLive(st)) {
          if (delta > 0) st.nextSlide()
          else st.previousSlide()
        } else st.moveHighlight(delta)
      } else if (e.key === 'Enter') {
        // Enter on another button (a schedule item, a dialog) keeps its own meaning; on a slide card or the page
        // it sends the highlighted preview slide live.
        const target = e.target as HTMLElement | null
        if (target?.closest('button, a, [role="button"]') && !target.closest('.slide-card, .slide-row')) return
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
      <PanelBoundary name="Toolbar">
        <Toolbar />
      </PanelBoundary>
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
            <PanelBoundary name="Songs">
              <SongList />
            </PanelBoundary>
          </div>
          <div className="library-page" hidden={libraryTab !== 'scripture'}>
            <PanelBoundary name="Scripture">
              <ScripturePanel />
            </PanelBoundary>
          </div>
          <div className="library-page" hidden={libraryTab !== 'presentations'}>
            <PanelBoundary name="Presentations">
              <PresentationsPanel />
            </PanelBoundary>
          </div>
          <div className="library-page" hidden={libraryTab !== 'media'}>
            <PanelBoundary name="Media">
              <MediaPanel />
            </PanelBoundary>
          </div>
        </div>
        <Splitter label="Resize library" value={sizes.library} min={LIMITS.library[0]} max={LIMITS.library[1]} direction={1} onChange={resize('library')} />
        {editingSongId !== null ? (
          <PanelBoundary key="songEditor" name="Song editor">
            <SongEditor key={editingSongId} songId={editingSongId} />
          </PanelBoundary>
        ) : themeEditorOpen ? (
          <PanelBoundary key="themes" name="Themes">
            <ThemeEditor />
          </PanelBoundary>
        ) : settingsOpen ? (
          <PanelBoundary key="settings" name="Settings">
            <SettingsPanel />
          </PanelBoundary>
        ) : streamPanelOpen ? (
          <PanelBoundary key="stream" name="Stream">
            <StreamPanel />
          </PanelBoundary>
        ) : (
          <PanelBoundary key="slides" name="Slides">
            <SlideGrid />
          </PanelBoundary>
        )}
        <Splitter label="Resize live output" value={sizes.preview} min={LIMITS.preview[0]} max={LIMITS.preview[1]} direction={-1} onChange={resize('preview')} />
        <div className="preview-column">
          <PanelBoundary name="Output controls">
            <LivePreview />
          </PanelBoundary>
          <PanelBoundary name="Lower third">
            <LowerThirdPanel />
          </PanelBoundary>
          <PanelBoundary name="Listener">
            <ListenerPanel />
          </PanelBoundary>
        </div>
        {!scheduleCollapsed && (
          <Splitter label="Resize schedule" value={sizes.schedule} min={LIMITS.schedule[0]} max={LIMITS.schedule[1]} direction={-1} onChange={resize('schedule')} />
        )}
        <PanelBoundary name="Schedule">
          <SchedulePanel collapsed={scheduleCollapsed} onCollapsedChange={setScheduleCollapsed} />
        </PanelBoundary>
      </main>
      {paletteOpen && <CommandPalette />}
    </div>
  )
}

export default App
