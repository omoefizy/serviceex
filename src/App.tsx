import { X } from 'lucide-react'
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { can } from '../shared/features'
import { layoutById, showsPanel } from '../shared/layouts'
import { CombineHost } from './components/CombineModal'
import { CommandPalette } from './components/CommandPalette'
import { ListenerPanel } from './components/ListenerPanel'
import { LiveMonitor, PreviewMonitor } from './components/LivePreview'
import { LowerThirdsWorkspace } from './components/LowerThirdsWorkspace'
import { PlansModal } from './components/PlansModal'
import { UpgradePopover } from './components/Locked'
import { MediaPanel } from './components/MediaPanel'
import { PanelBoundary } from './components/PanelBoundary'
import { PresentationsPanel } from './components/PresentationsPanel'
import { QueueCard } from './components/QueueCard'
import { SchedulePanel } from './components/SchedulePanel'
import { SermonsPanel } from './components/SermonsPanel'
import { ScripturePanel } from './components/ScripturePanel'
import { ScriptureEditHost } from './components/ScriptureTextEditor'
import { SettingsPanel } from './components/SettingsPanel'
import { SlideGrid } from './components/SlideGrid'
import { SongEditor } from './components/SongEditor'
import { SongList } from './components/SongList'
import { Splitter } from './components/Splitter'
import { StatusBar } from './components/StatusBar'
import { StreamPanel } from './components/StreamPanel'
import { SuggestionTray } from './components/SuggestionTray'
import { ThemeEditor } from './components/ThemeEditor'
import { Toolbar } from './components/Toolbar'
import { IconButton, Tabs } from './components/ui'
import { WelcomeScreen } from './components/WelcomeScreen'
import { highlightKey, toggleHighlightMode } from './lib/highlights'
import { cycleLayout, switchLayout } from './lib/layouts'
import { nudgeVerse, stepVerseSize } from './lib/scriptureAdjust'
import { focusLowerThirdHeadline, isTyping, MODE_KEYS } from './lib/shortcuts'
import { SHOW_LIBRARY_TAB_EVENT } from './lib/samples'
import { SHOW_SERVICE_PICKER_EVENT, TRANSCRIPT_DRAWER_EVENT } from './lib/shell'
import { slideTranslation } from './lib/translations'
import { usePersistentState } from './lib/usePersistentState'
import { useWelcome } from './lib/welcome'
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

const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

/**
 * What the splitters resize: the Schedule's width, the monitors' column width and the finder's height. A size
 * left out is the stylesheet's default (--order-width, --monitor-column-width, --finder-height); a double click on a
 * splitter puts it back. The middle column keeps at least its stylesheet minimum, so a column cannot squeeze it away.
 */
type PanelKey = 'order' | 'right' | 'finder'
type PanelSizes = Partial<Record<PanelKey, number>>
const LIMITS: Record<PanelKey, readonly [number, number]> = { order: [180, 420], right: [300, 600], finder: [140, 560] }
const SIZE_VARS: Record<PanelKey, string> = { order: '--order-width', right: '--monitor-column-width', finder: '--finder-height' }

const isPanelSizes = (value: unknown): value is PanelSizes =>
  typeof value === 'object' &&
  value !== null &&
  Object.entries(value).every(([key, size]) => key in LIMITS && typeof size === 'number' && size >= LIMITS[key as PanelKey][0] && size <= LIMITS[key as PanelKey][1])

