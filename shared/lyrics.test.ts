import { describe, expect, it } from 'vitest'
import { buildSongSlides, parseLyrics, replaceSongSlide } from './lyrics'

describe('translation lines', () => {
  it('keeps a [bracketed] line under a lyric line in the slide', () => {
    const slides = buildSongSlides('[Verse 1]\nAmazing grace\n[Gracia sublime]\nHow sweet the sound')
    expect(slides).toEqual([{ text: 'Amazing grace\n[Gracia sublime]\nHow sweet the sound', label: 'Verse 1' }])
  })

  it('still starts a section at a section name straight under a lyric line', () => {
    const sections = parseLyrics('[Verse 1]\nAmazing grace\n[Chorus]\nMy chains are gone\n[Refrain 2]\nOh')
    expect(sections.map((s) => s.label)).toEqual(['Verse 1', 'Chorus', 'Refrain 2'])
  })

  it('starts a section at any label after a blank line', () => {
    const sections = parseLyrics('Amazing grace\n\n[Ending]\nAmen')
    expect(sections.map((s) => s.label)).toEqual([null, 'Ending'])
  })

  it('keeps a translation on the same slide as its line when splitting', () => {
    const slides = buildSongSlides('One\n[Uno]\nTwo\n[Dos]\nThree\n[Tres]', { order: [], linesPerSlide: 2 })
    expect(slides.map((s) => s.text)).toEqual(['One\n[Uno]\nTwo\n[Dos]', 'Three\n[Tres]'])
  })
})

describe('replaceSongSlide', () => {
  const LYRICS = '[Verse 1]\nOne\nTwo\n\n[Chorus]\n  Sing  \nPraise\n\nThree'

  it('puts new words in place of the lines a slide came from', () => {
    expect(replaceSongSlide(LYRICS, { order: [], linesPerSlide: null }, 1, 'Sing out\nPraise him')).toBe(
      '[Verse 1]\nOne\nTwo\n\n[Chorus]\nSing out\nPraise him\n\nThree',
    )
  })

  it('counts slides in play order and after lines per slide splits them', () => {
    const arrangement = { order: ['Chorus', 'Verse 1'], linesPerSlide: 1 as const }
    expect(buildSongSlides(LYRICS, { order: ['Chorus', 'Verse 1'], linesPerSlide: 2 }).map((s) => s.text)).toEqual(['Sing\nPraise', 'Three', 'One\nTwo'])
    expect(replaceSongSlide(LYRICS, { order: ['Chorus', 'Verse 1'], linesPerSlide: 2 }, 2, 'Uno\nDos')).toBe(
      '[Verse 1]\nUno\nDos\n\n[Chorus]\n  Sing  \nPraise\n\nThree',
    )
    expect(replaceSongSlide(LYRICS, arrangement, 4, 'Deux')).toBe('[Verse 1]\nOne\nDeux\n\n[Chorus]\n  Sing  \nPraise\n\nThree')
  })

  it('leaves the lyrics alone for a slide that does not exist', () => {
    expect(replaceSongSlide(LYRICS, { order: [], linesPerSlide: null }, 9, 'x')).toBe(LYRICS)
  })
})
