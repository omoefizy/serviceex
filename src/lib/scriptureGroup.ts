// The tray of passages waiting to be combined into a Scripture group (filled from the Scripture finder and the Heard in
// the sermon cards, shown on the Preview header), and which editor is open on the grid's scripture.

import { create } from 'zustand'
import { MAX_GROUP_PASSAGES } from '../../shared/scriptureGroup'
import type { ScriptureGroup, ScriptureGroupPassage } from '../../shared/types'
import { useOperatorStore } from '../store'

/** What the combine editor is working on: a new group (itemId null) or a Scripture group in the Order of service. */
export interface CombineEditing {
  itemId: number | null
  group: ScriptureGroup
}

interface CombineState {
  /** Passages waiting to be combined, in order; at most four. */
  passages: ScriptureGroupPassage[]
  /** The combine editor, when open. */
  editing: CombineEditing | null
  /** The last group sent to the preview from the editor (not saved anywhere), by its deck title, to edit it again. */
  previewed: { title: string; group: ScriptureGroup } | null
  /** Adds a passage to the tray; false when it is full or already holds it. */
  add(passage: ScriptureGroupPassage): boolean
  remove(index: number): void
  clear(): void
  /** Opens the editor on the tray's passages. */
  openTray(): void
  /** Opens the editor on a group: one in the Order of service (`itemId`), or one only previewed (null). */
  openGroup(group: ScriptureGroup, itemId: number | null): void
  close(): void
}

const samePassage = (a: ScriptureGroupPassage, b: ScriptureGroupPassage) => a.reference === b.reference && a.version === b.version

export const useCombine = create<CombineState>((set, get) => ({
  passages: [],
  editing: null,
  previewed: null,
  add(passage) {
    const { passages } = get()
    if (passages.length >= MAX_GROUP_PASSAGES || passages.some((p) => samePassage(p, passage))) return false
    set({ passages: [...passages, passage] })
    return true
  },
  remove(index) {
    set({ passages: get().passages.filter((_, i) => i !== index) })
  },
  clear() {
    set({ passages: [] })
  },
  openTray() {
    set({ editing: { itemId: null, group: { layout: 'stacked', passages: get().passages } } })
  },
  openGroup(group, itemId) {
    set({ editing: { itemId, group } })
  },
  close() {
    set({ editing: null })
  },
}))

/** The grid slide open in the Edit text editor, by index. */
export const useTextEdit = create<{ index: number | null; open(index: number): void; close(): void }>((set) => ({
  index: null,
  open: (index) => set({ index }),
  close: () => set({ index: null }),
}))

/** The Scripture group in the grid: a group item from the Order of service, or one previewed from the editor. */
export function deckGroup(): CombineEditing | null {
  const s = useOperatorStore.getState()
  if (s.deckType !== 'scripture') return null
  const item = s.service?.items.find((i) => i.id === s.activeItemId)
  if (item?.type === 'scripture' && item.payload.group && s.deckKey === `item:${item.id}`) return { itemId: item.id, group: item.payload.group }
  const { previewed } = useCombine.getState()
  return previewed && s.activeItemId === null && s.deckTitle === previewed.title ? { itemId: null, group: previewed.group } : null
}

/** Edit text on scripture slide `index` of the grid: a Scripture group opens the combine editor, a verse the text editor. */
export function editScriptureText(index: number): void {
  const group = deckGroup()
  if (group) useCombine.getState().openGroup(group.group, group.itemId)
  else useTextEdit.getState().open(index)
}
