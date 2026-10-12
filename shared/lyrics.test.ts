import { describe, expect, it } from 'vitest'
import { buildSongSlides, parseLyrics } from './lyrics'

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
