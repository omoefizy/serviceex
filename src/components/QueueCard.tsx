import { BookOpen, Eye, GripVertical, Megaphone, Music, Play, Presentation, Quote, Type, X, type LucideIcon } from 'lucide-react'
import { useState } from 'react'
import { parseVerseCaption, slideLines } from '../lib/slides'
import { useOperatorStore, type DeckSlide, type RecentItem } from '../store'
import { IconButton, Panel } from './ui'

const KIND_ICONS: Record<RecentItem['kind'], LucideIcon> = {
  song: Music,
  scripture: BookOpen,
  announcement: Megaphone,
  presentation: Presentation,
  quote: Quote,
  lowerThird: Type,
}
const KIND_LABELS: Record<RecentItem['kind'], string> = {
  song: 'Song',
  scripture: 'Scripture',
  announcement: 'Slide',
  presentation: 'Slides',
  quote: 'Quote',
  lowerThird: 'Lower third',
}

/** "Sermon, then Offering": the next items in the Schedule after the live one. */
function UpNextMeta() {
  const next = useOperatorStore((s) => {
    const items = s.service?.items ?? []
    const at = items.findIndex((item) => item.id === s.live.scheduleItemId)
    return at === -1 ? '' : items.slice(at + 1, at + 3).map((item) => item.title).join(', then ')
  })
  return next ? <span className="up-next-meta">Up next: {next}</span> : null
}

/** "John 3:17" from a verse caption ("John 3:17 KJV"); a song's section label, or the slide's number. */
function slideName(slide: DeckSlide, index: number): string {
  const verse = slide.caption ? parseVerseCaption(slide.caption) : null
  if (verse) return `${verse.book} ${verse.chapter}:${verse.verse}${verse.part ?? ''}`
  return slide.label || slide.caption || `Slide ${index + 1}`
}

/** The slides after the live one, one row each: play one now, take it out, or drag it to another place. */
function WaitingList() {
  const live = useOperatorStore((s) => s.live)
  const playQueued = useOperatorStore((s) => s.playQueued)
  const removeQueued = useOperatorStore((s) => s.removeQueued)
  const moveQueued = useOperatorStore((s) => s.moveQueued)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const start = live.slideIndex === null ? null : live.slideIndex + 1
  const waiting = start === null ? [] : live.slides.slice(start)
  if (waiting.length === 0) return <p className="queue-note">{start === null ? 'Nothing is live yet.' : 'This is the last slide of the item.'}</p>
  return (
    <ol className="queue-list" aria-label="Waiting to go live">
      {waiting.map((slide, i) => {
        const index = start! + i
        const text = slide.page ? slide.pageText?.split('\n')[0] || 'Presentation page' : slideLines(slide.text).map((line) => line.text).join(' ')
        const name = slideName(slide, index)
        return (
          <li
            key={`${index}:${slide.text.slice(0, 20)}`}
            className={`queue-row${dragOver === index ? ' drop' : ''}`}
            title={text}
            draggable
            onDragStart={(e) => {
              setDragFrom(index)
              e.dataTransfer.effectAllowed = 'move'
            }}
            onDragOver={(e) => {
              if (dragFrom === null) return
              e.preventDefault()
              setDragOver(index)
            }}
            onDragLeave={() => setDragOver((at) => (at === index ? null : at))}
            onDrop={(e) => {
              e.preventDefault()
              if (dragFrom !== null) moveQueued(dragFrom, index)
              setDragFrom(null)
              setDragOver(null)
            }}
            onDragEnd={() => {
              setDragFrom(null)
              setDragOver(null)
            }}
            onKeyDown={(e) => {
              // Alt+Up and Alt+Down move the focused row, as dragging does.
              if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
              e.preventDefault()
              moveQueued(index, Math.max(start!, Math.min(live.slides.length - 1, index + (e.key === 'ArrowUp' ? -1 : 1))))
            }}
          >
            <GripVertical className="queue-grip" size={13} aria-hidden="true" />
            <span className="queue-ref">{name}</span>
            <span className="queue-text">{text}</span>
            <IconButton
              size="sm"
              className="queue-action"
              label={`Play ${name} now`}
              tooltip="Put this slide on screen now"
              icon={<Play size={13} />}
              disabled={live.powerPoint}
              onClick={() => playQueued(index)}
            />
            <IconButton size="sm" className="queue-action" label={`Remove ${name} from the queue`} tooltip="Take it out of the queue: Next skips it" icon={<X size={13} />} onClick={() => removeQueued(index)} />
          </li>
        )
      })}
    </ol>
  )
}

/** The last items and lower thirds sent live: each goes back to Preview, or straight live, in one click. */
function RecentlyShown() {
  const recent = useOperatorStore((s) => s.recentlyShown)
  const resend = useOperatorStore((s) => s.resendRecent)
  return (
    <section className="recently-shown" aria-label="Recently shown">
      <h3>Recently shown</h3>
      {recent.length === 0 ? (
        <p className="queue-note">What goes live shows here, to send again.</p>
      ) : (
        <ol className="queue-list">
          {recent.map((item) => {
            const Icon = KIND_ICONS[item.kind]
            return (
              <li key={item.id} className="queue-row recent-row" title={item.detail ? `${item.title}: ${item.detail}` : item.title}>
                <Icon className="queue-kind" size={13} aria-label={KIND_LABELS[item.kind]} />
                <span className="queue-ref">{item.title}</span>
                <span className="queue-text">{item.detail}</span>
                <IconButton size="sm" className="queue-action" label={`Resend ${item.title} to Preview`} tooltip="Resend to Preview" icon={<Eye size={13} />} onClick={() => resend(item.id, 'preview')} />
                <IconButton size="sm" className="queue-action" label={`Show ${item.title} live`} tooltip="Show live" icon={<Play size={13} />} onClick={() => resend(item.id, 'live')} />
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

/** Under Preview: the queue of the live item's slides still to come, then what was shown recently. Always visible. */
export function QueueCard() {
  const waiting = useOperatorStore((s) => (s.live.slideIndex === null ? 0 : s.live.slides.length - s.live.slideIndex - 1))
  return (
    <Panel
      className="queue-card"
      title="Queue"
      meta={
        <span className="monitor-meta">
          {waiting} waiting <UpNextMeta />
        </span>
      }
    >
      <div className="queue-card-body">
        <WaitingList />
        <RecentlyShown />
      </div>
    </Panel>
  )
}
