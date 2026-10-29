import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { can } from '../shared/features'
import { layoutById, showsPanel } from '../shared/layouts'
import { CommandPalette } from './components/CommandPalette'
import { OnScreenPanel, PreviewPanel, UpNextCard, UpNextMeta } from './components/LivePreview'
import { LowerThirdPanel } from './components/LowerThirdPanel'
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
import { StatusBar } from './components/StatusBar'
import { StreamPanel } from './components/StreamPanel'
import { SuggestionTray } from './components/SuggestionTray'
import { Splitter } from './components/Splitter'
import { ThemeEditor } from './components/ThemeEditor'
import { Toolbar } from './components/Toolbar'
import { IconButton, Tabs } from './components/ui'
import { WelcomeScreen } from './components/WelcomeScreen'
import { highlightKey, toggleHighlightMode } from './lib/highlights'
import { cycleLayout, switchLayout } from './lib/layouts'
import { nudgeVerse, stepVerseSize } from './lib/scriptureAdjust'
import { focusLowerThirdHeadline, isTyping, MODE_KEYS } from './lib/shortcuts'
import { SHOW_LIBRARY_TAB_EVENT } from './lib/samples'
import { SHOW_SERVICE_PICKER_EVENT } from './lib/shell'
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

/** The two side columns: the Order of service on the left, the finder on the right. The centre takes the rest. */
type PanelSizes = { order: number; finder: number }

const DEFAULT_SIZES: PanelSizes = { order: 300, finder: 400 }
const LIMITS = { order: [240, 440], finder: [300, 560] } as const
/** How far each side column gives way, below its saved width, when the window is too narrow (1280 by 720 laptops). */
const FLOORS: PanelSizes = { order: 240, finder: 300 }
/** Below 1366 pixels the Order of service and the finder are at most this wide. */
const NARROW_ORDER = 260
const NARROW_FINDER = 340
const CENTRE_MIN = 420
/** The centre's minimum while an editor is open there: forms need more room than the live screen. */
const EDITOR_MIN = 520
/** The Order of service as a rail of item icons: collapsed, or below 1280 pixels. The finder's rail is narrower. */
const ORDER_RAIL = 64
const RAIL = 44

const isPanelSizes = (value: unknown): value is PanelSizes =>
  typeof value === 'object' &&
  value !== null &&
  (Object.keys(LIMITS) as (keyof PanelSizes)[]).every((key) => typeof (value as PanelSizes)[key] === 'number')
const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'

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

