import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { OverrideSchema, REPO_NAME, RepoSchema, SettingsSchema } from '../../scripts/lib/schemas.ts'
import { readList } from '../../scripts/lib/list.ts'
import { loadOverrides } from '../../scripts/refresh.ts'

const cfg = (f: string) => fileURLToPath(new URL(`../../config/${f}`, import.meta.url))

describe('schemas', () => {
  it('override rejects unknown fields', () => {
    expect(() => OverrideSchema.parse({ title: 'x', topics: [] })).toThrow()
    expect(OverrideSchema.parse({ title: 'x' })).toEqual({ title: 'x' })
  })
  it('settings rejects unknown fields', () => {
    expect(() =>
      SettingsSchema.parse({ health: { retries: 3, timeoutMs: 1, maxPages: 1 }, shot: { width: 1, height: 1, timeoutMs: 1 }, extra: 1 }),
    ).toThrow()
    expect(() => SettingsSchema.parse({ health: { retries: 3, timeoutMs: 1, maxPages: 0 }, shot: { width: 1, height: 1, timeoutMs: 1 } })).toThrow()
  })
  it('repo rejects wrong types', () => {
    expect(() => RepoSchema.parse({ name: 5 })).toThrow()
  })
})

describe('schema hardening', () => {
  const repo = { name: 'r', description: null, topics: [], language: null, homepage: null, pushed_at: '2026-01-01T00:00:00Z', stargazers_count: 0, fork: false, archived: false, private: false, owner: { login: 'a' }, default_branch: 'main' }
  it.each(['.', '..', 'a b', ''])('REPO_NAME rejects %j', (n) => expect(REPO_NAME.test(n)).toBe(false))
  it.each(['.github', 'a.b_c-d', '...'])('REPO_NAME accepts %j', (n) => expect(REPO_NAME.test(n)).toBe(true))
  it('default_branch is required and non-empty', () => {
    expect(() => RepoSchema.parse({ ...repo, default_branch: undefined })).toThrow()
    expect(() => RepoSchema.parse({ ...repo, default_branch: '' })).toThrow()
  })
  it('pushed_at must be an ISO datetime', () => {
    expect(RepoSchema.parse(repo).pushed_at).toBe('2026-01-01T00:00:00Z')
    expect(() => RepoSchema.parse({ ...repo, pushed_at: 'yesterday' })).toThrow()
  })
  it.each(['a.webp', 'my-shot_1.PNG'.toLowerCase(), 'x.jpg'])('screenshot accepts %s', (f) => expect(OverrideSchema.parse({ screenshot: f })).toEqual({ screenshot: f }))
  it.each(['../a.webp', '..webp', '/etc/a.webp', 'a/b.webp', 'https://x.com/a.webp', 'a.svg', 'a\b.webp', 'a/../b.webp'])('screenshot rejects %s', (f) => expect(() => OverrideSchema.parse({ screenshot: f })).toThrow())
})

describe('repo config files', () => {
  it('settings.json is valid with the planned numbers', () => {
    expect(SettingsSchema.parse(JSON.parse(readFileSync(cfg('settings.json'), 'utf8')))).toEqual({
      health: { retries: 3, timeoutMs: 15000, maxPages: 50 },
      shot: { width: 1280, height: 800, timeoutMs: 30000 },
    })
  })
  const featured = [
    'qiu-cpdc-career-portal',
    'qiu-sld-campus-hub',
    'sld-event-verifier',
    'university-ims-erp',
    'Healthcare-Analysis-POC',
    'SmartRecipe-ContextAware-iOS',
    'Pocket-G',
    'OCR1',
  ]
  it('featured.txt has the 8 projects in rule 4 order', () => {
    expect(readList(cfg('featured.txt'))).toEqual(featured)
  })
  it('health-ignore lists bot-blocking hosts and localhost; hidden.txt has only comments', () => {
    expect(readList(cfg('health-ignore.txt'))).toEqual(['linkedin.com', 'openai.com', 'localhost'])
    expect(readList(cfg('hidden.txt'))).toEqual([])
  })
  it('every featured repo has a valid override with title and description', () => {
    const o = loadOverrides(cfg('overrides'))
    expect(Object.keys(o).sort()).toEqual([...featured].sort())
    for (const v of Object.values(o)) expect(v.title && v.description).toBeTruthy()
  })
})
