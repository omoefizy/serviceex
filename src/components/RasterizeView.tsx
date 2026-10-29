import { useEffect } from 'react'
import { drawPdfSlides, fitImageSlides } from '../lib/media'

/**
 * The hidden window that draws presentation slides for the main process: PDF pages with pdf.js, and images fitted
 * onto a black 1920x1080 slide. Jobs run one at a time; each page goes back as a thumbnail first, then as a PNG,
 * as soon as it is drawn. A job can be cancelled, and a page wanted sooner is drawn next.
 */
export function RasterizeView() {
  useEffect(() => {
    const api = window.api.rasterizer
    let queue = Promise.resolve()
    const controllers = new Map<number, AbortController>()
    const wants = new Map<number, (index: number) => void>()
    const offCancel = api.onCancel((id) => controllers.get(id)?.abort())
    const offWant = api.onWant((id, index) => wants.get(id)?.(index))
    const offJob = api.onJob((job) => {
      const controller = new AbortController()
      controllers.set(job.id, controller)
      queue = queue.then(async () => {
        const drawing = {
          signal: controller.signal,
          onThumb: (index: number, total: number, jpeg: Uint8Array, text: string) => api.thumb(job.id, index, total, jpeg, text),
          onPage: (index: number, total: number, png: Uint8Array) => api.page(job.id, index, total, png),
          setWant: (want: (index: number) => void) => wants.set(job.id, want),
        }
        try {
          if (controller.signal.aborted) return
          if (job.kind === 'pdf') await drawPdfSlides(job.data, drawing)
          else await fitImageSlides(job.images, drawing)
          if (!controller.signal.aborted) api.done(job.id)
        } catch (err) {
          if (!controller.signal.aborted) api.fail(job.id, err instanceof Error ? err.message : String(err))
        } finally {
          controllers.delete(job.id)
          wants.delete(job.id)
        }
      })
    })
    api.ready()
    return () => {
      offJob()
      offCancel()
      offWant()
    }
  }, [])

  return null
}
