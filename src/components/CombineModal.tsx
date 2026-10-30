import { ArrowDown, ArrowUp, Layers, Pencil, X } from 'lucide-react'
import { useState } from 'react'
import { formatReference, type VersePart } from '../../shared/parseReference'
import { fitBoxOf, groupFit, groupPayload, MAX_GROUP_PASSAGES, passageLabel } from '../../shared/scriptureGroup'
import type { ScriptureGroup, ScriptureGroupLayout, ScriptureGroupPassage, ScriptureSlide } from '../../shared/types'
import { isEdited, withPart, withWholeVerse } from '../../shared/verseEdit'
import { naturalSplit } from '../../shared/verseParts'
import { reportError, type ErrorLike } from '../lib/errors'
import { useCombine, type CombineEditing } from '../lib/scriptureGroup'
import { parseVerseCaption } from '../lib/slides'
import { selectDefaultTheme, slideTheme, useOperatorStore } from '../store'
import { ScriptureTextEditor } from './ScriptureTextEditor'
import { ThemedSlide } from './ThemedSlide'
import { Button, Chip, ErrorNote, IconButton, Modal, Select, SegmentedControl } from './ui'

type PartChoice = 'whole' | VersePart

/**
 * The passage's reference from its verses' captions, with the parts of its first and last verse: "Ephesians 1:19b-20a".
 * Unchanged when the captions are not verses of one chapter.
 */
function referenceOf(passage: ScriptureGroupPassage): string {
  const first = parseVerseCaption(passage.verses[0]?.caption ?? '')
  const last = parseVerseCaption(passage.verses.at(-1)?.caption ?? '')
  if (!first || !last || first.book !== last.book || first.chapter !== last.chapter) return passage.reference
  const single = passage.verses.length === 1
  return formatReference({
    book: first.book,
    chapter: first.chapter,
    verseStart: first.verse,
    verseEnd: last.verse,
    ...(first.part ? { startPart: first.part } : {}),
    ...((single ? first.part : last.part) ? { endPart: single ? first.part : last.part } : {}),
  })
}

/** One passage: its verses, each with a part choice and Edit (the ellipsis and typing editor). */
function PassageBlock({
  passage,
  index,
  count,
  onChange,
  onMove,
  onRemove,
  onEdit,
}: {
  passage: ScriptureGroupPassage
  index: number
  count: number
  onChange(passage: ScriptureGroupPassage): void
  onMove(delta: 1 | -1): void
  onRemove(): void
  onEdit(verse: number): void
}) {
  function setPart(at: number, choice: PartChoice) {
    const verse = passage.verses[at]
    const next = choice === 'whole' ? withWholeVerse(verse) : withPart(verse, choice, verse.part?.split ?? naturalSplit(verse.source ?? verse.text))
    const verses = passage.verses.map((v, i) => (i === at ? next : v))
    onChange({ ...passage, verses, reference: referenceOf({ ...passage, verses }) })
  }

  return (
    <li className="combine-passage">
      <header className="combine-passage-head">
        <strong>{passageLabel(passage)}</strong>
        <IconButton size="sm" label={`Move ${passage.reference} up`} icon={<ArrowUp size={14} />} disabled={index === 0} onClick={() => onMove(-1)} />
        <IconButton size="sm" label={`Move ${passage.reference} down`} icon={<ArrowDown size={14} />} disabled={index === count - 1} onClick={() => onMove(1)} />
        <IconButton size="sm" label={`Remove ${passage.reference}`} icon={<X size={14} />} onClick={onRemove} />
      </header>
      <ol className="combine-verses">
        {passage.verses.map((verse, i) => (
          <li key={i} className="combine-verse">
            <span className="combine-verse-text">
              {verse.text}
              {isEdited(verse) && (
                <Chip tone="warning" className="edited-chip">
                  Edited
                </Chip>
              )}
            </span>
            {parseVerseCaption(verse.caption) && (
              <Select
                size="sm"
                aria-label={`Part of ${verse.caption}`}
                value={verse.part?.which ?? 'whole'}
                onChange={(e) => setPart(i, e.target.value as PartChoice)}
              >
                <option value="whole">Whole verse</option>
                <option value="a">Part a</option>
                <option value="b">Part b</option>
              </Select>
            )}
            <IconButton size="sm" label={`Edit ${verse.caption || 'verse'}`} tooltip="Edit text: type, hide words with “…”, move a part’s split" icon={<Pencil size={14} />} onClick={() => onEdit(i)} />
          </li>
        ))}
      </ol>
    </li>
  )
}

