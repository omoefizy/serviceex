// Makes the video clips of a .pptx playable on the output for Native mode. Chromium plays MP4 (H.264, HEVC, AV1),
// WebM and Ogg; PowerPoint also embeds WMV, AVI and MPEG, and QuickTime files that may hold codecs Chromium cannot
// play. Those are converted to H.264 MP4 with ffmpeg when it is installed. Nothing is bundled.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'

const CONVERT_TIMEOUT_MS = 600_000
const PROBE_TIMEOUT_MS = 30_000

/** Extensions Chromium plays as they are. */
const PLAYABLE = ['mp4', 'm4v', 'webm', 'ogv', 'ogg']
/** QuickTime files play when their video codec is one of these. */
const PLAYABLE_CODECS = ['h264', 'hevc', 'av1', 'vp8', 'vp9']

/** ffmpeg on PATH, from Homebrew, or in Program Files; an app started from the Dock has no shell PATH. */
export function findFfmpeg(): string | null {
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const candidates = process.env.FFMPEG_PATH ? [process.env.FFMPEG_PATH] : []
  for (const folder of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) candidates.push(path.join(folder, name))
  if (process.platform === 'darwin') candidates.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg')
  if (process.platform === 'win32') {
    for (const root of [process.env.ProgramFiles, process.env.LOCALAPPDATA]) if (root) candidates.push(path.join(root, 'ffmpeg', 'bin', name))
  }
  return candidates.find((file) => existsSync(file)) ?? null
}

/** Runs ffmpeg; resolves to its error output (where it prints what it read), rejecting when it fails. */
function ffmpeg(binary: string, args: string[], timeoutMs: number, allowFailure = false): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, ['-hide_banner', ...args], { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (error && !allowFailure) reject(new Error(String(stderr ?? '').trim().split('\n').slice(-3).join(' ') || error.message))
      else resolve(String(stderr ?? ''))
    })
  })
}

/** The first video stream's codec, such as "h264", or null when ffmpeg finds none. */
export async function videoCodec(binary: string, file: string): Promise<string | null> {
  // With no output file ffmpeg exits with an error after printing the streams, which is all this needs.
  const info = await ffmpeg(binary, ['-i', file], PROBE_TIMEOUT_MS, true)
  return /Stream #\S+.*?: Video: (\w+)/.exec(info)?.[1] ?? null
}

/** Whether a clip needs converting before it plays: by extension, and for QuickTime files by codec when ffmpeg can tell. */
export async function needsConversion(file: string, binary: string | null): Promise<boolean> {
  const extension = path.extname(file).slice(1).toLowerCase()
  if (PLAYABLE.includes(extension)) return false
  if (extension === 'mov' || extension === 'qt') {
    if (!binary) return false // Most QuickTime files hold H.264 or HEVC; without ffmpeg there is no telling.
    const codec = await videoCodec(binary, file)
    return codec === null || !PLAYABLE_CODECS.includes(codec)
  }
  return true
}

/** Converts a clip to H.264 MP4 without sound (it plays muted), sized for the output. */
export async function convertToMp4(binary: string, input: string, output: string): Promise<void> {
  await ffmpeg(
    binary,
    ['-y', '-i', input, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(min(1920\\,iw)/2)*2:-2', '-movflags', '+faststart', output],
    CONVERT_TIMEOUT_MS,
  )
}
