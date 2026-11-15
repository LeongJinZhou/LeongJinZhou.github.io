import { readdirSync, readFileSync, renameSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { fetchLanguages, fetchRepos } from './lib/github.ts'
import { buildProjects, selectRepos } from './lib/select.ts'
import { OverrideSchema, ProjectSchema, REPO_NAME, type Languages, type Override } from './lib/schemas.ts'

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
}

/** Fetch everything first; write only when all succeeded and at least one project exists (rule 13). */
export async function refresh(o: RefreshOpts): Promise<number> {
  const hidden = new Set(readList(join(o.configDir, 'hidden.txt')))
  const featured = readList(join(o.configDir, 'featured.txt'))
  const overrides = loadOverrides(join(o.configDir, 'overrides'))
  const gh = { baseUrl: o.baseUrl, token: o.token }

  const repos = selectRepos(await fetchRepos(gh), hidden)
  if (repos.length === 0) throw new Error('No projects fetched; keeping previous data')
  const languages: Record<string, Languages> = Object.create(null)
  for (const r of repos) languages[r.name] = await fetchLanguages(r.name, gh)

  const projects = z.array(ProjectSchema).parse(buildProjects(repos, languages, { featured, overrides }))
  mkdirSync(o.outDir, { recursive: true })
  const tmp = join(o.outDir, 'projects.json.tmp')
  try {
    writeFileSync(tmp, JSON.stringify(projects, null, 2) + '\n')
    renameSync(tmp, join(o.outDir, 'projects.json'))
  } catch (e) {
    rmSync(tmp, { force: true })
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
