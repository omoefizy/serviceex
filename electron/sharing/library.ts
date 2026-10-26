// Turns library items into .serviceex packages and received items back into library items: songs, themes, media,
// presentations and whole services. Everything received is checked as if the renderer had sent it, saved under
// names chosen here, and never opened by another program. Nothing received goes live.

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { extensionOf, safeFileName, shareKindOf } from '../../shared/sharing'
import { normalizeTheme } from '../../shared/themes'
import type { AcceptResult, ConflictChoice, InboxConflict, InboxItem, InboxPreview, ServiceItem } from '../../shared/types'
import { getMediaRow, getSlideBackgrounds, insertMedia, listMedia, replaceMediaFile, setSlideBackground } from '../db/media'
import { presentationStore } from '../db/presentations'
import { addItem, createService, deleteService, getService, listServices } from '../db/services'
import { createSong, getSong, listSongs, updateSong } from '../db/songs'
import { createTheme, listThemes, updateTheme } from '../db/themes'
import { assertItem } from '../ipc/services'
import { assertSongInput } from '../ipc/songs'
import { copyIntoMedia, mediaFilePath, mediaUrl, removeMedia } from '../media'
import { readPptx } from '../presentations/pptx'
import { parseText, parseXmlSong } from '../songFiles/formats'
import {
  emptyContents,
  extractFile,
  mapStrings,
  PACKAGE_MEDIA_PREFIX,
  packagePath,
  readPackage,
  writePackage,
  type OpenedPackage,
  type PackageContents,
  type PackageItem,
} from './package'

type Done = Extract<AcceptResult, { status: 'done' }>

/** What to put in a package: a whole service, or library items. */
export type PackageSelection = { serviceId: number } | { songIds: number[]; themeIds: number[]; announcementItemIds: number[] }

const PRESENTATION_EXTENSIONS = ['pptx', 'ppt', 'pdf']
const MAX_PREVIEW_TEXT = 20_000
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Where received presentations and audio are kept: Documents/ServiceEx Received. Presentations stay linked to it. */
export const receivedFolder = () => path.join(app.getPath('documents'), 'ServiceEx Received')

/** A file name in `folder` that is not taken yet: "Name.ext", then "Name 2.ext" and so on. */
export function freeName(folder: string, name: string): string {
  const extension = path.extname(name)
  const base = path.basename(name, extension)
  let candidate = name
  for (let n = 2; existsSync(path.join(folder, candidate)); n++) candidate = `${base} ${n}${extension}`
  return path.join(folder, candidate)
}

// ---------- Building packages ----------

class PackageBuilder {
  readonly contents: PackageContents = emptyContents()
  readonly sources = new Map<string, string>()
  private readonly mediaKeys = new Map<string, number>()
  private readonly themeKeys = new Map<number, number>()
  private readonly songKeys = new Map<number, number>()
  private readonly presentationKeys = new Map<number, number>()

  /**
   * Adds the file behind a wd-media:// URL; a Media library item goes as one, under its library name. Null when
   * it is not a file this computer has.
   */
  media(url: string, fallbackName: string, library: boolean): number | null {
    const row = listMedia().find((m) => m.url === url)
    const name = row?.name ?? fallbackName
    library ||= row !== undefined
    const known = this.mediaKeys.get(url)
    if (known !== undefined) {
      if (library) Object.assign(this.contents.media[known], { library: true, name })
      return known
    }
    const file = mediaFilePath(url)
    const extension = file ? extensionOf(file) : ''
    const kind = shareKindOf(`x.${extension}`)
    if (!file || !existsSync(file) || (kind !== 'image' && kind !== 'video')) return null
    const key = this.contents.media.length
    const inPackage = packagePath('media', key, extension)
    this.contents.media.push({ key, name: name.slice(0, 200) || `Media ${key + 1}`, kind, file: inPackage, library })
    this.sources.set(inPackage, file)
    this.mediaKeys.set(url, key)
    return key
  }

