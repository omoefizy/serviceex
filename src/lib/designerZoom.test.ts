import { describe, expect, it } from 'vitest'
import { canvasSize, clampPan, fitScale, panToKeep, readZoomMode, scaleOf, zoomKey } from './designerZoom'

describe('designer zoom', () => {
  it('fits the 16:9 canvas to the tighter side of the area', () => {
    expect(fitScale({ width: 960, height: 1000 })).toBe(0.5)
    expect(fitScale({ width: 3000, height: 540 })).toBe(0.5)
    expect(fitScale({ width: 0, height: 540 })).toBe(0)
  })

  it('draws a set zoom at that scale, whatever the area', () => {
    expect(scaleOf({ mode: 'zoom', zoom: 2 }, { width: 100, height: 100 })).toBe(2)
    expect(scaleOf({ mode: 'fit' }, { width: 960, height: 540 })).toBe(0.5)
  })

  it('keeps the canvas exactly 16:9', () => {
    const { width, height } = canvasSize(0.3771)
    expect(height).toBe(Math.round((width * 9) / 16))
  })

  it('keeps the point under the pointer still while zooming', () => {
    const pan = { x: 10, y: -20 }
    const at = { x: 100, y: 50 }
    const next = panToKeep(pan, at, 1, 2)
    // That point was 90 px right of the canvas centre at 1x; at 2x it is 180 px right, still under the pointer.
    expect(at.x - next.x).toBe((at.x - pan.x) * 2)
    expect(at.y - next.y).toBe((at.y - pan.y) * 2)
  })

  it('cannot pan the canvas out of reach', () => {
    const pan = clampPan({ x: 99999, y: -99999 }, { width: 1000, height: 562 }, { width: 800, height: 600 })
    expect(pan.x).toBe((1000 + 800) / 2 - 48)
    expect(pan.y).toBe(-((562 + 600) / 2 - 48))
  })

  it('reads a stored zoom mode, falling back to Fit', () => {
    expect(readZoomMode({ mode: 'zoom', zoom: 2 })).toEqual({ mode: 'zoom', zoom: 2 })
    expect(readZoomMode({ mode: 'zoom', zoom: 99 })).toEqual({ mode: 'zoom', zoom: 4 })
    expect(readZoomMode({ mode: 'zoom' })).toEqual({ mode: 'fit' })
    expect(readZoomMode('nonsense')).toEqual({ mode: 'fit' })
    expect(zoomKey(7)).toBe('designer.zoom.7')
    expect(zoomKey(null)).toBe('designer.zoom.new')
  })
})
