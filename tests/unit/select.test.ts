import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildProjects, featuredProjects, httpsOnly, selectRepos } from '../../scripts/lib/select.ts'
import { ReposSchema, type Repo } from '../../scripts/lib/schemas.ts'

const load = (f: string) =>
  ReposSchema.parse(JSON.parse(readFileSync(new URL(`../fixtures/github/${f}`, import.meta.url), 'utf8')))
const all = [...load('repos-page1.json'), ...load('repos-page2.json')]
const mk = (name: string, x: Partial<Repo> = {}): Repo => ({
  name,
  description: null,
  topics: [],
  language: null,
  homepage: null,
  pushed_at: '2026-01-01T00:00:00Z',
  default_branch: 'main',
  stargazers_count: 0,
  fork: false,
  archived: false,
  private: false,
  owner: { login: 'LeongJinZhou' },
  ...x,
})
const names = (r: Repo[]) => r.map((x) => x.name)
const none = new Set<string>()

describe('selectRepos (S6, rules 1, 2, 5)', () => {
  it('excludes hidden, fork, archived, private and the two self repos; keeps qiu-ai-video-2026', () => {
    const out = names(selectRepos(all, new Set(['hidden-one'])))
    expect(out).toEqual(['qiu-cpdc-career-portal', 'qiu-ai-video-2026', 'Pocket-G', 'OCR1'])
    for (const bad of ['some-fork', 'old-archived', 'Print', 'hidden-one', 'LeongJinZhou', 'LeongJinZhou.github.io'])
      expect(out).not.toContain(bad)
  })
  it('shows a new public repo (S5)', () => {
    expect(names(selectRepos([...all, mk('brand-new')], none))).toContain('brand-new')
  })
  it('sorts by pushedAt descending', () => {
    const out = selectRepos(
      [
        mk('a', { pushed_at: '2026-01-01T00:00:00Z' }),
        mk('b', { pushed_at: '2026-05-01T00:00:00Z' }),
        mk('c', { pushed_at: '2026-03-01T00:00:00Z' }),
      ],
      none,
    )
    expect(names(out)).toEqual(['b', 'c', 'a'])
  })
  it('self repo and owner checks are case-insensitive; other owners dropped', () => {
    const out = names(
      selectRepos(
        [mk('leongjinzhou'), mk('LEONGJINZHOU.GITHUB.IO'), mk('x', { owner: { login: 'someone' } }), mk('ok')],
        none,
      ),
    )
    expect(out).toEqual(['ok'])
  })
  it('drops names outside ^[A-Za-z0-9._-]+$', () => {
    const out = names(selectRepos([mk('good.name_1-x'), mk('bad name'), mk('bad/name'), mk('b;rm'), mk('ünï')], none))
    expect(out).toEqual(['good.name_1-x'])
  })
  it('drops . and .. names', () => {
    expect(selectRepos([mk('.'), mk('..'), mk('.github')], none).map((r) => r.name)).toEqual(['.github'])
  })
  it('hidden list is case-insensitive', () => {
    expect(names(selectRepos([mk('Pocket-G'), mk('ok')], new Set(['pocket-g'])))).toEqual(['ok'])
  })
  it('empty input gives empty output', () => {
    expect(selectRepos([], none)).toEqual([])
  })
})

describe('featured forks', () => {
  it('includes a fork only when featured (case-insensitive)', () => {
    expect(names(selectRepos([mk('f', { fork: true }), mk('ok')], none, ['F']))).toEqual(expect.arrayContaining(['f', 'ok']))
  })
  it('drops a fork that is not on the featured list', () => {
    expect(selectRepos([mk('f', { fork: true })], none, ['other'])).toEqual([])
  })
  it('hide-list beats featured', () => {
    expect(selectRepos([mk('f', { fork: true })], new Set(['f']), ['f'])).toEqual([])
  })
  it('featured fork that is private or archived is still dropped', () => {
    expect(selectRepos([mk('p', { fork: true, private: true }), mk('a', { fork: true, archived: true })], none, ['p', 'a'])).toEqual([])
  })
})

describe('httpsOnly', () => {
  it.each([
    ['https://a.example.com/x', 'https://a.example.com/x'],
    ['http://a.example.com', null],
    ['javascript:alert(1)', null],
    ['not a url', null],
    ['', null],
    [null, null],
  ])('%s -> %s', (i, o) => expect(httpsOnly(i)).toBe(o))
})

describe('buildProjects (rule 6)', () => {
  const repos = [
    mk('r1', { description: 'api desc', topics: ['t'], language: 'Go', homepage: 'http://x.example.com', stargazers_count: 7 }),
    mk('r2', { homepage: 'https://y.example.com' }),
  ]
  it('takes fields from the API and drops non-https homepage', () => {
    const [p, q] = buildProjects(repos, { r1: { Go: 10 } }, { featured: [], overrides: {} })
    expect(p).toMatchObject({
      name: 'r1',
      title: 'r1',
      description: 'api desc',
      topics: ['t'],
      language: 'Go',
      languages: { Go: 10 },
      homepage: null,
      repoUrl: 'https://github.com/LeongJinZhou/r1',
      stars: 7,
      screenshot: null,
      featured: false,
      readmeHtml: '',
    })
    expect(q).toMatchObject({ description: '', homepage: 'https://y.example.com/', languages: {} })
  })
  it('override replaces title, description, screenshot only', () => {
    const [p] = buildProjects(
      repos,
      {},
      { featured: [], overrides: { r1: { title: 'T', description: 'D', screenshot: 's.webp' } } },
    )
    expect(p).toMatchObject({
      title: 'T',
      description: 'D',
      screenshot: 's.webp',
      topics: ['t'],
      language: 'Go',
      stars: 7,
      pushedAt: '2026-01-01T00:00:00Z',
    })
  })
})

describe('buildProjects lookups', () => {
  it('override and featured match case-insensitively', () => {
    const [p] = buildProjects([mk('Pocket-G')], {}, { featured: ['pocket-g'], overrides: { 'pocket-g': { title: 'T' } } })
    expect(p).toMatchObject({ title: 'T', featured: true })
  })
  it('featuredProjects matches case-insensitively', () => {
    const ps = buildProjects([mk('Pocket-G')], {}, { featured: [], overrides: {} })
    expect(featuredProjects(ps, ['pocket-g']).map((p) => p.name)).toEqual(['Pocket-G'])
  })
  it('__proto__ key is inert', () => {
    const langs = JSON.parse('{"__proto__":{"Go":1}}') as Record<string, Record<string, number>>
    const [p, q] = buildProjects([mk('__proto__'), mk('x')], langs, { featured: [], overrides: {} })
    expect(p?.languages).toEqual({ Go: 1 })
    expect(q?.languages).toEqual({})
  })
})

describe('featuredProjects (rule 4)', () => {
  const projects = buildProjects([mk('a'), mk('b'), mk('c')], {}, { featured: ['c', 'a', 'gone'], overrides: {} })
  it('follows featured order and skips absent (hidden/private) repos', () => {
    expect(featuredProjects(projects, ['c', 'a', 'gone']).map((p) => p.name)).toEqual(['c', 'a'])
  })
  it('marks featured flag', () => {
    expect(projects.map((p) => p.featured)).toEqual([true, false, true])
  })
})
