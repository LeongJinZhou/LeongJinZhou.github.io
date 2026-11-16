// Real Chromium against a local HTTP server. allowHost is a function parameter, never env.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chromium, type Browser } from '@playwright/test'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runShots } from '../../scripts/screenshots.ts'
import { captureUrl, installGuard } from '../../scripts/lib/shots.ts'

const S = { width: 1280, height: 800, timeoutMs: 20000 }
const FAST = { ...S, timeoutMs: 1500 }

/** Width and height of a lossy (VP8), lossless (VP8L) or extended (VP8X) WebP. */
function webpSize(b: Buffer): { w: number; h: number } {
  expect(b.toString('latin1', 0, 4)).toBe('RIFF')
  expect(b.toString('latin1', 8, 12)).toBe('WEBP')
  const k = b.toString('latin1', 12, 16)
  if (k === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff }
  if (k === 'VP8X') return { w: b.readUIntLE(24, 3) + 1, h: b.readUIntLE(27, 3) + 1 }
  expect(k).toBe('VP8L')
  const v = b.readUInt32LE(21)
  return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 }
}

let server: Server
let host: string
let browser: Browser
let tmp: string
let n = 0
const sockets = new Set<import('node:net').Socket>()

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'shots-'))
  server = createServer((req, res) => {
    if (req.url === '/hang') return // never answers
    if (req.url === '/big') {
      res.writeHead(200, { 'content-type': 'text/html' })
      const chunk = Buffer.alloc(1024 * 1024, 'a')
      for (let i = 0; i < 22; i++) res.write(chunk)
      res.end()
      return
    }
    if (req.url === '/to-private') {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }).end()
      return
    }
    if (req.url === '/to-rebind') {
      res.writeHead(302, { location: 'https://rebind.test/' }).end()
      return
    }
    res.writeHead(200, { 'content-type': 'text/html' }).end('<body style="margin:0;background:#c33"><h1>hello</h1></body>')
  })
  server.on('connection', (s) => sockets.add(s))
  // Real WebSocket handshake, so an unguarded socket would actually open.
  server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(`${req.headers['sec-websocket-key']}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64')
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`
  browser = await chromium.launch()
}, 60000)

afterAll(async () => {
  await browser?.close()
  sockets.forEach((s) => s.destroy())
  server?.close()
  rmSync(tmp, { recursive: true, force: true })
})

const project = (name: string, homepage: string | null, extra: Record<string, unknown> = {}) => ({
  name, title: name, description: '', topics: ['a<b'], language: 'TypeScript', languages: {},
  homepage, repoUrl: `https://github.com/x/${name}`, pushedAt: '2026-01-01T00:00:00Z', stars: 0,
  screenshot: `${name}.webp`, featured: false, readmeHtml: '', ...extra,
})

function setup(projects: unknown[]) {
  const dir = join(tmp, `case-${n++}`)
  const gen = join(dir, 'gen')
  const prev = join(dir, 'prev')
  mkdirSync(gen, { recursive: true })
  mkdirSync(prev, { recursive: true })
  writeFileSync(join(gen, 'projects.json'), JSON.stringify(projects))
  return { gen, prev, out: () => JSON.parse(readFileSync(join(gen, 'projects.json'), 'utf8')) as { name: string; screenshot: string | null }[] }
}

// Map the schema-valid https homepage onto the local server, through the real capture + guard.
const viaLocal = (path: (u: string) => string) => (b: Browser, u: string, s: typeof S) => captureUrl(b, `http://${host}${path(u)}`, s, { allowHost: host })

describe('captureUrl', () => {
  it('captures a local page as a 1280x800 WebP', async () => {
    const webp = await captureUrl(browser, `http://${host}/`, S, { allowHost: host })
    expect(webpSize(webp)).toEqual({ w: 1280, h: 800 })
  })
  it('blocks a non-https page when it is not the allow-host', async () => {
    await expect(captureUrl(browser, `http://${host}/`, FAST)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/)
  })
  it('blocks a redirect to a private address', async () => {
    await expect(captureUrl(browser, `http://${host}/to-private`, FAST, { allowHost: host })).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/)
  })
  it('blocks a redirect to a hostname that resolves to loopback', async () => {
    const ctx = await browser.newContext()
    await installGuard(ctx, { allowHost: host, lookup: async () => [{ address: '127.0.0.1' }] })
    const page = await ctx.newPage()
    await expect(page.goto(`http://${host}/to-rebind`, { timeout: 3000 })).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/)
    await ctx.close()
  }, 20000)
  it('blocks plain http even when the host resolves to a public address', async () => {
    const ctx = await browser.newContext()
    await installGuard(ctx, { lookup: async () => [{ address: '93.184.216.34' }] })
    const page = await ctx.newPage()
    await expect(page.goto('http://public.test/', { timeout: 5000 })).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/)
    await ctx.close()
  })
  it('stops a blocked redirect hop before the browser requests it', async () => {
    const ctx = await browser.newContext()
    await installGuard(ctx, { allowHost: host, lookup: async () => [{ address: '127.0.0.1' }] })
    const seen: string[] = []
    ctx.on('request', (r) => seen.push(r.url()))
    const page = await ctx.newPage()
    await expect(page.goto(`http://${host}/to-rebind`, { timeout: 3000 })).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/)
    expect(seen.some((u) => u.includes('rebind.test'))).toBe(false)
    await ctx.close()
  }, 15000)
  it('blocks WebSockets', async () => {
    const ctx = await browser.newContext()
    await installGuard(ctx, { allowHost: host })
    const page = await ctx.newPage()
    await page.goto(`http://${host}/`)
    const state = await page.evaluate(
      (h) => new Promise<string>((res) => {
        const ws = new WebSocket(`ws://${h}/`)
        ws.onopen = () => res('open')
        ws.onclose = () => res('closed')
        ws.onerror = () => res('error')
      }),
      host,
    )
    expect(state).not.toBe('open')
    await ctx.close()
  })
  it('times out on a hanging page', async () => {
    const t = Date.now()
    await expect(captureUrl(browser, `http://${host}/hang`, FAST, { allowHost: host })).rejects.toThrow(/Timeout|ERR_TIMED_OUT/)
    expect(Date.now() - t).toBeLessThan(15000)
  })
  it('rejects a response over the 20 MB cap', async () => {
    await expect(captureUrl(browser, `http://${host}/big`, S, { allowHost: host })).rejects.toThrow(/ERR_/)
  }, 60000)
})

