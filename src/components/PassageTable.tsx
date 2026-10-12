import type { BibleVersionCode, ScripturePayload, Verse } from '../../shared/types'
import { previewPassage } from '../lib/scripture'
import { parseVerseCaption, verseCaption } from '../lib/slides'
import { selectLiveSlide, selectPreviewSlide, useOperatorStore } from '../store'

interface Props {
  /** The passage that was looked up, as loaded into the grid. */
  passage: ScripturePayload
  /** The rest of its chapter after it, so the operator sees what is coming. */
  following: Verse[]
  version: BibleVersionCode
  /** Shows one of the following verses in the grid on its own, and sends it live when `live` is set. The table stays as it is. */
  onOpenVerse(verse: number, live: boolean): void
}

interface Row {
  caption: string
  reference: string
  text: string
  version: string
  verse: number
  /** The slide index in the passage, or null for a following verse. */
  index: number | null
}

/**
 * The looked-up verses and the ones after them, one row each with Reference, Text and Translation columns. The live
 * verse is marked as Up, Down, Left and Right step through it. Click a row to preview it, double-click to go live.
 */
export function PassageTable({ passage, following, version, onOpenVerse }: Props) {
  const deckKey = `scripture:${passage.title}`
  const previewCaption = useOperatorStore((s) => (s.deckType === 'scripture' ? (selectPreviewSlide(s)?.caption ?? null) : null))
  const liveCaption = useOperatorStore((s) => (s.live.itemType === 'scripture' ? (selectLiveSlide(s)?.caption ?? null) : null))

  const rowOf = (caption: string, text: string, index: number | null): Row => {
    const at = parseVerseCaption(caption)
    return {
      caption,
      reference: at ? `${at.chapter}:${at.verse}` : caption,
      text,
      version: at?.version ?? version,
      verse: at?.verse ?? 0,
      index,
    }
  }
  const rows = [
    ...passage.verses.map((slide, index) => rowOf(slide.caption, slide.text, index)),
    ...following.map((verse) => rowOf(verseCaption(verse, version), verse.text, null)),
  ]

  function show(row: Row, live: boolean) {
    if (row.index === null) return onOpenVerse(row.verse, live)
    const st = useOperatorStore.getState()
    if (st.deckKey !== deckKey) previewPassage(passage)
    if (live) useOperatorStore.getState().goLive(row.index)
    else useOperatorStore.getState().setHighlight(row.index)
  }

  return (
    <div className="passage-table-wrap">
      <table className="passage-table">
        <thead>
          <tr>
            <th scope="col">Ref</th>
            <th scope="col">Text</th>
            <th scope="col">Translation</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.caption}
              className={[
                row.index === null ? 'upcoming' : 'loaded',
                row.caption === liveCaption ? 'live' : '',
                row.caption === previewCaption ? 'preview' : '',
              ].join(' ')}
              title="Click to preview, double-click to go live"
              onClick={() => show(row, false)}
              onDoubleClick={() => show(row, true)}
            >
              <td className="passage-ref">{row.reference}</td>
              <td className="passage-text">
                <div>{row.text}</div>
              </td>
              <td className="passage-version">{row.version}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
