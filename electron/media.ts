// Media files: library backgrounds, their thumbnails and presentation pages. Files live in <userData>/media,
// so they keep working when the originals move, and are served to both windows as wd-media://local/<name>.
// Imported presentations' slide pictures live in <userData>/presentations/<hash>/, served as
// wd-media://deck/<hash>/<name>, and the pictures Native mode takes out of a .pptx in its native/ folder.
// Imported fonts live in <userData>/fonts, served as wd-media://font/<name> (see fonts.ts).
// The dev renderer runs on http://localhost, which may not load file:// URLs.

import { app, net, protocol } from 'electron'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { fontFileName, fontsDir } from './fonts'

const SCHEME = 'wd-media'

const mediaDir = () => path.join(app.getPath('userData'), 'media')
export const presentationsDir = () => path.join(app.getPath('userData'), 'presentations')

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ])
}

export function registerMediaProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    const name = decodeURIComponent(url.pathname.replace(/^\//, ''))
    let file: string
    if (url.host === 'deck') {
      // Only a slide picture, or a native slide's picture, inside a presentation's cache folder.
      const match = /^([0-9a-f]{64})\/(slide-\d{3}\.png|native\/[0-9a-f]{64}\.(?:png|jpe?g|gif|webp|svg|bmp))$/.exec(name)
      if (!match) return new Response('Not found', { status: 404 })
      file = path.join(presentationsDir(), match[1], ...match[2].split('/'))
    } else if (url.host === 'font') {
      // Only a font file name inside the fonts folder.
      const font = fontFileName(name)
      if (!font) return new Response('Not found', { status: 404 })
      file = path.join(fontsDir(), font)
    } else {
      // Only plain file names inside the media folder.
      if (!name || name !== path.basename(name) || name.startsWith('.')) return new Response('Not found', { status: 404 })
      file = path.join(mediaDir(), name)
    }
    // Pass headers through so video Range requests work for seeking and looping.
    const response = await net.fetch(pathToFileURL(file).toString(), { headers: request.headers })
    // The renderer draws library files onto a canvas to make thumbnails, which needs CORS.
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })
}

export const mediaUrl = (name: string) => `${SCHEME}://local/${encodeURIComponent(name)}`

/** A presentation's slide picture, by the hash of its cache folder and its file name (native/<name> for Native mode's). */
export const presentationImageUrl = (hash: string, file: string) => `${SCHEME}://deck/${hash}/${file}`

/** The file name behind a wd-media:// URL, or null for anything else. */
export function mediaName(url: string): string | null {
  if (!url.startsWith(`${SCHEME}://`)) return null
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''))
  return name && name === path.basename(name) ? name : null
}

function uniqueName(base: string, extension: string): string {
  const safe = base.replace(/[^\w.-]+/g, '-').slice(0, 60) || 'media'
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${safe}${extension}`
}

/** Copies a file into the media folder under a unique name and returns that name. */
export async function copyIntoMedia(source: string): Promise<string> {
  await mkdir(mediaDir(), { recursive: true })
  const extension = path.extname(source).toLowerCase()
  const name = uniqueName(path.basename(source, path.extname(source)), extension)
  await copyFile(source, path.join(mediaDir(), name))
  return name
}

/** Writes bytes the renderer made (a thumbnail or a PDF page) and returns the file name. */
export async function writeMedia(bytes: Uint8Array, base: string, extension: string): Promise<string> {
  await mkdir(mediaDir(), { recursive: true })
  const name = uniqueName(base, extension)
  await writeFile(path.join(mediaDir(), name), bytes)
  return name
}

export async function removeMedia(name: string | null): Promise<void> {
  if (name && name === path.basename(name)) await rm(path.join(mediaDir(), name), { force: true })
}