describe('runShots', () => {
  it('ok -> new shot; no homepage -> card; override left untouched', async () => {
    const c = setup([project('live', 'https://live.test/'), project('plain', null), project('over', 'https://over.test/', { screenshot: 'mine.png' })])
    const before = c.out()
    const failures = await runShots(c.gen, c.prev, { shot: S, capture: viaLocal(() => '/') })
    expect(failures).toEqual([])
    expect(c.out()).toEqual(before) // projects.json is never written here (trust split)
    expect(readdirSync(join(c.gen, 'shots')).sort()).toEqual(['live.webp', 'plain.webp'])
    expect(webpSize(readFileSync(join(c.gen, 'shots', 'live.webp')))).toEqual({ w: 1280, h: 800 })
    expect(webpSize(readFileSync(join(c.gen, 'shots', 'plain.webp')))).toEqual({ w: 1280, h: 800 })
    expect(existsSync(join(c.gen, 'shots', 'over.webp'))).toBe(false)
  })
  it('hanging page: times out, keeps previous image, reports failure', async () => {
    const c = setup([project('slow', 'https://slow.test/')])
    const old = await captureUrl(browser, `http://${host}/`, S, { allowHost: host })
    writeFileSync(join(c.prev, 'slow.webp'), old)
    const failures = await runShots(c.gen, c.prev, { shot: FAST, capture: viaLocal(() => '/hang') })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toMatch(/^slow: .*(Timeout|ERR_TIMED_OUT)/)
    expect(readFileSync(join(c.gen, 'shots', 'slow.webp'))).toEqual(old)
  })
  it('failure with no previous image falls back to the card', async () => {
    const c = setup([project('slow', 'https://slow.test/')])
    const failures = await runShots(c.gen, c.prev, { shot: FAST, capture: viaLocal(() => '/hang') })
    expect(failures).toHaveLength(1)
    expect(webpSize(readFileSync(join(c.gen, 'shots', 'slow.webp')))).toEqual({ w: 1280, h: 800 })
  })
  it('a previous file that is not a WebP is ignored', async () => {
    const c = setup([project('slow', 'https://slow.test/')])
    writeFileSync(join(c.prev, 'slow.webp'), 'not an image at all')
    await runShots(c.gen, c.prev, { shot: FAST, capture: viaLocal(() => '/hang') })
    expect(webpSize(readFileSync(join(c.gen, 'shots', 'slow.webp')))).toEqual({ w: 1280, h: 800 })
  })
  it('the real guard rejects an https homepage that resolves nowhere public (default capture)', async () => {
    const c = setup([project('priv', 'https://localhost/')])
    const failures = await runShots(c.gen, c.prev, { shot: FAST })
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('net::ERR_BLOCKED_BY_CLIENT')
    expect(webpSize(readFileSync(join(c.gen, 'shots', 'priv.webp')))).toEqual({ w: 1280, h: 800 }) // card
  })
  it('a repo name with leading/trailing/double dots gets a safe file name', async () => {
    const c = setup([project('.github', null, { screenshot: '_github.webp' }), project('a..b', null, { screenshot: 'a__b.webp' })])
    expect(await runShots(c.gen, c.prev, { shot: S })).toEqual([])
    expect(readdirSync(join(c.gen, 'shots')).sort()).toEqual(['_github.webp', 'a__b.webp'])
  })
})

describe('CLI', () => {
  const cli = (args: string[], env: Record<string, string> = {}) =>
    spawnSync(process.execPath, ['scripts/screenshots.ts', ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 120000 })
  it('writes failed=true to GITHUB_OUTPUT and exits 0 on screenshot failure', () => {
    const c = setup([project('priv', 'https://localhost/')])
    const out = join(tmp, `out-${n++}.txt`)
    const r = cli([c.gen, c.prev], { GITHUB_OUTPUT: out })
    expect(r.status).toBe(0)
    expect(readFileSync(out, 'utf8')).toBe('failed=true\n')
    expect(r.stderr).toContain('screenshot failure: priv')
    expect(r.stderr).toContain('net::ERR_BLOCKED_BY_CLIENT')
  })
  it('writes failed=false when all fine', () => {
    const c = setup([project('plain', null)])
    const out = join(tmp, `out-${n++}.txt`)
    const r = cli([c.gen, c.prev], { GITHUB_OUTPUT: out })
    expect(r.status).toBe(0)
    expect(readFileSync(out, 'utf8')).toBe('failed=false\n')
  })
  it('exits 2 on missing args and on bad projects.json', () => {
    expect(cli([]).status).toBe(2)
    const c = setup([{ name: 1 }])
    expect(cli([c.gen, c.prev]).status).toBe(2)
  })
})
