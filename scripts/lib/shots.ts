import { lookup as dnsLookup } from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import { isIP } from 'node:net'
import type { Browser, BrowserContext, Route } from '@playwright/test'
import { cardSvg, type CardInput } from './svg.ts'

export interface Shot {
  width: number
  height: number
  timeoutMs: number
}
export type Lookup = (host: string, opts: { all: true }) => Promise<{ address: string }[]>

/** 16 bytes of an IPv6 address, or null when malformed. */
function v6bytes(ip: string): number[] | null {
  let s = ip.split('%')[0] ?? ''
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (dotted) {
    const o = (dotted[1] as string).split('.').map(Number)
    if (o.some((n) => n > 255)) return null
    s = s.slice(0, -(dotted[1] as string).length) + ((o[0] as number) * 256 + (o[1] as number)).toString(16) + ':' + ((o[2] as number) * 256 + (o[3] as number)).toString(16)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const grp = (h: string) => (h === '' ? [] : h.split(':'))
  const head = grp(halves[0] as string)
  const tail = grp(halves[1] ?? '')
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const groups = [...head, ...Array<string>(Math.max(fill, 0)).fill('0'), ...tail]
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null
  return groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 255])
}

function v4blocked([a, b, c, d]: number[]): boolean {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && (b as number) >= 64 && (b as number) <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && (b as number) >= 16 && (b as number) <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 0) || // 192.0.0.0/24
    (a === 198 && (b === 18 || b === 19)) || // benchmarking 198.18.0.0/15
    (a === 168 && b === 63 && c === 129 && d === 16) || // Azure wire server
    (a as number) >= 224 // multicast + reserved
  )
}

/** True when the address is private, loopback, link-local, unspecified or malformed (fail closed). */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.replace(/^\[|\]$/g, '')
  const kind = isIP(addr.split('%')[0] ?? '')
  if (kind === 4) return v4blocked(addr.split('.').map(Number))
  if (kind !== 6) return true
  const b = v6bytes(addr)
  if (!b) return true
  if (b.slice(0, 12).every((x) => x === 0)) return true // ::, ::1, IPv4-compatible
  if (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff) return v4blocked(b.slice(12)) // ::ffff:a.b.c.d
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) return v4blocked(b.slice(12)) // NAT64
  const [b0, b1, b2, b3, b4, b5] = b as [number, number, number, number, number, number]
  return (
    (b0 & 0xfe) === 0xfc || // fc00::/7
    (b0 === 0xfe && b1 >= 0x80) || // fe80::/10 + fec0::/10
    b0 === 0xff || // multicast
    (b0 === 1 && b.slice(1, 8).every((x) => x === 0)) || // 100::/64 discard
    (b0 === 0 && b1 === 0x64 && b2 === 0xff && b3 === 0x9b && b4 === 0 && b5 === 1) || // 64:ff9b:1::/48
    (b0 === 0x20 && b1 === 1 && b2 === 0 && b3 === 0) || // 2001::/32 Teredo
    (b0 === 0x20 && b1 === 2) // 2002::/16 6to4
  )
}

/** Safe file name for a repo's image (no leading/trailing dots, no "..": each dot of such a run becomes "_"). */
export function shotName(name: string): string {
  return name.replace(/^\.+|\.+$|\.{2,}/g, (m) => '_'.repeat(m.length))
}

/** True when the host is safe to fetch: resolves, and EVERY address is public. */
export async function checkHost(host: string, lookup: Lookup = dnsLookup): Promise<boolean> {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return false
  if (isIP(h.split('%')[0] ?? '')) return !isBlockedAddress(h)
  try {
    const addrs = await lookup(h, { all: true })
    return addrs.length > 0 && addrs.every((a) => !isBlockedAddress(a.address))
  } catch {
    return false
  }
}

/** Rules 8-9: new image if it worked, else the previous one, else the generated card. */
export function chooseShot(ok: boolean, hasPrevious: boolean): 'new' | 'previous' | 'card' {
  return ok ? 'new' : hasPrevious ? 'previous' : 'card'
}

export interface GuardOpts {
  /** Test only: exact "host:port" that may be http and skips the address check. */
  allowHost?: string | undefined
  lookup?: Lookup | undefined
  timeoutMs?: number | undefined
}

export const MAX_BODY = 20 * 1024 * 1024

export interface ReqOpts {
  method: string
  headers: Record<string, string>
  body?: Buffer | null | undefined
  timeoutMs: number
  lookup?: Lookup | undefined
  /** Test only: plain http to this exact "host:port", no lookup guard. */
  allowHost?: string | undefined
}
export interface Res {
  status: number
  headers: Record<string, string>
  body: Buffer
}

/** The socket connects to an address this function approved: resolve all, refuse if ANY is blocked (no DNS rebinding gap). */
function guardedLookup(lookup: Lookup) {
  return (host: string, opts: { all?: boolean }, cb: (err: Error | null, addr?: unknown, family?: number) => void) => {
    lookup(host, { all: true }).then(
      (addrs) => {
        if (addrs.length === 0 || addrs.some((a) => isBlockedAddress(a.address))) return cb(new Error('blocked address'))
        const list = addrs.map((a) => ({ address: a.address, family: isIP(a.address) }))
        if (opts.all) cb(null, list)
        else cb(null, list[0]?.address, list[0]?.family)
      },
      (e: unknown) => cb(e instanceof Error ? e : new Error('lookup failed')),
    )
  }
}

