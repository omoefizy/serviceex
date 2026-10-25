// Reads the family, weight and style of the WOFF2 files bundled with the app, and of a small TrueType file built here.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readFontInfo } from './fonts'

const bundled = (file: string) => readFile(path.join(__dirname, '..', 'public', 'fonts', file))

/** A TrueType file with only a name table (family names 1 and 16) and an OS/2 table. */
function sfnt(family: string, typographic: string | null, weight: number, italic: boolean): Buffer {
  const names = [{ id: 1, value: family }, ...(typographic ? [{ id: 16, value: typographic }] : [])]
  const strings = names.map((n) => Buffer.from(n.value, 'utf16le').swap16())
  const name = Buffer.alloc(6 + names.length * 12)
  name.writeUInt16BE(names.length, 2)
  name.writeUInt16BE(name.length, 4)
  let offset = 0
  names.forEach((n, i) => {
    const at = 6 + i * 12
    name.writeUInt16BE(3, at)
    name.writeUInt16BE(1, at + 2)
    name.writeUInt16BE(0x409, at + 4)
    name.writeUInt16BE(n.id, at + 6)
    name.writeUInt16BE(strings[i].length, at + 8)
    name.writeUInt16BE(offset, at + 10)
    offset += strings[i].length
  })
  const nameTable = Buffer.concat([name, ...strings])
  const os2 = Buffer.alloc(96)
  os2.writeUInt16BE(weight, 4)
  os2.writeUInt16BE(italic ? 1 : 0x40, 62)
  const tables = [
    { tag: 'OS/2', data: os2 },
    { tag: 'name', data: nameTable },
  ]
  const header = Buffer.alloc(12 + tables.length * 16)
  header.writeUInt32BE(0x00010000, 0)
  header.writeUInt16BE(tables.length, 4)
  let at = header.length
  tables.forEach((t, i) => {
    header.write(t.tag, 12 + i * 16, 'latin1')
    header.writeUInt32BE(at, 12 + i * 16 + 8)
    header.writeUInt32BE(t.data.length, 12 + i * 16 + 12)
    at += t.data.length
  })
  return Buffer.concat([header, ...tables.map((t) => t.data)])
}

describe('readFontInfo', () => {
  it('reads a variable WOFF2 font as its whole weight range', async () => {
    expect(readFontInfo(await bundled('Montserrat-Variable.woff2'))).toEqual({ family: 'Montserrat', weight: '100 900', italic: false })
    expect(readFontInfo(await bundled('Montserrat-Italic-Variable.woff2'))).toEqual({ family: 'Montserrat', weight: '100 900', italic: true })
  })

  it('reads a static WOFF2 font', async () => {
    expect(readFontInfo(await bundled('Poppins-BoldItalic.woff2'))).toEqual({ family: 'Poppins', weight: '700', italic: true })
    expect(readFontInfo(await bundled('BebasNeue-Regular.woff2'))).toEqual({ family: 'Bebas Neue', weight: '400', italic: false })
  })

  it('prefers the typographic family of a TrueType font', () => {
    expect(readFontInfo(sfnt('Church Sans SemiBold', 'Church Sans', 600, false))).toEqual({ family: 'Church Sans', weight: '600', italic: false })
    expect(readFontInfo(sfnt('Church Serif', null, 400, true))).toEqual({ family: 'Church Serif', weight: '400', italic: true })
  })

  it('rejects files that are not fonts', () => {
    expect(() => readFontInfo(Buffer.from('not a font at all'))).toThrow()
  })
})
