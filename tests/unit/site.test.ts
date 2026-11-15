import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ProjectSchema, SiteSchema } from '../../scripts/lib/schemas.ts'
import { badgeUrl, demoteHeadings, loadData, loadSite, languageShares, stackOf, techList } from '../../src/lib/data.ts'
import site from '../../config/site.json' with { type: 'json' }

const fx = (f: string) => join(import.meta.dirname, '..', 'fixtures', f)
const proj = (o: object) => ({
  name: 'x', title: 'x', description: '', topics: [], language: null, languages: {}, homepage: null,
  repoUrl: 'https://github.com/LeongJinZhou/x', pushedAt: '2026-01-01T00:00:00Z', stars: 0, screenshot: null,
  featured: false, readmeHtml: '', ...o,
})

describe('techList', () => {
  it('is language + topics, deduped case-insensitively, sorted, nulls skipped', () => {
    const list = techList([
      proj({ language: 'TypeScript', topics: ['nextjs', 'Prisma'] }),
      proj({ language: 'typescript', topics: ['prisma', 'swift'] }),
      proj({ language: null, topics: [] }),
    ])
    expect(list).toEqual(['nextjs', 'Prisma', 'swift', 'TypeScript'])
  })
})

describe('loadData', () => {
  it('re-applies the hide-list and keeps featured order from featured.txt', () => {
    const { projects, featured } = loadData({
      dataDir: fx('generated'),
      hiddenFile: fx('hidden.txt'),
      featuredFile: join(import.meta.dirname, '..', '..', 'config', 'featured.txt'),
    })
    expect(projects.map((p) => p.name)).not.toContain('hidden-demo')
    expect(projects.map((p) => p.name)).toContain('qiu-ai-video-2026')
    expect(featured.map((p) => p.name)[0]).toBe('qiu-cpdc-career-portal')
    expect(featured).toHaveLength(8)
  })
  it('a featured repo that is hidden is skipped', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hid-'))
    const hid = join(dir, 'hidden.txt')
    writeFileSync(hid, '# c\nOCR1\n')
    const { featured } = loadData({
      dataDir: fx('generated'),
      hiddenFile: hid,
      featuredFile: join(import.meta.dirname, '..', '..', 'config', 'featured.txt'),
    })
    expect(featured.map((p) => p.name)).not.toContain('OCR1')
    expect(featured).toHaveLength(7)
  })
  it('fails with a clear message when DATA_DIR is missing', () => {
    expect(() => loadData({})).toThrow(/DATA_DIR is not set/)
  })
  it('fails with a clear message when projects.json is missing', () => {
    expect(() => loadData({ dataDir: mkdtempSync(join(tmpdir(), 'empty-')) })).toThrow(/projects\.json/)
  })
  it('rejects malformed data', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bad-'))
    writeFileSync(join(dir, 'projects.json'), '[{"name":"x"}]')
    expect(() => loadData({ dataDir: dir })).toThrow()
  })
})

describe('languageShares', () => {
  it('turns bytes into percentages that sum to 100, biggest first', () => {
    const s = languageShares({ A: 50, B: 30, C: 20 })
    expect(s.map((x) => x.name)).toEqual(['A', 'B', 'C'])
    expect(s.reduce((n, x) => n + x.pct, 0)).toBeCloseTo(100)
  })
  it('is empty for no data', () => expect(languageShares({})).toEqual([]))
  it('groups the tail as Other beyond 5 languages', () => {
    const s = languageShares({ A: 6, B: 5, C: 4, D: 3, E: 2, F: 1, G: 1 })
    expect(s).toHaveLength(6)
    expect(s.at(-1)?.name).toBe('Other')
  })
})

describe('site config', () => {
  it('config/site.json is valid and has no contact data', () => {
    const s = SiteSchema.parse(site)
    expect(s.linkedinUrl).toBe('')
    expect(JSON.stringify(s)).not.toMatch(/@|\+?\d{8,}/)
  })
  it('rejects unknown fields and non-https linkedin', () => {
    expect(() => SiteSchema.parse({ ...site, email: 'a@b.c' })).toThrow()
    expect(() => SiteSchema.parse({ ...site, linkedinUrl: 'http://linkedin.com/in/x' })).toThrow()
    expect(SiteSchema.parse({ ...site, linkedinUrl: 'https://www.linkedin.com/in/x' }).linkedinUrl).toContain('linkedin')
  })
})

