// Fonts: the ones bundled with the app, font names in themes, and what to draw when a font is not on this machine.
// Shared by the main process (theme and lower third validation) and the renderer (slides, the font picker).
// The files are in public/fonts with their licenses (LICENSES.txt); src/lib/fonts.ts loads them.

import type { ThemeElement, ThemeStyle } from './types'

export type FontCategory = 'sans' | 'serif' | 'slab' | 'display' | 'script'

export interface BundledFontFace {
  /** File name in public/fonts. */
  file: string
  /** A CSS font-weight: one weight, or a range for a variable font. */
  weight: string
  italic: boolean
}

export interface BundledFont {
  family: string
  category: FontCategory
  license: 'OFL-1.1' | 'Apache-2.0'
  faces: BundledFontFace[]
}

/** Open licensed fonts shipped in the app, so slides look the same on every machine. */
export const BUNDLED_FONTS: BundledFont[] = [
  { family: 'Montserrat', category: 'sans', license: 'OFL-1.1', faces: [{ file: 'Montserrat-Variable.woff2', weight: '100 900', italic: false }, { file: 'Montserrat-Italic-Variable.woff2', weight: '100 900', italic: true }] },
  { family: 'Poppins', category: 'sans', license: 'OFL-1.1', faces: [{ file: 'Poppins-Regular.woff2', weight: '400', italic: false }, { file: 'Poppins-Bold.woff2', weight: '700', italic: false }, { file: 'Poppins-Italic.woff2', weight: '400', italic: true }, { file: 'Poppins-BoldItalic.woff2', weight: '700', italic: true }] },
  { family: 'Roboto', category: 'sans', license: 'OFL-1.1', faces: [{ file: 'Roboto-Variable.woff2', weight: '100 900', italic: false }, { file: 'Roboto-Italic-Variable.woff2', weight: '100 900', italic: true }] },
  { family: 'Open Sans', category: 'sans', license: 'OFL-1.1', faces: [{ file: 'OpenSans-Variable.woff2', weight: '300 800', italic: false }, { file: 'OpenSans-Italic-Variable.woff2', weight: '300 800', italic: true }] },
  { family: 'Lato', category: 'sans', license: 'OFL-1.1', faces: [{ file: 'Lato-Regular.woff2', weight: '400', italic: false }, { file: 'Lato-Bold.woff2', weight: '700', italic: false }, { file: 'Lato-Italic.woff2', weight: '400', italic: true }, { file: 'Lato-BoldItalic.woff2', weight: '700', italic: true }] },
  { family: 'Inter', category: 'sans', license: 'OFL-1.1', faces: [{ file: 'Inter-Variable.woff2', weight: '100 900', italic: false }, { file: 'Inter-Italic-Variable.woff2', weight: '100 900', italic: true }] },
  { family: 'Nunito', category: 'sans', license: 'OFL-1.1', faces: [{ file: 'Nunito-Variable.woff2', weight: '200 1000', italic: false }, { file: 'Nunito-Italic-Variable.woff2', weight: '200 1000', italic: true }] },
  { family: 'Raleway', category: 'sans', license: 'OFL-1.1', faces: [{ file: 'Raleway-Variable.woff2', weight: '100 900', italic: false }, { file: 'Raleway-Italic-Variable.woff2', weight: '100 900', italic: true }] },
  { family: 'Oswald', category: 'display', license: 'OFL-1.1', faces: [{ file: 'Oswald-Variable.woff2', weight: '200 700', italic: false }] },
  { family: 'Bebas Neue', category: 'display', license: 'OFL-1.1', faces: [{ file: 'BebasNeue-Regular.woff2', weight: '400', italic: false }] },
  { family: 'Anton', category: 'display', license: 'OFL-1.1', faces: [{ file: 'Anton-Regular.woff2', weight: '400', italic: false }] },
  { family: 'Source Sans 3', category: 'sans', license: 'OFL-1.1', faces: [{ file: 'SourceSans3-Variable.woff2', weight: '200 900', italic: false }, { file: 'SourceSans3-Italic-Variable.woff2', weight: '200 900', italic: true }] },
  { family: 'Work Sans', category: 'sans', license: 'OFL-1.1', faces: [{ file: 'WorkSans-Variable.woff2', weight: '100 900', italic: false }, { file: 'WorkSans-Italic-Variable.woff2', weight: '100 900', italic: true }] },
  { family: 'DM Sans', category: 'sans', license: 'OFL-1.1', faces: [{ file: 'DMSans-Variable.woff2', weight: '100 1000', italic: false }, { file: 'DMSans-Italic-Variable.woff2', weight: '100 1000', italic: true }] },
  { family: 'Playfair Display', category: 'serif', license: 'OFL-1.1', faces: [{ file: 'PlayfairDisplay-Variable.woff2', weight: '400 900', italic: false }, { file: 'PlayfairDisplay-Italic-Variable.woff2', weight: '400 900', italic: true }] },
  { family: 'Merriweather', category: 'serif', license: 'OFL-1.1', faces: [{ file: 'Merriweather-Variable.woff2', weight: '300 900', italic: false }, { file: 'Merriweather-Italic-Variable.woff2', weight: '300 900', italic: true }] },
  { family: 'Lora', category: 'serif', license: 'OFL-1.1', faces: [{ file: 'Lora-Variable.woff2', weight: '400 700', italic: false }, { file: 'Lora-Italic-Variable.woff2', weight: '400 700', italic: true }] },
  { family: 'Libre Baskerville', category: 'serif', license: 'OFL-1.1', faces: [{ file: 'LibreBaskerville-Variable.woff2', weight: '400 700', italic: false }, { file: 'LibreBaskerville-Italic-Variable.woff2', weight: '400 700', italic: true }] },
  { family: 'Cinzel', category: 'serif', license: 'OFL-1.1', faces: [{ file: 'Cinzel-Variable.woff2', weight: '400 900', italic: false }] },
  { family: 'Cormorant Garamond', category: 'serif', license: 'OFL-1.1', faces: [{ file: 'CormorantGaramond-Variable.woff2', weight: '300 700', italic: false }, { file: 'CormorantGaramond-Italic-Variable.woff2', weight: '300 700', italic: true }] },
  { family: 'EB Garamond', category: 'serif', license: 'OFL-1.1', faces: [{ file: 'EBGaramond-Variable.woff2', weight: '400 800', italic: false }, { file: 'EBGaramond-Italic-Variable.woff2', weight: '400 800', italic: true }] },
  { family: 'Crimson Text', category: 'serif', license: 'OFL-1.1', faces: [{ file: 'CrimsonText-Regular.woff2', weight: '400', italic: false }, { file: 'CrimsonText-Bold.woff2', weight: '700', italic: false }, { file: 'CrimsonText-Italic.woff2', weight: '400', italic: true }, { file: 'CrimsonText-BoldItalic.woff2', weight: '700', italic: true }] },
  { family: 'Great Vibes', category: 'script', license: 'OFL-1.1', faces: [{ file: 'GreatVibes-Regular.woff2', weight: '400', italic: false }] },
  { family: 'Dancing Script', category: 'script', license: 'OFL-1.1', faces: [{ file: 'DancingScript-Variable.woff2', weight: '400 700', italic: false }] },
  { family: 'Pacifico', category: 'script', license: 'OFL-1.1', faces: [{ file: 'Pacifico-Regular.woff2', weight: '400', italic: false }] },
  { family: 'Caveat', category: 'script', license: 'OFL-1.1', faces: [{ file: 'Caveat-Variable.woff2', weight: '400 700', italic: false }] },
  { family: 'Roboto Slab', category: 'slab', license: 'Apache-2.0', faces: [{ file: 'RobotoSlab-Variable.woff2', weight: '100 900', italic: false }] },
  { family: 'Archivo Black', category: 'display', license: 'OFL-1.1', faces: [{ file: 'ArchivoBlack-Regular.woff2', weight: '400', italic: false }] },
]

