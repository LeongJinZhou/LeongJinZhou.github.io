// Node built-ins and sibling lib files only: the health workflow runs without npm ci.
import { checkHost, guardedRequest, type Lookup, type Res } from './shots.ts'

export interface Failure {
  url: string
  status?: number
  error?: string
}
export type CheckResult = { ok: true; res: Res } | { ok: false; failure: Failure }
export interface CheckOpts {
  retries: number
  timeoutMs: number
  lookup?: Lookup | undefined
  /** Test only: exact "host:port" that may be plain http and skips the address check. */
  allowHost?: string | undefined
  /** Wait before a retry; injectable so tests stay fast. */
  delay?: ((ms: number) => Promise<void>) | undefined
}

/** Absolute http(s) URL without fragment, or null (other schemes, blank, unparsable). */
export function normalizeUrl(raw: string, base: URL): string | null {
  const s = raw.trim()
  if (!s) return null
  try {
    const u = new URL(s, base)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    u.hash = ''
    return u.href
  } catch {
    return null
  }
}

const collect = (raws: Iterable<string>, base: URL): string[] => [...new Set([...raws].map((r) => normalizeUrl(r, base)).filter((u): u is string => u !== null))]

const TAG_ATTR: Record<string, string> = { a: 'href', img: 'src', link: 'href', script: 'src' }

/** a[href], img[src], link[href], script[src]; shortcut: regex, not a parser; upgrade if the site starts emitting odd markup. */
export function extractHtml(html: string, base: URL): string[] {
  const raws: string[] = []
  for (const [, name, attrs] of html.matchAll(/<(a|img|link|script)\b([^>]*)>/gi)) {
    const attr = TAG_ATTR[(name as string).toLowerCase()] as string
    const m = new RegExp(`(?:^|\\s)${attr}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs as string)
    const v = m?.[1] ?? m?.[2] ?? m?.[3]
    if (v !== undefined) raws.push(v.replaceAll('&amp;', '&'))
  }
  return collect(raws, base)
}

/** Inline links and images, plus reference definitions. */
export function extractMarkdown(md: string, base: URL): string[] {
  const raws = [...md.matchAll(/!?\[[^\]]*\]\(\s*<?([^)\s>]+)/g), ...md.matchAll(/^\s*\[[^\]]+\]:\s*<?(\S+?)>?\s*$/gm)].map((m) => m[1] as string)
  return collect(raws, base)
}

/** Hostname equals a line or ends with "." + line, case-insensitive. */
export function isIgnored(url: string, ignore: string[]): boolean {
  const host = new URL(url).hostname.toLowerCase()
  return ignore.some((l) => {
    const h = l.toLowerCase()
    return host === h || host.endsWith('.' + h)
  })
}

function describe(e: unknown): string {
  const err = e as { code?: unknown; name?: unknown; message?: unknown }
  if (err.name === 'TimeoutError' || err.name === 'AbortError' || err.code === 'ABORT_ERR') return 'timeout'
  if (typeof err.code === 'string') return err.code
  return typeof err.message === 'string' && err.message ? err.message : 'error'
}

/** GET without following redirects. 2xx/3xx works; anything else fails. Up to `retries` attempts. */
export async function checkUrl(url: string, o: CheckOpts): Promise<CheckResult> {
  let failure: Failure = { url, error: 'error' }
  const wait = o.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  for (let i = 0; i < o.retries; i++) {
    if (i > 0) await wait(1000 * i)
    try {
      const u = new URL(url)
      const local = u.host === o.allowHost
      if (!local && !(await checkHost(u.hostname, o.lookup))) return { ok: false, failure: { url, error: 'blocked address' } } // not retried: the answer will not change
      const res = await guardedRequest(u, {
        method: 'GET',
        headers: { 'user-agent': 'portfolio-health-check', accept: '*/*' },
        timeoutMs: o.timeoutMs,
        lookup: o.lookup,
        allowHost: local ? u.host : undefined,
      })
      if (res.status >= 200 && res.status < 400) return { ok: true, res }
      failure = { url, status: res.status }
    } catch (e) {
      failure = { url, error: describe(e) }
    }
  }
  return { ok: false, failure }
}
