import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { can } from '../shared/features'
import { layoutById, showsPanel } from '../shared/layouts'
import { CommandPalette } from './components/CommandPalette'
import { LivePreview } from './components/LivePreview'
import { LowerThirdPanel } from './components/LowerThirdPanel'
import { ListenerPanel } from './components/ListenerPanel'
import { PlansModal } from './components/PlansModal'
import { MediaPanel } from './components/MediaPanel'
import { PanelBoundary } from './components/PanelBoundary'
import { PresentationsPanel } from './components/PresentationsPanel'
import { SchedulePanel } from './components/SchedulePanel'
import { SermonsPanel } from './components/SermonsPanel'
import { ScripturePanel } from './components/ScripturePanel'
import { SettingsPanel } from './components/SettingsPanel'
import { SlideGrid } from './components/SlideGrid'
import { SongEditor } from './components/SongEditor'
import { SongList } from './components/SongList'
import { StreamPanel } from './components/StreamPanel'
import { Splitter } from './components/Splitter'
import { ThemeEditor } from './components/ThemeEditor'
import { Toolbar } from './components/Toolbar'
import { IconButton } from './components/ui'
import { highlightKey, toggleHighlightMode } from './lib/highlights'
import { cycleLayout, switchLayout } from './lib/layouts'
import { nudgeVerse, stepVerseSize } from './lib/scriptureAdjust'
import { focusLowerThirdHeadline, isTyping, MODE_KEYS } from './lib/shortcuts'
import { SHOW_LIBRARY_TAB_EVENT } from './lib/samples'
import { slideTranslation } from './lib/translations'
import { usePersistentState } from './lib/usePersistentState'
import { usePlansOpen } from './lib/account'
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
/**
 * How far each side column gives way, below its saved width, when the window is too narrow for every column at full
 * width (1280 by 720 laptops). The centre keeps CENTRE_MIN; the side columns then share what is left.
 */
const FLOORS: PanelSizes = { library: 200, preview: 240, schedule: 200 }
const CENTRE_MIN = 280
/** The centre's minimum while an editor or Settings is open there: forms need more room than the slide grid. */
const EDITOR_MIN = 520

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

/** Keeps a panel mounted (so it keeps its state, and the listener keeps listening) while the layout hides it. */
function Slot({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <div className="layout-slot" hidden={!show}>
      {children}
    </div>
  )
}

