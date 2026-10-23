import type { DragEvent } from 'react'

/** Whether a drag carries files from outside the app (not a schedule item or a library card). */
export const isFileDrag = (e: DragEvent) => e.dataTransfer.types.includes('Files')

/** The paths of dropped files and folders. */
export const droppedPaths = (e: DragEvent) =>
  [...e.dataTransfer.files].map((file) => window.api.presentations.pathForFile(file)).filter(Boolean)
