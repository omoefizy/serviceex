// Dev only: measures the design light effects on a 1920 by 1080 output. It serves the renderer with Vite, opens
// #/fx-bench (a lower third with every effect, on air) in Chromium at 1920 by 1080, and reports, for the page with
// the effects and the same page without them: the CPU each Chromium process used (browser, renderer, GPU), as a
// percentage of one core, and how many times a second the effect clock ticked. Results go to docs/fx-bench.json too.
//
//   node scripts/fx-bench.ts            10 seconds a run
//   node scripts/fx-bench.ts --seconds 30
//   node scripts/fx-bench.ts --headed      in a window, on the real GPU (headless Chromium draws with SwiftShader, a
//                                          software GPU, so its GPU process figure is far higher than on a projector)
//
// Runs with Node's built-in TypeScript support (Node 22.18 or later).

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, type Browser } from 'playwright'
import { createServer } from 'vite'
import react from '@vitejs/plugin-react'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const at = process.argv.indexOf('--seconds')
const SECONDS = at > 0 ? Number(process.argv[at + 1]) || 10 : 10
const HEADED = process.argv.includes('--headed')

interface ProcessInfo {
  type: string
  id: number
  cpuTime: number
}

/** Each Chromium process's CPU seconds so far. */
async function cpuTimes(browser: Browser): Promise<ProcessInfo[]> {
  const session = await browser.newBrowserCDPSession()
  const { processInfo } = (await session.send('SystemInfo.getProcessInfo')) as { processInfo: ProcessInfo[] }
  await session.detach()
  return processInfo
}

/** CPU by process type, in percent of one core, over `seconds`. */
function usage(before: ProcessInfo[], after: ProcessInfo[], seconds: number): Record<string, number> {
  const result: Record<string, number> = {}
  for (const p of after) {
    const was = before.find((b) => b.id === p.id)?.cpuTime ?? 0
    result[p.type] = Math.round(((result[p.type] ?? 0) + ((p.cpuTime - was) / seconds) * 100) * 10) / 10
  }
  return result
}

async function measure(browser: Browser, url: string) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  page.on('pageerror', (error) => console.warn('  page:', error.message))
  await page.goto(url)
  await page.waitForSelector('.design-view')
  // Settled: fonts in, the first passes under way.
  await page.waitForTimeout(2000)
  const renderer = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl')
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    return info && gl ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown'
  })
  const ticks = () => page.evaluate(() => (window as unknown as { __fxStats?: () => { ticks: number; playing: number } }).__fxStats?.() ?? { ticks: 0, playing: 0 })
  const startTicks = await ticks()
  const before = await cpuTimes(browser)
  await page.waitForTimeout(SECONDS * 1000)
  const after = await cpuTimes(browser)
  const endTicks = await ticks()
  await page.close()
  return {
    cpu: usage(before, after, SECONDS),
    fps: Math.round(((endTicks.ticks - startTicks.ticks) / SECONDS) * 10) / 10,
    effectsPlaying: endTicks.playing,
    renderer,
  }
}

const server = await createServer({ root: ROOT, configFile: false, plugins: [react()], logLevel: 'warn', server: { port: 5297 } })
await server.listen()
const url = server.resolvedUrls!.local[0]
const browser = await chromium.launch({ headless: !HEADED, args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] })
try {
  console.log(`Light effects at 1920 by 1080, ${SECONDS} s a run`)
  const baseline = await measure(browser, `${url}#/fx-bench?off`)
  const effects = await measure(browser, `${url}#/fx-bench`)
  const total = (r: Record<string, number>) => Math.round(Object.values(r).reduce((a, b) => a + b, 0) * 10) / 10
  const rows = [
    ['', 'renderer', 'GPU', 'browser', 'all', 'clock fps', 'effects'],
    ['without effects', baseline.cpu.renderer ?? 0, baseline.cpu.GPU ?? 0, baseline.cpu.browser ?? 0, total(baseline.cpu), baseline.fps, baseline.effectsPlaying],
    ['with all six', effects.cpu.renderer ?? 0, effects.cpu.GPU ?? 0, effects.cpu.browser ?? 0, total(effects.cpu), effects.fps, effects.effectsPlaying],
  ]
  for (const row of rows) console.log(row.map((c, i) => String(c).padEnd(i === 0 ? 18 : 10)).join(''))
  console.log(`CPU in percent of one core. Graphics: ${effects.renderer}`)
  mkdirSync(path.join(ROOT, 'docs'), { recursive: true })
  writeFileSync(path.join(ROOT, 'docs', 'fx-bench.json'), `${JSON.stringify({ seconds: SECONDS, viewport: '1920x1080', headed: HEADED, baseline, effects }, null, 2)}\n`)
} finally {
  await browser.close()
  await server.close()
}
