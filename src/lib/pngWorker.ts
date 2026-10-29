// Encodes a slide picture as a PNG off the rasterizer window's main thread. PNG encoding a 1920x1080 slide takes
// far longer than drawing it, so a few of these run side by side.

self.onmessage = async (event: MessageEvent<{ id: number; bitmap: ImageBitmap }>) => {
  const { id, bitmap } = event.data
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Canvas is not available')
    context.drawImage(bitmap, 0, 0)
    const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
    self.postMessage({ id, png }, { transfer: [png.buffer] })
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  } finally {
    bitmap.close()
  }
}
