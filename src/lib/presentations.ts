import type { DragEvent } from 'react'
import { can } from '../../shared/features'
import type { PresentationMode } from '../../shared/types'

/** Whether a drag carries files from outside the app (not a schedule item or a library card). */
export const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files')

/** The paths of dropped files and folders. */
export const droppedPaths = (e: DragEvent) =>
  [...e.dataTransfer.files].map((file) => window.api.presentations.pathForFile(file)).filter(Boolean)

/** Where the Presentations panel keeps how PowerPoint files import, Image or Native mode. */
export const IMPORT_MODE_KEY = 'serviceex.pptxImportMode'

export const isPresentationMode = (value: unknown): value is PresentationMode => value === 'image' || value === 'native'

/**
 * How PowerPoint files import, as chosen in the Presentations panel: Native only when chosen and in the plan. Files
 * from other computers import this way too, so they match a file dropped on the panel.
 */
export function chosenImportMode(): PresentationMode {
  let stored: unknown = null
  try {
    stored = JSON.parse(localStorage.getItem(IMPORT_MODE_KEY) ?? 'null')
  } catch {
    // No storage: Image mode.
  }
  return isPresentationMode(stored) && can('powerpoint.native') ? stored : 'image'
}
