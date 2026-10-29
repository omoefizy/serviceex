import { SECTION_COLOR_DEFAULT, SECTION_COLORS } from '../styles/contentColors'

/** The color for a section label such as "Verse 2" or "Chorus", or a neutral gray for any other label. */
export function sectionColor(label: string): string {
  const key = label.trim().toLowerCase()
  return SECTION_COLORS.find(([prefix]) => key.startsWith(prefix))?.[1] ?? SECTION_COLOR_DEFAULT
}
