import { describe, expect, it } from 'vitest'
import { detectFormat, mergeBibles, parseBibleFile, parseOsis, parseUsfm, parseZefania } from './bibleImport'

describe('detectFormat', () => {
  it('tells the three formats apart', () => {
    expect(detectFormat('<?xml version="1.0"?>\n<XMLBIBLE biblename="Test">')).toBe('zefania')
    expect(detectFormat('<?xml version="1.0"?>\n<osis xmlns="http://www.bibletechnologies.net/2003/OSIS/namespace">')).toBe('osis')
    expect(detectFormat('﻿\\id GEN Genesis\n\\c 1')).toBe('usfm')
    expect(detectFormat('{"books": []}')).toBeNull()
  })

  it('refuses anything else', () => {
    expect(() => parseBibleFile('just some text')).toThrow(/Zefania/)
  })
})

describe('parseZefania', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<XMLBIBLE biblename="Test Version">
  <INFORMATION><title>Ignored</title></INFORMATION>
  <BIBLEBOOK bnumber="43" bname="John">
    <CHAPTER cnumber="3">
      <CAPTION>Jesus and Nicodemus</CAPTION>
      <VERS vnumber="16">For God so loved <STYLE css="x">the world</STYLE>,<NOTE>a note</NOTE> that he gave&#160;his Son.</VERS>
      <VERS vnumber="17">Line one<BR/>line two &amp; more.</VERS>
    </CHAPTER>
  </BIBLEBOOK>
  <BIBLEBOOK bnumber="67" bname="Tobit">
    <CHAPTER cnumber="1"><VERS vnumber="1">Not kept.</VERS></CHAPTER>
  </BIBLEBOOK>
</XMLBIBLE>`

  it('reads verses by book number, without notes or headings', () => {
    const bible = parseZefania(xml)
    expect(bible.name).toBe('Test Version')
    expect(bible.verses).toEqual([
      { book: 'John', chapter: 3, verse: 16, text: 'For God so loved the world, that he gave his Son.' },
      { book: 'John', chapter: 3, verse: 17, text: 'Line one line two & more.' },
    ])
    expect(bible.skippedBooks).toEqual(['67'])
  })
})

describe('parseOsis', () => {
  it('reads container verses and the work title', () => {
    const bible = parseOsis(`<osis><osisText osisIDWork="TV">
      <header><work osisWork="TV"><title>Test OSIS</title></work></header>
      <div type="book" osisID="Ps">
        <chapter osisID="Ps.23">
          <title type="psalm">A Psalm of David.</title>
          <verse osisID="Ps.23.1"><w lemma="x">The</w> <w>LORD</w> is my shepherd;<note>n</note><l>I shall not want.</l></verse>
        </chapter>
      </div>
    </osisText></osis>`)
    expect(bible.name).toBe('Test OSIS')
    expect(bible.verses).toEqual([{ book: 'Psalms', chapter: 23, verse: 1, text: 'The LORD is my shepherd; I shall not want.' }])
  })

  it('reads milestone verses that run across elements', () => {
    const bible = parseOsis(`<osis><osisText>
      <div type="book" osisID="1John"><chapter sID="1John.4" osisID="1John.4"/>
        <p><verse sID="1John.4.8" osisID="1John.4.8"/>He that loveth not knoweth not God;</p>
        <p>for God is love.<verse eID="1John.4.8"/>
        <verse sID="1John.4.9" osisID="1John.4.9"/>In this was manifested<verse eID="1John.4.9"/></p>
      <chapter eID="1John.4"/></div>
      <div type="book" osisID="Tob"><chapter osisID="Tob.1"><verse osisID="Tob.1.1">Skipped</verse></chapter></div>
    </osisText></osis>`)
    expect(bible.verses).toEqual([
      { book: '1 John', chapter: 4, verse: 8, text: 'He that loveth not knoweth not God; for God is love.' },
      { book: '1 John', chapter: 4, verse: 9, text: 'In this was manifested' },
    ])
    expect(bible.skippedBooks).toEqual(['Tob'])
  })
})

describe('parseUsfm', () => {
  it('reads chapters and verses, without headings, notes or word attributes', () => {
    const bible = parseUsfm(`\\id GEN Test
\\h Genesis
\\toc1 The First Book of Moses
\\mt1 Genesis
\\c 1
\\s1 The Creation
\\p
\\v 1 In the beginning \\w God|strong="H0430"\\w* created the heavens and the earth.\\f + \\fr 1:1 \\ft A note.\\f*
\\v 2 The earth was \\add without form\\add*,
\\q1 and void.
\\c 2
\\p
\\v 1-2 Thus the heavens were finished.
`)
    expect(bible.verses).toEqual([
      { book: 'Genesis', chapter: 1, verse: 1, text: 'In the beginning God created the heavens and the earth.' },
      { book: 'Genesis', chapter: 1, verse: 2, text: 'The earth was without form, and void.' },
      { book: 'Genesis', chapter: 2, verse: 1, text: 'Thus the heavens were finished.' },
    ])
  })

  it('skips books outside the 66', () => {
    expect(parseUsfm('\\id TOB\n\\c 1\n\\v 1 Text')).toEqual({ name: null, verses: [], skippedBooks: ['TOB'] })
  })
})

describe('mergeBibles', () => {
  it('puts several files in Bible order', () => {
    const merged = mergeBibles([
      parseUsfm('\\id REV\n\\c 1\n\\v 1 Last.'),
      parseUsfm('\\id GEN\n\\c 1\n\\v 2 Second.\n\\v 1 First.'),
    ])
    expect(merged.verses.map((v) => `${v.book} ${v.chapter}:${v.verse}`)).toEqual(['Genesis 1:1', 'Genesis 1:2', 'Revelation 1:1'])
  })
})
