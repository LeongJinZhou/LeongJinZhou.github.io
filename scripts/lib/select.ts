import { OWNER } from './github.ts'
import { REPO_NAME, type Languages, type Override, type Project, type Repo } from './schemas.ts'

const SELF = new Set([OWNER.toLowerCase(), `${OWNER}.github.io`.toLowerCase()])

export interface SelectConfig {
  featured: readonly string[]
  overrides: Readonly<Record<string, Override>>
}

/** Rules 1, 2, 4, 5: shown repos, newest push first. A fork is shown only when featured. */
export function selectRepos(repos: readonly Repo[], hidden: ReadonlySet<string>, featured: readonly string[] = []): Repo[] {
  const hid = new Set([...hidden].map((h) => h.toLowerCase()))
  const feat = new Set(featured.map((f) => f.toLowerCase()))
  return repos
    .filter(
      (r) =>
        REPO_NAME.test(r.name) &&
        r.owner.login.toLowerCase() === OWNER.toLowerCase() &&
        !r.private &&
        (!r.fork || feat.has(r.name.toLowerCase())) &&
        !r.archived &&
        !hid.has(r.name.toLowerCase()) &&
        !SELF.has(r.name.toLowerCase()),
    )
    .sort((a, b) => Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
}

export function httpsOnly(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.protocol === 'https:' ? u.href : null
  } catch {
    return null
  }
}

/** Rule 6: API values; overrides replace title, description, screenshot only. */
export function buildProjects(
  repos: readonly Repo[],
  languages: Readonly<Record<string, Languages>>,
  cfg: SelectConfig,
): Project[] {
  // Maps keep "__proto__" and similar keys inert; lowercase keys make lookups case-insensitive.
  const lower = <T>(rec: Readonly<Record<string, T>>) => new Map(Object.entries(rec).map(([k, v]) => [k.toLowerCase(), v]))
  const ovr = lower(cfg.overrides)
  const langs = lower(languages)
  const feat = new Set(cfg.featured.map((f) => f.toLowerCase()))
  return repos.map((r) => {
    const key = r.name.toLowerCase()
    const o = ovr.get(key) ?? {}
    return {
      name: r.name,
      title: o.title ?? r.name,
      description: o.description ?? r.description ?? '',
      topics: r.topics,
      language: r.language,
      languages: langs.get(key) ?? {},
      homepage: httpsOnly(r.homepage),
      repoUrl: `https://github.com/${OWNER}/${r.name}`,
      pushedAt: r.pushed_at,
      stars: r.stargazers_count,
      screenshot: o.screenshot ?? null,
      featured: feat.has(key),
      readmeHtml: '',
    }
  })
}

/** Rule 4: featured projects in featured.txt order; absent (hidden/private) ones are skipped. */
export function featuredProjects(projects: readonly Project[], featured: readonly string[]): Project[] {
  return featured.flatMap((n) => projects.filter((p) => p.name.toLowerCase() === n.toLowerCase()))
}
