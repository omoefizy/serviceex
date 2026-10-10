// The statement guard, with invented sermon lines.
import { describe, expect, it } from 'vitest'
import { locateStatement, verbatimStatements } from './statements'

const TRANSCRIPT =
  'Some of you came in tired this morning. Hope is not a feeling, it is a decision you make on Monday. ' +
  'And here is the thing, a closed door is still a door. Write that down somewhere you will see it.'

describe('verbatimStatements', () => {
  it('keeps a statement that is in the transcript word for word, in the transcript’s wording', () => {
    // Different case and punctuation from the AI are fine; the transcript's own words come back.
    expect(verbatimStatements(['hope is not a feeling it is a decision you make on monday'], TRANSCRIPT)).toEqual([
      'Hope is not a feeling, it is a decision you make on Monday.',
    ])
  })

  it('drops a reworded line', () => {
    expect(verbatimStatements(['Hope is not a feeling, it is a choice you make on Monday.'], TRANSCRIPT)).toEqual([])
  })

  it('drops a line with added words', () => {
    expect(verbatimStatements(['A closed door is still a door to walk through.'], TRANSCRIPT)).toEqual([])
  })

  it('drops a line merged from two places', () => {
    expect(verbatimStatements(['Hope is not a feeling, a closed door is still a door.'], TRANSCRIPT)).toEqual([])
  })

  it('trims a trailing comma and leading punctuation from the kept wording', () => {
    expect(verbatimStatements(['here is the thing'], TRANSCRIPT)).toEqual(['here is the thing'])
    expect(verbatimStatements(['And here is the thing'], TRANSCRIPT)).toEqual(['And here is the thing'])
  })

  it('keeps at most two, each under 20 words, without repeats or non-text', () => {
    const long = 'Hope is not a feeling, it is a decision you make on Monday. And here is the thing, a closed door'
    expect(
      verbatimStatements(
        [42, long, 'A closed door is still a door.', 'a closed door is still a door', 'Write that down somewhere you will see it.', 'Some of you came in tired'],
        TRANSCRIPT,
      ),
    ).toEqual(['a closed door is still a door.', 'Write that down somewhere you will see it.'])
  })

  it('matches across a hyphen either way', () => {
    expect(verbatimStatements(['grace that is well known'], 'We sing of a grace that is well-known and still new.')).toEqual([
      'grace that is well-known',
    ])
  })

  it('accepts nothing when the answer is not a list', () => {
    expect(verbatimStatements('Hope is not a feeling', TRANSCRIPT)).toEqual([])
  })
})

describe('locateStatement', () => {
  it('gives the index of the first word, for the time it was heard', () => {
    expect(locateStatement('a closed door is still a door', TRANSCRIPT)?.start).toBe(26)
  })
})
