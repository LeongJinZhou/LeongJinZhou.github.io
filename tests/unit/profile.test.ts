import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { fetchContributions } from '../../scripts/lib/github.ts'
import { buildProfile, renderProfileReadme, topLanguages } from '../../scripts/lib/profile.ts'
import type { Project, Site } from '../../scripts/lib/schemas.ts'
import { badgeUrl } from '../../scripts/lib/select.ts'
import { bannerSvg, langsSvg, statsSvg } from '../../scripts/lib/svg.ts'
import { startStub, type Stub } from '../helpers/stub.ts'
import { assertWellFormedXml } from '../helpers/xml.ts'

const template = readFileSync(new URL('../../profile/README.template.md', import.meta.url), 'utf8')

const proj = (name: string, o: Partial<Project> = {}): Project => ({
  name, title: name, description: `${name} does things`, topics: [], language: 'TypeScript', languages: {},
  homepage: null, repoUrl: `https://github.com/LeongJinZhou/${name}`, pushedAt: '2026-01-01T00:00:00Z', stars: 0,
  screenshot: `${name}.webp`, featured: false, readmeHtml: '', ...o,
})
const site = (o: Partial<Site> = {}): Site => ({
  name: 'Leong Jin Zhou', title: 'AI Technologist at QIU', pitch: 'pitch', about: ['x'], linkedinUrl: '', skills: ['TypeScript', 'Claude Code'], ...o,
})

describe('topLanguages (rule 11)', () => {
  it('sums bytes across projects and returns the top 6 by bytes', () => {
    const ps = [
      proj('a', { languages: { TypeScript: 100, CSS: 10, Go: 5, Rust: 4, C: 3, Lua: 2, Zig: 1 } }),
      proj('b', { languages: { TypeScript: 100, Python: 50 } }),
    ]
    const top = topLanguages(ps)
    expect(top.map((l) => l.name)).toEqual(['TypeScript', 'Python', 'CSS', 'Go', 'Rust', 'C'])
    expect(top[0]?.pct).toBeCloseTo((200 / 275) * 100, 5)
  })
  it('is empty with no bytes and keeps fewer than 6 as they are', () => {
    expect(topLanguages([])).toEqual([])
    expect(topLanguages([proj('a', { languages: { Go: 0 } })])).toEqual([])
    expect(topLanguages([proj('a', { languages: { Go: 1 } })])).toEqual([{ name: 'Go', pct: 100 }])
  })
  it('breaks ties by name so output is deterministic', () => {
    expect(topLanguages([proj('a', { languages: { B: 1, A: 1 } })]).map((l) => l.name)).toEqual(['A', 'B'])
  })
})

describe('fetchContributions (rule 11, plan: user(login), never viewer)', () => {
  let stub: Stub
  afterEach(() => stub.close())
  it('reads commits and PRs for the owner and never queries viewer', async () => {
    stub = await startStub()
    expect(await fetchContributions({ baseUrl: stub.url, token: 'tok' })).toEqual({ commits: 321, prs: 45 })
    const body = stub.graphql[0] ?? ''
    expect(body).toContain('user(login:\\"LeongJinZhou\\")')
    expect(body).not.toContain('viewer')
    expect(stub.seenAuth).toEqual(['Bearer tok'])
  })
  it('throws on GraphQL errors, null user and HTTP errors (rule 13)', async () => {
    stub = await startStub('graphql-errors')
    await expect(fetchContributions({ baseUrl: stub.url })).rejects.toThrow('GitHub GraphQL error')
    stub.mode = 'graphql-null-user'
    await expect(fetchContributions({ baseUrl: stub.url })).rejects.toThrow('GitHub GraphQL error')
    stub.mode = 'graphql-partial-errors'
    await expect(fetchContributions({ baseUrl: stub.url })).rejects.toThrow('GitHub GraphQL error')
    stub.mode = 'error500'
    await expect(fetchContributions({ baseUrl: stub.url })).rejects.toThrow('HTTP 500')
  })
  it('refuses a token over non-https', async () => {
    stub = await startStub()
    await expect(fetchContributions({ baseUrl: 'http://example.com', token: 't' })).rejects.toThrow('non-https')
  })
})