/** One HTTP(S) request, no redirects followed, body capped at MAX_BODY, whole request limited to timeoutMs. */
export function guardedRequest(url: URL, o: ReqOpts): Promise<Res> {
  const plain = url.host === o.allowHost
  return new Promise((resolve, reject) => {
    const req = (plain ? http : https).request(
      url,
      {
        method: o.method,
        headers: o.headers,
        agent: false,
        signal: AbortSignal.timeout(o.timeoutMs),
        ...(plain ? {} : { lookup: guardedLookup(o.lookup ?? dnsLookup) as never }),
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > MAX_BODY) return req.destroy(new Error('response too large'))
          chunks.push(c)
        })
        res.on('error', reject)
        res.on('end', () => {
          const headers: Record<string, string> = {}
          for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(k === 'set-cookie' ? '\n' : ', ') : v
          resolve({ status: res.statusCode ?? 0, headers, body: Buffer.concat(chunks) })
        })
      },
    )
    req.on('error', reject)
    req.end(o.body ?? undefined)
  })
}

/** SSRF guard: https only, every hop (incl. redirects) resolved and checked, no WebSockets. */
export async function installGuard(ctx: BrowserContext, o: GuardOpts = {}): Promise<void> {
  const allowed = async (u: URL) => u.host === o.allowHost || (u.protocol === 'https:' && (await checkHost(u.hostname, o.lookup)))
  await ctx.routeWebSocket('**/*', (ws) => void ws.close())
  await ctx.route('**/*', async (route: Route) => {
    try {
      const url = new URL(route.request().url())
      if (!(await allowed(url))) return await route.abort('blockedbyclient')
      const rq = route.request()
      const headers = { ...rq.headers() }
      delete headers['host']
      delete headers['content-length']
      const res = await guardedRequest(url, { method: rq.method(), headers, body: rq.postDataBuffer(), timeoutMs: o.timeoutMs ?? 30000, lookup: o.lookup, allowHost: o.allowHost })
      const loc = res.status >= 300 && res.status < 400 ? res.headers['location'] : undefined
      // The browser's next hop comes back through this route and is checked again; this stops a blocked hop early.
      if (loc && !(await allowed(new URL(loc, url)))) return await route.abort('blockedbyclient')
      delete res.headers['transfer-encoding']
      delete res.headers['content-length']
      delete res.headers['connection']
      await route.fulfill({ status: res.status, headers: res.headers, body: res.body })
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')
      await route.abort(timedOut ? 'timedout' : 'failed').catch(() => {})
    }
  })
}

/** PNG -> WebP using Chromium itself (no image dependency). */
async function toWebp(browser: Browser, png: Buffer, s: Shot): Promise<Buffer> {
  const ctx = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block' })
  try {
    await ctx.route('**/*', (r) => r.abort())
    const page = await ctx.newPage()
    await page.goto('about:blank')
    const b64 = await page.evaluate(
      async ({ data, w, h }) => {
        const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(w, h)
        canvas.getContext('2d')?.drawImage(bmp, 0, 0, w, h)
        const out = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/webp', quality: 0.85 })).arrayBuffer())
        let bin = ''
        for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000))
        return btoa(bin)
      },
      { data: png.toString('base64'), w: s.width, h: s.height },
    )
    const webp = Buffer.from(b64, 'base64')
    if (webp.toString('latin1', 0, 4) !== 'RIFF' || webp.toString('latin1', 8, 12) !== 'WEBP') throw new Error('Chromium did not return a WebP image')
    return webp
  } finally {
    await ctx.close()
  }
}

/** Screenshot of a live page as WebP. Throws on timeout, blocked host or any error. */
export async function captureUrl(browser: Browser, url: string, s: Shot, o: Omit<GuardOpts, 'timeoutMs'> = {}): Promise<Buffer> {
  const ctx = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: 'block',
    viewport: { width: s.width, height: s.height },
  })
  try {
    ctx.setDefaultTimeout(s.timeoutMs)
    ctx.setDefaultNavigationTimeout(s.timeoutMs)
    await installGuard(ctx, { ...o, timeoutMs: s.timeoutMs })
    const page = await ctx.newPage()
    await page.goto(url, { waitUntil: 'load' })
    return await toWebp(browser, await page.screenshot({ type: 'png' }), s)
  } finally {
    await ctx.close()
  }
}

/** Generated card as WebP (no network). */
export async function renderCard(browser: Browser, p: CardInput, s: Shot): Promise<Buffer> {
  const ctx = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', viewport: { width: s.width, height: s.height } })
  try {
    await ctx.route('**/*', (r) => r.abort())
    const page = await ctx.newPage()
    await page.setContent(`<body style="margin:0">${cardSvg(p, s.width, s.height)}</body>`)
    return await toWebp(browser, await page.screenshot({ type: 'png' }), s)
  } finally {
    await ctx.close()
  }
}
