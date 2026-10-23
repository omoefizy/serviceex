import { useEffect } from 'react'
import { drawPdfSlides, fitImageSlide } from '../lib/media'

/**
 * The hidden window that draws presentation slides for the main process: PDF pages with pdf.js, and images fitted
 * onto a black 1920x1080 slide. Jobs run one at a time; each page goes back as a PNG as soon as it is drawn.
 */
export function RasterizeView() {
  useEffect(() => {
    const api = window.api.rasterizer
    let queue = Promise.resolve()
    const off = api.onJob((job) => {
      queue = queue.then(async () => {
        try {
          if (job.kind === 'pdf') {
            await drawPdfSlides(job.data, (index, total, png, text) => api.page(job.id, index, total, png, text))
          } else {
            for (const [index, image] of job.images.entries()) {
              api.page(job.id, index, job.images.length, await fitImageSlide(image), '')
            }
          }
          api.done(job.id)
        } catch (err) {
          api.fail(job.id, err instanceof Error ? err.message : String(err))
        }
      })
    })
    api.ready()
    return off
  }, [])

  return null
}
