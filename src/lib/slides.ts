/**
 * Splits lyrics into slide texts on blank lines, dropping empty chunks.
 * Mirrors splitIntoSlides in electron/db/songs.ts so the renderer shows the same slides the database stores.
 */
export function splitIntoSlides(lyrics: string): string[] {
  return lyrics
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0)
}
