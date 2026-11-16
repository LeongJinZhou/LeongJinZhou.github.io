import { readdirSync, readFileSync, renameSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
import { fetchContributions, fetchLanguages, fetchReadme, fetchRepos, OWNER } from './lib/github.ts'
import { buildProfile } from './lib/profile.ts'
import { renderReadme } from './lib/readme.ts'
import { shotName } from './lib/shots.ts'
import { buildProjects, selectRepos } from './lib/select.ts'
import { OverrideSchema, ProjectSchema, REPO_NAME, SiteSchema, type Languages, type Override } from './lib/schemas.ts'

const DEFAULT_TEMPLATE = join(import.meta.dirname, '..', 'profile', 'README.template.md')

export function readList(file: string): string[] {
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
}

export function loadOverrides(dir: string): Record<string, Override> {
  const out: Record<string, Override> = Object.create(null)
  for (const f of readdirSync(dir)) {
    const name = f.replace(/\.json$/, '')
    if (!f.endsWith('.json') || !REPO_NAME.test(name)) throw new Error(`Bad override file name: ${f}`)
    try {
      out[name] = OverrideSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8')))
    } catch (e) {
      throw new Error(`Bad override file ${f}`, { cause: e })
    }
  }
  return out
}

export interface RefreshOpts {
  outDir: string
  configDir: string
  baseUrl?: string | undefined
  token?: string | undefined
  /** Profile README template; defaults to profile/README.template.md in this repo. */
  templateFile?: string | undefined
}

/** Fetch everything first; write only when all succeeded and at least one project exists (rule 13). Also writes <outDir>/profile/. */
export async function refresh(o: RefreshOpts): Promise<number> {
  const hidden = new Set(readList(join(o.configDir, 'hidden.txt')))
  const featured = readList(join(o.configDir, 'featured.txt'))
  const overrides = loadOverrides(join(o.configDir, 'overrides'))
  const gh = { baseUrl: o.baseUrl, token: o.token }

  const repos = selectRepos(await fetchRepos(gh), hidden, featured)
  if (repos.length === 0) throw new Error('No projects fetched; keeping previous data')
  const languages: Record<string, Languages> = Object.create(null)
  const readmes: Record<string, string> = Object.create(null)
  for (const r of repos) {
    languages[r.name] = await fetchLanguages(r.name, gh)
    const { text, dir } = await fetchReadme(r.name, gh)
    try {
      readmes[r.name] = renderReadme(text, { owner: OWNER, repo: r.name, branch: r.default_branch, dir })
    } catch {
      console.error(`README render failed: ${r.name}`) // no stack: nothing sensitive in logs
      readmes[r.name] = ''
    }
  }

  const built = buildProjects(repos, languages, { featured, overrides })// Every project without an override image points at shots/<name>.webp; the screenshots job only writes those files.
    .map((p) => ({ ...p, screenshot: p.screenshot ?? `${shotName(p.name)}.webp`, readmeHtml: readmes[p.name] ?? '' }))
  const projects = z.array(ProjectSchema).parse(built)
  // Everything that can fail is done before the first write.
  const site = SiteSchema.parse(JSON.parse(readFileSync(join(o.configDir, 'site.json'), 'utf8')))
  const profile = buildProfile(readFileSync(o.templateFile ?? DEFAULT_TEMPLATE, 'utf8'), site, projects, featured, await fetchContributions(gh))
  mkdirSync(o.outDir, { recursive: true })
  // Both outputs go to temp names first; a failure removes them, so no partial profile/ is left.
  const tmp = join(o.outDir, 'projects.json.tmp')
  const profileTmp = join(o.outDir, 'profile.tmp')
  try {
    rmSync(profileTmp, { recursive: true, force: true })
    for (const [file, text] of Object.entries(profile)) {
      const dest = join(profileTmp, file)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, text)
    }
    writeFileSync(tmp, JSON.stringify(projects, null, 2) + '\n')
    renameSync(tmp, join(o.outDir, 'projects.json'))
    rmSync(join(o.outDir, 'profile'), { recursive: true, force: true })
    renameSync(profileTmp, join(o.outDir, 'profile'))
  } catch (e) {
    rmSync(tmp, { force: true })
    rmSync(profileTmp, { recursive: true, force: true })
    throw e
  }
  return projects.length
}

if (import.meta.main) {
  const outDir = process.argv[2] ?? process.env.OUT_DIR
  if (!outDir) {
    console.error('Usage: node scripts/refresh.ts <outDir> (or OUT_DIR)')
    process.exit(2)
  }
  if (!process.env.GITHUB_TOKEN) {
    // The profile stats use GraphQL, which GitHub only serves with a token.
    console.error('refresh failed: GITHUB_TOKEN is required (GraphQL stats)')
    process.exit(1)
  }
  try {
    const n = await refresh({
      outDir: resolve(outDir),
      configDir: resolve(process.env.CONFIG_DIR ?? join(import.meta.dirname, '..', 'config')),
      baseUrl: process.env.GITHUB_API_URL,
      token: process.env.GITHUB_TOKEN,
    })
    console.log(`refresh: wrote ${n} projects`)
  } catch (e) {
    console.error(`refresh failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    process.exit(1)
  }
}
