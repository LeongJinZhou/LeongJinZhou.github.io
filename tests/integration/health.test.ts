// Health check end to end: local stub site -> scan -> failures file -> report with a fake `gh`.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { report, type Gh } from '../../scripts/health-report.ts'
import { scan } from '../../scripts/health-scan.ts'

const root = new URL('../../', import.meta.url)
const script = (f: string) => fileURLToPath(new URL(`scripts/${f}`, root))

let server: Server
let host: string
let tmp: string
const hits: Record<string, number> = {}
const page = (...hrefs: string[]) => `<!doctype html><title>t</title>${hrefs.map((h) => `<a href="${h}">l</a>`).join('')}`

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'health-'))
  server = createServer((req, res) => {
    const html = (b: string) => res.writeHead(200, { 'content-type': 'text/html' }).end(b)
    const p = req.url ?? '/'
    hits[p] = (hits[p] ?? 0) + 1
    switch (req.url) {
      case '/dup/': return html(page('/dup-a/', '/dup-b/', '/shared.png', '/shared.png#x'))
      case '/dup-a/': return html(page('/shared.png', '/dup/'))
      case '/dup-b/': return html(page('/shared.png', '/flaky'))
      case '/shared.png': return res.writeHead(200, { 'content-type': 'image/png' }).end('x')
      case '/flaky': return res.writeHead((hits[p] ?? 0) % 3 === 0 ? 200 : 503).end()
      case '/README-dup.md': return res.writeHead(200).end('[s](/shared.png) [d](/dup-a/)')
      case '/': return html(page('/two/', '/boom', '/moved', 'http://ignored.test/x', 'mailto:a@b.c', '#top'))
      case '/two/': return html(page('/', '/ok.png'))
      case '/chain1/': return html(page('/chain2/'))
      case '/chain2/': return html(page('/x404'))
      case '/ok.png': return res.writeHead(200, { 'content-type': 'image/png' }).end('x')
      case '/moved': return res.writeHead(302, { location: '/two/' }).end()
      case '/boom': return res.writeHead(500).end('no')
      case '/README.md': return res.writeHead(200).end('[ok](/two/) ![i](/ok.png)')
      case '/README-empty.md': return res.writeHead(200).end('no links')
      case '/README-bad.md': return res.writeHead(200).end('[gone](/gone)')
      default: return res.writeHead(404).end()
    }
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.closeAllConnections()
  server.close()
  rmSync(tmp, { recursive: true, force: true })
})

const opts = () => ({
  siteUrl: `http://${host}/`,
  readmeUrl: `http://${host}/README.md`,
  ignore: ['ignored.test'],
  maxPages: 50,
  retries: 1,
  timeoutMs: 2000,
  allowHost: host,
})

describe('scan (S8)', () => {
  it('reports exactly the 500 URL; 302, ignored host, mailto and fragments are not failures', async () => {
    expect(await scan(opts())).toEqual([{ url: `http://${host}/boom`, status: 500 }])
  })
  it('a broken link in the profile README is reported, output sorted by url', async () => {
    const out = await scan({ ...opts(), readmeUrl: `http://${host}/README-bad.md` })
    expect(out).toEqual([{ url: `http://${host}/boom`, status: 500 }, { url: `http://${host}/gone`, status: 404 }])
  })
  it('an unreachable README is itself a failure', async () => {
    const out = await scan({ ...opts(), readmeUrl: `http://${host}/nope.md` })
    expect(out.map((f) => f.url)).toContain(`http://${host}/nope.md`)
  })
  it('maxPages caps the crawl: chain2 is checked but never parsed at maxPages 1', async () => {
    const chain = { ...opts(), siteUrl: `http://${host}/chain1/`, readmeUrl: `http://${host}/README-empty.md` }
    expect(await scan({ ...chain, maxPages: 1 })).toEqual([])
    expect(await scan({ ...chain, maxPages: 3 })).toEqual([{ url: `http://${host}/x404`, status: 404 }])
  })
  it('each URL is checked once even when linked from several pages and the README', async () => {
    for (const k of ['/dup/', '/dup-a/', '/dup-b/', '/shared.png', '/flaky']) hits[k] = 0
    const out = await scan({ ...opts(), siteUrl: `http://${host}/dup/`, readmeUrl: `http://${host}/README-dup.md`, retries: 3 })
    expect(out).toEqual([])
    expect([hits['/dup/'], hits['/dup-a/'], hits['/dup-b/'], hits['/shared.png']]).toEqual([1, 1, 1, 1])
    expect(hits['/flaky']).toBe(3) // rule 15: up to 3 tries, the third one works
  })
  it('scan passes its retries setting down: retries 1 leaves the flaky URL broken', async () => {
    hits['/flaky'] = 0
    const out = await scan({ ...opts(), siteUrl: `http://${host}/dup/`, readmeUrl: `http://${host}/README-dup.md`, retries: 1 })
    expect(out).toEqual([{ url: `http://${host}/flaky`, status: 503 }])
    expect(hits['/flaky']).toBe(1)
  })
  it('unreachable home is a failure entry, not a crash', async () => {
    expect(await scan({ ...opts(), siteUrl: `http://${host}/missing`, readmeUrl: `http://${host}/README-empty.md` })).toEqual([{ url: `http://${host}/missing`, status: 404 }])
  })
})

