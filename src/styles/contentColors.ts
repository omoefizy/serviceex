// Content colors: what the projector, stage display and Stream output draw, and the defaults saved into themes and
// settings. They are not interface colors (those are the CSS tokens in tokens.css). They stay hex strings because
// color inputs, saved themes and the output windows need hex; every one the app writes out is here.

export const CONTENT_COLORS = {
  black: '#000000',
  white: '#ffffff',
  /** A theme's gradient end and smoke color when a background kind is first chosen. */
  gradientEnd: '#333333',
  smoke: '#5a7bc4',
  /** The stage display: dim text, and the next slide. */
  stageMuted: '#9ca3af',
  stageNext: '#facc15',
  /** Highlighter, before one is chosen. */
  highlighter: '#ffff00',
  /** Stream output guides and the default chroma key. */
  guideMagenta: '#ff00ff',
  chromaGreen: '#00ff00',
  /** A scripture reference line, and the priority alert band. */
  referenceLine: '#ffd400',
  priorityBand: '#c81e1e',
  /** The alert band's default text and fill. */
  alertText: '#ffffff',
  alertBand: '#0a0e1c',
} as const

/** Scripture text colors offered in Scripture display. */
export const SCRIPTURE_TEXT_COLORS = [
  { color: '#ffffff', label: 'White' },
  { color: '#fff4d6', label: 'Cream' },
  { color: '#ffd400', label: 'Yellow' },
  { color: '#9cc9ff', label: 'Light blue' },
  { color: '#9be7b0', label: 'Light green' },
  { color: '#111111', label: 'Black' },
] as const

/** Song section labels, by the start of the label: verse, chorus, bridge and so on. */
export const SECTION_COLORS: readonly (readonly [string, string])[] = [
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

/** A section label the list above does not know. */
export const SECTION_COLOR_DEFAULT = '#6b7280'
