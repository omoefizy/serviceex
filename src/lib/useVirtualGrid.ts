import { useLayoutEffect, useState, type RefObject } from 'react'

/** Decks with more slides than this render only the rows in view. */
export const VIRTUAL_GRID_MIN = 40
/** Rows drawn above and below the visible ones, so scrolling does not show blanks. */
const OVERSCAN_ROWS = 2

export interface GridWindow {
  /** The first and one past the last slide to render. */
  start: number
  end: number
  /**
   * The height of the spacers that stand in for the rows not rendered, in pixels, less the grid gap after or before
   * them (spacers rather than padding, which would stop the grid shrinking to its panel).
   */
  padTop: number
  padBottom: number
  /** Where a slide's row starts and how tall a row is, for scrolling a slide into view. */
  rowTop(index: number): number
  rowHeight: number
}

/**
 * The layout of a grid with repeat(auto-fill, minmax(minWidth, 1fr)) columns of 16:9 cells. `columns` is what the
 * browser laid out, when known; otherwise it is worked out from the widths.
 */
export function gridLayout(count: number, width: number, minWidth: number, gap: number, cellHeight?: number, columns = 0) {
  if (columns < 1) columns = Math.max(1, Math.floor((width + gap) / (minWidth + gap)))
  const columnWidth = (width - gap * (columns - 1)) / columns
  const height = cellHeight ?? (columnWidth * 9) / 16
  return { columns, rows: Math.ceil(count / columns), rowHeight: height + gap }
}

/** Which slides to render for the grid's scroll position, and padding for the rest. */
export function gridWindow(count: number, layout: ReturnType<typeof gridLayout>, scrollTop: number, viewHeight: number, gap = 0): GridWindow {
  const { columns, rows, rowHeight } = layout
  const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN_ROWS)
  const lastRow = Math.min(rows, Math.ceil((scrollTop + viewHeight) / rowHeight) + OVERSCAN_ROWS)
  return {
    start: firstRow * columns,
    end: Math.min(count, lastRow * columns),
    padTop: Math.max(0, firstRow * rowHeight - gap),
    padBottom: Math.max(0, (rows - lastRow) * rowHeight - gap),
    rowTop: (index) => Math.floor(index / columns) * rowHeight,
    rowHeight,
  }
}

/**
 * The part of the element on screen, in its own content's coordinates (scrolled with it): the element clipped by every
 * ancestor that clips or scrolls, and by the window, since a layout may scroll a parent rather than the grid itself.
 */
function visibleSpan(el: HTMLElement): { top: number; height: number } {
  const rect = el.getBoundingClientRect()
  let top = Math.max(rect.top, 0)
  let bottom = Math.min(rect.bottom, window.innerHeight)
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    if (getComputedStyle(parent).overflowY === 'visible') continue
    const clip = parent.getBoundingClientRect()
    top = Math.max(top, clip.top)
    bottom = Math.min(bottom, clip.bottom)
  }
  return { top: top - rect.top + el.scrollTop, height: Math.max(0, bottom - top) }
}

/**
 * Windowing for the slide grid: with more than VIRTUAL_GRID_MIN slides only the rows in view (and a couple around
 * them) are rendered. Null when every slide renders. The row height comes from a rendered cell, so borders and
 * padding count.
 */
export function useVirtualGrid(ref: RefObject<HTMLElement>, count: number, minWidth: number, enabled: boolean): GridWindow | null {
  const on = enabled && count > VIRTUAL_GRID_MIN
  const [view, setView] = useState({ width: 0, height: 0, scrollTop: 0, gap: 0, cellHeight: 0, columns: 0 })

  useLayoutEffect(() => {
    const el = ref.current
    if (!on || !el) return
    const measure = () => {
      const style = getComputedStyle(el)
      const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const cell = el.querySelector<HTMLElement>('.slide-cell')
      const span = visibleSpan(el)
      setView({
        width: el.clientWidth - padding,
        height: span.height,
        scrollTop: span.top,
        gap: parseFloat(style.rowGap) || 0,
        cellHeight: cell?.offsetHeight ?? 0,
        // The columns the browser made, as other rules can widen the cells past the minimum.
        columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    // The grid or any parent scrolling moves what is visible; the capture phase hears scrolls that do not bubble.
    document.addEventListener('scroll', measure, { passive: true, capture: true })
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      document.removeEventListener('scroll', measure, { capture: true })
      window.removeEventListener('resize', measure)
    }
  }, [ref, on, minWidth])

  if (!on || view.width <= 0) return null
  return gridWindow(count, gridLayout(count, view.width, minWidth, view.gap, view.cellHeight || undefined, view.columns), view.scrollTop, view.height, view.gap)
}