/** Whether the window matches a media query, following it as the window is resized. */
function useMediaQuery(media: string): boolean {
  const query = typeof window.matchMedia === 'function' ? window.matchMedia(media) : null
  const [matches, setMatches] = useState(query?.matches ?? false)
  useEffect(() => {
    if (!query) return
    const change = () => setMatches(query.matches)
    change()
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [query])
  return matches
}

/** The finder's tabs. Slides is the Presentations library. */
const LIBRARY_TABS = [
  { id: 'scripture', label: 'Scripture' },
  { id: 'songs', label: 'Songs' },
  { id: 'presentations', label: 'Slides' },
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
  const [chosenTab, setLibraryTab] = useState<(typeof LIBRARY_TABS)[number]['id']>('scripture')
  const railWidth = useMediaQuery('(max-width: 1279px)')
  // Below 1280 pixels the Schedule is a rail unless it was opened out for now.
  const [orderOpenedOut, setOrderOpenedOut] = useState(false)
  const [sizes, setSizes] = usePersistentState<PanelSizes>('serviceex.panelSizes', {}, isPanelSizes)
  /** The live transcript, docked over the finder in the middle column. */
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  /** The finder's tab row, where the Scripture tab puts its translation and search. */
  const [finderTools, setFinderTools] = useState<HTMLDivElement | null>(null)
  const welcome = useWelcome()
  const [scheduleCollapsed, setScheduleCollapsed] = usePersistentState('serviceex.scheduleCollapsed', false, isBoolean)
  const editingSongId = useOperatorStore((s) => s.editingSongId)
  const slidesItem = useOperatorStore((s) => s.deckType === 'song' || s.deckType === 'presentation')

  // An empty state elsewhere asking for a library tab, such as the schedule's Browse songs.
  useEffect(() => {
    const show = (e: Event) => {
      const tab = (e as CustomEvent<string>).detail
      if (!LIBRARY_TABS.some((t) => t.id === tab)) return
      setLibraryTab(tab as (typeof LIBRARY_TABS)[number]['id'])
      setTranscriptOpen(false)
    }
    window.addEventListener(SHOW_LIBRARY_TAB_EVENT, show)
    return () => window.removeEventListener(SHOW_LIBRARY_TAB_EVENT, show)
  }, [])

  // The top bar's service button: the Schedule unfolds with the keyboard on its service picker.
  useEffect(() => {
    const show = () => {
      setScheduleCollapsed(false)
      setOrderOpenedOut(true)
      requestAnimationFrame(() => document.querySelector<HTMLSelectElement>('.schedule-picker select')?.focus())
    }
    window.addEventListener(SHOW_SERVICE_PICKER_EVENT, show)
    return () => window.removeEventListener(SHOW_SERVICE_PICKER_EVENT, show)
  }, [setScheduleCollapsed])
  // The listening chip and the status bar's Transcript button open, close or toggle the transcript.
  useEffect(() => {
    const onRequest = (e: Event) => {
      const wanted = (e as CustomEvent<boolean | undefined>).detail
      setTranscriptOpen((open) => wanted ?? !open)
    }
    window.addEventListener(TRANSCRIPT_DRAWER_EVENT, onRequest)
    return () => window.removeEventListener(TRANSCRIPT_DRAWER_EVENT, onRequest)
  }, [])

  // Escape closes the transcript, unless a dialog inside it has the keyboard.
  useEffect(() => {
    if (!transcriptOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as Element | null)?.closest?.('[role="dialog"]')) setTranscriptOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [transcriptOpen])

  const themeEditorOpen = useOperatorStore((s) => s.themeEditorOpen)
  const settingsOpen = useOperatorStore((s) => s.settingsOpen)
  const streamPanelOpen = useOperatorStore((s) => s.streamPanelOpen)
  const sermonsOpen = useOperatorStore((s) => s.sermonsOpen)
  // The Lower thirds workspace takes the schedule and the middle column; Live and Preview stay on the right.
  const lowerThirdsOpen = useOperatorStore((s) => s.lowerThirdsOpen && can('lowerThirds'))
  const paletteOpen = useOperatorStore((s) => s.paletteOpen)
  const plansOpen = usePlansOpen()
  const appearance = useOperatorStore((s) => s.settings.appearance)
  const layout = useOperatorStore((s) => layoutById(s.settings.layouts, s.settings.activeLayoutId))
  // A tab whose feature the plan leaves out is not shown.
  const libraryTabs = LIBRARY_TABS.filter((tab) => showsPanel(layout, tab.id) && (tab.id !== 'media' || can('mediaLibrary')))
  const libraryTab = libraryTabs.some((tab) => tab.id === chosenTab) ? chosenTab : (libraryTabs[0]?.id ?? chosenTab)
  // Editors open in the centre whatever the layout, so they can always be reached. Settings is a page of its own.
  const centreOpen = editingSongId !== null || themeEditorOpen || streamPanelOpen || sermonsOpen
  const show = {
    library: libraryTabs.length > 0,
    centre: showsPanel(layout, 'slides') || centreOpen,
    live: showsPanel(layout, 'live') || lowerThirdsOpen,
    points: showsPanel(layout, 'points') && can('lowerThirds'),
    listener: showsPanel(layout, 'listener'),
    schedule: showsPanel(layout, 'schedule'),
  }
  const rightColumn = show.live || show.points
  /** The middle column's main area: every slide of a song or presentation, else everything heard in the sermon. */
  const slidesMain = show.centre && slidesItem
  const orderRail = scheduleCollapsed || (railWidth && !orderOpenedOut)
  const setOrderRail = (rail: boolean) => {
    if (railWidth) setOrderOpenedOut(!rail)
    if (!rail || !railWidth) setScheduleCollapsed(rail)
  }
  const resize = (key: PanelKey) => (value: number) => setSizes((current) => ({ ...current, [key]: value }))
  const resetSize = (key: PanelKey) => () =>
    setSizes((current) => {
      const next = { ...current }
      delete next[key]
      return next
    })
  const sizeVars = Object.fromEntries(Object.entries(sizes).map(([key, size]) => [SIZE_VARS[key as PanelKey], `${size}px`])) as CSSProperties
  const splitter = (key: PanelKey, label: string, orientation: 'vertical' | 'horizontal', direction: 1 | -1, panel: string) => (
    <Splitter
      label={label}
      value={sizes[key] ?? null}
      min={LIMITS[key][0]}
      max={LIMITS[key][1]}
      orientation={orientation}
      direction={direction}
      panel={panel}
      onChange={resize(key)}
      onReset={resetSize(key)}
    />
  )

  useEffect(() => {
    const st = useOperatorStore.getState()
    st.loadThemes().catch(console.error)
    st.loadSettings().catch(console.error)
    st.loadLowerThirdTemplates().catch(console.error)
    st.loadDesigns().catch(console.error)
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
      // Cmd+L (Ctrl+L) selects the lower third headline on the canvas from anywhere, in the Lower thirds workspace.
      if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        if (can('lowerThirds')) st.openLowerThirds(true)
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
      // Shift+C clears only the lower third; C alone clears everything.
      if (e.shiftKey && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        st.hideLowerThird()
        return
      }
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

  // Three columns: the Schedule (236px, a 64px rail below 1280 pixels), the middle (Heard in the sermon, the
  // main area, the finder) and the monitors (Live, Preview, Lower third; 352px). Splitters between them resize them.
  // Nothing scrolls but the lists inside.
  return (
    <div className="app">
      <PanelBoundary name="Toolbar" layout="bar">
        <Toolbar />
      </PanelBoundary>
      {settingsOpen && (
        <PanelBoundary key="settings" name="Settings">
          <SettingsPanel />
        </PanelBoundary>
      )}
      {/* Hidden, not unmounted, while Settings is open: every panel keeps its search text and state. */}
      <main className="operator" hidden={settingsOpen} style={sizeVars}>
        {lowerThirdsOpen && (
          <PanelBoundary key="lowerThirds" name="Lower thirds">
            <LowerThirdsWorkspace />
          </PanelBoundary>
        )}
        <Slot show={show.schedule && !lowerThirdsOpen}>
          <div className={`operator-order${orderRail ? ' rail' : ''}`}>
            <PanelBoundary name="Schedule">
              <SchedulePanel collapsed={orderRail} onCollapsedChange={setOrderRail} />
            </PanelBoundary>
          </div>
          {!orderRail && splitter('order', 'Resize the schedule', 'vertical', 1, '.operator-order')}
        </Slot>
        <div className="operator-middle" hidden={lowerThirdsOpen}>
          {centreOpen &&
            (editingSongId !== null ? (
              <PanelBoundary key="songEditor" name="Song editor">
                <SongEditor key={editingSongId} songId={editingSongId} />
              </PanelBoundary>
            ) : themeEditorOpen ? (
              <PanelBoundary key="themes" name="Themes">
                <ThemeEditor />
              </PanelBoundary>
            ) : streamPanelOpen ? (
              <PanelBoundary key="stream" name="Stream">
                <StreamPanel />
              </PanelBoundary>
            ) : (
              <PanelBoundary key="sermons" name="Sermons">
                <SermonsPanel />
              </PanelBoundary>
            ))}
          {/* Stays mounted under an editor, so the heard verses and every search keep their state. */}
          <div className="operator-middle-live" hidden={centreOpen}>
            <PanelBoundary name="Suggestions">
              <SuggestionTray fullList={!slidesMain} />
            </PanelBoundary>
            {slidesMain && (
              <div className="operator-main">
                <PanelBoundary key="slides" name="Slides">
                  <SlideGrid />
                </PanelBoundary>
              </div>
            )}
            <Slot show={show.library}>
              {splitter('finder', 'Resize the finder', 'horizontal', -1, '.finder')}
              <section className="finder" aria-label="Finder">
                <div className="finder-head">
                  <Tabs<(typeof LIBRARY_TABS)[number]['id']>
                    className="finder-tabs"
                    aria-label="Finder"
                    idPrefix="finder"
                    tabs={libraryTabs.map((tab) => ({ id: tab.id, label: tab.label }))}
                    value={libraryTab}
                    onChange={setLibraryTab}
                  />
                  <div className="finder-tools" ref={setFinderTools} />
                </div>
                {/* All stay mounted so each keeps its search text when switching tabs. */}
                <div className="library-page" id="finder-panel-songs" role="tabpanel" aria-labelledby="finder-tab-songs" hidden={libraryTab !== 'songs'}>
                  <PanelBoundary name="Songs">
                    <SongList />
                  </PanelBoundary>
                </div>
                <div className="library-page" id="finder-panel-scripture" role="tabpanel" aria-labelledby="finder-tab-scripture" hidden={libraryTab !== 'scripture'}>
                  <PanelBoundary name="Scripture">
                    <ScripturePanel toolbar={libraryTab === 'scripture' ? finderTools : null} />
                  </PanelBoundary>
                </div>
                <div className="library-page" id="finder-panel-presentations" role="tabpanel" aria-labelledby="finder-tab-presentations" hidden={libraryTab !== 'presentations'}>
                  <PanelBoundary name="Presentations">
                    <PresentationsPanel />
                  </PanelBoundary>
                </div>
                <div className="library-page" id="finder-panel-media" role="tabpanel" aria-labelledby="finder-tab-media" hidden={libraryTab !== 'media'}>
                  <PanelBoundary name="Media">
                    <MediaPanel />
                  </PanelBoundary>
                </div>
              </section>
            </Slot>
          </div>
          {/* Docked in the middle column, over the finder, so it never covers Preview or Live. Always mounted, so
              listening carries on and the transcript keeps its place while it is shut. */}
          <aside id="transcript-panel" className="transcript-dock" hidden={!transcriptOpen || !show.listener} aria-label="Live transcript">
            <IconButton className="transcript-dock-close" label="Close the transcript" icon={<X size={18} />} onClick={() => setTranscriptOpen(false)} />
            <ListenerPanel />
          </aside>
        </div>
        <Slot show={rightColumn}>
          {splitter('right', 'Resize the monitors', 'vertical', -1, '.operator-right')}
          <div className="operator-right">
            {show.live && (
              <>
                <PanelBoundary name="Live">
                  <LiveMonitor />
                </PanelBoundary>
                <PanelBoundary name="Preview">
                  <PreviewMonitor />
                </PanelBoundary>
              </>
            )}
            <PanelBoundary name="Queue">
              <QueueCard />
            </PanelBoundary>
          </div>
        </Slot>
      </main>
      <StatusBar showListener={show.listener} transcriptOpen={transcriptOpen && show.listener} />
      {paletteOpen && <CommandPalette />}
      {plansOpen && <PlansModal />}
      <UpgradePopover />
      <ScriptureEditHost />
      <CombineHost />
      {welcome.open && <WelcomeScreen onAccount={welcome.toAccount} onContinue={welcome.continueWithoutAccount} />}
    </div>
  )
}

export default App
