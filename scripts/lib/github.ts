import { LanguagesSchema, ReposSchema, type Languages, type Repo } from './schemas.ts'

export const OWNER = 'LeongJinZhou'
const MAX_PAGES = 50

export interface GithubOpts {
  baseUrl?: string | undefined
  token?: string | undefined
  timeoutMs?: number
}

function assertSafeTransport(base: URL, o: GithubOpts): void {
  const local = base.hostname === '127.0.0.1' || base.hostname === 'localhost'
  if (o.token && base.protocol !== 'https:' && !local) throw new Error('Refusing to send a token over non-https')
}

async function get(url: string, o: GithubOpts): Promise<Response> {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'portfolio-refresh' }
  if (o.token) headers.Authorization = `Bearer ${o.token}`
  const res = await fetch(url, { headers, // shortcut: hard-coded 30 s default; move to settings if it ever needs tuning.
    signal: AbortSignal.timeout(o.timeoutMs ?? 30000) })
  // Status only: never echo headers or URL query (token safety).
  if (!res.ok) throw new Error(`GitHub API error: HTTP ${res.status}`)
  return res
}

function nextLink(header: string | null, base: URL): string | null {
  const m = header?.match(/<([^>]+)>\s*;\s*rel="next"/)
  if (!m?.[1]) return null
  const next = new URL(m[1], base)
  // Never send the token to another origin.
  if (next.origin !== base.origin) throw new Error('GitHub API error: next page on a different origin')
  return next.href
}

export async function fetchRepos(o: GithubOpts = {}): Promise<Repo[]> {
  const base = new URL(o.baseUrl ?? 'https://api.github.com')
  assertSafeTransport(base, o)
  const repos: Repo[] = []
  let url: string | null = new URL(`/users/${OWNER}/repos?type=owner&per_page=100`, base).href
  for (let page = 0; url; page++) {
    if (page >= MAX_PAGES) throw new Error('GitHub API error: too many pages')
    const res = await get(url, o)
    repos.push(...ReposSchema.parse(await res.json()))
    url = nextLink(res.headers.get('link'), base)
  }
  return repos
}

export async function fetchLanguages(name: string, o: GithubOpts = {}): Promise<Languages> {
  const base = new URL(o.baseUrl ?? 'https://api.github.com')
  assertSafeTransport(base, o)
  const res = await get(new URL(`/repos/${OWNER}/${encodeURIComponent(name)}/languages`, base).href, o)
  return LanguagesSchema.parse(await res.json())
}
