// Makes every app icon from the SVGs in assets/brand/, so the logo changes in one place.
//
//   npm run icons
//
// Sources:
//   assets/brand/icon.svg        the master: the mark on its rounded square (the element with id="background")
//   assets/brand/icon-small.svg  the 16 and 24 px icon, thickened and snapped to the pixel grid, without the live dot
// Made from them:
//   assets/brand/mark.svg        the master without its background, for the app header and the Welcome screen
//   build/icon.icns, icon.ico, icon.png, icons/NxN.png, icon-mac.png    electron-builder (macOS, Windows, Linux),
//                                and the dev Dock icon
//   public/app-icon.png          the window and About panel icon on Windows and Linux
//   public/tray/                 the macOS tray template (@1x, @2x) and the Windows tray icon
//   assets/brand/web/            the favicon set and web manifest
//
// The ICO and ICNS files are packed here rather than with png2icons or icon-gen: those scale one PNG to every size,
// and the small sizes need their own art.
//
// Runs with Node's built-in TypeScript support (Node 22.18 or later).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const BRAND = path.join(ROOT, 'assets/brand')
const BUILD = path.join(ROOT, 'build')
const PUBLIC = path.join(ROOT, 'public')
const WEB = path.join(BRAND, 'web')

const BACKGROUND = /<rect id="background"[^>]*\/>\s*/
const master = readFileSync(path.join(BRAND, 'icon.svg'), 'utf8')
const small = readFileSync(path.join(BRAND, 'icon-small.svg'), 'utf8')
if (!BACKGROUND.test(master) || !BACKGROUND.test(small)) throw new Error('icon.svg and icon-small.svg need a <rect id="background" .../>')

/** The mark alone. */
const mark = master.replace(BACKGROUND, '')
/** The small art in black on transparent, for a macOS template image (macOS tints it for the menu bar). */
const tray = small.replace(BACKGROUND, '').replace(/#[0-9A-Fa-f]{6}/g, '#000000')
/** A square background, for the Apple touch icon: iOS rounds the corners itself. */
const square = master.replace(/(<rect id="background"[^>]*?) rx="[^"]*"/, '$1')
/** The art at the size of the macOS icon grid: on a 1024 canvas the body is 824, so the Dock shows it at the system size. */
const MAC_INSET = (256 * 100) / 824

/** Renders an SVG to a square PNG of the given size, optionally with a transparent inset on every side (in SVG units). */
async function png(svg: string, size: number, inset = 0): Promise<Buffer> {
  const side = 256 + inset * 2
  const sized = svg.replace(/<svg([^>]*?) width="[^"]*" height="[^"]*" viewBox="[^"]*"/, `<svg$1 width="${size}" height="${size}" viewBox="${-inset} ${-inset} ${side} ${side}"`)
  return sharp(Buffer.from(sized), { density: 72 }).resize(size, size).png().toBuffer()
}

/** The small art up to 24 px, the master above. */
const app = (size: number, inset = 0) => png(size <= 24 ? small : master, size, inset)

/** A Windows ICO: 32 bit bitmaps below 256 (which every Windows and NSIS reads), PNG at 256. */
async function ico(images: Buffer[]): Promise<Buffer> {
  const entries = await Promise.all(
    images.map(async (image) => {
      const { data, info } = await sharp(image).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const { width, height } = info
      if (width >= 256) return { width, height, bytes: image }
      const header = Buffer.alloc(40)
      header.writeUInt32LE(40, 0)
      header.writeInt32LE(width, 4)
      header.writeInt32LE(height * 2, 8) // the colour rows, then the mask rows
      header.writeUInt16LE(1, 12)
      header.writeUInt16LE(32, 14)
      const pixels = Buffer.alloc(width * height * 4)
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const from = (y * width + x) * 4
          const to = ((height - 1 - y) * width + x) * 4 // bottom up, BGRA
          pixels[to] = data[from + 2]
          pixels[to + 1] = data[from + 1]
          pixels[to + 2] = data[from]
          pixels[to + 3] = data[from + 3]
        }
      }
      const mask = Buffer.alloc(Math.ceil(width / 32) * 4 * height) // all clear: the alpha channel decides
      return { width, height, bytes: Buffer.concat([header, pixels, mask]) }
    }),
  )
  const head = Buffer.alloc(6 + entries.length * 16)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(entries.length, 4)
  let offset = head.length
  entries.forEach(({ width, height, bytes }, i) => {
    const at = 6 + i * 16
    head.writeUInt8(width >= 256 ? 0 : width, at)
    head.writeUInt8(height >= 256 ? 0 : height, at + 1)
    head.writeUInt16LE(1, at + 4)
    head.writeUInt16LE(32, at + 6)
    head.writeUInt32LE(bytes.length, at + 8)
    head.writeUInt32LE(offset, at + 12)
    offset += bytes.length
  })
  return Buffer.concat([head, ...entries.map((e) => e.bytes)])
}