describe('badgeUrl', () => {
  it('url-encodes the skill and escapes shields separators', () => {
    expect(badgeUrl('Claude Code')).toMatch(/^https:\/\/img\.shields\.io\/badge\/Claude_Code-/)
    expect(badgeUrl('C++/a-b')).toContain('C%2B%2B%2Fa--b')
    expect(badgeUrl('a?b#c')).not.toMatch(/[?#].*[?#]/)
  })
})

describe('demoteHeadings', () => {
  it('shifts headings down two levels, capped at h6, and leaves other tags alone', () => {
    expect(demoteHeadings('<h1>a</h1><h2 id="x">b</h2><h5>c</h5><hr><header>d</header>')).toBe('<h3>a</h3><h4 id="x">b</h4><h6>c</h6><hr><header>d</header>')
  })
})

describe('invalid input names the file', () => {
  it('bad projects.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'json-'))
    writeFileSync(join(dir, 'projects.json'), '{nope')
    expect(() => loadData({ dataDir: dir })).toThrow(/Invalid JSON in .*projects\.json/)
  })
  it('bad site.json', () => {
    const dir = mkdtempSync(join(tmpdir(), 'site-'))
    mkdirSync(join(dir, 'config'))
    writeFileSync(join(dir, 'config', 'site.json'), '{nope')
    expect(() => loadSite(dir)).toThrow(/Invalid JSON in .*site\.json/)
  })
})

describe('ProjectSchema urls', () => {
  const base = JSON.parse(readFileSync(fx('generated/projects.json'), 'utf8'))[0]
  it('accepts https and null homepage', () => {
    expect(ProjectSchema.parse(base).homepage).toMatch(/^https:/)
    expect(ProjectSchema.parse({ ...base, homepage: null }).homepage).toBeNull()
  })
  it.each([{ homepage: 'http://x.example.com' }, { homepage: 'javascript:alert(1)' }, { repoUrl: 'http://github.com/a/b' }, { repoUrl: 'data:text/html,x' }])(
    'rejects %j',
    (o) => expect(() => ProjectSchema.parse({ ...base, ...o })).toThrow(),
  )
})

describe('stackOf', () => {
  it('language first, topics that repeat it (any case) or each other dropped', () => {
    expect(stackOf(proj({ language: 'Swift', topics: ['swift', 'supabase', 'Supabase'] }))).toEqual(['Swift', 'supabase'])
    expect(stackOf(proj({ language: null, topics: ['a'] }))).toEqual(['a'])
  })
})

describe('screenshot handling', () => {
  const dirWith = (shots: string[]) => {
    const dir = mkdtempSync(join(tmpdir(), 'shot-'))
    mkdirSync(join(dir, 'shots'))
    for (const s of shots) writeFileSync(join(dir, 'shots', s), 'x')
    const p = { ...JSON.parse(readFileSync(fx('generated/projects.json'), 'utf8'))[0], screenshot: 'a.webp' }
    writeFileSync(join(dir, 'projects.json'), JSON.stringify([p]))
    return dir
  }
  it('keeps the screenshot when the file exists', () => {
    expect(loadData({ dataDir: dirWith(['a.webp']), hiddenFile: fx('hidden.txt') }).projects[0]?.screenshot).toBe('a.webp')
  })
  it('falls back to null (generated card) when the file is missing', () => {
    expect(loadData({ dataDir: dirWith([]), hiddenFile: fx('hidden.txt') }).projects[0]?.screenshot).toBeNull()
  })
  it.each(['../x.webp', 'a/b.webp', 'a.svg', 'a b.webp', ''])('ProjectSchema rejects screenshot %j', (s) => {
    const base = JSON.parse(readFileSync(fx('generated/projects.json'), 'utf8'))[0]
    expect(() => ProjectSchema.parse({ ...base, screenshot: s })).toThrow()
  })
})