describe('health-scan CLI', () => {
  const run = (env: Record<string, string>, out: string) =>
    spawnSync(process.execPath, [script('health-scan.ts'), out], { env: { ...process.env, ...env }, encoding: 'utf8' })

  it('exits 0 and writes failures when the site is unreachable (blocked address)', () => {
    const out = join(tmp, 'cli.json')
    const r = run({ SITE_URL: 'https://localhost:1/', PROFILE_README_URL: 'https://localhost:1/README.md' }, out)
    expect(r.status, r.stderr).toBe(0)
    expect(JSON.parse(readFileSync(out, 'utf8'))).toEqual([
      { url: 'https://localhost:1/', error: 'blocked address' },
      { url: 'https://localhost:1/README.md', error: 'blocked address' },
    ])
  })
  it('exits 1 on bad settings', () => {
    const cfg = join(tmp, 'cfg')
    mkdirSync(cfg, { recursive: true })
    writeFileSync(join(cfg, 'settings.json'), JSON.stringify({ health: { retries: 3, timeoutMs: 1000, maxPages: 0 } }))
    writeFileSync(join(cfg, 'health-ignore.txt'), '')
    const r = run({ CONFIG_DIR: cfg }, join(tmp, 'bad.json'))
    expect(r.status).toBe(1)
  })
  it('exits 2 without an output path', () => {
    expect(spawnSync(process.execPath, [script('health-scan.ts')], { encoding: 'utf8' }).status).toBe(2)
  })
})

