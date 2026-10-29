import { Mic, MicOff, PanelRightOpen, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { openPlans, useAccount } from '../lib/account'
import { useListener } from '../lib/listener'
import { chipOf } from '../lib/listenerStatus'
import { TRANSCRIPT_DRAWER_EVENT, toggleTranscriptDrawer } from '../lib/shell'
import { LevelMeter } from './LevelMeter'
import { ListenerPanel } from './ListenerPanel'
import { StatusArea } from './StatusArea'
import { Button, IconButton } from './ui'

/** The last words heard: the words still forming, else the last settled line. */
function useLatestLine(): string {
  return useListener((st) => st.partial || st.finals[st.finals.length - 1] || '')
}

/**
 * The bottom bar: the listener (state, level, the latest line of the transcript and the Transcript button), the other
 * computers and the plan. The full transcript, with the listener's controls, opens as a drawer from here.
 */
export function StatusBar({ showListener }: { showListener: boolean }) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const status = useListener((st) => st.status)
  const mode = useListener((st) => st.mode)
  const modeReason = useListener((st) => st.modeReason)
  const error = useListener((st) => st.error)
  const restarting = useListener((st) => st.restarting)
  const reading = useListener((st) => st.reading)
  const latest = useLatestLine()
  const account = useAccount()
  const drawerRef = useRef<HTMLElement>(null)
  const chip = chipOf(status, mode, modeReason, error, restarting)
  const running = status === 'starting' || status === 'connecting' || status === 'listening'
  const plan = account?.signedIn ? account.license.plan : account?.configured ? 'Not signed in' : null

  useEffect(() => {
    const onRequest = (e: Event) => {
      const wanted = (e as CustomEvent<boolean | undefined>).detail
      setDrawerOpen((open) => wanted ?? !open)
    }
    window.addEventListener(TRANSCRIPT_DRAWER_EVENT, onRequest)
    return () => window.removeEventListener(TRANSCRIPT_DRAWER_EVENT, onRequest)
  }, [])

  // Escape closes the drawer, unless a dialog inside it has the keyboard.
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as Element | null)?.closest?.('[role="dialog"]')) setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  const MicIcon = running ? Mic : MicOff

  return (
    <>
      <footer className="statusbar">
        {showListener && (
          <div className="statusbar-listener">
            <MicIcon size={16} className={running ? 'statusbar-mic on' : 'statusbar-mic'} aria-hidden="true" />
            <span className="statusbar-state" role="status" title={chip.why}>
              {chip.label}
              {chip.detail && <span className="statusbar-detail"> · {chip.detail}</span>}
            </span>
            {running && <LevelMeter reading={reading} small />}
            <span className="statusbar-transcript" title={latest || undefined}>
              {latest || (running ? 'Waiting for the first words…' : 'The latest line of the sermon shows here while listening.')}
            </span>
            <Button
              size="sm"
              variant="ghost"
              icon={<PanelRightOpen size={16} aria-hidden="true" />}
              aria-expanded={drawerOpen}
              aria-controls="transcript-drawer"
              onClick={() => toggleTranscriptDrawer()}
            >
              Transcript
            </Button>
          </div>
        )}
        <div className="statusbar-end">
          <StatusArea />
          {plan && (
            <button type="button" className="statusbar-plan" title="Plans and Credits" onClick={() => openPlans(true)}>
              {plan}
            </button>
          )}
        </div>
      </footer>
      {/* Always mounted, so listening carries on and the transcript keeps its place while the drawer is shut. */}
      <aside id="transcript-drawer" ref={drawerRef} className="transcript-drawer" hidden={!drawerOpen || !showListener} aria-label="Live transcript">
        <IconButton className="transcript-drawer-close" label="Close the transcript" icon={<X size={18} />} onClick={() => setDrawerOpen(false)} />
        <ListenerPanel />
      </aside>
    </>
  )
}