function App() {
  const [chosenTab, setLibraryTab] = useState<(typeof LIBRARY_TABS)[number]['id']>('songs')
  const [sizes, setSizes] = usePersistentState('worshipdeck.panelSizes', DEFAULT_SIZES, isPanelSizes)
  const [scheduleCollapsed, setScheduleCollapsed] = usePersistentState('worshipdeck.scheduleCollapsed', false, isBoolean)
  const [libraryCollapsed, setLibraryCollapsed] = usePersistentState('worshipdeck.libraryCollapsed', false, isBoolean)
  const editingSongId = useOperatorStore((s) => s.editingSongId)

  // An empty state elsewhere asking for a library tab, such as the schedule's Browse songs.
  useEffect(() => {
    const show = (e: Event) => {
      const tab = (e as CustomEvent<string>).detail
      if (!LIBRARY_TABS.some((t) => t.id === tab)) return
      setLibraryTab(tab as (typeof LIBRARY_TABS)[number]['id'])
      setLibraryCollapsed(false)
    }
    window.addEventListener(SHOW_LIBRARY_TAB_EVENT, show)
    return () => window.removeEventListener(SHOW_LIBRARY_TAB_EVENT, show)
  }, [setLibraryCollapsed])
  const themeEditorOpen = useOperatorStore((s) => s.themeEditorOpen)
  const settingsOpen = useOperatorStore((s) => s.settingsOpen)
  const streamPanelOpen = useOperatorStore((s) => s.streamPanelOpen)
  const sermonsOpen = useOperatorStore((s) => s.sermonsOpen)
  const paletteOpen = useOperatorStore((s) => s.paletteOpen)
  const plansOpen = usePlansOpen()
  const appearance = useOperatorStore((s) => s.settings.appearance)
  const layout = useOperatorStore((s) => layoutById(s.settings.layouts, s.settings.activeLayoutId))
  // A tab whose feature the plan leaves out is not shown.
  const libraryTabs = LIBRARY_TABS.filter((tab) => showsPanel(layout, tab.id) && (tab.id !== 'media' || can('mediaLibrary')))
  const libraryTab = libraryTabs.some((tab) => tab.id === chosenTab) ? chosenTab : (libraryTabs[0]?.id ?? chosenTab)
  // Editors and Settings open in the centre whatever the layout, so they can always be reached.
  const centreOpen = editingSongId !== null || themeEditorOpen || settingsOpen || streamPanelOpen || sermonsOpen
  const show = {
    library: libraryTabs.length > 0,
    centre: showsPanel(layout, 'slides') || centreOpen,
    live: showsPanel(layout, 'live'),
    points: showsPanel(layout, 'points') && can('lowerThirds'),
    listener: showsPanel(layout, 'listener'),
    schedule: showsPanel(layout, 'schedule'),
  }
  const previewColumn = show.live || show.points || show.listener

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
    let lastLive = ''
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
      // The title of what is live, title only, for the other computers' device chips; library sync waits while a slide is live.
      const slideLive = s.live.slideIndex !== null && s.live.mode === 'show'
      const live = { title: s.live.slideIndex !== null ? s.live.title : null, slideLive }
      const liveJson = JSON.stringify(live)
      if (liveJson !== lastLive) {
        lastLive = liveJson
        window.api.sharing.setLive(live)
      }
    }
    send()
    return useOperatorStore.subscribe(send)
  }, [])

  // On macOS the main process catches Cmd+H before the app menu's Hide and passes it on here.
  useEffect(() => window.api.onToggleHighlight(toggleHighlightMode), [])

  // Cmd+Plus and Minus (Ctrl+Plus and Minus) size the live verse, or the preview's (as Up and Down would step). The
  // main process catches them before the View menu zooms the window.
  useEffect(
    () =>
      window.api.onScriptureSize((step) => {
        const where = selectTranslationTarget(useOperatorStore.getState())
        if (where) stepVerseSize(where, step)
      }),
    [],
  )

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
      // Cmd+, (Ctrl+,) opens Settings from anywhere, even while typing, as in most desktop apps.
      if (mod && !e.altKey && !e.shiftKey && e.key === ',') {
        e.preventDefault()
        st.openSettings(true)
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
      // Cmd+Alt+1 to 9 (Ctrl+Alt+1 to 9) switch to that layout; Cmd+Shift+L (Ctrl+Shift+L) to the next one.
      const layoutDigit = /^Digit([1-9])$/.exec(e.code)
      if (layoutDigit && mod && e.altKey && !e.shiftKey) {
        const target = st.settings.layouts[Number(layoutDigit[1]) - 1]
        if (target) {
          e.preventDefault()
          switchLayout(target.id).catch(console.error)
        }
        return
      }
      if (mod && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        cycleLayout(1).catch(console.error)
        return
      }
      // Live highlighting: Esc clears the live slide's marks, Cmd+H (Ctrl+H) toggles highlight mode, 1 to 5 pick a color.
      if (!isTyping(e.target) && highlightKey(e)) {
        e.preventDefault()
        return
      }
      // Alt+Up and Down move the live verse (or the preview's, as Up and Down would step) up and down the screen.
      if (e.altKey && !mod && !e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !isTyping(e.target)) {
        const where = selectTranslationTarget(st)
        if (!where) return
        e.preventDefault()
        nudgeVerse(where, e.key === 'ArrowDown' ? 1 : -1)
        return
      }
      // Cmd+1 to 9 (Ctrl+1 to 9) pick a translation, in the order of the version chips; Alt+Shift+Up and Down cycle them.
      // They change the live scripture or the preview's, as Up and Down would step (see selectTranslationTarget).
      const digit = /^Digit([1-9])$/.exec(e.code)
      const cycle = e.altKey && !mod && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')
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

  // The columns the layout shows, each with the splitter after it. Without the centre the preview column takes the room.
  // A side column is its saved width when there is room, and shrinks towards its floor when there is not.
  const side = (key: keyof PanelSizes) => `minmax(${Math.min(FLOORS[key], sizes[key])}px, ${sizes[key]}px)`
  const columns = [
    ...(show.library ? (libraryCollapsed ? ['auto'] : [side('library'), 'auto']) : []),
    ...(show.centre ? [`minmax(${centreOpen ? EDITOR_MIN : CENTRE_MIN}px, 1fr)`] : []),
    ...(show.centre && previewColumn ? ['auto'] : []),
    ...(previewColumn ? [show.centre ? side('preview') : `minmax(${FLOORS.preview}px, 1fr)`] : []),
    ...(show.schedule ? (scheduleCollapsed ? ['auto'] : [...(show.centre || previewColumn ? ['auto', side('schedule')] : ['1fr'])]) : []),
  ].join(' ')

  return (
    <div className="app">
      <PanelBoundary name="Toolbar" layout="bar">
        <Toolbar />
      </PanelBoundary>
      <main className="operator" style={{ gridTemplateColumns: columns }}>
        <Slot show={show.library}>
          {libraryCollapsed ? (
            <aside className="library collapsed">
              <button className="panel-rail-toggle" aria-expanded={false} title="Show the library" onClick={() => setLibraryCollapsed(false)}>
                <ChevronRight size={16} aria-hidden="true" />
                <span className="panel-rail-label">Library</span>
              </button>
            </aside>
          ) : (
            <>
              <div className="library">
                <div className="library-tabs">
                  <div className="library-tab-list" role="tablist">
                    {libraryTabs.map((tab) => (
                      <button
                        key={tab.id}
                        role="tab"
                        aria-selected={libraryTab === tab.id}
                        className={`library-tab${libraryTab === tab.id ? ' active' : ''}`}
                        title={tab.label}
                        onClick={() => setLibraryTab(tab.id)}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                  <IconButton label="Hide library" size="sm" icon={<ChevronLeft size={16} />} aria-expanded={true} onClick={() => setLibraryCollapsed(true)} />
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
              <Splitter label="Resize library" value={sizes.library} min={LIMITS.library[0]} max={LIMITS.library[1]} direction={1} panel=".library" onChange={resize('library')} />
            </>
          )}
        </Slot>
        <Slot show={show.centre}>
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
          ) : sermonsOpen ? (
            <PanelBoundary key="sermons" name="Sermons">
              <SermonsPanel />
            </PanelBoundary>
          ) : (
            <PanelBoundary key="slides" name="Slides">
              <SlideGrid />
            </PanelBoundary>
          )}
        </Slot>
        <Slot show={show.centre && previewColumn}>
          <Splitter label="Resize live output" value={sizes.preview} min={LIMITS.preview[0]} max={LIMITS.preview[1]} direction={-1} panel=".preview-column" onChange={resize('preview')} />
        </Slot>
        <div className="preview-column" hidden={!previewColumn}>
          <Slot show={show.live}>
            <PanelBoundary name="Output controls">
              <LivePreview />
            </PanelBoundary>
          </Slot>
          <Slot show={show.points}>
            <PanelBoundary name="Lower third">
              <LowerThirdPanel />
            </PanelBoundary>
          </Slot>
          <Slot show={show.listener}>
            <PanelBoundary name="Listener">
              <ListenerPanel />
            </PanelBoundary>
          </Slot>
        </div>
        <Slot show={show.schedule}>
          {!scheduleCollapsed && (show.centre || previewColumn) && (
            <Splitter label="Resize schedule" value={sizes.schedule} min={LIMITS.schedule[0]} max={LIMITS.schedule[1]} direction={-1} panel=".schedule" onChange={resize('schedule')} />
          )}
          <PanelBoundary name="Schedule">
            <SchedulePanel collapsed={scheduleCollapsed} onCollapsedChange={setScheduleCollapsed} />
          </PanelBoundary>
        </Slot>
      </main>
      {paletteOpen && <CommandPalette />}
      {plansOpen && <PlansModal />}
    </div>
  )
}

export default App
