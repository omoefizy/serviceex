/** Colors that tell song sections apart on slide cards; matched on the start of the label, ignoring case. */
const SECTION_COLORS: [prefix: string, color: string][] = [
  ['pre-chorus', '#ec4899'],
  ['prechorus', '#ec4899'],
  ['verse', '#14b8a6'],
  ['chorus', '#f59e0b'],
  ['refrain', '#ef4444'],
  ['bridge', '#a855f7'],
  ['tag', '#84cc16'],
  ['intro', '#64748b'],
  ['outro', '#64748b'],
  ['ending', '#64748b'],
]

/** The color for a section label such as "Verse 2" or "Chorus", or a neutral gray for any other label. */
export function sectionColor(label: string): string {
  const key = label.trim().toLowerCase()
  return SECTION_COLORS.find(([prefix]) => key.startsWith(prefix))?.[1] ?? '#6b7280'
}
