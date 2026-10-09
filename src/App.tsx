import { useEffect } from 'react'
import { LivePreview } from './components/LivePreview'
import { SlideGrid } from './components/SlideGrid'
import { SongList } from './components/SongList'
import { selectOutputState, useOperatorStore } from './store'

/** True when a key press is meant for a text field or the add-song modal, not for slide navigation. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || !!target.closest('.modal')
}

function App() {
  // Mirror the operator state to the output window.
  useEffect(() => {
    const send = () => window.api.output.send(selectOutputState(useOperatorStore.getState()))
    send()
    return useOperatorStore.subscribe(send)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
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
      <SongList />
      <SlideGrid />
      <LivePreview />
    </main>
  )
}

export default App
