// whisper.cpp models for the offline engine: which exist, which suits this computer, and downloading them into
// <userData>/whisper-models. Each download is checked against the published size and SHA-256 before it is kept.

import { app, net } from 'electron'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, rename, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { WhisperModelId, WhisperModelInfo, WhisperProgress } from '../../shared/types'

interface ModelSpec {
  id: WhisperModelId
  label: string
  description: string
  sizeBytes: number
  sha256: string
}

/** Smallest first. Sizes and hashes are those Hugging Face publishes for ggerganov/whisper.cpp. */
export const WHISPER_MODELS: ModelSpec[] = [
  {
    id: 'tiny.en',
    label: 'Tiny (English)',
    description: 'Fastest and least accurate. For older or low-powered computers.',
    sizeBytes: 77_704_715,
    sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
  },
  {
    id: 'base.en',
    label: 'Base (English)',
    description: 'Fast, good accuracy. Runs on most computers.',
    sizeBytes: 147_964_211,
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
  },
  {
    id: 'small.en',
    label: 'Small (English)',
    description: 'Clearly more accurate, needs a capable computer.',
    sizeBytes: 487_614_201,
    sha256: 'c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d',
  },
  {
    id: 'small',
    label: 'Small (multilingual)',
    description: 'Same size as Small (English), trained on many languages. Often better with strongly accented English.',
    sizeBytes: 487_601_967,
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
  },
]

const modelUrl = (id: WhisperModelId) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${id}.bin`

export const modelsFolder = () => path.join(app.getPath('userData'), 'whisper-models')
export const modelPath = (id: WhisperModelId) => path.join(modelsFolder(), `ggml-${id}.bin`)
const specOf = (id: WhisperModelId) => WHISPER_MODELS.find((m) => m.id === id)

export function isWhisperModelId(value: unknown): value is WhisperModelId {
  return WHISPER_MODELS.some((m) => m.id === value)
}

/** A finished download has exactly the published size (its hash was checked when it was saved). */
export function isDownloaded(id: WhisperModelId): boolean {
  const file = modelPath(id)
  return existsSync(file) && statSync(file).size === specOf(id)?.sizeBytes
}

/** The next smaller model, to suggest when one falls behind. The multilingual small steps down to base.en too. */
export function smallerModel(id: WhisperModelId): WhisperModelId | null {
  if (id === 'small' || id === 'small.en') return 'base.en'
  if (id === 'base.en') return 'tiny.en'
  return null
}

const downloads = new Map<WhisperModelId, { controller: AbortController; received: number }>()

export function modelInfos(): WhisperModelInfo[] {
  return WHISPER_MODELS.map(({ id, label, description, sizeBytes }) => ({
    id,
    label,
    description,
    sizeBytes,
    downloaded: isDownloaded(id),
    receivedBytes: downloads.get(id)?.received ?? null,
  }))
}

/** A model for this computer from its memory, cores and chip. The measured speed on first use has the final say. */
export function recommendModel(): { id: WhisperModelId; reason: string; summary: string } {
  const memoryGb = Math.round(os.totalmem() / 2 ** 30)
  const cores = os.cpus().length
  const cpu = os.cpus()[0]?.model.trim() ?? 'Unknown processor'
  const appleSilicon = process.platform === 'darwin' && process.arch === 'arm64'
  const summary = `${cpu}, ${cores} cores, ${memoryGb} GB memory`
  if (memoryGb < 4 || cores <= 2) {
    return { id: 'tiny.en', reason: 'This computer has little memory or few cores, so the smallest model is safest.', summary }
  }
  if (appleSilicon && memoryGb >= 8) {
    return { id: 'small.en', reason: 'Apple Silicon runs whisper on its GPU, so Small keeps up comfortably.', summary }
  }
  if (cores >= 12 && memoryGb >= 16) {
    return { id: 'small.en', reason: 'Plenty of cores and memory for the more accurate Small model.', summary }
  }
  return { id: 'base.en', reason: 'Base keeps up on most computers without a fast GPU.', summary }
}

/**
 * Downloads a model to a .part file, hashing as it goes, and keeps it only if the size and SHA-256 match.
 * Never blocks: the body is streamed to disk.
 */
export async function downloadModel(id: WhisperModelId, onProgress: (progress: WhisperProgress) => void): Promise<void> {
  const spec = specOf(id)
  if (!spec) throw new Error('Unknown model')
  if (downloads.has(id)) throw new Error('That model is already downloading.')
  const controller = new AbortController()
  const state = { controller, received: 0 }
  downloads.set(id, state)
  await mkdir(modelsFolder(), { recursive: true })
  const part = `${modelPath(id)}.part`
  let writeError: Error | null = null
  try {
    const response = await net.fetch(modelUrl(id), { signal: controller.signal })
    if (!response.ok || !response.body) throw new Error(`The download failed (HTTP ${response.status}).`)
    const hash = createHash('sha256')
    const file = createWriteStream(part)
    // A disk error (full, or no permission) stops the download instead of going unhandled.
    file.on('error', (error) => {
      writeError = error
      controller.abort()
    })
    let lastReport = 0
    const reader = response.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        hash.update(value)
        state.received += value.byteLength
        if (state.received > spec.sizeBytes) throw new Error('The download is larger than expected.')
        // Respect back-pressure so a fast connection does not pile the file up in memory.
        if (!file.write(value)) await new Promise<void>((resolve) => file.once('drain', () => resolve()))
        if (Date.now() - lastReport > 250) {
          lastReport = Date.now()
          onProgress({ id, receivedBytes: state.received, totalBytes: spec.sizeBytes })
        }
      }
    } finally {
      await new Promise<void>((resolve) => file.end(() => resolve()))
    }
    if (state.received !== spec.sizeBytes) throw new Error('The download was incomplete. Try again.')
    if (hash.digest('hex') !== spec.sha256) throw new Error('The downloaded file failed its integrity check. Try again.')
    await rename(part, modelPath(id))
    onProgress({ id, receivedBytes: state.received, totalBytes: spec.sizeBytes, finished: { ok: true } })
  } catch (error) {
    await rm(part, { force: true })
    const cancelled = controller.signal.aborted && !writeError
    const message = writeError
      ? `Could not save the model: ${(writeError as Error).message}`
      : cancelled
        ? 'Download cancelled.'
        : error instanceof Error
          ? error.message
          : String(error)
    onProgress({ id, receivedBytes: state.received, totalBytes: spec.sizeBytes, finished: { ok: false, message, cancelled } })
    throw new Error(message)
  } finally {
    downloads.delete(id)
  }
}

export function cancelDownload(id: WhisperModelId): void {
  downloads.get(id)?.controller.abort()
}

export async function deleteModel(id: WhisperModelId): Promise<void> {
  cancelDownload(id)
  await rm(modelPath(id), { force: true })
}
