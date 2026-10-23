// Watches linked presentation files for saves. It watches each file's folder rather than the file itself: PowerPoint
// and most editors save atomically, writing a temporary file and renaming it over the original, which replaces the
// file a direct watch would follow. PowerPoint's lock files (~$name.pptx) are ignored.

import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'

/** Paths compare without case where the file system usually ignores it. */
export function samePathKey(file: string): string {
  const resolved = path.resolve(file)
  return process.platform === 'win32' || process.platform === 'darwin' ? resolved.toLowerCase() : resolved
}

const isLockFile = (file: string) => path.basename(file).startsWith('~$')

export interface SourceWatcher {
  /** Watches exactly these files from now on. */
  setFiles(files: string[]): void
  close(): Promise<void>
}

/**
 * Calls `onChange` with a watched file's path once it has been quiet for `debounceMs` after being written, created
 * or replaced. Deleting it alone does not count; an atomic save's rename brings it back as a new file.
 */
export function watchSources(onChange: (file: string) => void, debounceMs = 1500): SourceWatcher {
  /** Watched files by key, to the path as given. */
  let files = new Map<string, string>()
  let folders = new Set<string>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()

  const watcher: FSWatcher = watch([], {
    ignoreInitial: true,
    depth: 0,
    // Folds an unlink followed quickly by an add of the same file (an atomic save) into one change.
    atomic: true,
    ignored: (file) => isLockFile(file),
  })

  watcher.on('all', (event, changed) => {
    if (event !== 'add' && event !== 'change') return
    const key = samePathKey(changed)
    const file = files.get(key)
    if (!file) return
    clearTimeout(timers.get(key))
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key)
        onChange(file)
      }, debounceMs),
    )
  })
  watcher.on('error', (error) => console.error('Presentation watcher:', error))

  return {
    setFiles(list) {
      files = new Map(list.map((file) => [samePathKey(file), path.resolve(file)]))
      const wanted = new Set([...files.values()].map((file) => path.dirname(file)))
      const added = [...wanted].filter((folder) => !folders.has(folder))
      const removed = [...folders].filter((folder) => !wanted.has(folder))
      if (removed.length > 0) watcher.unwatch(removed)
      if (added.length > 0) watcher.add(added)
      folders = wanted
      for (const [key, timer] of timers) {
        if (!files.has(key)) {
          clearTimeout(timer)
          timers.delete(key)
        }
      }
    },
    async close() {
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      await watcher.close()
    },
  }
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Resolves once the file exists, can be opened and read, and its size and time stay the same for a moment: the
 * saving app has finished and let go of it. Throws after `timeoutMs`.
 */
export async function waitUntilReadable(file: string, timeoutMs = 30_000, pollMs = 250): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  for (;;) {
    try {
      const info = await stat(file)
      const handle = await open(file, 'r')
      try {
        await handle.read(Buffer.alloc(1), 0, 1, 0)
      } finally {
        await handle.close()
      }
      const now = `${info.size}:${info.mtimeMs}`
      if (info.size > 0 && now === last) return
      last = now
    } catch (error) {
      // Still being written or swapped in (ENOENT between the unlink and the rename, EBUSY or EPERM on Windows).
      last = ''
      if (Date.now() >= deadline) throw error
    }
    if (Date.now() >= deadline) throw new Error(`${path.basename(file)} is still being written`)
    await delay(pollMs)
  }
}
