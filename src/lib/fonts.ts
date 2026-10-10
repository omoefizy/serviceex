/** A bare family name gets quotes and a fallback; a font stack is used as written. */
export function cssFontFamily(family: string): string {
  return /[,'"]/.test(family) ? family : `"${family}", sans-serif`
}
