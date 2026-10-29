import { describe, expect, it } from 'vitest'
import { combinedSlide, estimateFontSize, fitBoxOf, groupFit, groupPayload, groupSlides, MIN_READABLE_SIZE, type FitBox } from './scriptureGroup'
import { DEFAULT_THEME_STYLE } from './themes'
import type { ScriptureGroup, ScriptureGroupPassage } from './types'

const passage = (reference: string, ...texts: string[]): ScriptureGroupPassage => ({
  reference,
  version: 'KJV',
  verses: texts.map((text, i) => ({ text, caption: `${reference.replace(/:\d+.*$/, '')}:${i + 1} KJV` })),
})

const JOHN = passage('John 3:16', 'For God so loved the world, that he gave his only begotten Son.')
const ROMANS = passage('Romans 5:8', 'But God commendeth his love toward us, in that, while we were yet sinners, Christ died for us.')
const EPH = passage('Ephesians 1:19b', 'according to the working of his mighty power,')
const PSALM = passage('Psalms 23:1', 'The LORD is my shepherd; I shall not want.')

const BOX: FitBox = { width: 150, height: 70, lineHeight: 1.25, maxSize: 12 }
const group = (passages: ScriptureGroupPassage[], layout: ScriptureGroup['layout'] = 'stacked', split = false): ScriptureGroup => ({ layout, passages, split })

describe('combinedSlide', () => {
  it('stacks each passage with its own reference line', () => {
    expect(combinedSlide(group([JOHN, EPH]))).toEqual({
      text: `${JOHN.verses[0].text}\n{John 3:16 KJV}\n${EPH.verses[0].text}\n{Ephesians 1:19b KJV}`,
      caption: '',
    })
  })

  it('runs a passage’s verses together', () => {
    const range = passage('Psalms 23:1-2', 'The LORD is my shepherd;', 'He maketh me to lie down.')
    expect(combinedSlide(group([range])).text).toBe('The LORD is my shepherd; He maketh me to lie down.\n{Psalms 23:1-2 KJV}')
  })

  it('puts the first half in the left column and the rest in the right', () => {
    const slide = combinedSlide(group([JOHN, ROMANS, EPH], 'columns'))
    expect(slide.text).toBe(`${JOHN.verses[0].text}\n{John 3:16 KJV}\n${ROMANS.verses[0].text}\n{Romans 5:8 KJV}`)
    expect(slide.column).toBe(`${EPH.verses[0].text}\n{Ephesians 1:19b KJV}`)
  })

  it('stacks a single passage even in columns', () => {
    expect(combinedSlide(group([JOHN], 'columns')).column).toBeUndefined()
  })

  it('takes at most four passages', () => {
    const five = group([JOHN, ROMANS, EPH, PSALM, passage('Jude 1:2', 'Mercy unto you.')])
    expect(combinedSlide(five).text.match(/\{/g)).toHaveLength(4)
    expect(groupPayload(five).group.passages).toHaveLength(4)
  })
})

describe('fitting the text box', () => {
  it('gives short text the largest size and long text a smaller one', () => {
    expect(estimateFontSize('Jesus wept.', BOX)).toBe(BOX.maxSize)
    const long = Array.from({ length: 12 }, () => ROMANS.verses[0].text).join(' ')
    expect(estimateFontSize(long, BOX)).toBeLessThan(estimateFontSize(ROMANS.verses[0].text, BOX))
  })

  it('fits two short passages, and offers to split four long ones', () => {
    expect(groupFit(group([JOHN, EPH]), BOX).tooLong).toBe(false)
    const long = (ref: string) => passage(ref, ...Array.from({ length: 6 }, () => ROMANS.verses[0].text))
    const fit = groupFit(group([long('Romans 5:8-13'), long('John 3:16-21'), long('Psalms 23:1-6'), long('Jude 1:1-6')]), BOX)
    expect(fit.tooLong).toBe(true)
    expect(fit.fontSize).toBeLessThan(MIN_READABLE_SIZE)
  })

  it('reads the room from the theme’s main text box', () => {
    const box = fitBoxOf(DEFAULT_THEME_STYLE)
    expect(box).not.toBeNull()
    expect(box!.width).toBeGreaterThan(box!.height)
  })

  it('never says a group without a text box is too long', () => {
    expect(groupFit(group([JOHN]), null)).toEqual({ fontSize: 0, tooLong: false })
  })
})

describe('splitting into slides', () => {
  it('makes one slide per passage', () => {
    const slides = groupSlides(group([JOHN, EPH], 'stacked', true), BOX)
    expect(slides.map((s) => s.text)).toEqual([`${JOHN.verses[0].text}\n{John 3:16 KJV}`, `${EPH.verses[0].text}\n{Ephesians 1:19b KJV}`])
  })

  it('gives a passage too long for one slide a slide per verse', () => {
    const verse = Array.from({ length: 5 }, () => ROMANS.verses[0].text).join(' ')
    const long = passage('Romans 5:8-12', ...Array.from({ length: 5 }, () => verse))
    const slides = groupSlides(group([long], 'stacked', true), BOX)
    expect(slides).toHaveLength(5)
    expect(slides[1].text).toBe(`${verse}\n{Romans 5:2 KJV}`)
  })
})

describe('groupPayload', () => {
  it('titles the group by its references and keeps the group to edit again', () => {
    const payload = groupPayload(group([JOHN, EPH], 'columns'))
    expect(payload.title).toBe('John 3:16 KJV; Ephesians 1:19b KJV')
    expect(payload.verses).toHaveLength(1)
    expect(payload.group.layout).toBe('columns')
  })
})