/** The tabs of the card under On screen. Up next leaves out below 720 pixels of height, where it does not fit. */
type DeckTab = 'upNext' | 'slides' | 'preview' | 'points'
const DECK_TABS: { id: DeckTab; label: string }[] = [
  { id: 'upNext', label: 'Up next' },
  { id: 'slides', label: 'Slides' },
  { id: 'preview', label: 'Preview' },
  { id: 'points', label: 'Lower third' },
]
const isDeckTab = (value: unknown): value is DeckTab => DECK_TABS.some((tab) => tab.id === value)

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
  const [sizes, setSizes] = usePersistentState('serviceex.panelWidths', DEFAULT_SIZES, isPanelSizes)
  const narrow = useMediaQuery('(max-width: 1365px)')
  const railWidth = useMediaQuery('(max-width: 1279px)')
  const short = useMediaQuery('(max-height: 719px)')
  // Below 1280 pixels the Order of service is a rail unless it was opened out for now.
  const [orderOpenedOut, setOrderOpenedOut] = useState(false)
  const [chosenDeckTab, setDeckTab] = usePersistentState<DeckTab>('serviceex.deckTab', 'upNext', isDeckTab)
  const welcome = useWelcome()
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

  // The top bar's service button: the Order of service unfolds with the keyboard on its service picker.
  useEffect(() => {
    const show = () => {
      setScheduleCollapsed(false)
      setOrderOpenedOut(true)
      requestAnimationFrame(() => document.querySelector<HTMLSelectElement>('.schedule-picker select')?.focus())
    }
    window.addEventListener(SHOW_SERVICE_PICKER_EVENT, show)
    return () => window.removeEventListener(SHOW_SERVICE_PICKER_EVENT, show)
  }, [setScheduleCollapsed])
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
  // Editors open in the centre whatever the layout, so they can always be reached. Settings is a page of its own.
  const centreOpen = editingSongId !== null || themeEditorOpen || streamPanelOpen || sermonsOpen
  const show = {
    library: libraryTabs.length > 0,
    centre: showsPanel(layout, 'slides') || centreOpen,
    live: showsPanel(layout, 'live'),
    points: showsPanel(layout, 'points') && can('lowerThirds'),
    listener: showsPanel(layout, 'listener'),
    schedule: showsPanel(layout, 'schedule'),
  }
  const centreColumn = show.centre || show.live || show.points
  const orderRail = scheduleCollapsed || (railWidth && !orderOpenedOut)
  const setOrderRail = (rail: boolean) => {
    if (railWidth) setOrderOpenedOut(!rail)
    if (!rail || !railWidth) setScheduleCollapsed(rail)
  }
  const deckTabs = DECK_TABS.filter(
    (tab) => (tab.id === 'upNext' ? show.live && !short : tab.id === 'slides' ? showsPanel(layout, 'slides') : tab.id === 'preview' ? show.live : show.points),
  )
  const deckTab = deckTabs.some((tab) => tab.id === chosenDeckTab) ? chosenDeckTab : (deckTabs[0]?.id ?? chosenDeckTab)

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

  // The columns the layout shows, with a 12px splitter as the gap between each. A side column is its saved width when
  // there is room, and shrinks towards its floor when there is not; below 1366 pixels the Order of service is at most
  // 260 and the finder 340, and below 1280 the Order of service is a 64 pixel rail of item icons.
  const width = (key: keyof PanelSizes) => (narrow ? Math.min(sizes[key], key === 'finder' ? NARROW_FINDER : NARROW_ORDER) : sizes[key])
  const side = (key: keyof PanelSizes) => `minmax(${Math.min(FLOORS[key], width(key))}px, ${width(key)}px)`
  const columns = [
    ...(show.schedule ? [orderRail ? `${ORDER_RAIL}px` : side('order')] : []),
    ...(show.schedule && (centreColumn || show.library) ? ['auto'] : []),
    ...(centreColumn ? [`minmax(${centreOpen ? EDITOR_MIN : CENTRE_MIN}px, 1fr)`] : []),
    ...(show.library && centreColumn ? ['auto'] : []),
    ...(show.library ? [libraryCollapsed ? `${RAIL}px` : centreColumn ? side('finder') : '1fr'] : []),
  ].join(' ')

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
      <main className="operator" hidden={settingsOpen} style={{ gridTemplateColumns: columns }}>
        <Slot show={show.schedule}>
          <PanelBoundary name="Schedule">
            <SchedulePanel collapsed={orderRail} onCollapsedChange={setOrderRail} />
          </PanelBoundary>
          {(centreColumn || show.library) &&
            (orderRail ? (
              <span className="shell-gap" aria-hidden="true" />
            ) : (
              <Splitter label="Resize the order of service" value={sizes.order} min={LIMITS.order[0]} max={LIMITS.order[1]} direction={1} panel=".schedule" onChange={resize('order')} />
            ))}
        </Slot>
        <div className="stage-column" hidden={!centreColumn}>
          {centreOpen ? (
            editingSongId !== null ? (
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
            )
          ) : null}
          {/* The live screen stays mounted under an editor, so its state survives. On screen takes the height the card
              under it leaves; nothing here scrolls but the lists inside the cards. */}
          <div className="stage-live" hidden={centreOpen}>
            <Slot show={show.live}>
              <PanelBoundary name="On screen">
                <OnScreenPanel />
              </PanelBoundary>
            </Slot>
            {deckTabs.length > 0 && (
              <section className={`stage-deck stage-deck--${deckTab}`} aria-label={deckTabs.length === 1 ? deckTabs[0].label : 'Up next, slides and preview'}>
                {deckTabs.length > 1 && (
                  <div className="stage-deck-tabs">
                    <Tabs<DeckTab> aria-label="Under On screen" idPrefix="deck" tabs={deckTabs} value={deckTab} onChange={setDeckTab} />
                    {deckTab === 'upNext' && <UpNextMeta />}
                  </div>
                )}
                {/* All stay mounted, so the slide grid keeps its place and the lower third its text. */}
                <Slot show={deckTab === 'upNext' && show.live && !short}>
                  <div id="deck-panel-upNext" role="tabpanel" aria-labelledby="deck-tab-upNext" className="stage-deck-page">
                    <UpNextCard titled={deckTabs.length === 1} />
                  </div>
                </Slot>
                <Slot show={deckTab === 'slides' && show.centre}>
                  <div id="deck-panel-slides" role="tabpanel" aria-labelledby="deck-tab-slides" className="stage-deck-page">
                    <PanelBoundary key="slides" name="Slides">
                      <SlideGrid />
                    </PanelBoundary>
                  </div>
                </Slot>
                <Slot show={deckTab === 'preview' && show.live}>
                  <div id="deck-panel-preview" role="tabpanel" aria-labelledby="deck-tab-preview" className="stage-deck-page">
                    <PanelBoundary name="Preview">
                      <PreviewPanel />
                    </PanelBoundary>
                  </div>
                </Slot>
                <Slot show={deckTab === 'points' && show.points}>
                  <div id="deck-panel-points" role="tabpanel" aria-labelledby="deck-tab-points" className="stage-deck-page">
                    <PanelBoundary name="Lower third">
                      <LowerThirdPanel />
                    </PanelBoundary>
                  </div>
                </Slot>
              </section>
            )}
          </div>
        </div>
        <Slot show={show.library}>
          {centreColumn &&
            (libraryCollapsed ? (
              <span className="shell-gap" aria-hidden="true" />
            ) : (
              <Splitter label="Resize the finder" value={sizes.finder} min={LIMITS.finder[0]} max={LIMITS.finder[1]} direction={-1} panel=".library" onChange={resize('finder')} />
            ))}
          {libraryCollapsed ? (
            <aside className="library collapsed">
              <button className="panel-rail-toggle" aria-expanded={false} title="Show the finder" onClick={() => setLibraryCollapsed(false)}>
                <ChevronLeft size={16} aria-hidden="true" />
                <span className="panel-rail-label">Finder</span>
              </button>
            </aside>
          ) : (
            <div className="library">
              <div className="library-tabs">
                <Tabs<(typeof LIBRARY_TABS)[number]['id']>
                  className="library-tab-list"
                  aria-label="Finder"
                  idPrefix="finder"
                  tabs={libraryTabs.map((tab) => ({ id: tab.id, label: tab.label }))}
                  value={libraryTab}
                  onChange={setLibraryTab}
                />
                <IconButton label="Hide the finder" icon={<ChevronRight size={18} />} aria-expanded={true} onClick={() => setLibraryCollapsed(true)} />
              </div>
              <PanelBoundary name="Suggestions">
                <SuggestionTray />
              </PanelBoundary>
              {/* All stay mounted so each keeps its search text when switching tabs. */}
              <div className="library-page" id="finder-panel-songs" role="tabpanel" aria-labelledby="finder-tab-songs" hidden={libraryTab !== 'songs'}>
                <PanelBoundary name="Songs">
                  <SongList />
                </PanelBoundary>
              </div>
              <div className="library-page" id="finder-panel-scripture" role="tabpanel" aria-labelledby="finder-tab-scripture" hidden={libraryTab !== 'scripture'}>
                <PanelBoundary name="Scripture">
                  <ScripturePanel />
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
            </div>
          )}
        </Slot>
      </main>
      <StatusBar showListener={show.listener} />
      {paletteOpen && <CommandPalette />}
      {plansOpen && <PlansModal />}
      {welcome.open && <WelcomeScreen onAccount={welcome.toAccount} onContinue={welcome.continueWithoutAccount} />}
    </div>
  )
}

export default App
