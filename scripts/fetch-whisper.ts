// Puts whisper.cpp's whisper-server, which the offline sermon listener runs as a child process, into
// vendor/whisper/<os>-<arch>/. The app runs it from there in development, and electron-builder copies that folder
// into the packaged app's resources.
//
//   npm run fetch:whisper
//
// macOS: builds from source (needs the Xcode Command Line Tools and cmake, for example `brew install cmake`).
// Windows: downloads the prebuilt CPU binaries from the same whisper.cpp release.
// Both are pinned to one build and checked against a SHA-256 before use.
//
// Runs with Node's built-in TypeScript support (Node 22.18 or later).

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BUILD = 'b5454'
const SOURCE = {
  url: `https://github.com/ggml-org/whisper.cpp/archive/refs/tags/${BUILD}.tar.gz`,
  sha256: '9aa617f410d9c7f0dae952eb2b77eafdcfb310c2d622cca1f83633fd89a213bc',
}
const WINDOWS: Record<string, { url: string; sha256: string }> = {
  x64: {
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${BUILD}/whisper-bin-x64.zip`,
    sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
  },
  arm64: {
    url: `https://github.com/ggml-org/whisper.cpp/releases/download/${BUILD}/whisper-bin-win-cpu-arm64.zip`,
    sha256: '28c37e7b598c3d9bbfef94f3bd67f2ee6f12b7c86f3da5edcf5e4308d615ff6d',
  },
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
/** electron-builder's ${os} names, so its extraResources pattern finds the folder. */
const OS_NAMES: Partial<Record<NodeJS.Platform, string>> = { darwin: 'mac', win32: 'win', linux: 'linux' }
const arch = process.arch
const outDir = path.join(ROOT, 'vendor', 'whisper', `${OS_NAMES[process.platform]}-${arch}`)

async function download(url: string, sha256: string, file: string): Promise<void> {
  console.log(`Downloading ${url}`)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(data).digest('hex')
  if (actual !== sha256) throw new Error(`Checksum mismatch for ${url}: expected ${sha256}, got ${actual}`)
  writeFileSync(file, data)
}

function run(command: string, args: string[], cwd: string): void {
  execFileSync(command, args, { cwd, stdio: 'inherit' })
}

async function buildOnMac(work: string): Promise<void> {
  const cmake = process.env.CMAKE ?? 'cmake'
  try {
    execFileSync(cmake, ['--version'], { stdio: 'ignore' })
  } catch {
    throw new Error('cmake was not found. Install it (for example `brew install cmake`) or set CMAKE to its path.')
  }
  const tarball = path.join(work, 'source.tar.gz')
  await download(SOURCE.url, SOURCE.sha256, tarball)
  run('tar', ['-xzf', tarball], work)
  const source = path.join(work, `whisper.cpp-${BUILD}`)
  // A static, self-contained binary. Not tuned to this machine (GGML_NATIVE off) so it runs on every Mac of this
  // architecture: armv8.2 with dotprod and fp16 covers all Apple Silicon; AVX2 covers Intel Macs from 2013 on.
  const cpu =
    arch === 'arm64'
      ? ['-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16']
      : ['-DGGML_AVX=ON', '-DGGML_AVX2=ON', '-DGGML_FMA=ON', '-DGGML_F16C=ON']
  run(
    cmake,
    [
      '-B',
      'build',
      '-DCMAKE_BUILD_TYPE=Release',
      `-DCMAKE_OSX_ARCHITECTURES=${arch === 'arm64' ? 'arm64' : 'x86_64'}`,
      '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0',
      '-DBUILD_SHARED_LIBS=OFF',
      '-DGGML_NATIVE=OFF',
      '-DGGML_METAL=ON',
      '-DGGML_METAL_EMBED_LIBRARY=ON',
      '-DWHISPER_BUILD_TESTS=OFF',
      '-DWHISPER_SDL2=OFF',
      ...cpu,
    ],
    source,
  )
  run(cmake, ['--build', 'build', '--config', 'Release', '--target', 'whisper-server', '-j', String(os.cpus().length)], source)
  cpSync(path.join(source, 'build', 'bin', 'whisper-server'), path.join(outDir, 'whisper-server'))
}

async function fetchForWindows(work: string): Promise<void> {
  const release = WINDOWS[arch]
  if (!release) throw new Error(`No prebuilt whisper.cpp for Windows on ${arch}`)
  const zip = path.join(work, 'whisper.zip')
  await download(release.url, release.sha256, zip)
  // Windows 10 and later ship bsdtar, which reads zip files.
  run('tar', ['-xf', zip], work)
  const bin = path.join(work, 'Release')
  // The server and the DLLs it loads (ggml picks the CPU variant DLL that suits the machine at run time).
  for (const name of readdirSync(bin)) {
    if (name === 'whisper-server.exe' || name.toLowerCase().endsWith('.dll')) cpSync(path.join(bin, name), path.join(outDir, name))
  }
}

async function main(): Promise<void> {
  if (!OS_NAMES[process.platform]) throw new Error(`Unsupported platform ${process.platform}`)
  const work = mkdtempSync(path.join(os.tmpdir(), 'whisper-'))
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  try {
    if (process.platform === 'darwin') await buildOnMac(work)
    else if (process.platform === 'win32') await fetchForWindows(work)
    else throw new Error('Linux: build whisper-server from source and put it in ' + outDir)
    writeFileSync(path.join(outDir, 'VERSION'), `whisper.cpp ${BUILD}\n`)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  if (!existsSync(path.join(outDir, process.platform === 'win32' ? 'whisper-server.exe' : 'whisper-server'))) {
    throw new Error('whisper-server was not produced')
  }
  console.log(`whisper-server is ready in ${path.relative(ROOT, outDir)}`)
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
