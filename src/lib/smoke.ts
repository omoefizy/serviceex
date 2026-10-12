// Slow drifting smoke for the 'smoke' theme background, drawn from value noise on a small canvas that the browser
// scales up smoothly. Nothing is loaded: every frame is computed here.
//
// Every animated canvas with the same colours shares one frame, drawn once per tick, so a grid of slides and the
// previews cost the same as one. Thumbnails draw a single cached frame.

/** The frame size; the canvas is scaled up to fill the slide, which softens it into smoke. */
export const SMOKE_WIDTH = 96
export const SMOKE_HEIGHT = 54
/** About 15 frames a second is plenty for motion this slow. */
const FRAME_MS = 66
/** The moment thumbnails show. */
const STILL_TIME = 40

function hash(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function noise(x: number, y: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const xf = x - xi
  const yf = y - yi
  const u = xf * xf * (3 - 2 * xf)
  const v = yf * yf * (3 - 2 * yf)
  const a = hash(xi, yi)
  const b = hash(xi + 1, yi)
  const c = hash(xi, yi + 1)
  const d = hash(xi + 1, yi + 1)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Four octaves of noise, from about 0 to 0.94. */
function fbm(x: number, y: number): number {
  let sum = 0
  let amplitude = 0.5
  for (let octave = 0; octave < 4; octave++) {
    sum += amplitude * noise(x, y)
    x = x * 2.03 + 17.1
    y = y * 2.03 + 9.7
    amplitude *= 0.5
  }
  return sum
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Draws the smoke at time `t` (seconds) into `image`: the base colour, wisps of the smoke colour, darker edges. */
function render(image: ImageData, base: string, smoke: string, t: number): void {
  const [br, bg, bb] = rgb(base)
  const [sr, sg, sb] = rgb(smoke)
  const { data, width, height } = image
  const scale = 2.4 / height
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const nx = x * scale
      const ny = y * scale
      // Domain warping turns round blobs into curling wisps; the time terms make them drift.
      const qx = fbm(nx + t * 0.045, ny - t * 0.02)
      const qy = fbm(nx + 5.2 - t * 0.03, ny + 1.3 + t * 0.025)
      const n = fbm(nx + 1.9 * qx - t * 0.015, ny + 1.9 * qy)
      const s = Math.min(1, Math.max(0, (n - 0.38) / 0.4))
      const amount = s * s * (3 - 2 * s) * 0.5
      const dx = x / width - 0.5
      const dy = y / height - 0.5
      const vignette = 1 - Math.min(0.55, (dx * dx + dy * dy) * 1.3)
      const i = (y * width + x) * 4
      data[i] = (br + (sr - br) * amount) * vignette
      data[i + 1] = (bg + (sg - bg) * amount) * vignette
      data[i + 2] = (bb + (sb - bb) * amount) * vignette
      data[i + 3] = 255
    }
  }
}

const newImage = () => new ImageData(SMOKE_WIDTH, SMOKE_HEIGHT)

const stills = new Map<string, ImageData>()

/** Draws one fixed frame, for thumbnails. */
export function drawStillSmoke(canvas: HTMLCanvasElement, base: string, smoke: string): void {
  const key = `${base}:${smoke}`
  let image = stills.get(key)
  if (!image) {
    image = newImage()
    render(image, base, smoke, STILL_TIME)
    stills.set(key, image)
  }
  canvas.getContext('2d')?.putImageData(image, 0, 0)
}

interface Loop {
  image: ImageData
  canvases: Set<HTMLCanvasElement>
  frame: number
  last: number
}

const loops = new Map<string, Loop>()
const started = performance.now()

/** Keeps the canvas showing moving smoke until the returned function is called. */
export function animateSmoke(canvas: HTMLCanvasElement, base: string, smoke: string): () => void {
  const key = `${base}:${smoke}`
  let loop = loops.get(key)
  if (!loop) {
    const created: Loop = { image: newImage(), canvases: new Set(), frame: 0, last: -Infinity }
    const tick = (now: number) => {
      if (now - created.last >= FRAME_MS) {
        created.last = now
        render(created.image, base, smoke, STILL_TIME + (now - started) / 1000)
        for (const target of created.canvases) target.getContext('2d')?.putImageData(created.image, 0, 0)
      }
      created.frame = requestAnimationFrame(tick)
    }
    created.frame = requestAnimationFrame(tick)
    loops.set(key, created)
    loop = created
  }
  loop.canvases.add(canvas)
  // Show the latest frame straight away rather than an empty canvas until the next tick.
  if (loop.last > -Infinity) canvas.getContext('2d')?.putImageData(loop.image, 0, 0)
  else drawStillSmoke(canvas, base, smoke)
  const current = loop
  return () => {
    current.canvases.delete(canvas)
    if (current.canvases.size === 0) {
      cancelAnimationFrame(current.frame)
      loops.delete(key)
    }
  }
}