  /** Media URLs inside a theme or payload swapped for package keys; files this computer lacks are left out. */
  private withMediaKeys<T>(value: T): T {
    return mapStrings(value, (text) => {
      if (!text.startsWith('wd-media://')) return text
      const key = this.media(text, path.basename(mediaFilePath(text) ?? 'Picture', path.extname(mediaFilePath(text) ?? '')), false)
      return key === null ? '' : `${PACKAGE_MEDIA_PREFIX}${key}`
    })
  }

  theme(id: number | null): number | null {
    if (id === null) return null
    const known = this.themeKeys.get(id)
    if (known !== undefined) return known
    const theme = listThemes().find((t) => t.id === id)
    if (!theme) return null
    const key = this.contents.themes.length
    this.themeKeys.set(id, key)
    this.contents.themes.push({
      key,
      name: theme.name,
      builtin: theme.type === 'builtin',
      style: theme.type === 'builtin' ? null : this.withMediaKeys(theme.style),
    })
    return key
  }

  private backgrounds(deckKey: string): Record<string, number> {
    const result: Record<string, number> = {}
    for (const [index, item] of Object.entries(getSlideBackgrounds(deckKey))) {
      const key = this.media(item.url, item.name, true)
      if (key !== null) result[index] = key
    }
    return result
  }

  song(id: number): number | null {
    const known = this.songKeys.get(id)
    if (known !== undefined) return known
    const song = getSong(id)
    if (!song) return null
    const key = this.contents.songs.length
    this.songKeys.set(id, key)
    this.contents.songs.push({
      key,
      title: song.title,
      author: song.author,
      copyright: song.copyright,
      tags: song.tags,
      arrangement: song.arrangement,
      lyrics: song.lyrics,
      ...(song.formatting && Object.keys(song.formatting).length > 0 ? { formatting: song.formatting } : {}),
      theme: this.theme(song.themeId),
      backgrounds: this.backgrounds(`song:${id}`),
    })
    return key
  }

  libraryMedia(id: number): void {
    const row = getMediaRow(id)
    if (!row) throw new Error('That media item is no longer in the library')
    if (this.media(mediaUrl(row.file), row.name, true) === null) throw new Error(`The file for ${row.name} is missing`)
  }

  /** The original file of a library presentation, when it is still where it was imported from. */
  presentation(id: number): number | null {
    const known = this.presentationKeys.get(id)
    if (known !== undefined) return known
    const record = presentationStore.get(id)
    const extension = record ? extensionOf(record.sourcePath) : ''
    if (!record || !PRESENTATION_EXTENSIONS.includes(extension) || !existsSync(record.sourcePath)) return null
    const key = this.contents.presentations.length
    const inPackage = packagePath('presentations', key, extension)
    this.contents.presentations.push({ key, title: record.title, file: inPackage })
    this.sources.set(inPackage, record.sourcePath)
    this.presentationKeys.set(id, key)
    return key
  }

  private item(item: ServiceItem): PackageItem | null {
    const backgrounds = this.backgrounds(`item:${item.id}`)
    switch (item.type) {
      case 'song': {
        const song = this.song(item.ref_id)
        return song === null ? null : { type: 'song', song, backgrounds }
      }
      case 'scripture':
        return { type: 'scripture', payload: item.payload, backgrounds }
      case 'announcement':
        return { type: 'announcement', payload: item.payload, backgrounds }
      case 'presentation': {
        const pages = item.payload.pages.map((url, index) => this.media(url, `${item.title} ${index + 1}`, false))
        if (pages.some((page) => page === null)) throw new Error(`Some slide pictures of ${item.title} are missing`)
        const presentation = item.payload.presentationId ? this.presentation(item.payload.presentationId) : null
        return { type: 'presentation', title: item.title, pages: pages as number[], presentation, backgrounds }
      }
    }
  }