describe('SVGs (rule 11)', () => {
  const evil = `<script>alert("x")</script> & 'q'`
  const all = [
    bannerSvg(evil, evil),
    statsSvg({ repos: 4, stars: 7, commits: 321, prs: 45 }, 'dark'),
    statsSvg({ repos: 4, stars: 7, commits: 321, prs: 45 }, 'light'),
    langsSvg([{ name: evil, pct: 60 }, { name: 'C++', pct: 40 }], 'dark'),
    langsSvg([], 'light'),
  ]
  it.each(all.map((s, i) => [i, s] as const))('svg %i is well-formed XML with no external reference', (_i, svg) => {
    assertWellFormedXml(svg)
    expect(svg).not.toMatch(/<script|<image|<foreignObject|href=|url\(|@import/i)
    // The only URL is the xmlns namespace.
    expect(svg.replace('http://www.w3.org/2000/svg', '')).not.toMatch(/https?:/)
  })
  it('escapes text content', () => {
    expect(bannerSvg(evil, 'T')).toContain('&#60;script&#62;')
    expect(bannerSvg(evil, 'T')).not.toContain('<script')
  })
  it('dark and light differ and show the numbers', () => {
    const s = { repos: 4, stars: 7, commits: 321, prs: 45 }
    expect(statsSvg(s, 'dark')).not.toBe(statsSvg(s, 'light'))
    for (const n of ['4', '7', '321', '45']) expect(statsSvg(s, 'dark')).toContain(`>${n}<`)
  })
  it('langs bars show names and rounded percentages', () => {
    const svg = langsSvg([{ name: 'TypeScript', pct: 62.5 }], 'dark')
    expect(svg).toContain('TypeScript')
    expect(svg).toContain('62.5%')
  })
})

describe('renderProfileReadme (rules 7a, 11, 17)', () => {
  const featuredNames = ['b', 'missing', 'a']
  const ps = [proj('a', { homepage: 'https://a.example.com/' }), proj('b', { screenshot: 'custom.png' })]
  const render = (s = site(), p = ps, names = featuredNames) => renderProfileReadme(template, { site: s, projects: p, featured: names })

  it('keeps hand-written lines and replaces only inside markers', () => {
    const out = render()
    const handwritten = template.replace(/<!-- gen:(\w+) -->[\s\S]*?<!-- \/gen:\1 -->/g, '').split('\n').filter((l) => l.trim())
    let at = 0
    for (const l of handwritten) {
      at = out.indexOf(l, at)
      expect(at, l).toBeGreaterThan(-1)
    }
    expect(render()).toBe(out) // deterministic
    expect(renderProfileReadme(out, { site: site(), projects: ps, featured: featuredNames })).toBe(out) // idempotent
  })
  it.each(['banner', 'stats', 'langs', 'snake', 'featured', 'skills', 'contact'])('missing marker %s is an error', (m) => {
    const broken = template.replace(`<!-- gen:${m} -->`, '')
    expect(() => renderProfileReadme(broken, { site: site(), projects: ps, featured: featuredNames })).toThrow(`marker "${m}"`)
    const noClose = template.replace(`<!-- /gen:${m} -->`, '')
    expect(() => renderProfileReadme(noClose, { site: site(), projects: ps, featured: featuredNames })).toThrow(`marker "${m}"`)
  })
  it('featured rows follow featured.txt order, skip absent projects, point at assets/shots', () => {
    const out = render()
    const rows = out.split('\n').filter((l) => l.startsWith('| ') && /assets\/shots\//.test(l))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toContain('assets/shots/custom.png')
    expect(rows[1]).toContain('assets/shots/a.webp')
    expect(rows[1]).toContain('https://a.example.com/')
    expect(rows[0]).not.toContain('live')
  })
  it('escapes table-breaking text in descriptions and titles', () => {
    const out = render(site(), [proj('a', { title: 'x|y', description: 'one | two\nthree <b>', topics: ['t|u'] })], ['a'])
    const row = out.split('\n').find((l) => l.includes('assets/shots/a.webp')) ?? ''
    expect(row.match(/(?<!\\)\|/g)).toHaveLength(5) // 4 columns -> 5 unescaped pipes
    expect(row).not.toContain('<b>')
  })
  it.each([['|', '%7C'], ['<', '%3C'], ['>', '%3E'], ['"', '%22'], ['(', '%28'], [')', '%29'], [' ', '%20']])('percent-encodes %j in link URLs', (ch, enc) => {
    const u = `https://a.example.com/x${ch}y`
    const out = render(site({ linkedinUrl: u }), [proj('a', { homepage: u, repoUrl: u })], ['a'])
    const row = out.split('\n').find((l) => l.includes('assets/shots/a.webp')) ?? ''
    expect(row.match(/(?<!\\)\|/g)).toHaveLength(5) // a raw "|" would add a column
    expect(row).toContain(`x${enc}y`)
    expect(out).toContain(`[LinkedIn](https://a.example.com/x${enc}y)`)
    expect(out.slice(out.indexOf('<!-- gen:featured -->'), out.indexOf('<!-- /gen:featured -->'))).not.toContain(`/x${ch}y`)
  })
  it('a duplicated marker pair is an error', () => {
    const dup = template + '\n<!-- gen:stats -->\n<!-- /gen:stats -->\n'
    expect(() => renderProfileReadme(dup, { site: site(), projects: ps, featured: featuredNames })).toThrow('marker "stats"')
  })
  it('contact: GitHub always, LinkedIn only when set (rule 17)', () => {
    const none = render()
    expect(none).toContain('https://github.com/LeongJinZhou')
    expect(none).not.toMatch(/linkedin/i)
    expect(render(site({ linkedinUrl: 'https://www.linkedin.com/in/someone' }))).toContain('[LinkedIn](https://www.linkedin.com/in/someone)')
  })
  it('skills badges use the shared badgeUrl (URL-encoded) (rule 7a)', () => {
    const out = render(site({ skills: ['Claude Code', 'C++/a-b'] }))
    expect(out).toContain(badgeUrl('Claude Code'))
    expect(out).toContain('C%2B%2B%2Fa--b')
    expect(out).toContain('alt="Claude Code"')
  })
  it('links the generated assets with dark/light variants', () => {
    const out = render()
    for (const f of ['banner', 'stats-dark', 'stats-light', 'langs-dark', 'langs-light', 'snake-dark', 'snake-light']) expect(out).toContain(`assets/${f}.svg`)
  })
})

describe('buildProfile', () => {
  it('returns README and the six SVGs, built from the projects and contributions', () => {
    const files = buildProfile(template, site(), [proj('a', { stars: 3, languages: { Go: 10 } }), proj('b', { stars: 4 })], ['a'], { commits: 9, prs: 8 })
    expect(Object.keys(files).sort()).toEqual([
      'README.md', 'assets/banner.svg', 'assets/langs-dark.svg', 'assets/langs-light.svg', 'assets/stats-dark.svg', 'assets/stats-light.svg',
    ])
    const stats = files['assets/stats-dark.svg'] ?? ''
    for (const n of ['2', '7', '9', '8']) expect(stats).toContain(`>${n}<`) // repos, stars (3+4), commits, PRs
    expect(files['assets/langs-dark.svg']).toContain('Go')
  })
})
