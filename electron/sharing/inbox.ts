// Received items waiting for the operator, in <userData>/sharing/inbox: each file saved as <id>.<ext> under a name
// of our choosing, listed in index.json with the sender and the name it was sent with. Nothing here opens or runs
// a file, and nothing touches Electron.

import { existsSync, readFileSync } from 'node:fs'
import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { extensionOf, safeFileName, shareKindOf } from '../../shared/sharing'
import type { InboxItem } from '../../shared/types'
import { randomId } from './crypto'

const isItem = (value: unknown): value is InboxItem => {
  const item = value as Partial<InboxItem> | null
  return (
    typeof item === 'object' &&
    item !== null &&
    typeof item.id === 'string' &&
    /^[0-9a-f]{32}$/.test(item.id) &&
    typeof item.name === 'string' &&
    shareKindOf(item.name) === item.kind &&
    typeof item.size === 'number' &&
    typeof item.senderId === 'string' &&
    typeof item.senderName === 'string' &&
    typeof item.receivedAt === 'string'
  )
}

export class Inbox {
  readonly folder: string
  private items: InboxItem[] = []

  constructor(folder: string) {
    this.folder = folder
    try {
      const stored: unknown = JSON.parse(readFileSync(this.indexFile, 'utf8'))
      // Entries whose file has gone are dropped.
      this.items = (Array.isArray(stored) ? stored : []).filter((item): item is InboxItem => isItem(item) && existsSync(this.filePath(item)))
    } catch {
      this.items = []
    }
  }

  private get indexFile() {
    return path.join(this.folder, 'index.json')
  }

  /** Where partial transfers are kept until they are complete. */
  get partialFolder() {
    return path.join(this.folder, 'partial')
  }

  list(): InboxItem[] {
    return [...this.items]
  }

  get(id: string): InboxItem | undefined {
    return this.items.find((item) => item.id === id)
  }

  filePath(item: InboxItem): string {
    return path.join(this.folder, `${item.id}.${extensionOf(item.name)}`)
  }

  /** Moves (or with `copy`, copies) a complete file in. Its type must be allowed. */
  async add(source: string, name: string, size: number, sender: { id: string; name: string }, copy = false): Promise<InboxItem> {
    const clean = safeFileName(name)
    const kind = shareKindOf(clean)
    if (!kind) throw new Error(`${clean} is not a type that can be shared`)
    const item: InboxItem = { id: randomId(), senderId: sender.id, senderName: sender.name, name: clean, size, kind, receivedAt: new Date().toISOString() }
    await mkdir(this.folder, { recursive: true })
    if (copy) await copyFile(source, this.filePath(item))
    else await rename(source, this.filePath(item))
    this.items.unshift(item)
    await this.save()
    return item
  }

  /** Takes an item out of the Inbox and deletes its file. */
  async remove(id: string): Promise<void> {
    const item = this.get(id)
    if (!item) return
    this.items = this.items.filter((i) => i.id !== id)
    await this.save()
    await rm(this.filePath(item), { force: true })
  }

  private async save(): Promise<void> {
    await mkdir(this.folder, { recursive: true })
    const temp = `${this.indexFile}.tmp`
    await writeFile(temp, JSON.stringify(this.items, null, 2))
    await rename(temp, this.indexFile)
  }
}
