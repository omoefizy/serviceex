// Media files: library backgrounds, their thumbnails and presentation pages. Files live in <userData>/media,
// so they keep working when the originals move, and are served to both windows as wd-media://local/<name>.
// The dev renderer runs on http://localhost, which may not load file:// URLs.

import { app, net, protocol } from 'electron'
import { copyFile, mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SCHEME = 'wd-media'

const mediaDir = () => path.join(app.getPath('userData'), 'media')

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ])
}

export function registerMediaProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
    // Only plain file names inside the media folder.
    if (!name || name !== path.basename(name) || name.startsWith('.')) return new Response('Not found', { status: 404 })
    // Pass headers through so video Range requests work for seeking and looping.
    const response = await net.fetch(pathToFileURL(path.join(mediaDir(), name)).toString(), { headers: request.headers })
    // The renderer draws library files onto a canvas to make thumbnails, which needs CORS.
    const headers = new Headers(response.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
  })
}

export const mediaUrl = (name: string) => `${SCHEME}://local/${encodeURIComponent(name)}`

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
