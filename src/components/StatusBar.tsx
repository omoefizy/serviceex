import { Mic, MicOff, PanelBottomOpen } from 'lucide-react'
import { useAccount } from '../lib/account'
import { useListener } from '../lib/listener'
import { chipOf } from '../lib/listenerStatus'
import { toggleTranscriptDrawer } from '../lib/shell'
import { LevelMeter } from './LevelMeter'
import { PlanBadge } from './PlanBadge'
import { StatusArea } from './StatusArea'
import { Button } from './ui'

/** The last words heard: the words still forming, else the last settled line. */
function useLatestLine(): string {
  return useListener((st) => st.partial || st.finals[st.finals.length - 1] || '')
}

/**
 * The bottom bar: the listener (state, level, the latest line of the transcript and the Transcript button), the other
 * computers and the plan. The full transcript, with the listener's controls, opens docked in the middle column (App).
 */
export function StatusBar({ showListener, transcriptOpen }: { showListener: boolean; transcriptOpen: boolean }) {
  const status = useListener((st) => st.status)
  const mode = useListener((st) => st.mode)
  const modeReason = useListener((st) => st.modeReason)
  const error = useListener((st) => st.error)
  const restarting = useListener((st) => st.restarting)
  const reading = useListener((st) => st.reading)
  const latest = useLatestLine()
  const account = useAccount()
  const chip = chipOf(status, mode, modeReason, error, restarting)
  const running = status === 'starting' || status === 'connecting' || status === 'listening'

  const MicIcon = running ? Mic : MicOff

  return (
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
              icon={<PanelBottomOpen size={16} aria-hidden="true" />}
              aria-expanded={transcriptOpen}
              aria-controls="transcript-panel"
              onClick={() => toggleTranscriptDrawer()}
            >
              Transcript
            </Button>
          </div>
        )}
        <div className="statusbar-end">
          <StatusArea />
          {account && (account.signedIn || account.configured) && <PlanBadge account={account} />}
        </div>
    </footer>
  )
}