describe('report (S9) with an in-process gh', () => {
  const now = new Date('2026-11-16T01:00:00Z')
  const failuresFile = (list: unknown) => {
    const p = join(tmp, `f-${Math.random().toString(36).slice(2)}.json`)
    writeFileSync(p, JSON.stringify(list))
    return p
  }
  const fake = (openJson: string) => {
    const calls: { args: string[]; input?: string | undefined }[] = []
    const gh: Gh = async (args, input) => {
      calls.push({ args, input })
      return args[0] === 'issue' && args[1] === 'list' ? openJson : ''
    }
    return { gh, calls }
  }
  const LIST = ['issue', 'list', '--label', 'health-check', '--state', 'open', '--json', 'number,createdAt']

  it('failures + no open issue -> label, list, create with the URL in the body (stdin)', async () => {
    const { gh, calls } = fake('[]')
    await report(failuresFile([{ url: 'https://x.test/a', status: 500 }]), gh, now)
    expect(calls.map((c) => c.args)).toEqual([
      ['label', 'create', 'health-check', '--force'],
      LIST,
      ['issue', 'create', '--title', 'Health check: broken links', '--label', 'health-check', '--body-file', '-'],
    ])
    expect(calls[2]?.input).toContain('`https://x.test/a`')
  })
  it('failures + open issue -> edits the oldest, never creates', async () => {
    const { gh, calls } = fake('[{"number":9,"createdAt":"2026-02-01T00:00:00Z"},{"number":4,"createdAt":"2026-01-01T00:00:00Z"}]')
    await report(failuresFile([{ url: 'https://x.test/a', status: 500 }]), gh, now)
    expect(calls.map((c) => c.args[1])).toEqual(['create', 'list', 'edit'])
    expect(calls[2]?.args).toEqual(['issue', 'edit', '4', '--body-file', '-'])
    expect(calls[2]?.input).toContain('`https://x.test/a`')
  })
  it('no failures + open issue -> closes with a dated comment', async () => {
    const { gh, calls } = fake('[{"number":4,"createdAt":"2026-01-01T00:00:00Z"}]')
    await report(failuresFile([]), gh, now)
    expect(calls[2]?.args).toEqual(['issue', 'close', '4', '--comment', 'All links healthy on 2026-11-16.'])
  })
  it('no failures + several open issues -> closes every one, each with the comment', async () => {
    const { gh, calls } = fake('[{"number":9,"createdAt":"2026-02-01T00:00:00Z"},{"number":4,"createdAt":"2026-01-01T00:00:00Z"}]')
    await report(failuresFile([]), gh, now)
    expect(calls.slice(2).map((c) => c.args)).toEqual([
      ['issue', 'close', '4', '--comment', 'All links healthy on 2026-11-16.'],
      ['issue', 'close', '9', '--comment', 'All links healthy on 2026-11-16.'],
    ])
  })
  it('no failures + no issue -> nothing beyond label and list', async () => {
    const { gh, calls } = fake('[]')
    await report(failuresFile([]), gh, now)
    expect(calls).toHaveLength(2)
  })
  it('rejects a malformed failures file before calling gh', async () => {
    const { gh, calls } = fake('[]')
    await expect(report(failuresFile({ nope: 1 }), gh, now)).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })
  it('S8 chain: scan of a stub site with one 500 -> failures file -> one issue whose body lists that URL', async () => {
    const p = join(tmp, 'chain.json')
    writeFileSync(p, JSON.stringify(await scan(opts())))
    const { gh, calls } = fake('[]')
    await report(p, gh, now)
    const creates = calls.filter((c) => c.args[1] === 'create' && c.args[0] === 'issue')
    expect(creates).toHaveLength(1)
    const items = (creates[0]?.input ?? '').split('\n').filter((l) => l.startsWith('- `'))
    expect(items).toEqual([`- \`http://${host}/boom\` - HTTP 500`])
  })
  it('S9 sequence: failing run creates, next failing run updates the same issue, clean run closes it', async () => {
    let open = '[]'
    const calls: string[][] = []
    const gh: Gh = async (args) => {
      calls.push(args)
      if (args[0] === 'issue' && args[1] === 'list') return open
      if (args[0] === 'issue' && args[1] === 'create') open = '[{"number":21,"createdAt":"2026-11-16T01:00:00Z"}]'
      if (args[0] === 'issue' && args[1] === 'close') open = '[]'
      return ''
    }
    const bad = failuresFile([{ url: 'https://x.test/a', status: 500 }])
    await report(bad, gh, now)
    await report(bad, gh, now)
    await report(failuresFile([]), gh, now)
    await report(failuresFile([]), gh, now)
    const issueOps = calls.filter((c) => c[0] === 'issue' && c[1] !== 'list').map((c) => c.slice(1, 3))
    expect(issueOps).toEqual([['create', '--title'], ['edit', '21'], ['close', '21']])
  })
  it('rejects a malformed issue list', async () => {
    const { gh } = fake('[{"number":"x"}]')
    await expect(report(failuresFile([]), gh, now)).rejects.toThrow()
  })
})

// The real execFile path needs an executable named `gh` on PATH; Windows cannot exec a script by name without a shell.
describe.skipIf(process.platform === 'win32')('health-report CLI with a fake gh on PATH', () => {
  it('edits the open issue and passes the body on stdin', () => {
    const bin = join(tmp, 'bin')
    mkdirSync(bin, { recursive: true })
    const log = join(tmp, 'gh.log')
    const gh = join(bin, 'gh')
    writeFileSync(
      gh,
      `#!/usr/bin/env node
const fs = require('node:fs')
const a = process.argv.slice(2)
const input = a.includes('-') ? fs.readFileSync(0, 'utf8') : ''
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify({ a, input, repo: process.env.GH_REPO }) + '\\n')
if (a[0] === 'issue' && a[1] === 'list') process.stdout.write('[{"number":12,"createdAt":"2026-01-01T00:00:00Z"}]')
`,
    )
    chmodSync(gh, 0o755)
    const f = join(tmp, 'cli-failures.json')
    writeFileSync(f, JSON.stringify([{ url: 'https://x.test/a', status: 500 }]))
    const r = spawnSync(process.execPath, [script('health-report.ts'), f], {
      env: { ...process.env, PATH: bin + delimiter + (process.env.PATH ?? ''), GITHUB_REPOSITORY: 'o/r' },
      encoding: 'utf8',
    })
    expect(r.status, r.stderr).toBe(0)
    const calls = readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { a: string[]; input: string; repo: string })
    expect(calls.map((c) => c.a.slice(0, 2))).toEqual([['label', 'create'], ['issue', 'list'], ['issue', 'edit']])
    expect(calls[2]?.a).toEqual(['issue', 'edit', '12', '--body-file', '-'])
    expect(calls[2]?.input).toContain('`https://x.test/a`')
    expect(calls[0]?.repo).toBe('o/r')
  })
})
