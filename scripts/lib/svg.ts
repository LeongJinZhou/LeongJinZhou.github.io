const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

export type Theme = 'dark' | 'light'
export interface Stats { repos: number; stars: number; commits: number; prs: number }
export interface LangShare { name: string; pct: number }

const PALETTE = {
  dark: { bg: '#0d1117', fg: '#e6edf3', muted: '#8b949e', accent: '#58a6ff', track: '#21262d' },
  light: { bg: '#ffffff', fg: '#1f2328', muted: '#59636e', accent: '#0969da', track: '#eaeef2' },
} as const

const W = 495
const open = (w: number, h: number, bg: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="system-ui, sans-serif">` +
  `<rect width="100%" height="100%" rx="8" fill="${bg}"/>`

/** Profile banner (rule 11). Text only: no external references. */
export function bannerSvg(name: string, title: string): string {
  const p = PALETTE.dark
  const size = Math.min(72, Math.floor(1100 / (0.62 * Math.max(name.length, 1))))
  return (
    open(1200, 240, p.bg) +
    `<text x="60" y="115" font-size="${size}" font-weight="700" fill="${p.fg}">${esc(name)}</text>` +
    `<text x="60" y="175" font-size="32" fill="${p.accent}">${esc(title)}</text>` +
    `</svg>`
  )
}

/** Stats card (rule 11): one row per number. */
export function statsSvg(s: Stats, theme: Theme): string {
  const p = PALETTE[theme]
  const rows: [string, number][] = [['Public repositories', s.repos], ['Stars earned', s.stars], ['Commits in the last year', s.commits], ['Pull requests', s.prs]]
  return (
    open(W, 60 + rows.length * 30, p.bg) +
    `<text x="24" y="36" font-size="18" font-weight="700" fill="${p.accent}">GitHub stats</text>` +
    rows
      .map(([label, n], i) => {
        const y = 70 + i * 30
        return `<text x="24" y="${y}" font-size="14" fill="${p.muted}">${esc(label)}</text><text x="${W - 24}" y="${y}" font-size="14" font-weight="700" text-anchor="end" fill="${p.fg}">${n}</text>`
      })
      .join('') +
    `</svg>`
  )
}

/** Top languages card (rule 11): name, percentage and a bar per language. */
export function langsSvg(langs: readonly LangShare[], theme: Theme): string {
  const p = PALETTE[theme]
  const bar = W - 48
  return (
    open(W, 60 + Math.max(langs.length, 1) * 36, p.bg) +
    `<text x="24" y="36" font-size="18" font-weight="700" fill="${p.accent}">Top languages</text>` +
    (langs.length === 0 ? `<text x="24" y="70" font-size="14" fill="${p.muted}">No language data yet</text>` : '') +
    langs
      .map((l, i) => {
        const y = 66 + i * 36
        return (
          `<text x="24" y="${y}" font-size="14" fill="${p.fg}">${esc(l.name)}</text>` +
          `<text x="${W - 24}" y="${y}" font-size="14" text-anchor="end" fill="${p.muted}">${l.pct.toFixed(1)}%</text>` +
          `<rect x="24" y="${y + 6}" width="${bar}" height="8" rx="4" fill="${p.track}"/>` +
          `<rect x="24" y="${y + 6}" width="${((bar * l.pct) / 100).toFixed(1)}" height="8" rx="4" fill="${p.accent}"/>`
        )
      })
      .join('') +
    `</svg>`
  )
}

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
