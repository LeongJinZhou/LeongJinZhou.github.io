const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

export interface CardInput {
  name: string
  language: string | null
  topics: readonly string[]
}

/** Generated card for projects with no screenshot (rules 8-9). Text only: no external references. */
export function cardSvg(p: CardInput, width: number, height: number): string {
  const tags = p.topics.slice(0, 6).map((t, i) => `<text x="80" y="${460 + i * 48}" font-size="30" fill="#94a3b8">#${esc(t)}</text>`)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="system-ui, sans-serif">` +
    `<rect width="100%" height="100%" fill="#0f172a"/>` +
    `<text x="80" y="260" font-size="${Math.min(84, Math.floor((width - 160) / (0.62 * Math.max(p.name.length, 1))))}" font-weight="700" fill="#f8fafc">${esc(p.name)}</text>` +
    `<text x="80" y="350" font-size="40" fill="#38bdf8">${esc(p.language ?? 'Code')}</text>` +
    tags.join('') +
    `</svg>`
  )
}
