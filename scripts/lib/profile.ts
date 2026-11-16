import { OWNER } from './github.ts'
import type { Project, Site } from './schemas.ts'
import { badgeUrl, featuredProjects, stackOf } from './select.ts'
import { bannerSvg, langsSvg, statsSvg, type LangShare } from './svg.ts'

/** Rule 11: top languages by bytes across the shown projects, as a share of all their bytes. */
export function topLanguages(projects: readonly Pick<Project, 'languages'>[], n = 6): LangShare[] {
  const bytes = new Map<string, number>()
  for (const p of projects) for (const [lang, b] of Object.entries(p.languages)) bytes.set(lang, (bytes.get(lang) ?? 0) + b)
  const total = [...bytes.values()].reduce((a, b) => a + b, 0)
  if (total === 0) return []
  return [...bytes]
    .filter(([, b]) => b > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, b]) => ({ name, pct: (b / total) * 100 }))
}

// "|" too: an alt text inside a table cell must not end the cell.
const attr = (s: string) => s.replace(/[<>&"'|]/g, (c) => `&#${c.charCodeAt(0)};`)
// Table cell text: one line, no markdown or HTML specials (descriptions come from GitHub).
const cell = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[\\`*_[\]<>|~&#]/g, '\\$&')
// Link URLs: percent-encode what ends a link, a table cell or an attribute.
const url = (u: string) => u.replace(/[()\s|<>"]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)

const picture = (name: string, alt: string) =>
  `<picture>\n  <source media="(prefers-color-scheme: dark)" srcset="assets/${name}-dark.svg">\n  <img alt="${attr(alt)}" src="assets/${name}-light.svg">\n</picture>`

export interface ProfileInput {
  site: Site
  projects: readonly Project[]
  /** featured.txt names, in order. */
  featured: readonly string[]
}

function featuredTable(projects: readonly Project[], featured: readonly string[]): string {
  const rows = featuredProjects(projects, featured).map((p) => {
    const shot = p.screenshot ? `<img src="assets/shots/${p.screenshot}" alt="${attr(p.title)} screenshot" width="240">` : ''
    const links = `[${cell(p.title)}](${url(p.repoUrl)})${p.homepage ? ` · [live](${url(p.homepage)})` : ''}`
    return `| ${shot} | ${links} | ${cell(p.description)} | ${cell(stackOf(p).join(', '))} |`
  })
  return ['| Preview | Project | What it does | Stack |', '|---|---|---|---|', ...rows].join('\n')
}

/** Replaces only the text between `<!-- gen:x -->` and `<!-- /gen:x -->`; a missing marker is an error. */
export function renderProfileReadme(template: string, { site, projects, featured }: ProfileInput): string {
  const sections: Record<string, string> = {
    banner: `<img alt="${attr(site.name)}" src="assets/banner.svg">`,
    stats: picture('stats', 'GitHub stats'),
    langs: picture('langs', 'Top languages'),
    snake: picture('snake', 'Contribution snake'),
    featured: featuredTable(projects, featured),
    skills: site.skills.map((s) => `<img alt="${attr(s)}" src="${attr(badgeUrl(s))}" height="20">`).join('\n'),
    contact: [`- [GitHub](https://github.com/${OWNER})`, ...(site.linkedinUrl ? [`- [LinkedIn](${url(site.linkedinUrl)})`] : [])].join('\n'),
  }
  let out = template
  for (const [name, body] of Object.entries(sections)) {
    const re = new RegExp(`(<!-- gen:${name} -->)[\\s\\S]*?(<!-- /gen:${name} -->)`)
    if (!re.test(out)) throw new Error(`Profile template: marker "${name}" is missing`)
    if (out.split(`<!-- gen:${name} -->`).length > 2) throw new Error(`Profile template: marker "${name}" appears more than once`)
    out = out.replace(re, (_, a: string, b: string) => `${a}\n${body}\n${b}`)
  }
  return out
}

/** Every generated profile file, keyed by path inside the profile repo. The snake SVGs come from their own job. */
export function buildProfile(
  template: string,
  site: Site,
  projects: readonly Project[],
  featured: readonly string[],
  contributions: { commits: number; prs: number },
): Record<string, string> {
  const stats = { repos: projects.length, stars: projects.reduce((n, p) => n + p.stars, 0), commits: contributions.commits, prs: contributions.prs }
  const langs = topLanguages(projects)
  return {
    'README.md': renderProfileReadme(template, { site, projects, featured }),
    'assets/banner.svg': bannerSvg(site.name, site.title),
    'assets/stats-dark.svg': statsSvg(stats, 'dark'),
    'assets/stats-light.svg': statsSvg(stats, 'light'),
    'assets/langs-dark.svg': langsSvg(langs, 'dark'),
    'assets/langs-light.svg': langsSvg(langs, 'light'),
  }
}
