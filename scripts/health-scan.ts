// Node built-ins and sibling lib files only: the health workflow runs without npm ci.
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkUrl, extractHtml, extractMarkdown, isIgnored, type Failure } from './lib/links.ts'
import { readList } from './lib/list.ts'

const SITE = 'https://leongjinzhou.github.io/'
const README = 'https://raw.githubusercontent.com/LeongJinZhou/LeongJinZhou/main/README.md'
const CONCURRENCY = 8

export interface ScanOpts {
  siteUrl: string
  readmeUrl: string
  ignore: string[]
  maxPages: number
  retries: number
  timeoutMs: number
  /** Test only: exact "host:port" that may be plain http and skips the address check. */
  allowHost?: string | undefined
}

async function pool<T>(items: T[], fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (i < items.length) await fn(items[i++] as T)
    }),
  )
}

/** Crawl same-origin HTML from the site (at most maxPages parsed), add the profile README's links, check each URL once. */
export async function scan(o: ScanOpts): Promise<Failure[]> {
  const check = (u: string) => checkUrl(u, { retries: o.retries, timeoutMs: o.timeoutMs, allowHost: o.allowHost })
  const origin = new URL(o.siteUrl).origin
  const failures = new Map<string, Failure>()
  const seen = new Set<string>([new URL(o.siteUrl).href])
  const queue: string[] = [...seen]
  const enqueue = (urls: string[]) => {
    for (const u of urls) {
      if (seen.has(u) || isIgnored(u, o.ignore)) continue
      seen.add(u)
      queue.push(u)
    }
  }

  const readme = await check(o.readmeUrl)
  if (readme.ok) {
    const text = readme.res.body.toString('utf8')
    const base = new URL(o.readmeUrl)
    enqueue([...extractMarkdown(text, base), ...extractHtml(text, base)])
  } else failures.set(o.readmeUrl, readme.failure)

  let pages = 0
  const visit = async (u: string) => {
    const r = await check(u)
    if (!r.ok) return void failures.set(u, r.failure)
    if (pages >= o.maxPages || new URL(u).origin !== origin || !/text\/html/i.test(r.res.headers['content-type'] ?? '')) return
    pages++
    enqueue(extractHtml(r.res.body.toString('utf8'), new URL(u)))
  }
  while (queue.length > 0) await pool(queue.splice(0), visit)

  return [...failures.values()].sort((a, b) => (a.url < b.url ? -1 : a.url > b.url ? 1 : 0))
}

function healthSettings(file: string): { retries: number; timeoutMs: number; maxPages: number } {
  const h = (JSON.parse(readFileSync(file, 'utf8')) as { health?: Record<string, unknown> }).health
  const num = (k: string): number => {
    const v = h?.[k]
    if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) throw new Error(`settings.health.${k} must be a positive integer`)
    return v
  }
  return { retries: num('retries'), timeoutMs: num('timeoutMs'), maxPages: num('maxPages') }
}

if (import.meta.main) {
  const out = process.argv[2]
  if (!out) {
    console.error('Usage: node scripts/health-scan.ts <failures.json>')
    process.exit(2)
  }
  try {
    const configDir = resolve(process.env.CONFIG_DIR ?? join(import.meta.dirname, '..', 'config'))
    const failures = await scan({
      siteUrl: process.env.SITE_URL ?? SITE,
      readmeUrl: process.env.PROFILE_README_URL ?? README,
      ignore: readList(join(configDir, 'health-ignore.txt')),
      ...healthSettings(join(configDir, 'settings.json')),
    })
    writeFileSync(resolve(out), JSON.stringify(failures, null, 2) + '\n')
    console.log(`health-scan: ${failures.length} broken`)
  } catch (e) {
    console.error(`health-scan failed: ${e instanceof Error ? e.message : 'unknown error'}`)
    process.exit(1)
  }
}
