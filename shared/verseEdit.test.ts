import { describe, expect, it } from 'vitest'
import type { ScriptureSlide } from './types'
import { hideSelection, isEdited, originalText, record, redo, resetSlide, startHistory, undo, withPart, withSlideText, withWholeVerse } from './verseEdit'

const VERSE = 'For God so loved the world, that he gave his only begotten Son.'
const slide: ScriptureSlide = { text: VERSE, caption: 'John 3:16 KJV' }
const select = (text: string, words: string) => [text.indexOf(words), text.indexOf(words) + words.length] as const

describe('hideSelection', () => {
  it('hides words at the start', () => {
    expect(hideSelection(VERSE, ...select(VERSE, 'For God so')).text).toBe('… loved the world, that he gave his only begotten Son.')
  })

  it('hides words in the middle', () => {
    expect(hideSelection(VERSE, ...select(VERSE, 'that he gave')).text).toBe('For God so loved the world, … his only begotten Son.')
  })

  it('hides words at the end, punctuation and all', () => {
    expect(hideSelection(VERSE, ...select(VERSE, 'only begotten Son.')).text).toBe('For God so loved the world, that he gave his …')
  })

  it('grows a selection to whole words', () => {
    // "od so lo" covers parts of "God" and "loved".
    expect(hideSelection(VERSE, ...select(VERSE, 'od so lo')).text).toBe('For … the world, that he gave his only begotten Son.')
  })

  it('keeps punctuation that follows straight after the ellipsis', () => {
    expect(hideSelection(VERSE, ...select(VERSE, 'the world')).text).toBe('For God so loved …, that he gave his only begotten Son.')
  })

  it('joins an ellipsis next to the selection instead of doubling it', () => {
    const once = hideSelection(VERSE, ...select(VERSE, 'that he')).text
    expect(once).toBe('For God so loved the world, … gave his only begotten Son.')
    expect(hideSelection(once, ...select(once, 'gave his')).text).toBe('For God so loved the world, … only begotten Son.')
  })

  it('puts the cursor after the ellipsis, and ignores a selection of spaces', () => {
    const hidden = hideSelection(VERSE, ...select(VERSE, 'For God'))
    expect(hidden.text.slice(0, hidden.cursor)).toBe('…')
    expect(hideSelection(VERSE, 3, 4)).toEqual({ text: VERSE, cursor: 4 })
  })
})

describe('scripture slide edits', () => {
  it('marks typed words as edited and keeps the Bible text', () => {
    const edited = withSlideText(slide, 'For God so loved the world.')
    expect(edited).toEqual({ ...slide, text: 'For God so loved the world.', source: VERSE, edited: true })
    expect(isEdited(edited)).toBe(true)
    expect(originalText(edited)).toBe(VERSE)
  })

  it('is not edited once the words match the Bible again', () => {
    expect(withSlideText(withSlideText(slide, 'Changed'), VERSE)).toEqual(slide)
  })

  it('resets to the original', () => {
    expect(resetSlide(withSlideText(slide, 'Changed'))).toEqual(slide)
  })

  it('resets a part to its part of the verse, not the whole verse', () => {
    const part = withPart(slide, 'b', VERSE.indexOf('that'))
    expect(part.text).toBe('that he gave his only begotten Son.')
    expect(part.caption).toBe('John 3:16b KJV')
    const edited = withSlideText(part, '… his only begotten Son.')
    expect(isEdited(edited)).toBe(true)
    expect(resetSlide(edited)).toEqual(part)
    expect(withWholeVerse(part)).toEqual(slide)
  })
})

describe('editor history', () => {
  it('undoes and redoes, and a new edit clears what could be redone', () => {
    let history = startHistory('one')
    history = record(history, 'two')
    history = record(history, 'three')
    history = undo(history)
    expect(history.present).toBe('two')
    history = redo(history)
    expect(history.present).toBe('three')
    history = record(undo(history), 'four')
    expect(history.present).toBe('four')
    expect(redo(history)).toBe(history)
    expect(undo(undo(undo(undo(history)))).present).toBe('one')
  })

  it('records nothing when nothing changed', () => {
    const history = startHistory({ text: 'same' })
    expect(record(history, { text: 'same' })).toBe(history)
  })
})
