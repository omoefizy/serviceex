import { useEffect, useState } from 'react'
import { LivePreview } from './components/LivePreview'
import { SchedulePanel } from './components/SchedulePanel'
import { ScripturePanel } from './components/ScripturePanel'
import { SlideGrid } from './components/SlideGrid'
import { SongEditor } from './components/SongEditor'
import { SongList } from './components/SongList'
import { selectOutputState, useOperatorStore } from './store'

/** True when a key press is meant for a text field or the add-song modal, not for slide navigation. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || !!target.closest('.modal')
}

function App() {
  const [libraryTab, setLibraryTab] = useState<'songs' | 'scripture'>('songs')
  const editingSongId = useOperatorStore((s) => s.editingSongId)

  // Mirror the operator state to the output window.
  useEffect(() => {
    const send = () => window.api.output.send(selectOutputState(useOperatorStore.getState()))
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
      // Cmd+Down (Ctrl+Down off macOS) runs the schedule: next item, first slide live.
      if (e.key === 'ArrowDown' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && !isTyping(e.target)) {
        e.preventDefault()
        useOperatorStore.getState().nextItem().catch(console.error)
        return
      }
      if (e.altKey || e.ctrlKey || e.metaKey || isTyping(e.target)) return
      const { nextSlide, previousSlide } = useOperatorStore.getState()
      if (e.key === 'ArrowRight') {
        e.preventDefault()
        nextSlide()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        previousSlide()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <main className="operator">
      <div className="library">
        <div className="library-tabs" role="tablist">
          <button
            role="tab"
            aria-selected={libraryTab === 'songs'}
            className={`library-tab${libraryTab === 'songs' ? ' active' : ''}`}
            onClick={() => setLibraryTab('songs')}
          >
            Songs
          </button>
          <button
            role="tab"
            aria-selected={libraryTab === 'scripture'}
            className={`library-tab${libraryTab === 'scripture' ? ' active' : ''}`}
            onClick={() => setLibraryTab('scripture')}
          >
            Scripture
          </button>
        </div>
        {/* Both stay mounted so each keeps its search text when switching tabs. */}
        <div className="library-page" hidden={libraryTab !== 'songs'}>
          <SongList />
        </div>
        <div className="library-page" hidden={libraryTab !== 'scripture'}>
          <ScripturePanel />
        </div>
      </div>
      {editingSongId !== null ? <SongEditor key={editingSongId} songId={editingSongId} /> : <SlideGrid />}
      <LivePreview />
      <SchedulePanel />
    </main>
  )
}

export default App
