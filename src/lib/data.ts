import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { ProjectSchema, SiteSchema, type Languages, type Project, type Site } from '../../scripts/lib/schemas.ts'
import { featuredProjects, stackOf } from '../../scripts/lib/select.ts'

export { badgeUrl, stackOf } from '../../scripts/lib/select.ts'

const ROOT = process.cwd()

const readList = (file: string): string[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))

const parseJson = (text: string, file: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Invalid JSON in ${file}`)
  }
}

export interface LoadOptions {
  dataDir?: string | undefined
  hiddenFile?: string | undefined
  featuredFile?: string | undefined
}

/** Build-time data. Re-applies hidden.txt (S6) so a hide takes effect on a plain push, before the next refresh. */
export function loadData(o: LoadOptions): { projects: Project[]; featured: Project[] } {
  if (!o.dataDir) throw new Error('DATA_DIR is not set. Point it at the folder holding projects.json (CI uses tests/fixtures/generated).')
  const file = join(o.dataDir, 'projects.json')
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    throw new Error(`Cannot read ${file}. Run the refresh first or check DATA_DIR.`)
  }
  const hidden = new Set(readList(o.hiddenFile ?? join(ROOT, 'config', 'hidden.txt')).map((n) => n.toLowerCase()))
  const projects = z
    .array(ProjectSchema)
    .parse(parseJson(raw, file))
    .filter((p) => !hidden.has(p.name.toLowerCase()))
    // A missing image file must not become a broken <img>: use the generated card.
    .map((p) => (p.screenshot && !existsSync(join(o.dataDir as string, 'shots', p.screenshot)) ? { ...p, screenshot: null } : p))
    .sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt))
  return { projects, featured: featuredProjects(projects, readList(o.featuredFile ?? join(ROOT, 'config', 'featured.txt'))) }
}

export const loadProjects = () =>
  loadData({ dataDir: process.env.DATA_DIR, hiddenFile: process.env.HIDDEN_FILE })

export function loadSite(root = ROOT): Site {
  const file = join(root, 'config', 'site.json')
  return SiteSchema.parse(parseJson(readFileSync(file, 'utf8'), file))
}

/** Filter list: every project language and topic, deduped case-insensitively, sorted. */
export function techList(projects: readonly Project[]): string[] {
  const seen = new Map<string, string>()
  for (const p of projects) for (const t of stackOf(p)) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t)
  return [...seen.values()].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }))
}

/** Language bytes to percentages: top 5 then "Other". */
export function languageShares(languages: Languages): { name: string; pct: number }[] {
  const entries = Object.entries(languages).sort((a, b) => b[1] - a[1])
  const total = entries.reduce((n, [, b]) => n + b, 0)
  if (total === 0) return []
  const head = entries.slice(0, 5)
  const rest = entries.slice(5).reduce((n, [, b]) => n + b, 0)
  if (rest > 0) head.push(['Other', rest])
  return head.map(([name, b]) => ({ name, pct: (b / total) * 100 }))
}

/** Page has one h1 and a "README" h2 above: README h1..h6 become h3..h6 (sanitised HTML has bare tags only). */
export function demoteHeadings(html: string): string {
  return html.replace(/<(\/?)h([1-6])(?=[\s>])/g, (_, slash: string, n: string) => `<${slash}h${Math.min(6, Number(n) + 2)}`)
}
