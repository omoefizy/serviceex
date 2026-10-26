// Switching layouts on this computer: the panels it shows, and the defaults the layout sets. Any computer can
// switch at any time; nothing about it is sent to other computers.

import { hasFeature } from '../../shared/features'
import { layoutById } from '../../shared/layouts'
import type { Layout, ThemeContentType } from '../../shared/types'
import { useOperatorStore } from '../store'
import { useSharingStore } from './sharing'

export const activeLayout = (): Layout => {
  const { settings } = useOperatorStore.getState()
  return layoutById(settings.layouts, settings.activeLayoutId)
}

/**
 * Shows a layout and applies its defaults: theme defaults, the output background when nothing is live, and which
 * shared service items the schedule lists. What is live stays live.
 */
export async function switchLayout(id: string): Promise<void> {
  if (!hasFeature('sharing.layouts')) return
  const st = useOperatorStore.getState()
  const layout = layoutById(st.settings.layouts, id)
  await st.updateSettings({ activeLayoutId: layout.id })
  const themeIds = new Set(st.themes.map((t) => t.id))
  const defaults = Object.entries(layout.themeDefaults).filter(([, themeId]) => themeIds.has(themeId as number)) as [ThemeContentType, number][]
  if (defaults.length > 0) {
    for (const [type, themeId] of defaults) await window.api.themes.setDefault(type, themeId)
    await st.loadThemes()
  }
  const live = useOperatorStore.getState().live
  if (layout.outputBackground && live.slideIndex === null) st.setOutputMode(layout.outputBackground)
  useSharingStore.setState({ itemFilter: layout.itemFilter === 'mine' ? { kind: 'mine' } : { kind: 'all' } })
}

/** The next layout in the list, for the shortcut that cycles them. */
export function cycleLayout(step: 1 | -1): Promise<void> {
  const { layouts } = useOperatorStore.getState().settings
  const at = layouts.findIndex((l) => l.id === activeLayout().id)
  return switchLayout(layouts[(at + step + layouts.length) % layouts.length].id)
}
