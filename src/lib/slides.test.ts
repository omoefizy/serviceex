import { describe, expect, it } from 'vitest'
import { announcementSlides, parseVerseCaption, slideLines, withAnnouncementSlideText } from './slides'

describe('slideLines', () => {
  it('marks translations and reference lines', () => {
    expect(slideLines('{Psalm 23:1}\nThe Lord is my shepherd\n[El Señor es mi pastor]')).toEqual([
      { text: 'Psalm 23:1', kind: 'reference' },
      { text: 'The Lord is my shepherd', kind: 'text' },
      { text: 'El Señor es mi pastor', kind: 'translation' },
    ])
  })

  it('leaves a bracketed first line alone, as it translates nothing', () => {
    expect(slideLines('[Instrumental]')).toEqual([{ text: '[Instrumental]', kind: 'text' }])
  })
})

describe('parseVerseCaption', () => {
  it('reads a scripture caption back', () => {
    expect(parseVerseCaption('1 John 4:8 KJV')).toEqual({ book: '1 John', chapter: 4, verse: 8, version: 'KJV' })
    expect(parseVerseCaption('© 1779 John Newton')).toBeNull()
  })
})

describe('withAnnouncementSlideText', () => {
  const payload = { title: 'Welcome', body: 'Coffee after church\n\nKids club', titleSlide: true }

  it('changes the title from the title slide and a body part from its slide', () => {
    expect(withAnnouncementSlideText(payload, 0, 'Hello')).toEqual({ ...payload, title: 'Hello' })
    const edited = withAnnouncementSlideText(payload, 2, 'Youth club')
    expect(announcementSlides(edited).map((s) => s.text)).toEqual(['Welcome', 'Coffee after church', 'Youth club'])
  })

  it('keeps a quote’s words without its quote marks', () => {
    const quote = { title: 'Quote: Faith', body: 'Faith sings', quote: { speaker: 'Pastor' } }
    expect(withAnnouncementSlideText(quote, 0, '“Faith sings first”').body).toBe('Faith sings first')
  })
})