  service(id: number): string {
    const service = getService(id)
    if (!service) throw new Error('That service no longer exists')
    const items = service.items.map((item) => this.item(item)).filter((item): item is PackageItem => item !== null)
    this.contents.service = { name: service.name, date: service.date, items }
    return service.name
  }

  announcement(itemId: number): string {
    const item = listServices()
      .flatMap((s) => getService(s.id)?.items ?? [])
      .find((i) => i.id === itemId)
    if (!item || item.type !== 'announcement') throw new Error('That announcement is no longer in a schedule')
    this.contents.announcements.push(item.payload)
    return item.title
  }
}

/** Writes a package for the selection to `dest`. Resolves to a name for it, such as the service's. */
export async function buildPackage(selection: PackageSelection, dest: string): Promise<string> {
  const builder = new PackageBuilder()
  let name: string
  if ('serviceId' in selection) {
    name = builder.service(selection.serviceId)
  } else {
    const names: string[] = []
    for (const id of selection.songIds) {
      if (builder.song(id) === null) throw new Error('That song is no longer in the library')
      names.push(getSong(id)?.title ?? 'Song')
    }
    for (const id of selection.themeIds) {
      if (builder.theme(id) === null) throw new Error('That theme no longer exists')
      names.push(listThemes().find((t) => t.id === id)?.name ?? 'Theme')
    }
    for (const id of selection.announcementItemIds) names.push(builder.announcement(id))
    name = names.length === 1 ? names[0] : `${names.length} items`
  }
  await writePackage(dest, builder.contents, builder.sources)
  return name
}

/** Writes library media to send as it is (an image or video file). Resolves to the file and its name. */
export function mediaSource(id: number): { file: string; name: string } {
  const row = getMediaRow(id)
  const file = row ? mediaFilePath(mediaUrl(row.file)) : null
  if (!row || !file || !existsSync(file)) throw new Error('The file for that media item is missing')
  return { file, name: `${safeFileName(row.name)}${path.extname(file).toLowerCase()}` }
}

/** A library presentation's original file, to send as it is. */
export function presentationSource(id: number): { file: string; name: string } {
  const record = presentationStore.get(id)
  if (!record) throw new Error('That presentation is no longer in the library')
  const extension = extensionOf(record.sourcePath)
  if (!PRESENTATION_EXTENSIONS.includes(extension)) throw new Error(`${record.title} is a folder of images; send the images instead`)
  if (!existsSync(record.sourcePath)) throw new Error(`The original of ${record.title} is no longer at ${record.sourcePath}`)
  return { file: record.sourcePath, name: `${safeFileName(record.title)}.${extension}` }
}

// ---------- Conflicts ----------

function packageConflicts(contents: PackageContents): InboxConflict[] {
  const conflicts: InboxConflict[] = []
  const songs = listSongs()
  for (const song of contents.songs) {
    if (songs.some((s) => same(s.title, String(song.title)))) conflicts.push({ key: `song:${song.key}`, what: 'song', name: song.title })
  }
  const custom = listThemes().filter((t) => t.type === 'custom')
  for (const theme of contents.themes) {
    if (!theme.builtin && custom.some((t) => same(t.name, String(theme.name)))) conflicts.push({ key: `theme:${theme.key}`, what: 'theme', name: theme.name })
  }
  const media = listMedia()
  for (const item of contents.media) {
    if (item.library && media.some((m) => m.kind === item.kind && same(m.name, String(item.name)))) conflicts.push({ key: `media:${item.key}`, what: 'media', name: item.name })
  }
  const presentations = presentationStore.list()
  for (const p of contents.presentations) {
    if (presentations.some((r) => same(r.title, String(p.title)))) conflicts.push({ key: `presentation:${p.key}`, what: 'presentation', name: p.title })
  }
  if (contents.service && serviceMatch(contents.service.name, contents.service.date)) {
    conflicts.push({ key: 'service:main', what: 'service', name: contents.service.name })
  }
  return conflicts
}

