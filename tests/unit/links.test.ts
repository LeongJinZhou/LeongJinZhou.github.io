import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkUrl, extractHtml, extractMarkdown, isIgnored, normalizeUrl } from '../../scripts/lib/links.ts'

const base = new URL('https://site.test/a/b/')

describe('normalizeUrl', () => {
  it('resolves relative, drops fragment, keeps http and https only', () => {
    expect(normalizeUrl('../c?x=1#top', base)).toBe('https://site.test/a/c?x=1')
    expect(normalizeUrl('//cdn.test/x.js', base)).toBe('https://cdn.test/x.js')
    expect(normalizeUrl('http://plain.test/', base)).toBe('http://plain.test/')
  })
  it.each(['mailto:a@b.c', 'javascript:alert(1)', 'data:text/plain,hi', 'tel:123', 'ftp://x.test/f', '', '   ', 'http://'])('rejects %j', (raw) => {
    expect(normalizeUrl(raw, base)).toBeNull()
  })
})

describe('extractHtml', () => {
  it('collects a[href], img[src], link[href], script[src], decodes &amp;, dedupes', () => {
    const html = `
      <a href="/x?a=1&amp;b=2">x</a><A HREF='/x?a=1&b=2'>dup</A>
      <img src=pic.png alt=""><link rel="stylesheet" href="/s.css"><script src="https://cdn.test/j.js"></script>
      <a href="mailto:me@x.test">m</a><a href="#top">top</a><a data-href="/no" data-src="/no2">n</a>
      <div src="/not-a-tag-we-care-about"></div><a>no href</a>`
    expect(extractHtml(html, base).sort()).toEqual(
      ['https://site.test/x?a=1&b=2', 'https://site.test/a/b/pic.png', 'https://site.test/s.css', 'https://cdn.test/j.js', 'https://site.test/a/b/'].sort(),
    )
  })
  it('handles empty input', () => expect(extractHtml('', base)).toEqual([]))
})

describe('extractMarkdown', () => {
  it('collects links, images and reference definitions', () => {
    const md = `[a](https://one.test/) ![img](./i.png "t") [b](<https://two.test/x>) [c][r]\n\n[r]: https://three.test/ref\n[m](mailto:x@y.z)`
    expect(extractMarkdown(md, new URL('https://raw.test/u/r/main/README.md')).sort()).toEqual(
      ['https://one.test/', 'https://raw.test/u/r/main/i.png', 'https://two.test/x', 'https://three.test/ref'].sort(),
    )
  })
  it('handles empty input', () => expect(extractMarkdown('', base)).toEqual([]))
})

describe('isIgnored', () => {
  const ignore = ['linkedin.com']
  it('matches exact host and subdomains, case-insensitive', () => {
    expect(isIgnored('https://linkedin.com/in/x', ignore)).toBe(true)
    expect(isIgnored('https://WWW.LinkedIn.com/in/x', ignore)).toBe(true)
  })
  it('does not match look-alikes or paths', () => {
    expect(isIgnored('https://notlinkedin.com/', ignore)).toBe(false)
    expect(isIgnored('https://evil.test/linkedin.com', ignore)).toBe(false)
    expect(isIgnored('https://linkedin.com.evil.test/', ignore)).toBe(false)
  })
  it('empty list ignores nothing', () => expect(isIgnored('https://linkedin.com/', [])).toBe(false))
})

