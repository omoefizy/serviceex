// Checks a packaged release before it is uploaded: the installers and update files have the expected names, and each
// packaged app carries the better-sqlite3 binary for its own platform and architecture and can load it.
//
//   node scripts/check-release.ts mac    after `npm run dist:mac`
//   node scripts/check-release.ts win    after `npm run build:win`
//
// better-sqlite3 ships prebuilt N-API binaries for every target and picks one at run time (lib/<platform>-<arch>.js),
// so nothing is compiled. This is the check that the right one shipped and works in Electron, which a rebuild would
// otherwise be for. The load runs the packaged app itself as Node (ELECTRON_RUN_AS_NODE), through its asar, the way
// the app loads it. An architecture the machine cannot run (Intel without Rosetta) gets the file check only.
//
// Runs with Node's built-in TypeScript support (Node 22.18 or later).

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }
const OUT = path.join(ROOT, 'release', version)

interface App {
  arch: 'arm64' | 'x64'
  /** The packaged app's resources folder. */
  resources: string
  /** The executable that runs as Node with ELECTRON_RUN_AS_NODE. */
  executable: string
}

const TARGETS: Record<string, { files: string[]; platform: 'darwin' | 'win32'; apps: App[] }> = {
  mac: {
    platform: 'darwin',
    files: [
      `ServiceEx-Mac-${version}-arm64.dmg`,
      `ServiceEx-Mac-${version}-x64.dmg`,
      'latest-mac.yml',
    ],
    apps: (['arm64', 'x64'] as const).map((arch) => {
      const app = path.join(OUT, arch === 'x64' ? 'mac' : `mac-${arch}`, 'ServiceEx.app', 'Contents')
      return { arch, resources: path.join(app, 'Resources'), executable: path.join(app, 'MacOS', 'ServiceEx') }
    }),
  },
  win: {
    platform: 'win32',
    files: [`ServiceEx-Windows-${version}-Setup.exe`, 'latest.yml'],
    apps: [{
      arch: 'x64',
      resources: path.join(OUT, 'win-unpacked', 'resources'),
      executable: path.join(OUT, 'win-unpacked', 'ServiceEx.exe'),
    }],
  },
}

const target = TARGETS[process.argv[2] ?? '']
if (!target) {
  console.error('Usage: node scripts/check-release.ts mac|win')
  process.exit(2)
}

const failures: string[] = []

for (const file of target.files) {
  if (existsSync(path.join(OUT, file))) console.log(`ok    ${file}`)
  else failures.push(`missing release/${version}/${file}`)
}

/** Whether this machine can run code for the architecture: natively, or an Intel app through Rosetta on a Mac. */
function canRun(arch: string): boolean {
  if (arch === process.arch) return true
  if (process.platform !== 'darwin' || arch !== 'x64') return false
  try {
    execFileSync('arch', ['-x86_64', '/usr/bin/true'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

for (const app of target.apps) {
  const name = `${target.platform}-${app.arch}`
  const binary = path.join(app.resources, 'app.asar.unpacked', 'node_modules', 'better-sqlite3', 'prebuilds', `${name}.node`)
  if (!existsSync(binary)) {
    failures.push(`missing ${path.relative(ROOT, binary)}`)
    continue
  }
  if (target.platform === 'darwin') {
    const archs = execFileSync('lipo', ['-archs', binary], { encoding: 'utf8' }).trim().split(/\s+/)
    // lipo names Intel x86_64.
    if (!archs.includes(app.arch === 'x64' ? 'x86_64' : app.arch)) {
      failures.push(`${path.relative(ROOT, binary)} is built for ${archs.join(', ')}, not ${app.arch}`)
      continue
    }
  }
  if (!canRun(app.arch)) {
    console.log(`ok    better-sqlite3 ${name} present (this machine cannot run ${app.arch}, so not loaded)`)
    continue
  }
  const loader = path.join(app.resources, 'app.asar', 'node_modules', 'better-sqlite3', 'lib', `${name}.js`)
  const script = `const Database = require(${JSON.stringify(loader)});`
    + `const v = new Database(':memory:').prepare('select sqlite_version() as v').get().v;`
    + `process.stdout.write(v)`
  const command = app.arch === process.arch ? app.executable : 'arch'
  const args = app.arch === process.arch ? ['-e', script] : ['-x86_64', app.executable, '-e', script]
  try {
    const sqlite = execFileSync(command, args, {
      encoding: 'utf8',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      timeout: 60_000,
    })
    console.log(`ok    better-sqlite3 ${name} loads in the packaged app (SQLite ${sqlite})`)
  } catch (error) {
    failures.push(`better-sqlite3 ${name} did not load in the packaged app: ${(error as Error).message}`)
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL  ${failure}`)
  process.exit(1)
}