const BUNDLED_BY_KEY = new Map(BUNDLED_FONTS.map((font) => [font.family.toLowerCase(), font]))

export const bundledFont = (family: string): BundledFont | undefined => BUNDLED_BY_KEY.get(family.trim().toLowerCase())

/** CSS generic families: always available. */
export const GENERIC_FAMILIES = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'emoji', 'math', 'fangsong']

export const isGenericFamily = (family: string) => GENERIC_FAMILIES.includes(family.trim().toLowerCase())

/** The families of a CSS font stack, without quotes: "'Helvetica Neue', Inter, sans-serif" → Helvetica Neue, Inter, sans-serif. */
export const familiesOf = (value: string): string[] =>
  value
    .split(',')
    .map((family) => family.trim().replace(/^(['"])(.*)\1$/, '$2').trim())
    .filter(Boolean)

/** The first family of a stack, as the font picker shows it. */
export const familyName = (value: string): string => familiesOf(value)[0] ?? ''

// ---------- Names in older themes ----------

/** Families renamed since, or spelled the way some systems and files spell them. */
const RENAMED: Record<string, string> = {
  'source sans pro': 'Source Sans 3',
  sourcesanspro: 'Source Sans 3',
  'source sans 3 vf': 'Source Sans 3',
  opensans: 'Open Sans',
  'open sans regular': 'Open Sans',
  playfairdisplay: 'Playfair Display',
  playfair: 'Playfair Display',
  bebasneue: 'Bebas Neue',
  bebas: 'Bebas Neue',
  'bebas neue regular': 'Bebas Neue',
  'dm sans 9pt': 'DM Sans',
  dmsans: 'DM Sans',
  worksans: 'Work Sans',
  robotoslab: 'Roboto Slab',
  'roboto slab regular': 'Roboto Slab',
  librebaskerville: 'Libre Baskerville',
  ebgaramond: 'EB Garamond',
  'eb garamond 12': 'EB Garamond',
  'eb garamond 08': 'EB Garamond',
  cormorantgaramond: 'Cormorant Garamond',
  crimsontext: 'Crimson Text',
  greatvibes: 'Great Vibes',
  dancingscript: 'Dancing Script',
  archivoblack: 'Archivo Black',
  'inter var': 'Inter',
  'inter variable': 'Inter',
  'inter display': 'Inter',
}

/**
 * A font name from a theme, tidied so it matches a bundled font where it means one: quotes, letter case, a trailing
 * "Regular" and renamed families. Stacks and names of other fonts are kept as they are.
 */
export function migrateFontName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes(',')) return trimmed
  const bare = trimmed.replace(/^(['"])(.*)\1$/, '$2').trim()
  const key = bare.toLowerCase().replace(/\s+/g, ' ')
  const known = bundledFont(key) ?? bundledFont(key.replace(/ regular$/, ''))
  if (known) return known.family
  return RENAMED[key] ?? RENAMED[key.replace(/ regular$/, '')] ?? (bare === trimmed ? trimmed : bare)
}

// ---------- Fallbacks ----------

/** Well known fonts that may be missing, and the bundled font closest to each in shape and width. */
const SUBSTITUTES: [RegExp, string][] = [
  [/^(helvetica( neue)?|arial|liberation sans|nimbus sans|segoe ui|san francisco|sf pro( display| text)?|tahoma|verdana|calibri|candara|corbel|myriad( pro)?)\b/, 'Inter'],
  [/^(futura|century gothic|avenir( next)?|gotham|proxima nova|museo sans|brandon|tw cen)\b/, 'Montserrat'],
  [/^(gill sans|seravek|optima|lucida (sans|grande))\b/, 'Lato'],
  [/^(franklin gothic|din|bahnschrift|trade gothic|league gothic|arial narrow|helvetica condensed)\b/, 'Oswald'],
  [/^(impact|haettenschweiler|knockout)\b/, 'Anton'],
  [/^(arial black|helvetica black|segoe ui black)\b/, 'Archivo Black'],
  [/^(trajan|copperplate|perpetua titling)\b/, 'Cinzel'],
  [/^(garamond|adobe garamond|sabon|bembo|minion( pro)?)\b/, 'EB Garamond'],
  [/^(baskerville|big caslon|caslon|new york)\b/, 'Libre Baskerville'],
  [/^(didot|bodoni|bodoni 72|modern no)\b/, 'Playfair Display'],
  [/^(georgia|cambria|charter|constantia|hoefler text|iowan old style)\b/, 'Merriweather'],
  [/^(times( new roman)?|book antiqua|palatino( linotype)?|century schoolbook|liberation serif)\b/, 'Crimson Text'],
  [/^(rockwell|courier new|american typewriter|museo slab|clarendon|zilla slab)\b/, 'Roboto Slab'],
  [/^(edwardian script|lucida calligraphy|snell roundhand|zapfino|brush script|monotype corsiva|apple chancery)\b/, 'Great Vibes'],
  [/^(comic sans|segoe print|bradley hand|chalkboard|noteworthy|marker felt|segoe script|lucida handwriting)\b/, 'Caveat'],
]

/** Guesses from the name itself, for fonts the list above does not know. */
const BY_NAME: [RegExp, string][] = [
  [/mono|code|consol|courier|menlo/, 'monospace'],
  [/script|hand|brush|callig|signature|vibes/, 'Dancing Script'],
  [/slab|typewriter|egyptian/, 'Roboto Slab'],
  [/garamond/, 'EB Garamond'],
  [/condensed|compressed|narrow|gothic/, 'Oswald'],
  [/\bsans\b|grotesk|grotesque/, 'Inter'],
  [/serif|roman|antiqua|old ?style|text$|book/, 'Merriweather'],
  [/black|heavy|ultra|poster|display/, 'Archivo Black'],
]

const GENERIC_OF: Record<FontCategory, string> = { sans: 'sans-serif', display: 'sans-serif', serif: 'serif', slab: 'serif', script: 'cursive' }

const quoted = (family: string) => (isGenericFamily(family) ? family : `"${family.replace(/"/g, '')}"`)

/**
 * What to draw instead when a family is not on this machine: a bundled font of the same kind (always there), then
 * the generic family. Never the browser's default serif for a sans font.
 */
export function fallbackFor(family: string): string {
  const key = family.trim().toLowerCase()
  const own = bundledFont(key)
  const pick = own?.family ?? SUBSTITUTES.find(([pattern]) => pattern.test(key))?.[1] ?? BY_NAME.find(([pattern]) => pattern.test(key))?.[1] ?? 'Inter'
  if (pick === 'monospace') return 'ui-monospace, Menlo, Consolas, monospace'
  const substitute = bundledFont(pick)!
  const generic = GENERIC_OF[substitute.category]
  return substitute.family.toLowerCase() === key ? generic : `${quoted(substitute.family)}, ${generic}`
}

/**
 * A theme's font as CSS: a bare family gets quotes and its fallback; a stack is used as written, with a fallback
 * added when it ends without a generic family.
 */
export function cssFontFamily(family: string): string {
  const families = familiesOf(family)
  if (families.length === 0) return fallbackFor('')
  if (!/[,'"]/.test(family)) return `${quoted(families[0])}, ${fallbackFor(families[0])}`
  return families.some(isGenericFamily) ? family : `${family}, ${fallbackFor(families[0])}`
}

// ---------- Replacing a font ----------

const sameFamily = (value: string | undefined, family: string) => value !== undefined && familyName(value).toLowerCase() === family.trim().toLowerCase()

/** Every text box and run of a theme or slide that uses `from` (by its first family) uses `to` instead. */
export function replaceThemeFont(style: ThemeStyle, from: string, to: string): ThemeStyle {
  const replace = (element: ThemeElement): ThemeElement => {
    if (!('text' in element)) return element
    const text = sameFamily(element.text.fontFamily, from) ? { ...element.text, fontFamily: to } : element.text
    if (element.kind !== 'text' || !element.paragraphs) return { ...element, text }
    const paragraphs = element.paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: paragraph.runs.map((run) => (sameFamily(run.fontFamily, from) ? { ...run, fontFamily: to } : run)),
    }))
    return { ...element, text, paragraphs }
  }
  return { ...style, elements: style.elements.map(replace) }
}

/** The fonts a theme or slide names: its text boxes' and their runs'. */
export function themeFonts(style: ThemeStyle): string[] {
  return style.elements.flatMap((element) =>
    'text' in element ? [element.text.fontFamily, ...(element.kind === 'text' ? (element.paragraphs ?? []).flatMap((p) => p.runs.map((run) => run.fontFamily ?? '')) : [])] : [],
  )
}