describe('checkUrl', () => {
  let server: Server
  let host: string
  const hits: Record<string, number> = {}
  beforeAll(async () => {
    server = createServer((req, res) => {
      const p = req.url ?? '/'
      hits[p] = (hits[p] ?? 0) + 1
      if (p === '/ok') return res.writeHead(200, { 'content-type': 'text/html' }).end('<a href="/z">z</a>')
      if (p === '/redir') return res.writeHead(302, { location: '/ok' }).end()
      if (p === '/404') return res.writeHead(404).end()
      if (p === '/500') return res.writeHead(500).end()
      if (p === '/400') return res.writeHead(400).end()
      if (p === '/399') return res.writeHead(399).end()
      if (p === '/204') return res.writeHead(204).end()
      if (p === '/flaky') return res.writeHead(hits[p] < 3 ? 503 : 200).end()
      if (p === '/hang') return
      res.writeHead(200).end()
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    host = `127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })
  const o = () => ({ retries: 3, timeoutMs: 1000, allowHost: host, delay: async () => {} })

  it('2xx is ok and returns the body', async () => {
    const r = await checkUrl(`http://${host}/ok`, o())
    expect(r.ok && r.res.status).toBe(200)
    expect(r.ok && r.res.body.toString()).toContain('href')
    expect(hits['/ok']).toBe(1)
  })
  it('3xx is ok and is not followed', async () => {
    const r = await checkUrl(`http://${host}/redir`, o())
    expect(r.ok && r.res.status).toBe(302)
    expect(hits['/ok']).toBe(1) // only the earlier test
  })
  it('404 and 500 fail with their status, tried exactly `retries` times', async () => {
    expect(await checkUrl(`http://${host}/404`, o())).toEqual({ ok: false, failure: { url: `http://${host}/404`, status: 404 } })
    expect(hits['/404']).toBe(3)
    expect(await checkUrl(`http://${host}/500`, { ...o(), retries: 1 })).toMatchObject({ ok: false, failure: { status: 500 } })
    expect(hits['/500']).toBe(1)
  })
  it('rule 15 boundaries: 204 and 399 work, 400 fails', async () => {
    expect(await checkUrl(`http://${host}/204`, o())).toMatchObject({ ok: true, res: { status: 204 } })
    expect(await checkUrl(`http://${host}/399`, o())).toMatchObject({ ok: true, res: { status: 399 } })
    expect(await checkUrl(`http://${host}/400`, o())).toEqual({ ok: false, failure: { url: `http://${host}/400`, status: 400 } })
    expect(hits['/400']).toBe(3)
  })
  it('a later attempt that succeeds wins', async () => {
    const r = await checkUrl(`http://${host}/flaky`, o())
    expect(r.ok).toBe(true)
    expect(hits['/flaky']).toBe(3)
  })
  it('timeout fails with error "timeout"', async () => {
    const r = await checkUrl(`http://${host}/hang`, { ...o(), retries: 1, timeoutMs: 150 })
    expect(r).toEqual({ ok: false, failure: { url: `http://${host}/hang`, error: 'timeout' } })
  })
  it('connection refused fails with the error code', async () => {
    const dead = createServer()
    await new Promise<void>((r) => dead.listen(0, '127.0.0.1', r))
    const h = `127.0.0.1:${(dead.address() as AddressInfo).port}`
    await new Promise<void>((r) => dead.close(() => r()))
    const r = await checkUrl(`http://${h}/`, { retries: 1, timeoutMs: 1000, allowHost: h })
    expect(r).toMatchObject({ ok: false, failure: { error: 'ECONNREFUSED' } })
  })
  it('private and loopback addresses are blocked by default, no request sent', async () => {
    const before = hits['/ok']
    const r = await checkUrl(`http://${host}/ok`, { retries: 1, timeoutMs: 500 })
    expect(r).toMatchObject({ ok: false, failure: { error: 'blocked address' } })
    expect(await checkUrl('https://localhost/', { retries: 1, timeoutMs: 500 })).toMatchObject({ ok: false, failure: { error: 'blocked address' } })
    expect(hits['/ok']).toBe(before)
  })
  it('plain http to a host whose lookup says loopback is blocked and counted as a failure', async () => {
    const port = host.split(':')[1]
    const lookup = async () => [{ address: '127.0.0.1' }]
    const before = hits['/ok']
    const r = await checkUrl(`http://public.test:${port}/ok`, { retries: 1, timeoutMs: 500, lookup })
    expect(r).toEqual({ ok: false, failure: { url: `http://public.test:${port}/ok`, error: 'blocked address' } })
    expect(hits['/ok']).toBe(before)
  })
  it('plain http is guarded at connect time: a DNS answer that flips to loopback after the first check is refused', async () => {
    const port = host.split(':')[1]
    let calls = 0
    const lookup = async () => [{ address: calls++ === 0 ? '93.184.216.34' : '127.0.0.1' }]
    const before = hits['/ok']
    const r = await checkUrl(`http://rebind.test:${port}/ok`, { retries: 1, timeoutMs: 500, lookup })
    expect(r).toMatchObject({ ok: false, failure: { error: 'blocked address' } })
    expect(calls).toBeGreaterThan(1)
    expect(hits['/ok']).toBe(before)
  })
  it('waits 1000*i ms before attempt i > 0', async () => {
    const waits: number[] = []
    await checkUrl(`http://${host}/404`, { ...o(), delay: async (ms: number) => void waits.push(ms) })
    expect(waits).toEqual([1000, 2000])
    waits.length = 0
    await checkUrl(`http://${host}/ok`, { ...o(), delay: async (ms: number) => void waits.push(ms) })
    expect(waits).toEqual([])
  })
})
