// The PowerPoint export: every slide of the sermon's deck is written, not only the title. The sermon is invented.
import JSZip from 'jszip'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { sermonDeck } from '../../shared/sermons'
import type { Sermon } from '../../shared/types'
import { makeTempDirSync, removeTempSync } from '../tempDir.test-helper'

vi.mock('electron', () => ({ app: { getAppPath: () => '.', getPath: () => tmpdir() }, BrowserWindow: class {} }))

const { imageSize, renderSermonPptx } = await import('./export')

const SERMON: Sermon = {
  id: 7,
  title: 'Bread for the Road',
  preacher: 'Odile Marchetti',
  date: '2026-10-25',
  series: 'Journeys',
  status: 'saved',
  createdAt: '2026-10-25T09:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
  churchName: 'Willow Lane Fellowship',
  notes: '',
  summary: 'Small provisions are enough for the next step.',
  keyPoints: [
    'Enough for today is a gift, not a shortage.',
    'Rest is part of the journey, not a break from it.',
    'Share the bread you carry.',
    'The road teaches what the map cannot.',
    'Arrive together or not at all.',
  ],
  cleanedTranscript: '',
  segments: [],
  scriptures: [
    { id: 1, reference: 'Exodus 16:4', atMs: 1000, source: 'detected' },
    { id: 2, reference: '1 Kings 19:5-8', atMs: 2000, source: 'detected' },
    { id: 3, reference: 'John 6', atMs: 3000, source: 'manual' },
  ],
  statements: [
    { id: 1, text: 'The crumbs on the table are proof that someone was fed.', atMs: 4000, pinned: true },
    { id: 2, text: 'You do not need the whole loaf to take one step.', atMs: 5000, pinned: true },
    { id: 3, text: 'Not pinned, so not a slide.', atMs: 6000, pinned: false },
  ],
}

const PASSAGES = [
  { reference: 'Exodus 16:4 KJV', text: 'Behold, I will rain bread from heaven for you.' },
  { reference: '1 Kings 19:5-8 KJV', text: null },
  { reference: 'John 6', text: null },
]

/** A 2 by 1 pixel PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEKGAEAJgUD/ThwagAAAABJRU5ErkJggg==', 'base64')
const dir = makeTempDirSync('serviceex-pptx-')
afterAll(() => removeTempSync(dir))

async function slideXml(buffer: Buffer): Promise<string[]> {
  const zip = await JSZip.loadAsync(buffer)
  const names = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
  return Promise.all(names.map((name) => zip.file(name)!.async('string')))
}

describe('PowerPoint export', () => {
  it('writes 12 slides for 3 scriptures, 2 statements and 5 key points', async () => {
    const deck = sermonDeck(SERMON, PASSAGES)
    const logo = path.join(dir, 'logo.png')
    writeFileSync(logo, PNG)
    const buffer = await renderSermonPptx('Bread for the Road', deck, logo)

    const zip = await JSZip.loadAsync(buffer)
    const presentation = await zip.file('ppt/presentation.xml')!.async('string')
    expect(presentation.match(/<p:sldId /g)).toHaveLength(12)
    const slides = await slideXml(buffer)
    expect(slides).toHaveLength(12)

    // Title, preacher, date and church, with the logo.
    expect(slides[0]).toContain('Bread for the Road')
    expect(slides[0]).toContain('Odile Marchetti')
    expect(slides[0]).toMatch(/2026/)
    expect(slides[0]).toContain('Willow Lane Fellowship')
    expect(slides[0]).toContain('<p:pic>')
    // Then scripture, statements, key points and the closing slide, in that order.
    expect(slides[1]).toContain('Behold, I will rain bread from heaven for you.')
    expect(slides[1]).toContain('Exodus 16:4 KJV')
    expect(slides[2]).toContain('1 Kings 19:5-8 KJV')
    expect(slides[3]).toContain('John 6')
    expect(slides[4]).toContain('The crumbs on the table are proof that someone was fed.')
    expect(slides[5]).toContain('You do not need the whole loaf to take one step.')
    SERMON.keyPoints.forEach((point, i) => expect(slides[6 + i]).toContain(point))
    expect(slides[11]).toContain('Thank you for joining us')
    expect(slides.join('')).not.toContain('Not pinned')
  })

  it('reads the size of PNG and JPEG logos, and nothing else', () => {
    expect(imageSize(PNG)).toEqual({ width: 2, height: 1 })
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 30, 0, 40, 3, 0, 0, 0])
    expect(imageSize(jpeg)).toEqual({ width: 40, height: 30 })
    expect(imageSize(Buffer.from('<svg></svg>'))).toBeNull()
  })
})