const serviceMatch = (name: string, date: string | null) => listServices().find((s) => same(s.name, String(name)) && s.date === date)
const mediaMatch = (name: string, kind: 'image' | 'video') => listMedia().find((m) => m.kind === kind && same(m.name, name))
const songMatch = (title: string) => listSongs().find((s) => same(s.title, title))
const presentationMatch = (title: string) => presentationStore.list().find((r) => same(r.title, title))

/** A title and kind for a single received file. */
const baseName = (item: InboxItem) => path.basename(item.name, path.extname(item.name))

/** Songs read from a received .txt or OpenLyrics file. */
async function readSongFile(item: InboxItem, file: string) {
  if (item.size > 5 * 1024 * 1024) throw new Error('A song file can be at most 5 MB')
  const text = (await readFile(file, 'utf8')).replace(/^\uFEFF/, '')
  if (item.kind === 'text') return parseText(text, baseName(item))
  if (!text.trimStart().startsWith('<')) throw new Error(`${item.name} is not an OpenLyrics song`)
  return parseXmlSong(text, baseName(item)).song
}

/** What in a received item clashes with something already here. */
export async function conflictsOf(item: InboxItem, file: string): Promise<InboxConflict[]> {
  switch (item.kind) {
    case 'package':
      return packageConflicts((await readPackage(file)).manifest.contents)
    case 'image':
    case 'video':
      return mediaMatch(baseName(item), item.kind) ? [{ key: 'file', what: 'media', name: baseName(item) }] : []
    case 'presentation':
      return presentationMatch(baseName(item)) ? [{ key: 'file', what: 'presentation', name: baseName(item) }] : []
    case 'text':
    case 'openlyrics': {
      const song = await readSongFile(item, file)
      return songMatch(song.title) ? [{ key: 'file', what: 'song', name: song.title }] : []
    }
    case 'audio':
      return existsSync(path.join(receivedFolder(), item.name)) ? [{ key: 'file', what: 'file', name: item.name }] : []
  }
}

// ---------- Accepting ----------

function done(message: string, changed: Done['changed'], extra: Partial<Done> = {}): Done {
  return { status: 'done', message, presentations: [], serviceId: null, changed, ...extra }
}

/** Saves a copy in the received folder, replacing a file of that name or beside it. */
async function saveReceived(file: string, name: string, choice: ConflictChoice | undefined): Promise<string> {
  await mkdir(receivedFolder(), { recursive: true })
  const dest = choice === 'replace' ? path.join(receivedFolder(), safeFileName(name)) : freeName(receivedFolder(), safeFileName(name))
  await copyFile(file, dest)
  return dest
}

async function addMediaFile(file: string, name: string, kind: 'image' | 'video', choice: ConflictChoice | undefined): Promise<{ id: number; url: string } | null> {
  const existing = mediaMatch(name, kind)
  if (existing && choice === 'skip') return { id: existing.id, url: existing.url }
  const stored = await copyIntoMedia(file)
  if (existing && choice === 'replace') {
    const old = replaceMediaFile(existing.id, stored)
    if (old) {
      await removeMedia(old.file)
      await removeMedia(old.thumb)
    }
    return { id: existing.id, url: mediaUrl(stored) }
  }
  const added = insertMedia(name, kind, stored)
  return { id: added.id, url: added.url }
}