/**
 * Combine on one slide: the passages from the tray (or a saved Scripture group), stacked or in two columns, each under
 * its own reference. The words fit the theme's text box; when they get too small, Split into slides is offered. The
 * group goes to the Preview, or into the Schedule as one "Scripture group" item.
 */
function CombineModal({ editing }: { editing: CombineEditing }) {
  const close = useCombine((s) => s.close)
  const service = useOperatorStore((s) => s.service)
  const theme = useOperatorStore((s) => selectDefaultTheme(s, 'scripture'))
  const logoUrl = useOperatorStore((s) => s.settings.logoUrl)
  const [group, setGroup] = useState<ScriptureGroup>(editing.group)
  const [verseEdit, setVerseEdit] = useState<{ passage: number; verse: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ErrorLike | null>(null)
  const itemId = editing.itemId
  const box = fitBoxOf(theme)
  const { passages } = group
  const tooMany = passages.length > MAX_GROUP_PASSAGES
  const fit = groupFit(group, box)
  const payload = groupPayload(group, box)

  const setPassages = (next: ScriptureGroupPassage[]) => setGroup({ ...group, passages: next })
  const move = (index: number, delta: 1 | -1) => {
    const next = [...passages]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    setPassages(next)
  }

  async function run(action: () => Promise<void> | void) {
    setBusy(true)
    setError(null)
    try {
      await action()
      close()
    } catch (err) {
      setError(reportError('Combine scripture', err))
      setBusy(false)
    }
  }

  function preview() {
    useOperatorStore.getState().selectScripture(payload.title, payload.verses)
    useCombine.setState({ previewed: { title: payload.title, group: payload.group } })
  }

  async function save() {
    const st = useOperatorStore.getState()
    if (itemId !== null) await st.updateItemPayload(itemId, payload)
    else {
      await st.addToSchedule('scripture', null, payload)
      useCombine.getState().clear()
    }
  }

  const editingVerse = verseEdit && passages[verseEdit.passage]?.verses[verseEdit.verse]

  return (
    <>
      <Modal
        title={
          <>
            <Layers size={16} aria-hidden="true" /> {itemId !== null ? 'Edit Scripture group' : 'Combine scripture'}
          </>
        }
        size="lg"
        className="combine-modal"
        onClose={close}
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button disabled={busy || passages.length === 0 || tooMany} title="Show it in the Preview monitor" onClick={() => run(preview)}>
              Preview
            </Button>
            <Button
              variant="primary"
              disabled={busy || passages.length === 0 || tooMany || (itemId === null && !service)}
              title={itemId !== null ? 'Save the group in the Schedule' : service ? `Add to ${service.name} as one Scripture group` : 'Create or pick a service first'}
              onClick={() => run(save)}
            >
              {itemId !== null ? 'Save' : 'Add to Schedule'}
            </Button>
          </>
        }
      >
        <div className="combine-body">
          <div className="combine-controls">
            <SegmentedControl<ScriptureGroupLayout>
              aria-label="Layout"
              value={group.layout}
              options={[
                { value: 'stacked', label: 'Stacked' },
                { value: 'columns', label: 'Two columns', disabled: passages.length < 2 },
              ]}
              onChange={(layout) => setGroup({ ...group, layout })}
            />
            <span className="hint">
              {passages.length} of {MAX_GROUP_PASSAGES} passages
            </span>
          </div>
          {tooMany && <p className="combine-note warning">A group holds at most {MAX_GROUP_PASSAGES} passages. Remove one to go on.</p>}
          {passages.length === 0 ? (
            <p className="hint">Add passages with Add to combine in the Scripture finder or on a Heard in the sermon card.</p>
          ) : (
            <ol className="combine-passages">
              {passages.map((passage, i) => (
                <PassageBlock
                  key={`${passage.reference}:${passage.version}:${i}`}
                  passage={passage}
                  index={i}
                  count={passages.length}
                  onChange={(next) => setPassages(passages.map((p, j) => (j === i ? next : p)))}
                  onMove={(delta) => move(i, delta)}
                  onRemove={() => setPassages(passages.filter((_, j) => j !== i))}
                  onEdit={(verse) => setVerseEdit({ passage: i, verse })}
                />
              ))}
            </ol>
          )}

          {passages.length > 0 && (
            <section className="combine-preview" aria-label="How it looks">
              {fit.tooLong && !group.split && (
                <p className="combine-note warning" role="status">
                  The words are too small to read on one slide.
                  <Button size="sm" variant="primary" onClick={() => setGroup({ ...group, split: true })}>
                    Split into slides
                  </Button>
                </p>
              )}
              {group.split && (
                <p className="combine-note" role="status">
                  {payload.verses.length} slides, one per passage.
                  <Button size="sm" variant="ghost" onClick={() => setGroup({ ...group, split: false })}>
                    Put back on one slide
                  </Button>
                </p>
              )}
              <div className="combine-slides">
                {payload.verses.map((slide, i) => (
                  <div key={i} className="combine-slide">
                    <ThemedSlide theme={slideTheme(theme, slide)} text={slide.text} caption={slide.caption} logoUrl={logoUrl} still />
                  </div>
                ))}
              </div>
            </section>
          )}
          <ErrorNote error={error} />
        </div>
      </Modal>
      {verseEdit && editingVerse && (
        <ScriptureTextEditor
          slide={editingVerse}
          title={editingVerse.caption || passageLabel(passages[verseEdit.passage])}
          onClose={() => setVerseEdit(null)}
          onSave={(next: ScriptureSlide) => {
            const passage = passages[verseEdit.passage]
            const verses = passage.verses.map((v, i) => (i === verseEdit.verse ? next : v))
            setPassages(passages.map((p, i) => (i === verseEdit.passage ? { ...p, verses, reference: referenceOf({ ...p, verses }) } : p)))
          }}
        />
      )}
    </>
  )
}

/** The combine editor while it is open: fresh each time, on the tray or on a group. */
export function CombineHost() {
  const editing = useCombine((s) => s.editing)
  return editing ? <CombineModal editing={editing} /> : null
}

/** The passages waiting to be combined, as chips on the Preview header, with Combine on one slide. Hidden when empty. */
export function CombineTray() {
  const passages = useCombine((s) => s.passages)
  const remove = useCombine((s) => s.remove)
  const openTray = useCombine((s) => s.openTray)
  if (passages.length === 0) return null
  return (
    <div className="combine-tray" role="group" aria-label="Passages to combine">
      <ul className="combine-chips">
        {passages.map((passage, i) => (
          <li key={`${passage.reference}:${passage.version}`}>
            <Chip onRemove={() => remove(i)} removeLabel={`Take ${passage.reference} out of the tray`} title={passageLabel(passage)}>
              {passage.reference}
            </Chip>
          </li>
        ))}
      </ul>
      <Button size="sm" variant="primary" icon={<Layers size={14} aria-hidden="true" />} title={`Combine on one slide (up to ${MAX_GROUP_PASSAGES} passages)`} onClick={openTray}>
        Combine on one slide
      </Button>
    </div>
  )
}