/** A macOS ICNS of PNGs, by type: the 1x sizes, then the Retina ones (16@2x is 32 px, and so on). */
function icns(images: [type: string, image: Buffer][]): Buffer {
  const chunks = images.map(([type, image]) => {
    const head = Buffer.alloc(8)
    head.write(type, 0, 'ascii')
    head.writeUInt32BE(image.length + 8, 4)
    return Buffer.concat([head, image])
  })
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(8 + chunks.reduce((sum, c) => sum + c.length, 0), 4)
  return Buffer.concat([head, ...chunks])
}

function write(file: string, data: Buffer | string) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, data)
  console.log(path.relative(ROOT, file))
}

write(path.join(BRAND, 'mark.svg'), mark)

// macOS: on the icon grid. 16 px uses the small art; its 2x (32 px) and up use the master.
const mac = (size: number) => app(size, MAC_INSET)
write(
  path.join(BUILD, 'icon.icns'),
  icns([
    ['icp4', await mac(16)],
    ['icp5', await mac(32)],
    ['icp6', await mac(64)],
    ['ic07', await mac(128)],
    ['ic08', await mac(256)],
    ['ic09', await mac(512)],
    ['ic10', await mac(1024)],
    ['ic11', await mac(32)],
    ['ic12', await mac(64)],
    ['ic13', await mac(256)],
    ['ic14', await mac(512)],
  ]),
)
write(path.join(BUILD, 'icon-mac.png'), await mac(1024))

// Windows.
write(path.join(BUILD, 'icon.ico'), await ico(await Promise.all([16, 24, 32, 48, 64, 128, 256].map((s) => app(s)))))

// Linux, and electron-builder's fallback.
write(path.join(BUILD, 'icon.png'), await app(1024))
for (const size of [16, 24, 32, 48, 64, 128, 256, 512, 1024]) write(path.join(BUILD, 'icons', `${size}x${size}.png`), await app(size))

// At run time.
write(path.join(PUBLIC, 'app-icon.png'), await app(512))
write(path.join(PUBLIC, 'tray', 'trayTemplate.png'), await png(tray, 16))
write(path.join(PUBLIC, 'tray', 'trayTemplate@2x.png'), await png(tray, 32))
write(path.join(PUBLIC, 'tray', 'tray.ico'), await ico(await Promise.all([16, 24, 32, 48].map((s) => app(s)))))

// The web.
write(path.join(WEB, 'favicon.ico'), await ico(await Promise.all([16, 32, 48].map((s) => app(s)))))
write(path.join(WEB, 'favicon.svg'), master)
write(path.join(WEB, 'favicon-32.png'), await app(32))
write(path.join(WEB, 'apple-touch-icon.png'), await png(square, 180))
write(path.join(WEB, 'icon-512.png'), await app(512))
write(
  path.join(WEB, 'site.webmanifest'),
  JSON.stringify(
    {
      name: 'ServiceEx',
      short_name: 'ServiceEx',
      icons: [{ src: 'icon-512.png', sizes: '512x512', type: 'image/png' }],
      theme_color: '#0A0F1E',
      background_color: '#0A0F1E',
      display: 'standalone',
    },
    null,
    2,
  ) + '\n',
)
