// Theme background images and videos. Picked files are copied into <userData>/media, so a theme keeps working
// when the original moves, and served to both windows as wd-media://local/<name>. The dev renderer runs on
// http://localhost, which may not load file:// URLs.

import { app, net, protocol } from 'electron'
import { copyFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SCHEME = 'wd-media'

const mediaDir = () => path.join(app.getPath('userData'), 'media')

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ])
}

export function registerMediaProtocol(): void {
  protocol.handle(SCHEME, (request) => {
    const name = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
    // Only plain file names inside the media folder.
    if (!name || name !== path.basename(name) || name.startsWith('.')) return new Response('Not found', { status: 404 })
    // Pass headers through so video Range requests work for seeking and looping.
    return net.fetch(pathToFileURL(path.join(mediaDir(), name)).toString(), { headers: request.headers })
  })
}

/** Copies a file into the media folder under a unique name and returns its wd-media:// URL. */
export async function importMedia(source: string): Promise<string> {
  await mkdir(mediaDir(), { recursive: true })
  const extension = path.extname(source).toLowerCase()
  const base = path
    .basename(source, path.extname(source))
    .replace(/[^\w.-]+/g, '-')
    .slice(0, 60)
  const name = `${Date.now()}-${base || 'media'}${extension}`
  await copyFile(source, path.join(mediaDir(), name))
  return `${SCHEME}://local/${encodeURIComponent(name)}`
}