/** Unpacks a .serviceex package into the library and, for a service, the schedule list. */
async function acceptPackage(file: string, opened: OpenedPackage, choices: Record<string, ConflictChoice>, serviceId: number | null): Promise<Done> {
  const { contents } = opened.manifest
  if (contents.announcements.length > 0 && serviceId === null) {
    throw new Error('Open a service in the schedule first; the announcements are added to it.')
  }
  const work = await mkdtemp(path.join(os.tmpdir(), 'serviceex-package-'))
  const changed = new Set<Done['changed'][number]>()
  const summary: string[] = []
  try {
    // Media first: themes, songs and items refer to it.
    const mediaUrls = new Map<number, string>()
    const mediaIds = new Map<number, number>()
    for (const media of contents.media) {
      const kind = media.kind === 'video' ? 'video' : 'image'
      const choice = media.library ? choices[`media:${media.key}`] : undefined
      const existing = media.library ? mediaMatch(String(media.name), kind) : undefined
      if (existing && choice === 'skip') {
        mediaUrls.set(media.key, existing.url)
        mediaIds.set(media.key, existing.id)
        continue
      }
      const temp = path.join(work, `${media.key}.${extensionOf(media.file)}`)
      await extractFile(file, opened, media.file, temp)
      if (media.library) {
        const added = await addMediaFile(temp, String(media.name).slice(0, 200), kind, choice)
        if (added) {
          mediaUrls.set(media.key, added.url)
          mediaIds.set(media.key, added.id)
        }
        changed.add('media')
      } else {
        mediaUrls.set(media.key, mediaUrl(await copyIntoMedia(temp)))
      }
    }
    const withMedia = <T>(value: T): T =>
      mapStrings(value, (text) => (text.startsWith(PACKAGE_MEDIA_PREFIX) ? (mediaUrls.get(Number(text.slice(PACKAGE_MEDIA_PREFIX.length))) ?? '') : text))

    // Themes.
    const themeIds = new Map<number, number>()
    const themes = listThemes()
    for (const theme of contents.themes) {
      const name = String(theme.name).trim().slice(0, 100) || 'Received theme'
      if (theme.builtin) {
        const builtin = themes.find((t) => t.type === 'builtin' && t.name === name)
        if (builtin) themeIds.set(theme.key, builtin.id)
        continue
      }
      const style = normalizeTheme(withMedia(theme.style))
      const existing = themes.find((t) => t.type === 'custom' && same(t.name, name))
      const choice = choices[`theme:${theme.key}`]
      if (existing && choice === 'skip') {
        themeIds.set(theme.key, existing.id)
        continue
      }
      if (existing && choice === 'replace') {
        updateTheme(existing.id, existing.name, style)
        themeIds.set(theme.key, existing.id)
      } else {
        // Kept beside one of the same name (or a built-in one) as "Name 2".
        const taken = new Set(listThemes().map((t) => t.name.toLowerCase()))
        let unique = name
        for (let n = 2; taken.has(unique.toLowerCase()); n++) unique = `${name} ${n}`
        themeIds.set(theme.key, createTheme(unique, style).id)
      }
      changed.add('themes')
    }

    // Songs.
    const songIds = new Map<number, number>()
    let songsAdded = 0
    for (const song of contents.songs) {
      const input = assertSongInput({ ...song, themeId: song.theme === null ? null : (themeIds.get(song.theme) ?? null) })
      const existing = songMatch(input.title)
      const choice = choices[`song:${song.key}`]
      let id: number
      if (existing && choice === 'skip') {
        songIds.set(song.key, existing.id)
        continue
      } else if (existing && choice === 'replace') {
        updateSong(existing.id, input)
        id = existing.id
      } else {
        id = createSong(input).id
      }
      songIds.set(song.key, id)
      songsAdded++
      for (const [index, mediaKey] of Object.entries(song.backgrounds ?? {})) {
        const mediaId = mediaIds.get(mediaKey)
        if (mediaId !== undefined && /^\d+$/.test(index)) setSlideBackground(`song:${id}`, Number(index), mediaId)
      }
    }
    if (songsAdded > 0) {
      changed.add('songs')
      summary.push(`${songsAdded} song${songsAdded === 1 ? '' : 's'}`)
    }

    // Presentation originals, for the renderer to import into the Presentations library.
    const presentations: Done['presentations'] = []
    for (const p of contents.presentations) {
      const title = safeFileName(String(p.title)).slice(0, 100) || 'Presentation'
      const existing = presentationMatch(title)
      const choice = choices[`presentation:${p.key}`]
      if (existing && choice === 'skip') continue
      const temp = path.join(work, `p${p.key}.${extensionOf(p.file)}`)
      await extractFile(file, opened, p.file, temp)
      const saved = await saveReceived(temp, `${title}.${extensionOf(p.file)}`, existing && choice === 'replace' ? 'replace' : undefined)
      presentations.push({ path: saved, replaceId: existing && choice === 'replace' ? existing.id : null })
    }
    if (presentations.length > 0) summary.push(`${presentations.length} presentation${presentations.length === 1 ? '' : 's'}`)

    // The service.
    let newServiceId: number | null = null
    if (contents.service) {
      const name = String(contents.service.name).trim().slice(0, 200) || 'Received service'
      const date = typeof contents.service.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(contents.service.date) ? contents.service.date : null
      const existing = serviceMatch(name, date)
      const choice = choices['service:main']
      if (!(existing && choice === 'skip')) {
        if (existing && choice === 'replace') deleteService(existing.id)
        const service = createService(name, date)
        newServiceId = service.id
        for (const item of contents.service.items) {
          const added = addPackageItem(service.id, item, songIds, mediaUrls)
          if (!added) continue
          for (const [index, mediaKey] of Object.entries(item.backgrounds ?? {})) {
            const mediaId = mediaIds.get(mediaKey)
            if (mediaId !== undefined && /^\d+$/.test(index)) setSlideBackground(`item:${added}`, Number(index), mediaId)
          }
        }
        changed.add('services')
        summary.unshift(`the service ${name}`)
      }
    }

    // Announcements sent on their own go into the open schedule.
    if (contents.announcements.length > 0 && serviceId !== null) {
      for (const payload of contents.announcements) {
        const checked = assertItem('announcement', null, payload)
        addItem(serviceId, checked.type, checked.refId, checked.payload)
      }
      changed.add('schedule')
      summary.push(`${contents.announcements.length} announcement${contents.announcements.length === 1 ? '' : 's'}`)
    }
    if (changed.has('themes')) summary.push('themes')
    if (changed.has('media')) summary.push('media')

    return done(summary.length > 0 ? `Added ${summary.join(', ')}.` : 'Nothing new was added; everything was skipped.', [...changed], {
      presentations,
      serviceId: newServiceId,
    })
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

/** Adds one package item to a service, checked as the renderer's would be. Resolves to its id, or null if skipped. */
function addPackageItem(serviceId: number, item: PackageItem, songIds: Map<number, number>, mediaUrls: Map<number, string>): number | null {
  try {
    if (item.type === 'song') {
      const songId = songIds.get(item.song)
      return songId === undefined ? null : addItem(serviceId, 'song', songId, null).id
    }
    if (item.type === 'presentation') {
      const pages = item.pages.map((key) => mediaUrls.get(key))
      if (pages.some((page) => !page)) return null
      const checked = assertItem('presentation', null, { title: item.title, pages })
      return addItem(serviceId, checked.type, checked.refId, checked.payload).id
    }
    const checked = assertItem(item.type, null, item.payload)
    return addItem(serviceId, checked.type, checked.refId, checked.payload).id
  } catch (error) {
    // One unreadable item does not stop the rest of the service.
    console.error('Skipped a received schedule item', error)
    return null
  }
}

/**
 * Copies a received item into the library, media or schedule. With conflicts it has no choice for, resolves to them
 * instead and changes nothing.
 */
export async function acceptItem(item: InboxItem, file: string, choices: Record<string, ConflictChoice>, serviceId: number | null): Promise<AcceptResult> {
  const conflicts = await conflictsOf(item, file)
  const open = conflicts.filter((c) => !choices[c.key])
  if (open.length > 0) return { status: 'conflicts', conflicts: open }
  const choice = choices.file

  switch (item.kind) {
    case 'package':
      return acceptPackage(file, await readPackage(file), choices, serviceId)
    case 'image':
    case 'video': {
      if (choice === 'skip') return done('Skipped.', [])
      await addMediaFile(file, baseName(item), item.kind, choice)
      return done(`${baseName(item)} is in the Media library.`, ['media'])
    }
    case 'presentation': {
      const existing = presentationMatch(baseName(item))
      if (existing && choice === 'skip') return done('Skipped.', [])
      const saved = await saveReceived(file, item.name, existing && choice === 'replace' ? 'replace' : undefined)
      return done(`${baseName(item)} is being added to Presentations.`, [], {
        presentations: [{ path: saved, replaceId: existing && choice === 'replace' ? existing.id : null }],
      })
    }
    case 'text':
    case 'openlyrics': {
      const input = assertSongInput(await readSongFile(item, file))
      const existing = songMatch(input.title)
      if (existing && choice === 'skip') return done('Skipped.', [])
      if (existing && choice === 'replace') updateSong(existing.id, input)
      else createSong(input)
      return done(`${input.title} is in the Songs library.`, ['songs'])
    }
    case 'audio': {
      if (choice === 'skip') return done('Skipped.', [])
      const saved = await saveReceived(file, item.name, choice)
      return done(`Saved to ${saved}.`, [])
    }
  }
}

// ---------- Previews ----------

/** What is in a received item, read here without running or opening anything. */
export async function previewItem(item: InboxItem, file: string): Promise<InboxPreview> {
  switch (item.kind) {
    case 'image':
    case 'video':
    case 'audio':
      return { kind: item.kind, url: `wd-media://inbox/${item.id}` }
    case 'text':
    case 'openlyrics': {
      try {
        const song = await readSongFile(item, file)
        return { kind: item.kind, text: `${song.title}${song.author ? `\n${song.author}` : ''}\n\n${song.lyrics}`.slice(0, MAX_PREVIEW_TEXT) }
      } catch (error) {
        return { kind: item.kind, text: `This file cannot be read as a song: ${error instanceof Error ? error.message : String(error)}` }
      }
    }
    case 'presentation': {
      if (extensionOf(item.name) !== 'pptx') return { kind: item.kind, text: `${item.name}: accept it to add it to Presentations and see its slides.` }
      if ((await stat(file)).size > 300 * 1024 * 1024) return { kind: item.kind, text: 'Too large to preview here; accept it to see its slides.' }
      try {
        const slides = readPptx(new Uint8Array(await readFile(file)))
        return { kind: item.kind, text: slides.map((slide, i) => `${i + 1}. ${slide.title || slide.text.split('\n')[0] || 'Untitled slide'}`).join('\n') }
      } catch {
        return { kind: item.kind, text: 'This PowerPoint file could not be read.' }
      }
    }
    case 'package': {
      const { contents } = (await readPackage(file)).manifest
      const songTitles = new Map(contents.songs.map((s) => [s.key, String(s.title)]))
      return {
        kind: 'package',
        contents: {
          service: contents.service
            ? {
                name: String(contents.service.name),
                date: contents.service.date,
                items: contents.service.items.map((i) =>
                  i.type === 'song' ? (songTitles.get(i.song) ?? 'Song') : i.type === 'presentation' ? String(i.title) : String(i.payload?.title ?? i.type),
                ),
              }
            : null,
          songs: contents.songs.map((s) => String(s.title)),
          themes: contents.themes.filter((t) => !t.builtin).map((t) => String(t.name)),
          media: contents.media.filter((m) => m.library).map((m) => String(m.name)),
          presentations: contents.presentations.map((p) => String(p.title)),
          announcements: contents.announcements.map((a) => String(a?.title ?? 'Announcement')),
        },
      }
    }
  }
}

/** Whether a received kind is worth auto accepting: announcements need an open schedule, so packages with them wait. */
export async function canAutoAccept(item: InboxItem, file: string): Promise<boolean> {
  if (item.kind !== 'package') return true
  return (await readPackage(file)).manifest.contents.announcements.length === 0
}

